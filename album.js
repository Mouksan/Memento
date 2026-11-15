// Memento — раскладка карточек по страницам и вёрстка биндера.

import { escapeHtml } from './store.js';
import { seeded, scribbleSpot, scribbleTilt, cardTilt, sealHtml, holderDecorHtml, pageDecorHtml, pageLabel } from './themes.js';

export const POCKETS_PER_PAGE = 4;   // 3★ и 4★ — сетка 2×2

/**
 * Раскладка по страницам, в хронологии сообщений.
 * 3★ и 4★ ложатся по 4 на страницу; каждая 5★ получает свою страницу.
 * Если 5★ застаёт страницу недобитой, пустых дыр посреди альбома не оставляем:
 *  - 1 карточка — страница-заметка: карточка и записка с её цитатой;
 *  - 2–3 карточки — жребий 50/50 (постоянный, от id 5★):
 *    орёл — страница добирается следующими 3–4★ (только теми, что идут сразу за этой 5★
 *    и до следующей 5★), а 5★ встаёт после неё; если добрать до 4 нечем — как решка;
 *    решка — раскладка: две по диагонали, три треугольником.
 * Последняя страница альбома остаётся с пустыми кармашками — ждёт новых карточек.
 * Страница: { kind: 'grid', layout: 'full' | 'note' | 'diag' | 'tri', mirror, cards }
 *        или { kind: 'hero', cards: [card] }.
 */
