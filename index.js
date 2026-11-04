// Memento — альбом воспоминаний: моменты чата становятся коллекционными карточками
// Этап 1: фундамент — регистрация, альбом у каждого чата свой, сверка веток, пустой биндер
// Этап 2: захват момента (выделение, меню сообщения, сцена) и текст карточки от модели
// Этап 3: картинка — банана через Naistera или Gemini-compatible, рефы из Frame, «Перерисовать»

import {
    ctx, getSettings, saveSettings, escapeHtml, makeId, currentChatId, getAlbum, saveAlbum, saveAlbumDebounced,
    reconcileAlbum, memoriesWord, confirmPopup, findCardMessage, TOAST_TITLE,
} from './store.js';
import { drawImage, deleteImageFile, getMissingDrawSetting } from './image.js';
import { layoutPages, spreadHtml, pageIndexOf, starsText, rarityOf } from './album.js';
import { addSettingsDrawer, ICON } from './settings.js';
import { initCapture, resetCapture, addMessageButtons } from './capture.js';
import { buildMomentPrompt, extractJson, cardFromAnswer, cleanMessageText } from './prompt.js';
import { requestModel } from './connection.js';

const NARROW = window.matchMedia('(max-width: 720px)');   // на телефоне — по одной странице

// ---------- Окно ----------

let overlayEl = null;
let pageCursor = 0;      // номер текущей страницы (на широком экране показываем её разворот)
let view = 'album';      // 'album' | 'scene'
let peekId = null;       // открытая карточка

function buildWindow() {
    const overlay = document.createElement('div');
    overlay.id = 'mmt-overlay';
    overlay.className = 'mmt-overlay';
    overlay.innerHTML = `
        <div class="mmt-window" role="dialog" aria-label="Memento">
            <div class="mmt-header">
                <div class="mmt-title"><i class="fa-solid ${ICON}"></i><span>「 MEMENTO 」</span></div>
                <div class="mmt-chatname"></div>
                <button class="mmt-icon-btn mmt-scene-btn" type="button" title="Выбрать сцену"><i class="fa-solid fa-film"></i></button>
                <button class="mmt-icon-btn mmt-close" type="button" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="mmt-body"></div>
            <div class="mmt-footer">
                <button class="mmt-icon-btn mmt-prev" type="button" title="Назад"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="mmt-pager"></div>
                <button class="mmt-icon-btn mmt-next" type="button" title="Вперёд"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <div class="mmt-peek" hidden></div>
        </div>`;

    overlay.querySelector('.mmt-close').addEventListener('click', closeWindow);
    overlay.querySelector('.mmt-prev').addEventListener('click', () => turn(-1));
    overlay.querySelector('.mmt-next').addEventListener('click', () => turn(1));
    overlay.querySelector('.mmt-scene-btn').addEventListener('click', () => setView(view === 'scene' ? 'album' : 'scene'));

    overlay.querySelector('.mmt-body').addEventListener('click', (e) => {
        const card = e.target.closest('.mmt-card[data-card]');
        if (card) openPeek(card.dataset.card);
    });

    // Клик мимо окна закрывает его (mousedown — чтобы выделение текста не закрывало случайно)
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeWindow();
    });

    document.body.appendChild(overlay);
    return overlay;
}

function isOpen() {
    return Boolean(overlayEl && overlayEl.classList.contains('mmt-open'));
}

function onKeyDown(e) {
    if (!isOpen()) return;
    if (document.querySelector('dialog[open]')) return;   // попап таверны поверх — пусть он сам
    if (e.key === 'Escape') {
        if (peekId) closePeek();
        else if (view === 'scene') setView('album');
        else closeWindow();
        return;
    }
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (view !== 'album' || peekId) return;
    if (e.key === 'ArrowLeft') turn(-1);
    else if (e.key === 'ArrowRight') turn(1);
}

