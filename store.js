// Memento — настройки, альбом чата и мелкие помощники.

export const MODULE = 'memento';      // ключ в extension_settings
export const META_KEY = 'memento';    // ключ в метаданных чата
export const TOAST_TITLE = 'Memento';

export const DEFAULT_SETTINGS = Object.freeze({
    version: 1,
    theme: 'binder',             // тема альбома (пока одна)
});

export function ctx() {
    // Всегда свежий контекст: после смены чата объекты внутри меняются
    return SillyTavern.getContext();
}

export function getSettings() {
    const c = ctx();
    if (!c.extensionSettings[MODULE] || typeof c.extensionSettings[MODULE] !== 'object') {
        c.extensionSettings[MODULE] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = c.extensionSettings[MODULE];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (s[key] === undefined) s[key] = structuredClone(value);
    }
    return s;
}

export function saveSettings() {
    ctx().saveSettingsDebounced();
}

// ---------- Помощники ----------

export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** «1 воспоминание», «3 воспоминания», «7 воспоминаний» */
export function memoriesWord(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'воспоминание';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'воспоминания';
    return 'воспоминаний';
}

// ---------- Альбом чата ----------

export function currentChatId() {
    return ctx().getCurrentChatId?.() || null;
}

/*
 * Альбом живёт в метаданных чата:
 *   owner — id чата, которому альбом принадлежит. Если он не совпадает с текущим,
 *           значит метаданные приехали копией (ветка, чекпоинт, переименование).
 *   cards — карточки. Поля карточки (заполняются с этапа 2):
 *     id, title, rarity (3|4|5), quote, note, prompt, image,
 *     mesId, sendDate, swipeId, speaker, calendarDate, createdAt
 */
export function getAlbum() {
    if (!currentChatId()) return null;
    const meta = ctx().chatMetadata;
    if (!meta) return null;
    if (!meta[META_KEY] || typeof meta[META_KEY] !== 'object') {
        meta[META_KEY] = { owner: currentChatId(), cards: [] };
    }
    const album = meta[META_KEY];
    if (!Array.isArray(album.cards)) album.cards = [];
    if (album.owner === undefined) album.owner = currentChatId();
    return album;
}

export async function saveAlbum() {
    await ctx().saveMetadata();
}

export function saveAlbumDebounced() {
    const c = ctx();
    if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
    else c.saveMetadata();
}

// ---------- Сверка карточек с сообщениями ----------

function sameDate(a, b) {
    return a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
}

/** Это то самое сообщение, из которого сделана карточка? Свайпы тоже считаются. */
function messageMatches(message, card) {
    if (!message || !card.sendDate) return false;
    if (sameDate(message.send_date, card.sendDate)) return true;
    return Array.isArray(message.swipe_info)
        && message.swipe_info.some((s) => sameDate(s?.send_date, card.sendDate));
}

/** Где сейчас сообщение карточки: номер или -1, если его в чате нет. */
export function findCardMessage(card, chat = ctx().chat) {
    if (!Array.isArray(chat)) return -1;
    if (messageMatches(chat[card.mesId], card)) return card.mesId;
    return chat.findIndex((m) => messageMatches(m, card));
}

/**
 * Сверка при открытии чата.
 * - Номера сообщений поправляются, если выше что-то удалили и всё съехало.
 * - Если альбом приехал копией (ветка/чекпоинт), выкидываются карточки, чьих сообщений
 *   в этом чате нет: они из постов после точки ветвления или из чужих свайпов.
 *   Файлы картинок при этом не трогаем — они по-прежнему нужны родительскому чату.
 * - В родном чате карточка живёт, даже если её сообщение удалили.
 * Возвращает true, если что-то поменялось.
 */
export function reconcileAlbum() {
    const album = getAlbum();
    if (!album) return false;
    const chatId = currentChatId();
    const inherited = album.owner !== chatId;
    let changed = false;

    const kept = [];
    for (const card of album.cards) {
        const index = findCardMessage(card);
        if (index === -1) {
            if (inherited) {
                changed = true;
                continue;
            }
        } else if (index !== card.mesId) {
            card.mesId = index;
            changed = true;
        }
        kept.push(card);
    }

    if (inherited) {
        album.owner = chatId;
        changed = true;
        const dropped = album.cards.length - kept.length;
        if (dropped > 0) console.info(`[Memento] ветка: убрано карточек из чужой части истории — ${dropped}`);
    }
    album.cards = kept;
    return changed;
}
