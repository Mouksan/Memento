// Memento — альбом воспоминаний: моменты чата становятся коллекционными карточками
// Этап 1: фундамент — регистрация, альбом у каждого чата свой, сверка веток, пустой биндер
// Этап 2: захват момента (выделение, меню сообщения, сцена) и текст карточки от модели
// Этап 3: картинка — банана через Naistera или Gemini-compatible, рефы из Frame, «Перерисовать»
// Этап 4: книга с перелистыванием, большой вид карточки с оборотом, «К моменту», дата из Hearthtide

import {
    ctx, getSettings, saveSettings, escapeHtml, makeId, currentChatId, getAlbum, saveAlbum, saveAlbumDebounced,
    reconcileAlbum, memoriesWord, confirmPopup, findCardMessage, TOAST_TITLE,
} from './store.js';
import { drawImage, deleteImageFile, getMissingDrawSetting } from './image.js';
import { layoutPages, bookPagesHtml, pageIndexOf, starsText, rarityOf } from './album.js';
import { THEMES, getTheme, effectiveThemeId, bindingHtml } from './themes.js';
import { PageFlip } from './lib/page-flip.module.js';
import { findHearthDate } from './hearth.js';
import { addSettingsDrawer, ICON } from './settings.js';
import { initCapture, resetCapture, addMessageButtons } from './capture.js';
import { buildMomentPrompt, extractJson, cardFromAnswer, cleanMessageText } from './prompt.js';
import { requestModel } from './connection.js';

// ---------- Окно ----------

let overlayEl = null;
let pageCursor = 0;      // номер текущей страницы
let view = 'album';      // 'album' | 'scene'
let viewId = null;       // открытая в большом виде карточка
let solo = false;        // большой вид над чатом, без окна альбома (новая карточка)
let book = null;         // PageFlip

