// Memento — темы альбома.
// Тема меняет обложку, страницы, переплёт, держатели карточек, рубашку и вид приписок.
// Своя у каждого чата (album.theme), по умолчанию — из настроек.
// ready: false — тема уже в списке, но ещё не нарисована (появится в следующих этапах).
// Здесь — разметка украшений; как они выглядят, решает themes/<тема>.css.

import { escapeHtml } from './store.js';

export const DEFAULT_THEME = 'binder';

export const THEMES = [
    { id: 'binder', name: 'Полночный биндер', swatch: 'radial-gradient(circle at 30% 20%, #3a3560, #17152a 75%)', ready: true },
    { id: 'scrapbook', name: 'Скрапбук', swatch: 'linear-gradient(135deg, #c19b6c 50%, #4e331f 51%)', ready: true },
    { id: 'polaroid', name: 'Полароид', swatch: 'linear-gradient(135deg, #fbfaf6 45%, #1d1d20 46%)', ready: true },
    { id: 'dossier', name: 'Досье', swatch: 'linear-gradient(135deg, #d2b47a 60%, #b2222a 61%)', ready: true },
    { id: 'silk', name: 'Шёлковая книга', swatch: 'linear-gradient(135deg, #1f5a52 60%, #b8954a 61%)', ready: false },
    { id: 'grimoire', name: 'Гримуар', swatch: 'radial-gradient(circle at 30% 20%, #3e1418, #140406 75%)', ready: false },
    { id: 'wedding', name: 'Свадебный', swatch: 'linear-gradient(135deg, #fbf8f2 60%, #c9a24e 61%)', ready: false },
    { id: 'deepspace', name: 'Deepspace', swatch: 'conic-gradient(from 120deg, #7af3ff, #a98bff, #ff8fd8, #ffe08a, #7af3ff)', ready: false },
    { id: 'diary', name: 'Дневничок', swatch: 'linear-gradient(135deg, #f4b8c8, #dccfff)', ready: false },
];

export function getTheme(id) {
    const theme = THEMES.find((t) => t.id === id);
    return theme && theme.ready ? theme : THEMES.find((t) => t.id === DEFAULT_THEME);
}

/** Тема этого альбома: своя у чата, иначе — по умолчанию из настроек. */
export function effectiveThemeId(album, settings) {
    return getTheme(album?.theme || settings?.theme || DEFAULT_THEME).id;
}

// ---------- Постоянная «случайность» от id карточки ----------

/** Число 0…1, всегда одинаковое для одной и той же строки. */
export function seeded(text, salt = '') {
    let h = 2166136261;
    const s = `${text}|${salt}`;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
}

/** Точек вокруг фото на 5★ странице, где может стоять приписка (классы .mmt-spot-0…5). */
export const SCRIBBLE_SPOTS = 6;

export function scribbleSpot(cardId) {
    return Math.floor(seeded(cardId, 'spot') * SCRIBBLE_SPOTS);
}

export function scribbleTilt(cardId) {
    return Math.round((seeded(cardId, 'tilt') * 10 - 5) * 10) / 10;   // −5…+5°
}

/** Наклон карточки на странице (там, где тема его использует): −3…+3°. */
export function cardTilt(cardId) {
    return Math.round((seeded(cardId, 'card-tilt') * 6 - 3) * 10) / 10;
}

// ---------- Переплёт поверх разворота ----------

export function bindingHtml(themeId) {
    if (themeId === 'binder') {
        return `
            <div class="mmt-binding" aria-hidden="true">
                <span class="mmt-plate"><span class="mmt-rivet"></span><span class="mmt-rivet"></span></span>
                <span class="mmt-ring mmt-ring-1"></span><span class="mmt-ring mmt-ring-2"></span><span class="mmt-ring mmt-ring-3"></span>
            </div>`;
    }
    if (themeId === 'scrapbook') return '<div class="mmt-binding" aria-hidden="true"><span class="mmt-stitch"></span></div>';
    if (themeId === 'polaroid') return '<div class="mmt-binding" aria-hidden="true"><span class="mmt-spiral"></span></div>';
    if (themeId === 'dossier') return '<div class="mmt-binding" aria-hidden="true"><span class="mmt-fold"></span></div>';
    return '';
}

// ---------- Обложка ----------

/** Номер дела для досье — постоянный для чата. */
export function caseNumber(chatId) {
    return String(Math.floor(seeded(chatId, 'case') * 9000) + 1000);
}

