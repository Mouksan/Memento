// Memento — альбом воспоминаний: моменты чата становятся коллекционными карточками
// Этап 1: фундамент — регистрация, альбом у каждого чата свой, сверка веток, пустой биндер

import {
    ctx, getSettings, escapeHtml, currentChatId, getAlbum, saveAlbumDebounced,
    reconcileAlbum, memoriesWord,
} from './store.js';
import { layoutPages, spreadHtml } from './album.js';

const ICON = 'fa-book-bookmark';
const NARROW = window.matchMedia('(max-width: 720px)');   // на телефоне — по одной странице

// ---------- Окно ----------

let overlayEl = null;
let pageCursor = 0;   // номер текущей страницы (на широком экране показываем её разворот)

function buildWindow() {
    const overlay = document.createElement('div');
    overlay.id = 'mmt-overlay';
    overlay.className = 'mmt-overlay';
    overlay.innerHTML = `
        <div class="mmt-window" role="dialog" aria-label="Memento">
            <div class="mmt-header">
                <div class="mmt-title"><i class="fa-solid ${ICON}"></i><span>「 MEMENTO 」</span></div>
                <div class="mmt-chatname"></div>
                <button class="mmt-icon-btn mmt-close" type="button" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="mmt-body"></div>
            <div class="mmt-footer">
                <button class="mmt-icon-btn mmt-prev" type="button" title="Назад"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="mmt-pager"></div>
                <button class="mmt-icon-btn mmt-next" type="button" title="Вперёд"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
        </div>`;

    overlay.querySelector('.mmt-close').addEventListener('click', closeWindow);
    overlay.querySelector('.mmt-prev').addEventListener('click', () => turn(-1));
    overlay.querySelector('.mmt-next').addEventListener('click', () => turn(1));

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
    if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return;
    if (e.key === 'Escape') closeWindow();
    else if (e.key === 'ArrowLeft') turn(-1);
    else if (e.key === 'ArrowRight') turn(1);
}

function openWindow() {
    if (!overlayEl) overlayEl = buildWindow();
    overlayEl.classList.add('mmt-open');
    document.addEventListener('keydown', onKeyDown);
    render();
}

function closeWindow() {
    if (!overlayEl) return;
    overlayEl.classList.remove('mmt-open');
    document.removeEventListener('keydown', onKeyDown);
}

// ---------- Листание ----------

function step() {
    return NARROW.matches ? 1 : 2;
}

function turn(direction) {
    const album = getAlbum();
    if (!album) return;
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
    const album = getAlbum();

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

// ---------- Вход ----------

function addSettingsDrawer() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('mmt-settings')) return;

    const wrap = document.createElement('div');
    wrap.id = 'mmt-settings';
    wrap.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid ${ICON}" style="margin-right: 6px;"></i>「 MEMENTO 」</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="mmt-drawer">
                    <div class="mmt-drawer-hint">Альбом воспоминаний: любимые моменты чата превращаются в коллекционные карточки.</div>
                    <button class="menu_button mmt-open-btn" type="button">
                        <i class="fa-solid ${ICON}"></i>
                        <span>Открыть альбом</span>
                    </button>
                </div>
            </div>
        </div>`;
    host.appendChild(wrap);
    wrap.querySelector('.mmt-open-btn').addEventListener('click', openWindow);
}

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('mmt-wand')) return;

    const item = document.createElement('div');
    item.id = 'mmt-wand';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = `<div class="fa-solid ${ICON} extensionsMenuExtensionButton"></div><span>Memento</span>`;
    item.addEventListener('click', openWindow);
    menu.appendChild(item);
}

function onChatChanged() {
    pageCursor = 0;
    if (reconcileAlbum()) saveAlbumDebounced();
    if (isOpen()) render();
}

jQuery(async () => {
    getSettings();
    addSettingsDrawer();
    addWandButton();

    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    // Повернула телефон или сузила окно — пересобрать разворот
    NARROW.addEventListener?.('change', () => { if (isOpen()) render(); });
});