function buildWindow() {
    const overlay = document.createElement('div');
    overlay.id = 'mmt-overlay';
    overlay.className = 'mmt-overlay';
    overlay.innerHTML = `
        <div class="mmt-window" role="dialog" aria-label="Memento">
            <div class="mmt-header">
                <div class="mmt-title"><i class="fa-solid ${ICON}"></i><span>「 MEMENTO 」</span></div>
                <div class="mmt-chatname"></div>
                <button class="mmt-icon-btn mmt-theme-btn" type="button" title="Тема альбома" aria-haspopup="true" aria-expanded="false"><i class="fa-solid fa-palette"></i></button>
                <button class="mmt-icon-btn mmt-scene-btn" type="button" title="Выбрать сцену"><i class="fa-solid fa-film"></i></button>
                <div class="mmt-theme-menu" hidden></div>
                <button class="mmt-icon-btn mmt-close" type="button" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="mmt-body"></div>
            <div class="mmt-footer">
                <button class="mmt-icon-btn mmt-prev" type="button" title="Назад"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="mmt-pager"></div>
                <button class="mmt-icon-btn mmt-next" type="button" title="Вперёд"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
        </div>
        <div class="mmt-view" hidden></div>`;

    overlay.querySelector('.mmt-close').addEventListener('click', closeWindow);
    overlay.querySelector('.mmt-prev').addEventListener('click', () => turn(-1));
    overlay.querySelector('.mmt-next').addEventListener('click', () => turn(1));
    overlay.querySelector('.mmt-scene-btn').addEventListener('click', () => setView(view === 'scene' ? 'album' : 'scene'));
    overlay.querySelector('.mmt-theme-btn').addEventListener('click', toggleThemeMenu);
    overlay.querySelector('.mmt-theme-menu').addEventListener('click', onThemeMenuClick);

    overlay.querySelector('.mmt-body').addEventListener('click', (e) => {
        const edit = e.target.closest('.mmt-scribble-edit[data-scribble]');
        if (edit) {
            editScribble(edit.dataset.scribble);
            return;
        }
        const card = e.target.closest('.mmt-card[data-card]');
        if (card) openCardView(card.dataset.card);
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
        if (isThemeMenuOpen()) closeThemeMenu();
        else if (viewId || solo) closeCardView();
        else if (view === 'scene') setView('album');
        else closeWindow();
        return;
    }
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (viewId) {
        if (e.key === ' ' || e.key === 'Enter') {
            if (e.target instanceof Element && e.target.closest('button:not(.mmt-flip)')) return;
            e.preventDefault();
            flipCard();
        }
        return;
    }
    if (view !== 'album') return;
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
    closeThemeMenu();
    solo = false;
    closeCardView();
    destroyBook();
    overlayEl.classList.remove('mmt-open', 'mmt-solo');
    document.removeEventListener('keydown', onKeyDown);
}

/** Окно альбома видно (не режим «над чатом»). */
function albumVisible() {
    return isOpen() && !solo && view === 'album';
}

/** Новая карточка над чатом: рубашкой вверх, открывается кликом. */
function openSolo(cardId) {
    if (!findCard(cardId)) return;
    if (!overlayEl) overlayEl = buildWindow();
    if (isOpen() && !solo) {
        // Альбом уже открыт — вытягиваем прямо в нём
        openAtCard(cardId);
        return;
    }
    solo = true;
    overlayEl.classList.add('mmt-open', 'mmt-solo');
    document.addEventListener('keydown', onKeyDown);
    openCardView(cardId, { waitClick: true });
}

/** «В альбом»: из режима над чатом — в окно альбома, на страницу этой карточки. */
function soloToAlbum(cardId) {
    const album = getAlbum();
    if (!album) return;
    solo = false;
    overlayEl.classList.remove('mmt-solo');
    closeCardView();
    const index = pageIndexOf(layoutPages(album.cards), cardId);
    if (index >= 0) pageCursor = index;
    view = 'album';
    render();
}

function setView(next) {
    view = next;
    closeCardView();
    render();
}

// ---------- Книга (PageFlip) ----------

function destroyBook() {
    if (!book) return;
    try { book.destroy(); } catch { /* уже снята */ }
    book = null;
}

function isLandscape() {
    try {
        return book?.getOrientation?.() === 'landscape';
    } catch {
        return window.innerWidth > 720;
    }
}

function turn(direction) {
    if (!book || view !== 'album' || viewId) return;
    if (direction > 0) book.flipNext('top');
    else book.flipPrev('top');
}

function updatePager() {
    if (!overlayEl || !book) return;
    const total = book.getPageCount();
    const index = book.getCurrentPageIndex();
    pageCursor = index;
    const landscape = isLandscape();
    const shown = landscape ? `${index + 1}–${Math.min(total, index + 2)}` : `${index + 1}`;
    overlayEl.querySelector('.mmt-pager').textContent = `${shown} из ${total}`;
    overlayEl.querySelector('.mmt-prev').disabled = index <= 0;
    overlayEl.querySelector('.mmt-next').disabled = index + (landscape ? 2 : 1) >= total;
    overlayEl.querySelector('.mmt-binder')?.classList.toggle('mmt-portrait', !landscape);
}

/** Размер страницы под окно: книга должна влезть по высоте без прокрутки. */
function pageSize() {
    const maxHeight = Math.max(300, Math.min(640, window.innerHeight - 230));
    return { width: 400, height: 540, maxHeight, maxWidth: Math.round(maxHeight / 1.35) };
}

function renderBook(body, album) {
    destroyBook();
    const themeId = effectiveThemeId(album, getSettings());
    const pages = layoutPages(album.cards);
    pageCursor = Math.max(0, Math.min(pageCursor, pages.length - 1));
    const count = album.cards.length;

    body.innerHTML = `
        <div class="mmt-binder mmt-th-${themeId}">
            <div class="mmt-book-host">
                <div class="mmt-book">${bookPagesHtml(pages)}</div>
                ${bindingHtml(themeId)}
            </div>
            ${count ? '' : `
                <div class="mmt-empty-note">
                    Здесь пока пусто. Выдели любимый момент в чате — и он станет первой карточкой.
                </div>`}
        </div>`;

    const bookEl = body.querySelector('.mmt-book');
    const size = pageSize();
    book = new PageFlip(bookEl, {
        width: size.width,
        height: size.height,
        size: 'stretch',
        minWidth: 200,
        maxWidth: size.maxWidth,
        minHeight: 270,
        maxHeight: size.maxHeight,
        usePortrait: true,
        showCover: false,
        autoSize: true,
        startPage: pageCursor,
        flippingTime: 650,
        maxShadowOpacity: 0.35,
        showPageCorners: true,
        disableFlipByClick: true,     // листаем стрелками и уголком — клик по странице не перелистывает
        clickEventForward: true,      // клики по карточкам доходят до нас
        mobileScrollSupport: false,
    });
    book.loadFromHTML(bookEl.querySelectorAll('.mmt-page'));
    book.on('flip', updatePager);
    book.on('changeOrientation', updatePager);
    updatePager();
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
        destroyBook();
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
        destroyBook();
        footer.hidden = true;
        renderScenePane(body);
        return;
    }

    footer.hidden = false;
    renderBook(body, album);
}