function openWindow(nextView = 'album') {
    if (!overlayEl) overlayEl = buildWindow();
    overlayEl.classList.add('mmt-open');
    document.addEventListener('keydown', onKeyDown);
    view = nextView;
    render();
}

function closeWindow() {
    if (!overlayEl) return;
    closePeek();
    overlayEl.classList.remove('mmt-open');
    document.removeEventListener('keydown', onKeyDown);
}

function setView(next) {
    view = next;
    closePeek();
    render();
}

// ---------- Листание ----------

function step() {
    return NARROW.matches ? 1 : 2;
}

function turn(direction) {
    const album = getAlbum();
    if (!album || view !== 'album') return;
    const total = layoutPages(album.cards).length;
    const next = pageCursor + direction * step();
    if (next < 0 || next >= total) return;
    pageCursor = next;
    render();
}

// ---------- Отрисовка ----------

function render() {
    if (!overlayEl) return;
    const body = overlayEl.querySelector('.mmt-body');
    const footer = overlayEl.querySelector('.mmt-footer');
    const chatName = overlayEl.querySelector('.mmt-chatname');
    const sceneBtn = overlayEl.querySelector('.mmt-scene-btn');
    const album = getAlbum();

    sceneBtn.hidden = !album;
    sceneBtn.classList.toggle('mmt-active', view === 'scene');

    if (!album) {
        chatName.textContent = '';
        footer.hidden = true;
        body.innerHTML = `<div class="mmt-nochat">Открой чат — у каждого чата свой альбом.</div>`;
        return;
    }

    const count = album.cards.length;
    const chatId = currentChatId();
    chatName.textContent = `${chatId} · ${count} ${memoriesWord(count)}`;
    chatName.title = chatId;

    if (view === 'scene') {
        footer.hidden = true;
        renderScenePane(body);
        return;
    }

    const pages = layoutPages(album.cards);
    pageCursor = Math.max(0, Math.min(pageCursor, pages.length - 1));
    const spread = Math.floor(pageCursor / 2);
    const side = pageCursor % 2 ? 'right' : 'left';

    body.innerHTML = `
        <div class="mmt-binder mmt-theme-${escapeHtml(getSettings().theme)} mmt-show-${side}">
            ${spreadHtml(pages, spread)}
            ${count ? '' : `
                <div class="mmt-empty-note">
                    Здесь пока пусто. Выдели любимый момент в чате — и он станет первой карточкой.
                </div>`}
        </div>`;

    footer.hidden = false;
    const narrow = NARROW.matches;
    const shown = narrow ? `${pageCursor + 1}` : `${spread * 2 + 1}–${spread * 2 + 2}`;
    overlayEl.querySelector('.mmt-pager').textContent = `${shown} из ${pages.length}`;
    overlayEl.querySelector('.mmt-prev').disabled = narrow ? pageCursor === 0 : spread === 0;
    overlayEl.querySelector('.mmt-next').disabled = narrow
        ? pageCursor >= pages.length - 1
        : (spread + 1) * 2 >= pages.length;
}

// ---------- Выбор сцены (как в Junket) ----------

const QUICK_LAST = [5, 10];    // первое число — заодно выбор по умолчанию
const PREVIEW_CHARS = 120;
const rangeDrafts = new Map(); // черновик диапазона на чат (до перезагрузки страницы)

function lastIndex() {
    return (ctx().chat || []).length - 1;
}

function getDraft() {
    const chatId = currentChatId();
    if (!rangeDrafts.has(chatId)) {
        const last = lastIndex();
        rangeDrafts.set(chatId, last < 0 ? { from: '', to: '' } : { from: Math.max(0, last - QUICK_LAST[0] + 1), to: last });
    }
    return rangeDrafts.get(chatId);
}

