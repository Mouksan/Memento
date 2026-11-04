// Memento — как ловится момент:
//  1) выделение текста → кнопка 📸 в панельке ST-Quotes (или своя запасная над началом выделения);
//  2) «В альбом» в меню сообщения — с выделением в этом сообщении берём его,
//     без выделения — весь пост как сцену из одного сообщения.
// Выбор сцены диапазоном живёт в окне альбома (index.js).

const SELECTION_SETTLE_MS = 180;     // ST-Quotes показывает свою панельку через 120 мс — мы чуть позже
const SELECTION_TTL_MS = 30_000;     // сколько помним снятое выделение (меню сообщения снимает его кликом)
const STQ_POPUP_ID = 'stq-sel-popup';
const BUTTON_TITLE = 'В альбом';

let onCapture = () => {};
let lastSelection = null;    // { text, mesId, collapsedAt }
let floatBtn = null;
let settleTimer = null;

// ---------- Выделение ----------

function elementOf(node) {
    return (node && node.nodeType === 3 ? node.parentElement : node) || null;
}

/** Текущее выделение внутри текста одного сообщения чата, или null. */
function readSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;

    const range = sel.getRangeAt(0);
    const common = elementOf(range.commonAncestorContainer);
    const anchorText = elementOf(sel.anchorNode)?.closest?.('#chat .mes[mesid] .mes_text');
    const focusText = elementOf(sel.focusNode)?.closest?.('#chat .mes[mesid] .mes_text');
    // Только внутри одного сообщения и только в его тексте (не в имени, не в поле редактирования)
    if (!anchorText || anchorText !== focusText) return null;
    if (common?.closest?.('textarea, .mes_edit_textarea')) return null;

    const mesId = Number.parseInt(anchorText.closest('.mes').getAttribute('mesid'), 10);
    if (!Number.isInteger(mesId)) return null;
    return { text, mesId, range };
}

function rememberedFor(mesId) {
    if (!lastSelection || lastSelection.mesId !== mesId) return null;
    if (lastSelection.collapsedAt && Date.now() - lastSelection.collapsedAt > SELECTION_TTL_MS) return null;
    return lastSelection.text;
}

function onSelectionChange() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(syncWithSelection, SELECTION_SETTLE_MS);
}

function syncWithSelection() {
    const current = readSelection();
    if (current) {
        lastSelection = { text: current.text, mesId: current.mesId, collapsedAt: 0 };
    } else if (lastSelection && !lastSelection.collapsedAt) {
        lastSelection.collapsedAt = Date.now();
    }

    if (!current) {
        hideFloat();
        return;
    }
    // ST-Quotes показал свою панельку — встраиваемся в неё, свою кнопку не показываем
    if (injectIntoQuotes()) hideFloat();
    else showFloat(current.range);
}

function captureSelection() {
    const current = readSelection();
    const text = current?.text || lastSelection?.text;
    const mesId = current?.mesId ?? lastSelection?.mesId;
    if (!text || !Number.isInteger(mesId)) return;
    lastSelection = null;
    try { window.getSelection()?.removeAllRanges(); } catch { /* ничего */ }
    hideFloat();
    onCapture({ mode: 'quote', mesId, quote: text });
}

/** На телефоне клик по кнопке поверх выделения часто проглатывается — ловим и touchend (как ST-Quotes). */
function bindTap(el, handler) {
    let lastTouch = 0;
    el.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lastTouch = Date.now();
        handler();
    });
    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() - lastTouch < 700) return;
        handler();
    });
    // Не даём клику снять выделение
    el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
}

// ---------- Кнопка в панельке ST-Quotes ----------

/** true, если панелька ST-Quotes сейчас видна и наша кнопка в ней. */
function injectIntoQuotes() {
    const popup = document.getElementById(STQ_POPUP_ID);
    if (!popup || popup.classList.contains('stq-hidden')) return false;
    const row = popup.querySelector('.stq-sel-row');
    if (!row) return false;
    if (!row.querySelector('.mmt-stq-btn')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mmt-stq-btn';
        btn.title = BUTTON_TITLE;
        btn.innerHTML = '<i class="fa-solid fa-camera-retro"></i>';
        bindTap(btn, captureSelection);
        const pen = row.querySelector('.stq-sel-note-btn');
        if (pen) pen.after(btn);
        else row.appendChild(btn);
    }
    return true;
}

// ---------- Своя запасная кнопка ----------

function buildFloat() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mmt-sel-btn';
    btn.className = 'mmt-sel-btn';
    btn.title = BUTTON_TITLE;
    btn.hidden = true;
    btn.innerHTML = '<i class="fa-solid fa-camera-retro"></i>';
    bindTap(btn, captureSelection);
    document.body.appendChild(btn);
    return btn;
}

/** Над началом выделения — с противоположной от ST-Quotes стороны. */
function showFloat(range) {
    if (!floatBtn) floatBtn = buildFloat();
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const first = rects[0] || range.getBoundingClientRect();
    floatBtn.hidden = false;
    const size = floatBtn.offsetWidth || 32;
    const pad = 8;
    let top = first.top - size - 6;
    if (top < pad) top = first.bottom + 6;   // у самого верха экрана — под первой строкой
    const left = Math.max(pad, Math.min(first.left - 4, window.innerWidth - size - pad));
    floatBtn.style.top = `${Math.round(top)}px`;
    floatBtn.style.left = `${Math.round(left)}px`;
}

function hideFloat() {
    if (floatBtn) floatBtn.hidden = true;
}

// ---------- «В альбом» в меню сообщения ----------

const MES_BUTTON_HTML = `<div class="mes_button mmt-mes-btn fa-solid fa-camera-retro interactable" title="${BUTTON_TITLE}" tabindex="0"></div>`;

/** Шаблон новых сообщений + те, что уже на экране. */
export function addMessageButtons() {
    const template = document.querySelector('#message_template .extraMesButtons');
    if (template && !template.querySelector('.mmt-mes-btn')) template.insertAdjacentHTML('afterbegin', MES_BUTTON_HTML);
    document.querySelectorAll('#chat .mes .extraMesButtons').forEach((box) => {
        if (!box.querySelector('.mmt-mes-btn')) box.insertAdjacentHTML('afterbegin', MES_BUTTON_HTML);
    });
}

function onMessageButton(e) {
    const btn = e.target.closest?.('.mmt-mes-btn');
    if (!btn) return;
    e.stopPropagation();
    const mesId = Number.parseInt(btn.closest('.mes[mesid]')?.getAttribute('mesid') || '', 10);
    if (!Number.isInteger(mesId)) return;
    const quote = rememberedFor(mesId);
    lastSelection = null;
    if (quote) onCapture({ mode: 'quote', mesId, quote });
    else onCapture({ mode: 'scene', from: mesId, to: mesId });
}

// ---------- Запуск ----------

export function initCapture(handler) {
    onCapture = handler;
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mouseup', onSelectionChange);
    document.addEventListener('touchend', onSelectionChange);
    document.addEventListener('keyup', onSelectionChange);
    window.addEventListener('scroll', hideFloat, true);
    document.addEventListener('click', onMessageButton);
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.mmt-mes-btn')) {
            e.preventDefault();
            onMessageButton(e);
        }
    });
    addMessageButtons();
}

export function resetCapture() {
    lastSelection = null;
    hideFloat();
}