// ---------- Тема альбома (своя у чата) ----------

function isThemeMenuOpen() {
    return Boolean(overlayEl && !overlayEl.querySelector('.mmt-theme-menu').hidden);
}

function closeThemeMenu() {
    if (!overlayEl) return;
    overlayEl.querySelector('.mmt-theme-menu').hidden = true;
    overlayEl.querySelector('.mmt-theme-btn').setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutsideThemeMenu, true);
}

function onOutsideThemeMenu(e) {
    if (e.target.closest?.('.mmt-theme-menu, .mmt-theme-btn')) return;
    closeThemeMenu();
}

function toggleThemeMenu() {
    if (isThemeMenuOpen()) {
        closeThemeMenu();
        return;
    }
    const album = getAlbum();
    if (!album) return;
    const settings = getSettings();
    const own = album.theme && getTheme(album.theme).id === album.theme ? album.theme : '';
    const fallback = getTheme(settings.theme).name;
    const item = (id, name, swatch, { active, disabled, note } = {}) => `
        <button type="button" class="mmt-theme-item ${active ? 'mmt-active' : ''}" data-theme="${id}" ${disabled ? 'disabled' : ''}>
            <span class="mmt-theme-swatch" style="background: ${swatch};"></span>
            <span class="mmt-theme-name">${escapeHtml(name)}</span>
            ${note ? `<span class="mmt-theme-note">${escapeHtml(note)}</span>` : ''}
            ${active ? '<i class="fa-solid fa-check"></i>' : ''}
        </button>`;
    const menu = overlayEl.querySelector('.mmt-theme-menu');
    menu.innerHTML = `
        <div class="mmt-theme-head">Тема этого альбома</div>
        ${item('', `По умолчанию (${fallback})`, getTheme(settings.theme).swatch, { active: !own })}
        ${THEMES.map((t) => item(t.id, t.name, t.swatch, { active: own === t.id, disabled: !t.ready, note: t.ready ? '' : 'скоро' })).join('')}`;
    menu.hidden = false;
    overlayEl.querySelector('.mmt-theme-btn').setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutsideThemeMenu, true);
}

function onThemeMenuClick(e) {
    const btn = e.target.closest('.mmt-theme-item');
    if (!btn || btn.disabled) return;
    const album = getAlbum();
    if (!album) return;
    album.theme = btn.dataset.theme || null;
    saveAlbumDebounced();
    closeThemeMenu();
    render();
}

// ---------- Приписка на полях 5★ ----------

async function editScribble(cardId) {
    const card = findCard(cardId);
    if (!card) return;
    const c = ctx();
    let value;
    if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE?.INPUT !== undefined) {
        value = await c.callGenericPopup(
            '<h3>Приписка на полях</h3><div>1–4 слова. Сотри всё — и приписки не будет.</div>',
            c.POPUP_TYPE.INPUT,
            card.scribble || '',
            { okButton: 'Сохранить', cancelButton: 'Отмена', rows: 2 },
        );
    } else {
        value = window.prompt('Приписка на полях (1–4 слова). Пусто — убрать.', card.scribble || '');
    }
    if (typeof value !== 'string') return;   // отмена
    const live = findCard(cardId);
    if (!live) return;
    live.scribble = value.replace(/\s+/g, ' ').trim().slice(0, 60);
    await saveAlbum();
    render();
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
            scribble: fields.scribble,
            prompt: fields.prompt,
            image: '',
            mesId: fields.mesId,
            sendDate: message?.send_date ?? null,
            swipeId: message?.swipe_id ?? 0,
            speaker: message?.name || '',
            calendarDate: findHearthDate(ctx().chat, fields.mesId) || false,
            createdAt: Date.now(),
            revealed: false,     // вскрывается сценой вытягивания (этап 5)
        };
        const album = getAlbum();
        album.cards.push(card);
        await saveAlbum();

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
    if (albumVisible()) render();
    if (viewId === cardId) openCardView(cardId, { waitClick: solo });
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
        if (card.revealed === false) announceNew(cardId);
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
    const sealed = card.revealed === false;
    const label = sealed ? 'новое воспоминание' : `«${title}»`;

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
            toastr.info(sealed ? 'Новое воспоминание готово — ждёт в том чате' : `Картинка для «${title}» готова — появится, когда вернёшься в тот чат`, TOAST_TITLE, { timeOut: 4000 });
        } else {
            toastr.error(`Банана не нарисовала ${label} (${String(failure?.message || failure).slice(0, 200)})`, TOAST_TITLE, { timeOut: 8000 });
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
        if (live.revealed === false) announceNew(cardId);
        else toastr.success(`Картинка для «${title}» готова`, TOAST_TITLE, { timeOut: 2500 });
    } else {
        const text = String(failure?.message || failure);
        console.warn('[Memento] рисование упало:', failure);
        live.drawStatus = 'error';
        live.drawError = text;
        await saveAlbum();
        toastr.error(`Банана не нарисовала ${label} (${text.slice(0, 200)}). Карточка в альбоме — жми «Перерисовать»`, TOAST_TITLE, { timeOut: 8000, onclick: () => openAtCard(cardId) });
    }
    refreshViews(cardId);
}