function validateRange(draft) {
    const last = lastIndex();
    if (last < 0) return { ok: false, error: 'В этом чате пока нет сообщений.' };
    const parse = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const from = parse(draft.from);
    const to = parse(draft.to);
    if (from === null || to === null) return { ok: false, error: 'Укажи, с какого и по какое сообщение.' };
    if (!Number.isInteger(from) || !Number.isInteger(to)) return { ok: false, error: 'Номера сообщений — целые числа.' };
    if (from < 0 || to < 0 || from > last || to > last) return { ok: false, error: `В этом чате сообщения с 0 по ${last}.` };
    if (from > to) return { ok: false, error: '«С» должно быть не больше, чем «По».' };
    return { ok: true, from, to };
}

function previewRowHtml(index) {
    const msg = (ctx().chat || [])[index];
    if (!msg) return '';
    const text = cleanMessageText(msg.mes).replace(/[*_~`]+/g, '').replace(/\s+/g, ' ');
    const short = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : (text || '(пусто)');
    return `
        <div class="mmt-preview-row">
            <span class="mmt-preview-id">#${index}</span>
            <span class="mmt-preview-name">${escapeHtml(msg.name || '???')}</span>
            <span class="mmt-preview-text">${escapeHtml(short)}</span>
        </div>`;
}

function renderScenePane(body) {
    const draft = getDraft();
    body.innerHTML = `
        <div class="mmt-scene">
            <div class="mmt-scene-title">Выбрать сцену</div>
            <div class="mmt-scene-hint">Модель сама найдёт в ней самый запоминающийся момент.</div>
            <div class="mmt-range-row">
                <label class="mmt-range-field"><span>С</span>
                    <input class="mmt-range-from text_pole" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(draft.from)}">
                </label>
                <label class="mmt-range-field"><span>По</span>
                    <input class="mmt-range-to text_pole" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(draft.to)}">
                </label>
            </div>
            <div class="mmt-chips">
                ${QUICK_LAST.map((n) => `<button class="mmt-chip" type="button" data-last="${n}">Последние ${n}</button>`).join('')}
            </div>
            <div class="mmt-range-summary"></div>
            <div class="mmt-preview"></div>
            <div class="mmt-scene-actions">
                <button class="mmt-btn mmt-scene-back" type="button"><i class="fa-solid fa-arrow-left"></i> К альбому</button>
                <button class="menu_button mmt-go" type="button"><i class="fa-solid fa-camera-retro"></i> В альбом</button>
            </div>
        </div>`;

    const fromInput = body.querySelector('.mmt-range-from');
    const toInput = body.querySelector('.mmt-range-to');
    const refresh = () => {
        const result = validateRange(getDraft());
        const summary = body.querySelector('.mmt-range-summary');
        const box = body.querySelector('.mmt-preview');
        body.querySelector('.mmt-go').disabled = !result.ok;
        if (!result.ok) {
            summary.innerHTML = `<span class="mmt-error">${escapeHtml(result.error)}</span>`;
            box.innerHTML = '';
            return;
        }
        const count = result.to - result.from + 1;
        summary.textContent = `Выбрано сообщений: ${count}`;
        let rows = previewRowHtml(result.from);
        if (count > 2) rows += `<div class="mmt-preview-gap">… ещё ${count - 2} сообщ. между ними …</div>`;
        if (count > 1) rows += previewRowHtml(result.to);
        box.innerHTML = rows;
    };
    let typing = null;
    const onType = () => {
        rangeDrafts.set(currentChatId(), { from: fromInput.value, to: toInput.value });
        clearTimeout(typing);
        typing = setTimeout(refresh, 250);
    };
    fromInput.addEventListener('input', onType);
    toInput.addEventListener('input', onType);
    body.querySelectorAll('[data-last]').forEach((btn) => btn.addEventListener('click', () => {
        const last = lastIndex();
        if (last < 0) return;
        const from = Math.max(0, last - Number(btn.dataset.last) + 1);
        rangeDrafts.set(currentChatId(), { from, to: last });
        fromInput.value = from;
        toInput.value = last;
        refresh();
    }));
    body.querySelector('.mmt-scene-back').addEventListener('click', () => setView('album'));
    body.querySelector('.mmt-go').addEventListener('click', () => {
        const result = validateRange(getDraft());
        if (!result.ok) return;
        setView('album');
        develop({ mode: 'scene', from: result.from, to: result.to });
    });
    refresh();
}

// ---------- Проявка: момент → карточка ----------

const jobs = new Set();   // { controller, chatId, toast }

async function develop(moment) {
    const chatId = currentChatId();
    if (!chatId || !getAlbum()) {
        toastr.warning('Открой чат, чтобы сохранить воспоминание', TOAST_TITLE);
        return;
    }
    const controller = new AbortController();
    const toast = toastr.info('Проявляем воспоминание…', TOAST_TITLE, { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });
    const job = { controller, chatId, toast };
    jobs.add(job);

    try {
        const { instruction, contextText, from, to } = buildMomentPrompt(moment, getAlbum().cards);
        const raw = await requestModel({ instruction, contextText }, controller.signal);
        if (controller.signal.aborted || currentChatId() !== chatId) throw new DOMException('Aborted', 'AbortError');
        if (!String(raw).trim()) throw new Error('Модель вернула пустой ответ — попробуй ещё раз или увеличь лимит токенов ответа.');

        const fields = cardFromAnswer(extractJson(raw), moment, { from, to });
        const message = (ctx().chat || [])[fields.mesId];
        const card = {
            id: makeId(),
            title: fields.title,
            rarity: fields.rarity,
            quote: fields.quote,
            note: fields.note,
            prompt: fields.prompt,
            image: '',
            mesId: fields.mesId,
            sendDate: message?.send_date ?? null,
            swipeId: message?.swipe_id ?? 0,
            speaker: message?.name || '',
            calendarDate: null,
            createdAt: Date.now(),
        };
        const album = getAlbum();
        album.cards.push(card);
        await saveAlbum();

        toastr.success(`Воспоминание добавлено в альбом: «${card.title}» ${starsText(card)}`, TOAST_TITLE);
        if (isOpen() && view === 'album') {
            const index = pageIndexOf(layoutPages(album.cards), card.id);
            if (index >= 0) pageCursor = index;
            render();
        }
        drawCard(card.id);
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            if (!controller.quiet) toastr.info('Проявка остановлена', TOAST_TITLE);
        } else {
            console.error('[Memento]', error);
            toastr.error(`Не удалось проявить: ${String(error?.message || error)}`, TOAST_TITLE);
        }
    } finally {
        jobs.delete(job);
        toastr.clear(toast);
    }
}

// ---------- Картинка ----------

// Рисование не обрывается при смене чата: файл сохраняется, а ссылка ждёт в почтовом ящике (как в Reel)
const drawJobs = new Map();   // cardId → { controller, chatId }

function findCard(cardId) {
    return getAlbum()?.cards.find((c) => c.id === cardId) || null;
}

/** Файл карточки можно удалять, только если он родился в этом чате и больше ни у кого его нет. */
function canDeleteFile(card, path) {
    if (!path || card.imageChat !== currentChatId()) return false;
    return !getAlbum().cards.some((c) => c !== card && c.image === path);
}

function refreshViews(cardId) {
    if (!isOpen()) return;
    if (view === 'album') render();
    if (peekId === cardId) openPeek(cardId);
}

async function applyImage(card, image) {
    const oldPath = card.image;
    const oldDeletable = canDeleteFile(card, oldPath);
    card.image = image.path;
    card.imageChat = currentChatId();
    card.imageMeta = { provider: image.provider, model: image.model, refs: image.refs, style: image.style, createdAt: image.createdAt };
    card.drawStatus = null;
    card.drawError = null;
    await saveAlbum();
    if (oldDeletable && oldPath !== image.path) await deleteImageFile(oldPath);
}

async function drawCard(cardId) {
    const card = findCard(cardId);
    if (!card || drawJobs.has(cardId)) return;
    const missing = getMissingDrawSetting();
    if (missing) {
        toastr.warning(`Карточка без картинки — ${missing}. Загляни в настройки, «Рисование»`, TOAST_TITLE, { timeOut: 6000 });
        return;
    }

    const chatId = currentChatId();
    const controller = new AbortController();
    drawJobs.set(cardId, { controller, chatId });
    card.drawStatus = 'drawing';
    card.drawError = null;
    await saveAlbum();
    refreshViews(cardId);
    const title = card.title;

    let image = null;
    let failure = null;
    try {
        image = await drawImage(card.prompt, controller.signal);
    } catch (error) {
        failure = error;
    }
    drawJobs.delete(cardId);
    if (controller.signal.aborted) {
        // Карточку удалили, пока рисовалась — файл ей больше не нужен
        if (image?.path) await deleteImageFile(image.path);
        return;
    }

    if (currentChatId() !== chatId) {
        if (image) {
            getSettings().mailbox.push({ chatId, cardId, image });
            saveSettings();
            toastr.info(`Картинка для «${title}» готова — появится, когда вернёшься в тот чат`, TOAST_TITLE, { timeOut: 4000 });
        } else {
            toastr.error(`Банана не нарисовала «${title}» (${String(failure?.message || failure).slice(0, 200)})`, TOAST_TITLE, { timeOut: 8000 });
        }
        return;
    }

    const live = findCard(cardId);
    if (!live) {
        if (image?.path) await deleteImageFile(image.path);
        return;
    }
    if (image) {
        await applyImage(live, image);
        toastr.success(`Картинка для «${title}» готова`, TOAST_TITLE, { timeOut: 2500 });
    } else {
        const text = String(failure?.message || failure);
        console.warn('[Memento] рисование упало:', failure);
        live.drawStatus = 'error';
        live.drawError = text;
        await saveAlbum();
        toastr.error(`Банана не нарисовала «${title}» (${text.slice(0, 200)}). Карточка в альбоме — жми «Перерисовать»`, TOAST_TITLE, { timeOut: 8000 });
    }
    refreshViews(cardId);
}

/** Дорисованное, пока ты была в другом чате, — на место. И сброс зависших «рисуется» после перезагрузки. */
async function deliverMailbox() {
    const album = getAlbum();
    if (!album) return;
    const chatId = currentChatId();
    let changed = false;

    for (const card of album.cards) {
        if (card.drawStatus === 'drawing' && !drawJobs.has(card.id)) {
            card.drawStatus = 'error';
            card.drawError = 'Рисование прервалось (таверну перезагрузили?)';
            changed = true;
        }
    }

    const s = getSettings();
    const mine = s.mailbox.filter((m) => m.chatId === chatId);
    if (mine.length) {
        s.mailbox = s.mailbox.filter((m) => m.chatId !== chatId);
        saveSettings();
        for (const item of mine) {
            const card = album.cards.find((c) => c.id === item.cardId);
            if (card) await applyImage(card, item.image);
            else await deleteImageFile(item.image?.path);
        }
        changed = false;   // applyImage уже сохранил
    }
    if (changed) saveAlbumDebounced();
}

// ---------- Временный просмотр карточки (большой вид с оборотом — этап 4) ----------

function openPeek(cardId) {
    const album = getAlbum();
    const card = album?.cards.find((c) => c.id === cardId);
    if (!card || !overlayEl) return;
    peekId = cardId;
    const where = findCardMessage(card);
    const drawing = card.drawStatus === 'drawing';
    const box = overlayEl.querySelector('.mmt-peek');
    let art = '';
    if (card.image) art = `<img class="mmt-peek-img" src="${escapeHtml(card.image)}" alt="">`;
    if (drawing) art = `<div class="mmt-peek-wait"><i class="fa-solid fa-spinner fa-spin"></i> Рисуется…</div>`;
    else if (card.drawStatus === 'error') art += `<div class="mmt-peek-error">${escapeHtml(card.drawError || 'Картинка не нарисовалась')}</div>`;
    box.innerHTML = `
        <div class="mmt-peek-card mmt-r${rarityOf(card)}">
            ${art}
            <div class="mmt-peek-stars">${starsText(card)}</div>
            <div class="mmt-peek-title">${escapeHtml(card.title)}</div>
            <blockquote class="mmt-peek-quote">${escapeHtml(card.quote)}</blockquote>
            ${card.note ? `<div class="mmt-peek-note">${escapeHtml(card.note)}</div>` : ''}
            <div class="mmt-peek-meta">${where >= 0 ? `#${where}` : 'сообщения больше нет'}${card.speaker ? ` · ${escapeHtml(card.speaker)}` : ''}</div>
            <div class="mmt-peek-actions">
                <button class="mmt-btn mmt-peek-delete" type="button"><i class="fa-solid fa-trash-can"></i> Удалить</button>
                <button class="mmt-btn mmt-peek-redraw" type="button" ${drawing ? 'disabled' : ''}><i class="fa-solid fa-rotate"></i> Перерисовать</button>
                <button class="mmt-btn mmt-peek-close" type="button">Закрыть</button>
            </div>
        </div>`;
    box.hidden = false;
    box.querySelector('.mmt-peek-close').addEventListener('click', closePeek);
    box.querySelector('.mmt-peek-redraw').addEventListener('click', () => drawCard(cardId));
    box.querySelector('.mmt-peek-delete').addEventListener('click', () => deleteCard(cardId));
    box.onmousedown = (e) => { if (e.target === box) closePeek(); };
}

function closePeek() {
    peekId = null;
    const box = overlayEl?.querySelector('.mmt-peek');
    if (box) {
        box.hidden = true;
        box.innerHTML = '';
    }
}

async function deleteCard(cardId) {
    const album = getAlbum();
    const card = album?.cards.find((c) => c.id === cardId);
    if (!card) return;
    // В ветке картинка принадлежит родительскому чату — её не трогаем
    const deletable = canDeleteFile(card, card.image);
    const text = deletable
        ? 'Удалить это воспоминание из альбома? Картинка тоже удалится.'
        : 'Удалить это воспоминание из альбома?';
    if (!(await confirmPopup(text))) return;
    const job = drawJobs.get(cardId);
    if (job) {
        job.controller.abort();
        drawJobs.delete(cardId);
    }
    album.cards = album.cards.filter((c) => c.id !== cardId);
    await saveAlbum();
    if (deletable) await deleteImageFile(card.image);
    closePeek();
    render();
}

// ---------- Вход ----------

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('mmt-wand')) return;

    const item = document.createElement('div');
    item.id = 'mmt-wand';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = `<div class="fa-solid ${ICON} extensionsMenuExtensionButton"></div><span>Memento</span>`;
    item.addEventListener('click', () => openWindow());
    menu.appendChild(item);
}

function onChatChanged() {
    // Карточка по старому чату больше не нужна — сохранить её некуда
    for (const job of jobs) {
        job.controller.quiet = true;
        job.controller.abort();
    }
    if (jobs.size) toastr.info('Проявка остановлена: сменился чат', TOAST_TITLE);
    jobs.clear();

    pageCursor = 0;
    view = 'album';
    closePeek();
    resetCapture();
    addMessageButtons();
    if (reconcileAlbum()) saveAlbumDebounced();
    deliverMailbox().finally(() => { if (isOpen()) render(); });
    if (isOpen()) render();
}

jQuery(async () => {
    getSettings();
    addSettingsDrawer(() => openWindow());
    addWandButton();
    initCapture((moment) => develop(moment));

    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    // Подгрузка старых сообщений и новые посты — кнопке в меню нужны и они
    for (const key of ['MORE_MESSAGES_LOADED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED']) {
        if (event_types[key]) eventSource.on(event_types[key], addMessageButtons);
    }
    // Повернула телефон или сузила окно — пересобрать разворот
    NARROW.addEventListener?.('change', () => { if (isOpen()) render(); });
});
