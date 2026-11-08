// Memento — темы альбома.
// Тема меняет обложку, страницы, переплёт, держатели карточек, рубашку и вид приписок.
// Своя у каждого чата (album.theme), по умолчанию — из настроек.
// ready: false — тема уже в списке, но ещё не нарисована (появится в следующих этапах).

export const DEFAULT_THEME = 'binder';

export const THEMES = [
    { id: 'binder', name: 'Полночный биндер', swatch: 'radial-gradient(circle at 30% 20%, #3a3560, #17152a 75%)', ready: true },
    { id: 'scrapbook', name: 'Скрапбук', swatch: 'linear-gradient(135deg, #8a6040, #3a2414)', ready: false },
    { id: 'polaroid', name: 'Полароид', swatch: 'linear-gradient(135deg, #fbfaf6 45%, #1d1d20 46%)', ready: false },
    { id: 'dossier', name: 'Досье', swatch: 'linear-gradient(135deg, #d2b47a, #a3804a)', ready: false },
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

/** Переплёт поверх разворота: у биндера — стальная планка с кольцами. */
export function bindingHtml(themeId) {
    if (themeId === 'binder') {
        return `
            <div class="mmt-binding" aria-hidden="true">
                <span class="mmt-plate"><span class="mmt-rivet"></span><span class="mmt-rivet"></span></span>
                <span class="mmt-ring mmt-ring-1"></span><span class="mmt-ring mmt-ring-2"></span><span class="mmt-ring mmt-ring-3"></span>
            </div>`;
    }
    return '';
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
