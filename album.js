// Memento — раскладка карточек по страницам и вёрстка биндера.

import { escapeHtml } from './store.js';

export const POCKETS_PER_PAGE = 4;   // 3★ и 4★ — сетка 2×2

/**
 * Раскладка по страницам, в хронологии сообщений.
 * 3★ и 4★ ложатся по 4 на страницу; каждая 5★ получает свою страницу.
 * Перед 5★ недобитая страница закрывается как есть — пустые кармашки остаются,
 * как в настоящем биндере, зато порядок воспоминаний не ломается.
 * Страница: { kind: 'grid', cards: [...] } или { kind: 'hero', cards: [card] }.
 */
export function layoutPages(cards) {
    const sorted = [...cards].sort((a, b) => (a.mesId - b.mesId) || ((a.createdAt || 0) - (b.createdAt || 0)));
    const pages = [];
    let grid = [];

    const flush = () => {
        if (grid.length) pages.push({ kind: 'grid', cards: grid });
        grid = [];
    };

    for (const card of sorted) {
        if (Number(card.rarity) === 5) {
            flush();
            pages.push({ kind: 'hero', cards: [card] });
        } else {
            grid.push(card);
            if (grid.length === POCKETS_PER_PAGE) flush();
        }
    }
    flush();

    // Пустой альбом — всё равно разворот с пустыми кармашками
    while (pages.length < 2) pages.push({ kind: 'grid', cards: [] });
    // Разворот всегда из двух страниц
    if (pages.length % 2) pages.push({ kind: 'grid', cards: [] });
    return pages;
}

export function rarityOf(card) {
    return Math.max(3, Math.min(5, Number(card?.rarity) || 3));
}

export function starsText(card) {
    return '★'.repeat(rarityOf(card));
}

/** Страница, на которой лежит карточка (для прыжка к новой). */
export function pageIndexOf(pages, cardId) {
    return pages.findIndex((p) => p.cards.some((c) => c.id === cardId));
}

// Карточка в кармашке. Картинки появятся на этапе 3 — пока вместо неё подложка цвета редкости.
function cardHtml(card) {
    const rarity = rarityOf(card);
    const art = card.image
        ? `<img class="mmt-card-img" src="${escapeHtml(card.image)}" alt="" loading="lazy">`
        : `<div class="mmt-card-blank"><i class="fa-solid fa-camera-retro"></i></div>`;
    let badge = '';
    if (card.drawStatus === 'drawing') badge = '<span class="mmt-card-badge mmt-card-drawing" title="Рисуется"><i class="fa-solid fa-spinner fa-spin"></i></span>';
    else if (card.drawStatus === 'error') badge = '<span class="mmt-card-badge mmt-card-failed" title="Картинка не нарисовалась"><i class="fa-solid fa-triangle-exclamation"></i></span>';
    return `
        <button type="button" class="mmt-card mmt-r${rarity}" data-card="${escapeHtml(card.id)}" title="${escapeHtml(card.title || '')}">
            ${art}
            ${badge}
            <span class="mmt-card-caption">
                <span class="mmt-card-stars">${starsText(card)}</span>
                <span class="mmt-card-title">${escapeHtml(card.title || '')}</span>
            </span>
        </button>`;
}

function pocketHtml(card) {
    return `<div class="mmt-pocket ${card ? 'mmt-filled' : ''}">${card ? cardHtml(card) : ''}</div>`;
}

export function pageHtml(page, side, pageNumber) {
    let inner;
    if (page.kind === 'hero') {
        inner = `<div class="mmt-pockets mmt-pockets-hero">${pocketHtml(page.cards[0])}</div>`;
    } else {
        const pockets = [];
        for (let i = 0; i < POCKETS_PER_PAGE; i++) pockets.push(pocketHtml(page.cards[i]));
        inner = `<div class="mmt-pockets mmt-pockets-grid">${pockets.join('')}</div>`;
    }
    return `
        <div class="mmt-page mmt-page-${side}" data-page="${pageNumber}" data-density="soft">
            <div class="mmt-holes" aria-hidden="true"><span></span><span></span><span></span></div>
            ${inner}
            <div class="mmt-page-num">${pageNumber}</div>
        </div>`;
}

/** Все страницы книги подряд: чётные — левые, нечётные — правые (листает PageFlip). */
export function bookPagesHtml(pages) {
    return pages.map((page, i) => pageHtml(page, i % 2 ? 'right' : 'left', i + 1)).join('');
}
