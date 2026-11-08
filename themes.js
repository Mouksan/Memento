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
    { id: 'silk', name: 'Шёлковая книга', swatch: 'linear-gradient(135deg, #1f5a52 60%, #b8954a 61%)', ready: true },
    { id: 'grimoire', name: 'Гримуар', swatch: 'radial-gradient(circle at 30% 20%, #3e1418, #140406 75%)', ready: true },
    { id: 'wedding', name: 'Свадебный', swatch: 'linear-gradient(135deg, #fbf8f2 60%, #c9a24e 61%)', ready: true },
    { id: 'deepspace', name: 'Deepspace', swatch: 'conic-gradient(from 120deg, #7af3ff, #a98bff, #ff8fd8, #ffe08a, #7af3ff)', ready: true },
    { id: 'diary', name: 'Дневничок', swatch: 'linear-gradient(135deg, #f4b8c8, #dccfff)', ready: true },
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
    if (themeId === 'silk' || themeId === 'wedding') return '<div class="mmt-binding" aria-hidden="true"><span class="mmt-ribbon"></span></div>';
    if (themeId === 'grimoire') return '<div class="mmt-binding" aria-hidden="true"><span class="mmt-gutter"></span></div>';
    if (themeId === 'deepspace') return '<div class="mmt-binding" aria-hidden="true"><span class="mmt-seam"></span></div>';
    if (themeId === 'diary') {
        return `<div class="mmt-binding" aria-hidden="true"><span class="mmt-prings">${'<span></span>'.repeat(6)}</span></div>`;
    }
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
    if (themeId === 'grimoire') {
        // Кованые уголки и застёжка
        return '<span class="mmt-iron mmt-iron-tl" aria-hidden="true"></span><span class="mmt-iron mmt-iron-tr" aria-hidden="true"></span>'
            + '<span class="mmt-iron mmt-iron-bl" aria-hidden="true"></span><span class="mmt-iron mmt-iron-br" aria-hidden="true"></span>'
            + '<span class="mmt-clasp" aria-hidden="true"></span>';
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
    if (themeId === 'silk') {
        // Красный лак с иероглифом «память»
        return '<span class="mmt-seal" aria-hidden="true"><span class="mmt-seal-mark mmt-glyph">忆</span></span>';
    }
    if (themeId === 'grimoire') {
        // Чёрная кожа и восковая печать
        return '<span class="mmt-seal" aria-hidden="true"><span class="mmt-wax"><span class="mmt-seal-mark">✦</span></span></span>';
    }
    if (themeId === 'deepspace') {
        // Созвездие в голографическом кольце
        return '<span class="mmt-seal" aria-hidden="true"><span class="mmt-halo"></span><span class="mmt-seal-name">MEMORY</span></span>';
    }
    if (themeId === 'diary') {
        // Пастель в горошек и звезда-наклейка
        return `<span class="mmt-seal" aria-hidden="true">${STAR_SVG.replace('class="mmt-sticker-svg"', 'class="mmt-sticker-svg mmt-seal-star"')}<span class="mmt-seal-name">memento</span></span>`;
    }
    if (themeId === 'wedding') {
        // Слоновая кость, монограмма в двойном круге
        return '<span class="mmt-seal" aria-hidden="true"><span class="mmt-mono">M</span><span class="mmt-seal-name">Memento</span></span>';
    }
    return `
        <span class="mmt-seal" aria-hidden="true">
            <span class="mmt-seal-mark">✦</span>
            <span class="mmt-seal-name">MEMENTO</span>
        </span>`;
}

// ---------- Держатели карточки ----------

const STAR_SVG = '<svg class="mmt-sticker-svg" viewBox="0 0 54 52" aria-hidden="true"><path d="M27 3 L33.5 19 L50.5 19.8 L37.3 30.6 L41.7 47.2 L27 37.8 L12.3 47.2 L16.7 30.6 L3.5 19.8 L20.5 19 Z" fill="#ffd36e" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>';
const HEART_SVG = '<svg class="mmt-sticker-svg" viewBox="0 0 34 32" aria-hidden="true"><path d="M17 30 C 3 20, 0 12, 4 6 C 8 0, 15 2, 17 8 C 19 2, 26 0, 30 6 C 34 12, 31 20, 17 30 Z" fill="#ff8fb1" stroke="#fff" stroke-width="2.5"/></svg>';

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
    if (themeId === 'silk') {
        // Облачные уголки паспарту; на 5★ — красная печать-ханко на углу
        const hanko = hero && card.revealed !== false ? '<span class="mmt-hanko">忆</span>' : '';
        return `<span class="mmt-cloud mmt-cloud-tl"></span><span class="mmt-cloud mmt-cloud-br"></span>${hanko}`;
    }
    if (themeId === 'grimoire') return '<span class="mmt-slit mmt-slit-tl"></span><span class="mmt-slit mmt-slit-br"></span>';
    if (themeId === 'deepspace') {
        // Уголки-скобки цвета редкости; на открытой 5★ — голо-блик
        const sheen = card.revealed !== false && Number(card.rarity) === 5 ? '<span class="mmt-holo-sheen"></span>' : '';
        return `<span class="mmt-bracket mmt-bracket-tl"></span><span class="mmt-bracket mmt-bracket-br"></span>${sheen}`;
    }
    if (themeId === 'diary') {
        // Васи-лента одного из четырёх узоров, в одном из трёх положений; иногда — наклейка-сердечко
        const pattern = 1 + Math.floor(seeded(card.id, 'washi') * 4);
        const place = hero ? 'top' : ['top', 'left', 'right'][Math.floor(seeded(card.id, 'washi-place') * 3)];
        const tilt = Math.round(seeded(card.id, 'washi-tilt') * 8 - 4);
        let sticker = '';
        if (hero && card.revealed !== false) sticker = `<span class="mmt-sticker mmt-sticker-star">${STAR_SVG}</span>`;
        else if (!hero && card.revealed !== false && seeded(card.id, 'heart') < 0.3) sticker = `<span class="mmt-sticker mmt-sticker-heart">${HEART_SVG}</span>`;
        return `<span class="mmt-washi mmt-washi-${place} mmt-washi-w${pattern}" style="--mmt-washi-tilt: ${tilt}deg;"></span>${sticker}`;
    }
    return '';
}

