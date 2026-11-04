// Memento — дата и место момента из тегов Hearthtide.
// Hearthtide пишет в каждый ответ скрытый тег:
//   <!-- HT date=1151-02-05 | time=09:30 | when=5 февраля, утро | place=деревня -->
// Модели он не уходит (комментарии вырезаются), читаем его сами.

const LOOK_BACK = 12;   // если в сообщении момента тега нет — ищем в стольких сообщениях выше

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function clean(value, max = 80) {
    const x = String(value ?? '').replace(/\s+/g, ' ').trim();
    return x && !/^(none|null|нет|-|—|n\/a)$/i.test(x) ? x.slice(0, max) : '';
}

/** Последний тег HT в тексте сообщения → поля, или null. */
function parseTag(text) {
    const re = /<!--\s*HT(?![\w-])[\s:]*([\s\S]*?)-->/gi;
    let m;
    let last = null;
    while ((m = re.exec(String(text ?? ''))) !== null) last = m[1];
    if (last === null) return null;
    const fields = {};
    for (const part of last.split('|')) {
        const kv = part.match(/^\s*([a-z_]+)\s*[=:]\s*([\s\S]*?)\s*$/i);
        if (kv) fields[kv[1].toLowerCase()] = kv[2];
    }
    return fields;
}

/** «5 февраля 1151 · утро» из date=1151-02-05 и when=5 февраля, утро. */
function labelFrom(fields) {
    const when = clean(fields.when);
    const m = String(fields.date || '').trim().match(/^(-?\d{1,5})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
        const month = MONTHS[Number(m[2]) - 1];
        if (month) {
            const day = `${Number(m[3])} ${month} ${m[1]}`;
            // Время суток — то, что в when после запятой («утро»)
            const tod = when.includes(',') ? clean(when.slice(when.indexOf(',') + 1), 30) : '';
            return tod ? `${day} · ${tod}` : day;
        }
    }
    return when;
}

/** Дата и место момента: { label, place } или null, если Hearthtide молчит. */
export function findHearthDate(chat, mesId) {
    if (!Array.isArray(chat) || !Number.isInteger(mesId) || mesId < 0) return null;
    for (let i = Math.min(mesId, chat.length - 1); i >= Math.max(0, mesId - LOOK_BACK); i--) {
        const fields = parseTag(chat[i]?.mes);
        if (!fields) continue;
        const label = labelFrom(fields);
        const place = clean(fields.place, 60);
        if (label || place) return { label, place };
    }
    return null;
}