export function layoutPages(cards) {
    const sorted = [...cards].sort((a, b) => (a.mesId - b.mesId) || ((a.createdAt || 0) - (b.createdAt || 0)));
    const isHero = (card) => Number(card.rarity) === 5;
    const taken = new Set();   // 3–4★, которые уже забрали вперёд на недобитую страницу
    const pages = [];
    let grid = [];

    const flush = (layout = 'full', seedId = '') => {
        if (grid.length) {
            pages.push({ kind: 'grid', layout, mirror: seeded(seedId || grid[0].id, 'mirror') < 0.5, cards: grid });
        }
        grid = [];
    };

    for (let i = 0; i < sorted.length; i++) {
        const card = sorted[i];
        if (taken.has(card.id)) continue;
        if (!isHero(card)) {
            grid.push(card);
            if (grid.length === POCKETS_PER_PAGE) flush();
            continue;
        }
        if (grid.length === 1) {
            flush('note', card.id);
        } else if (grid.length > 1) {
            let filled = false;
            if (seeded(card.id, 'float') < 0.5) {
                // Орёл: добираем следующими 3–4★ до ближайшей 5★
                const extra = [];
                for (let j = i + 1; j < sorted.length && grid.length + extra.length < POCKETS_PER_PAGE; j++) {
                    if (isHero(sorted[j])) break;
                    if (!taken.has(sorted[j].id)) extra.push(sorted[j]);
                }
                if (grid.length + extra.length === POCKETS_PER_PAGE) {
                    for (const x of extra) taken.add(x.id);
                    grid.push(...extra);
                    flush();
                    filled = true;
                }
            }
            if (!filled) flush(grid.length === 2 ? 'diag' : 'tri', card.id);
        }
        pages.push({ kind: 'hero', cards: [card] });
    }
    flush();

    // Пустой альбом — всё равно разворот с пустыми кармашками
    while (pages.length < 2) pages.push({ kind: 'grid', layout: 'full', cards: [] });
    // Разворот всегда из двух страниц
    if (pages.length % 2) pages.push({ kind: 'grid', layout: 'full', cards: [] });
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

// Карточка в кармашке.
function cardHtml(card, themeId) {
    const rarity = rarityOf(card);
    // Запечатанная (ещё не вытянутая): рубашка со свечением редкости, без спойлеров
    if (card.revealed === false) {
        const wait = card.drawStatus === 'drawing' ? '<span class="mmt-card-badge mmt-card-drawing" title="Проявляется"><i class="fa-solid fa-spinner fa-spin"></i></span>' : '';
        return `
            <button type="button" class="mmt-card mmt-r${rarity} mmt-sealed" data-card="${escapeHtml(card.id)}" title="Новое воспоминание">
                ${sealHtml(themeId)}
                ${wait}
            </button>`;
    }
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

function pocketHtml(card, opts, hero = false) {
    if (!card) return '<div class="mmt-pocket"></div>';
    const decor = holderDecorHtml(opts.themeId, card, { hero, exhibit: opts.exhibits.get(card.id) || 0 });
    return `
        <div class="mmt-pocket mmt-filled mmt-r${rarityOf(card)}" style="--mmt-card-tilt: ${cardTilt(card.id)}deg;">
            ${cardHtml(card, opts.themeId)}
            ${decor}
        </div>`;
}

/**
 * Приписка на полях 5★ страницы и карандаш в её внешнем верхнем углу.
 * У запечатанной карточки — ничего: приписка была бы спойлером.
 */
function scribbleHtml(card) {
    if (!card || card.revealed === false) return '';
    const text = String(card.scribble || '').trim();
    const note = text
        ? `<span class="mmt-scribble mmt-spot-${scribbleSpot(card.id)}" style="--mmt-tilt: ${scribbleTilt(card.id)}deg;">${escapeHtml(text)}</span>`
        : '';
    return `${note}
        <button type="button" class="mmt-scribble-edit" data-scribble="${escapeHtml(card.id)}" title="${text ? 'Изменить приписку' : 'Добавить приписку'}" aria-label="${text ? 'Изменить приписку' : 'Добавить приписку'}">
            <i class="fa-solid fa-pen"></i>
        </button>`;
}

// ---------- Страница-заметка ----------

export const NOTE_MAX_CHARS = 300;

/** Цитата для записки: до 300 знаков, обрезка по границе слова и «…». */
export function noteText(quote) {
    const text = String(quote || '').replace(/\s+/g, ' ').trim();
    if (text.length <= NOTE_MAX_CHARS) return text;
    const cut = text.slice(0, NOTE_MAX_CHARS + 1);
    const space = cut.lastIndexOf(' ');
    const head = (space > NOTE_MAX_CHARS * 0.6 ? cut.slice(0, space) : text.slice(0, NOTE_MAX_CHARS)).replace(/[\s,;:.—–-]+$/u, '');
    return `${head}…`;
}

/** Карточка по центру сверху, под ней записка с её цитатой; у запечатанной — сложенная записка без текста. */
function noteLayoutHtml(page, opts) {
    const card = page.cards[0];
    const tilt = Math.round((seeded(card.id, 'note-tilt') * 3 - 1.5) * 10) / 10;
    let note;
    if (card.revealed === false) {
        note = `<div class="mmt-note mmt-note-sealed" style="--mmt-note-tilt: ${tilt}deg;" aria-hidden="true"><span class="mmt-note-fold"></span></div>`;
    } else {
        const text = noteText(card.quote);
        const size = text.length > 220 ? ' mmt-note-long' : text.length > 140 ? ' mmt-note-mid' : '';
        note = text
            ? `<div class="mmt-note${size}" style="--mmt-note-tilt: ${tilt}deg;"><span class="mmt-note-text">${escapeHtml(text)}</span></div>`
            : '';
    }
    return `<div class="mmt-pockets mmt-pockets-note">${pocketHtml(card, opts)}${note}</div>`;
}

export function pageHtml(page, side, pageNumber, opts) {
    let inner;
    if (page.kind === 'hero') {
        inner = `<div class="mmt-pockets mmt-pockets-hero">${pocketHtml(page.cards[0], opts, true)}</div>${scribbleHtml(page.cards[0])}`;
    } else if (page.layout === 'note') {
        inner = noteLayoutHtml(page, opts);
    } else if (page.layout === 'diag' || page.layout === 'tri') {
        // Только сами карточки, без пустых кармашков. Сетка 4 колонки: карточка занимает две,
        // так что размер тот же, что в обычной сетке, а одиночку в ряду можно поставить по центру.
        const flip = page.mirror ? ' mmt-flip-x' : '';
        inner = `<div class="mmt-pockets mmt-pockets-${page.layout}${flip}">${page.cards.map((c) => pocketHtml(c, opts)).join('')}</div>`;
    } else {
        const pockets = [];
        for (let i = 0; i < POCKETS_PER_PAGE; i++) pockets.push(pocketHtml(page.cards[i], opts));
        inner = `<div class="mmt-pockets mmt-pockets-grid">${pockets.join('')}</div>`;
    }
    const layout = page.kind === 'grid' ? ` mmt-layout-${page.layout || 'full'}` : '';
    return `
        <div class="mmt-page mmt-page-${side} mmt-page-${page.kind}${layout}" data-page="${pageNumber}" data-density="soft">
            <div class="mmt-holes" aria-hidden="true"><span></span><span></span><span></span></div>
            ${pageDecorHtml(opts.themeId, page, side, pageNumber, opts.info, opts.exhibits)}
            ${inner}
            <div class="mmt-page-num">${pageLabel(opts.themeId, pageNumber)}</div>
        </div>`;
}

/**
 * Все страницы книги подряд: чётные — левые, нечётные — правые (листает PageFlip).
 * opts: { themeId, info: { charName, userName, caseNo } }
 */
export function bookPagesHtml(pages, opts) {
    // Номера улик для досье — по порядку карточек в альбоме
    const exhibits = new Map();
    let n = 0;
    for (const page of pages) for (const card of page.cards) exhibits.set(card.id, ++n);
    const full = { themeId: opts.themeId, info: opts.info || {}, exhibits };
    return pages.map((page, i) => pageHtml(page, i % 2 ? 'right' : 'left', i + 1, full)).join('');
}