export function coverDecorHtml(themeId, info) {
    if (themeId === 'dossier') {
        return `<span class="mmt-dossier-tab">ДЕЛО № ${escapeHtml(info.caseNo)}</span>`;
    }
    return '';
}

// ---------- Рубашка запечатанной карточки ----------

export function sealHtml(themeId) {
    if (themeId === 'scrapbook') {
        return `
            <span class="mmt-seal" aria-hidden="true">
                <span class="mmt-stamp"><span class="mmt-seal-mark">✦</span><span class="mmt-seal-name">MEMENTO</span></span>
            </span>`;
    }
    if (themeId === 'polaroid') {
        return `
            <span class="mmt-seal" aria-hidden="true">
                <span class="mmt-film"><span class="mmt-seal-mark">✦</span></span>
                <span class="mmt-seal-name">проявляется…</span>
            </span>`;
    }
    if (themeId === 'dossier') {
        return `
            <span class="mmt-seal" aria-hidden="true">
                <span class="mmt-envelope-tie"></span>
                <span class="mmt-seal-name">СЕКРЕТНО</span>
            </span>`;
    }
    return `
        <span class="mmt-seal" aria-hidden="true">
            <span class="mmt-seal-mark">✦</span>
            <span class="mmt-seal-name">MEMENTO</span>
        </span>`;
}

// ---------- Держатели карточки ----------

/** Уголки, скотч, скрепка — поверх карточки в кармашке. hero — карточка на своей странице. */
export function holderDecorHtml(themeId, card, { hero = false, exhibit = 0 } = {}) {
    if (!card) return '';
    if (themeId === 'scrapbook') {
        // Половина карточек — на фотоуголках, половина — на скотче
        if (!hero && seeded(card.id, 'holder') < 0.5) {
            return '<span class="mmt-corner mmt-corner-tl"></span><span class="mmt-corner mmt-corner-tr"></span><span class="mmt-corner mmt-corner-bl"></span><span class="mmt-corner mmt-corner-br"></span>';
        }
        if (!hero && seeded(card.id, 'tape') < 0.5) {
            return '<span class="mmt-tape mmt-tape-diag1"></span><span class="mmt-tape mmt-tape-diag2"></span>';
        }
        return `<span class="mmt-tape mmt-tape-top" style="--mmt-tape-tilt: ${Math.round(seeded(card.id, 'tt') * 8 - 4)}deg;"></span>`;
    }
    if (themeId === 'polaroid') {
        return hero && card.revealed !== false ? '<span class="mmt-sticker"></span>' : '';
    }
    if (themeId === 'dossier') {
        const side = seeded(card.id, 'clip') < 0.5 ? 'left' : 'right';
        const labelSide = side === 'left' ? 'right' : 'left';   // номер — с другой стороны от скрепки
        const label = card.revealed === false ? '' : `<span class="mmt-exhibit mmt-exhibit-${labelSide}">${hero ? 'ВЕЩДОК ' : ''}№${exhibit}</span>`;
        return `<span class="mmt-clip mmt-clip-${side}"></span>${label}`;
    }
    return '';
}

// ---------- Украшения страницы ----------

/** Поля бланка в досье, штампы, след от кружки. */
export function pageDecorHtml(themeId, page, side, pageNumber, info) {
    if (themeId !== 'dossier') return '';
    const parts = [];
    if (side === 'left') {
        parts.push(`<span class="mmt-field mmt-field-1">ОБЪЕКТ: <u>${escapeHtml(info.charName || '—')}</u></span>`);
        parts.push(`<span class="mmt-field mmt-field-2">ИСТОЧНИК: <u>${escapeHtml(info.userName || '—')}</u></span>`);
    } else {
        parts.push(`<span class="mmt-field mmt-field-1">ДЕЛО № ${escapeHtml(info.caseNo)} · ЛИСТ ${pageNumber}</span>`);
    }
    if (page.kind === 'hero' && page.cards[0]?.revealed !== false) {
        parts.push('<span class="mmt-stamp-big">СОВ. СЕКРЕТНО</span>');
    }
    if (seeded(`${info.caseNo}-${pageNumber}`, 'stain') < 0.35) {
        parts.push(`<span class="mmt-stain" style="--mmt-stain-y: ${Math.round(seeded(pageNumber, 'sy') * 60 + 15)}%;"></span>`);
    }
    return parts.join('');
}