/** Тост без спойлеров: название и редкость видно только после вытягивания. */
function announceNew(cardId) {
    // Сразу над чатом — если включено и сейчас не открыта другая карточка
    if (getSettings().revealPopup && !viewId && !revealingId) {
        openSolo(cardId);
        return;
    }
    toastr.success('Новое воспоминание ждёт в альбоме — нажми, чтобы открыть', TOAST_TITLE, {
        timeOut: 8000,
        onclick: () => openSolo(cardId),
    });
}

function openAtCard(cardId) {
    const album = getAlbum();
    if (!album?.cards.some((c) => c.id === cardId)) return;
    const index = pageIndexOf(layoutPages(album.cards), cardId);
    if (index >= 0) pageCursor = index;
    view = 'album';
    openWindow();
    openCardView(cardId);
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

// ---------- Большой вид карточки ----------

let viewFlipped = false;

/** Дата и место из Hearthtide: сохраняем один раз, старым карточкам — при первом открытии. */
function ensureCalendarDate(card) {
    if (card.calendarDate !== null && card.calendarDate !== undefined) return;
    const index = findCardMessage(card);
    if (index < 0) return;
    card.calendarDate = findHearthDate(ctx().chat, index) || false;   // false — смотрели, тега нет
    saveAlbumDebounced();
}

function dateLine(card) {
    const d = card.calendarDate;
    if (!d) return '';
    return [d.label, d.place].filter(Boolean).join(' · ');
}

let revealTimers = [];
let revealingId = null;

function clearReveal() {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    revealingId = null;
}

function openCardView(cardId, { waitClick = false } = {}) {
    const card = findCard(cardId);
    if (!card || !overlayEl) return;
    if (revealingId === cardId) return;   // идёт вытягивание — не перебиваем его перерисовкой
    const sealed = card.revealed === false;
    if (sealed && card.drawStatus === 'drawing') {
        toastr.info('Ещё проявляется…', TOAST_TITLE, { timeOut: 2000 });
        return;
    }
    if (viewId !== cardId) viewFlipped = false;
    viewId = cardId;
    ensureCalendarDate(card);

    const rarity = rarityOf(card);
    const drawing = card.drawStatus === 'drawing';
    const where = findCardMessage(card);
    const date = dateLine(card);

    let art;
    if (card.image) art = `<img class="mmt-face-img" src="${escapeHtml(card.image)}" alt="">`;
    else art = `<div class="mmt-face-blank"><i class="fa-solid fa-camera-retro"></i></div>`;
    if (drawing) art += `<div class="mmt-face-wait"><i class="fa-solid fa-spinner fa-spin"></i> Рисуется…</div>`;

    const meta = [
        where >= 0 ? `#${where}` : 'сообщения больше нет',
        card.speaker ? escapeHtml(card.speaker) : '',
    ].filter(Boolean).join(' · ');

    const box = overlayEl.querySelector('.mmt-view');
    box.className = `mmt-view mmt-th-${effectiveThemeId(getAlbum(), getSettings())}`;
    box.innerHTML = `
        <div class="mmt-view-inner">
            <button class="mmt-icon-btn mmt-view-close" type="button" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            <button class="mmt-flip mmt-r${rarity} ${viewFlipped || sealed ? 'mmt-flipped' : ''} ${sealed ? 'mmt-sealing' : ''}" type="button" title="Перевернуть">
                ${sealed ? '<span class="mmt-rays" aria-hidden="true"></span>' : ''}
                <span class="mmt-flip-inner">
                    <span class="mmt-face mmt-face-front">
                        ${art}
                        ${rarity === 5 ? '<span class="mmt-holo" aria-hidden="true"></span>' : ''}
                        <span class="mmt-face-caption">
                            <span class="mmt-face-stars">${starsText(card)}</span>
                            <span class="mmt-face-title">${escapeHtml(card.title)}</span>
                        </span>
                    </span>
                    <span class="mmt-face mmt-face-back">
                        <span class="mmt-seal" aria-hidden="true">
                            <span class="mmt-seal-mark">✦</span>
                            <span class="mmt-seal-name">MEMENTO</span>
                        </span>
                        ${date ? `<span class="mmt-back-date">${escapeHtml(date)}</span>` : ''}
                        <span class="mmt-back-note">${escapeHtml(card.note || '…')}</span>
                        <span class="mmt-back-title">${escapeHtml(card.title)} ${starsText(card)}</span>
                    </span>
                </span>
            </button>
            <div class="mmt-view-side ${sealed ? (waitClick ? 'mmt-awaiting-side' : 'mmt-hidden-side') : ''}">
                <div class="mmt-view-hint">
                    <div class="mmt-view-hint-title">Новое воспоминание</div>
                    <div>Нажми на карточку, чтобы открыть.</div>
                    <div class="mmt-view-hint-sub">Закроешь — она подождёт в альбоме запечатанной.</div>
                </div>
                <blockquote class="mmt-view-quote mmt-r${rarity}">${escapeHtml(card.quote)}</blockquote>
                <div class="mmt-view-meta">${meta}${date ? `<br>${escapeHtml(date)}` : ''}</div>
                ${card.drawStatus === 'error' ? `<div class="mmt-view-error">${escapeHtml(card.drawError || 'Картинка не нарисовалась')}</div>` : ''}
                <div class="mmt-view-actions">
                    <button class="mmt-btn" type="button" data-act="flip"><i class="fa-solid fa-rotate-left"></i> Перевернуть</button>
                    <button class="mmt-btn" type="button" data-act="jump" ${where >= 0 ? '' : 'disabled'}><i class="fa-solid fa-location-arrow"></i> К моменту</button>
                    <button class="mmt-btn" type="button" data-act="redraw" ${drawing ? 'disabled' : ''}><i class="fa-solid fa-paintbrush"></i> Перерисовать</button>
                    <button class="mmt-btn mmt-btn-danger" type="button" data-act="delete"><i class="fa-solid fa-trash-can"></i> Удалить</button>
                    ${solo ? '<button class="mmt-btn" type="button" data-act="album"><i class="fa-solid fa-book-open"></i> В альбом</button>' : ''}
                </div>
            </div>
        </div>`;
    box.hidden = false;

    box.querySelector('.mmt-view-close').addEventListener('click', closeCardView);
    box.querySelector('.mmt-flip').addEventListener('click', () => {
        if (revealingId) finishReveal(true);
        else if (findCard(cardId)?.revealed === false) startReveal(findCard(cardId));   // ждала клика
        else flipCard();
    });
    box.querySelector('[data-act="album"]')?.addEventListener('click', () => soloToAlbum(cardId));
    if (rarity === 5) bindHolo(box.querySelector('.mmt-flip'));
    if (sealed && !waitClick) startReveal(card);
    box.querySelector('[data-act="flip"]').addEventListener('click', flipCard);
    box.querySelector('[data-act="jump"]').addEventListener('click', () => jumpToMoment(cardId));
    box.querySelector('[data-act="redraw"]').addEventListener('click', () => drawCard(cardId));
    box.querySelector('[data-act="delete"]').addEventListener('click', () => deleteCard(cardId));
    box.onmousedown = (e) => { if (e.target === box) closeCardView(); };
}

// ---------- Вытягивание ----------

const REVEAL_CHARGE_MS = 1300;   // рубашка разгорается
const REVEAL_FLIP_MS = 650;      // переворот (как .mmt-flip-inner в CSS)

function startReveal(card) {
    clearReveal();
    revealingId = card.id;
    const el = overlayEl.querySelector('.mmt-flip');
    const side = overlayEl.querySelector('.mmt-view-side');
    side?.classList.remove('mmt-awaiting-side');
    side?.classList.add('mmt-hidden-side');
    el.classList.add('mmt-charging');
    revealTimers.push(setTimeout(() => finishReveal(false), REVEAL_CHARGE_MS));
}

/** Переворот на арт. skip — по клику: сразу, без ожидания. */
function finishReveal(skip) {
    const cardId = revealingId;
    if (!cardId || !overlayEl) return;
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    const box = overlayEl.querySelector('.mmt-view');
    const el = box.querySelector('.mmt-flip');
    el.classList.remove('mmt-charging', 'mmt-flipped');
    el.classList.add('mmt-burst');
    box.querySelector('.mmt-rays')?.classList.add('mmt-rays-on');
    viewFlipped = false;

    revealTimers.push(setTimeout(() => {
        el.classList.remove('mmt-sealing');
        box.querySelector('.mmt-view-side')?.classList.remove('mmt-hidden-side');
        revealingId = null;
        const card = findCard(cardId);
        if (card) {
            card.revealed = true;
            saveAlbumDebounced();
        }
        if (albumVisible()) render();
    }, skip ? REVEAL_FLIP_MS / 2 : REVEAL_FLIP_MS));
    revealTimers.push(setTimeout(() => el.classList.remove('mmt-burst'), 2200));
}

// ---------- Голография 5★ ----------

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

function bindHolo(el) {
    const reset = () => {
        el.style.setProperty('--mx', '50%');
        el.style.setProperty('--my', '50%');
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
    };
    reset();
    el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
        if (!REDUCED_MOTION.matches) {
            el.style.setProperty('--rx', `${((x - 0.5) * 14).toFixed(2)}deg`);
            el.style.setProperty('--ry', `${((0.5 - y) * 14).toFixed(2)}deg`);
        }
    });
    el.addEventListener('pointerleave', reset);
}

