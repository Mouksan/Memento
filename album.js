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

// Пока карточек нет (этап 2+), кармашек с карточкой — просто подпись
function cardHtml(card) {
    const stars = '★'.repeat(Math.max(3, Math.min(5, Number(card.rarity) || 3)));
    return `
        <div class="mmt-card" data-card="${escapeHtml(card.id)}" data-rarity="${escapeHtml(card.rarity)}">
            <div class="mmt-card-stars">${stars}</div>
            <div class="mmt-card-title">${escapeHtml(card.title || '')}</div>
        </div>`;
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
        <div class="mmt-page mmt-page-${side}" data-page="${pageNumber}">
            <div class="mmt-holes" aria-hidden="true"><span></span><span></span><span></span></div>
            ${inner}
            <div class="mmt-page-num">${pageNumber}</div>
        </div>`;
}

/** Разворот: две страницы и кольца посередине. */
export function spreadHtml(pages, spreadIndex) {
    const left = pages[spreadIndex * 2];
    const right = pages[spreadIndex * 2 + 1];
    return `
        <div class="mmt-spread">
            ${pageHtml(left, 'left', spreadIndex * 2 + 1)}
            <div class="mmt-rings" aria-hidden="true"><span></span><span></span><span></span></div>
            ${pageHtml(right, 'right', spreadIndex * 2 + 2)}
        </div>`;
}