// ---------- Украшения страницы ----------

/** Поля бланка в досье, штампы, след от кружки; калька в свадебном. */
export function pageDecorHtml(themeId, page, side, pageNumber, info, exhibits = new Map()) {
    const heroOpen = page.kind === 'hero' && page.cards[0]?.revealed !== false;
    if (themeId === 'deepspace') return deepspaceCode(page, exhibits);
    if (themeId === 'wedding') return heroOpen ? '<span class="mmt-vellum" aria-hidden="true"></span>' : '';
    if (themeId !== 'dossier') return '';
    const parts = [];
    if (side === 'left') {
        parts.push(`<span class="mmt-field mmt-field-1">ОБЪЕКТ: <u>${escapeHtml(info.charName || '—')}</u></span>`);
        parts.push(`<span class="mmt-field mmt-field-2">ИСТОЧНИК: <u>${escapeHtml(info.userName || '—')}</u></span>`);
    } else {
        parts.push(`<span class="mmt-field mmt-field-1">ДЕЛО № ${escapeHtml(info.caseNo)} · ЛИСТ ${pageNumber}</span>`);
    }
    if (heroOpen) {
        parts.push('<span class="mmt-stamp-big">СОВ. СЕКРЕТНО</span>');
    }
    if (seeded(`${info.caseNo}-${pageNumber}`, 'stain') < 0.35) {
        parts.push(`<span class="mmt-stain" style="--mmt-stain-y: ${Math.round(seeded(pageNumber, 'sy') * 60 + 15)}%;"></span>`);
    }
    return parts.join('');
}

/** Бортовой код страницы в Deepspace: «MEMORY · 001—004» или «MEMORY · 005 · ★5». */
function deepspaceCode(page, exhibits) {
    const nums = page.cards.map((c) => exhibits.get(c.id)).filter(Boolean);
    const pad = (n) => String(n).padStart(3, '0');
    let code = 'MEMORY · ———';
    if (page.kind === 'hero' && nums.length) {
        const card = page.cards[0];
        code = `MEMORY · ${pad(nums[0])}${card.revealed === false ? '' : ` · ★${Number(card.rarity) || 3}`}`;
    } else if (nums.length === 1) {
        code = `MEMORY · ${pad(nums[0])}`;
    } else if (nums.length) {
        code = `MEMORY · ${pad(nums[0])}—${pad(nums[nums.length - 1])}`;
    }
    return `<span class="mmt-code">${code}</span>`;
}

// ---------- Номера страниц ----------

const CN_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1…99 китайскими цифрами; дальше — арабскими (в шрифте нет «百» с «零»). */
function chineseNumber(n) {
    if (n < 1 || n > 99) return String(n);
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    if (!tens) return CN_DIGITS[ones];
    return `${tens > 1 ? CN_DIGITS[tens] : ''}十${CN_DIGITS[ones]}`;
}

function romanNumber(n) {
    if (n < 1 || n > 3999) return String(n);
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [value, sign] of map) {
        while (n >= value) { out += sign; n -= value; }
    }
    return out;
}

/** Как тема пишет номер страницы: шёлк — 一 二 三, гримуар — I II III, свадебный — i ii iii, Deepspace — 01, дневничок — «стр. 1». */
export function pageLabel(themeId, n) {
    if (themeId === 'silk') return chineseNumber(n);
    if (themeId === 'grimoire') return romanNumber(n);
    if (themeId === 'wedding') return romanNumber(n).toLowerCase();
    if (themeId === 'deepspace') return String(n).padStart(2, '0');
    if (themeId === 'diary') return `стр. ${n}`;
    return String(n);
}