function flipCard() {
    const el = overlayEl?.querySelector('.mmt-flip');
    if (!el) return;
    viewFlipped = !viewFlipped;
    el.classList.toggle('mmt-flipped', viewFlipped);
}

function closeCardView() {
    if (revealingId) {
        // Закрыла посреди вытягивания — считаем вскрытой, второй раз не мучаем
        const card = findCard(revealingId);
        if (card) {
            card.revealed = true;
            saveAlbumDebounced();
        }
        clearReveal();
        if (albumVisible()) render();
    }
    viewId = null;
    viewFlipped = false;
    const box = overlayEl?.querySelector('.mmt-view');
    if (box) {
        box.hidden = true;
        box.innerHTML = '';
    }
    // Над чатом закрыть карточку — значит закрыть всё
    if (solo) {
        solo = false;
        overlayEl.classList.remove('mmt-open', 'mmt-solo');
        document.removeEventListener('keydown', onKeyDown);
    }
}

// ---------- К моменту ----------

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jumpToMoment(cardId) {
    const card = findCard(cardId);
    if (!card) return;
    const index = findCardMessage(card);
    if (index < 0) {
        toastr.info('Этого сообщения в чате больше нет', TOAST_TITLE);
        return;
    }
    closeWindow();

    const selector = `#chat .mes[mesid="${index}"]`;
    let el = document.querySelector(selector);
    // Сообщение выше подгруженного — просим таверну догрузить (/chat-jump есть в свежих версиях)
    if (!el) {
        const c = ctx();
        const hasJump = Boolean(c.SlashCommandParser?.commands?.['chat-jump']);
        if (hasJump && typeof c.executeSlashCommandsWithOptions === 'function') {
            try {
                await c.executeSlashCommandsWithOptions(`/chat-jump ${index}`, { handleExecutionErrors: true });
                await wait(400);
                el = document.querySelector(selector);
            } catch (error) {
                console.warn('[Memento] /chat-jump не сработал:', error);
            }
        }
    }
    if (!el) {
        toastr.info(`Сообщение #${index} ещё не подгружено — пролистай чат выше и нажми «К моменту» ещё раз`, TOAST_TITLE, { timeOut: 5000 });
        return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mmt-flash');
    setTimeout(() => el.classList.remove('mmt-flash'), 1800);

    const message = ctx().chat?.[index];
    if (message && String(message.send_date) !== String(card.sendDate)) {
        toastr.info('Момент из другого свайпа этого сообщения', TOAST_TITLE, { timeOut: 3500 });
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
    closeCardView();
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
    if (solo) closeWindow();
    closeCardView();
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
});
