// Memento — что уходит модели и как разбирается ответ.

import { ctx, substitute } from './store.js';

const CONTEXT_BEFORE = 2;   // сколько сообщений перед выделенным моментом даём для контекста

// ---------- Источники (как в Junket) ----------

function cardFields() {
    try {
        return ctx().getCharacterCardFields?.() || {};
    } catch (error) {
        console.warn('[Memento] не удалось прочитать карточку персонажа', error);
        return {};
    }
}

function cardText() {
    const f = cardFields();
    const parts = [];
    if (f.description) parts.push(`## Description\n${f.description}`);
    if (f.personality) parts.push(`## Personality\n${f.personality}`);
    if (f.scenario) parts.push(`## Scenario\n${f.scenario}`);
    return parts.join('\n\n');
}

function personaText() {
    return String(cardFields().persona || '').trim();
}

/** Текст сообщения для модели: без мыслей, картинок, стилей и html-тегов. */
export function cleanMessageText(text) {
    return String(text ?? '')
        .replace(/<(think|thinking|reasoning|thought|rp_preflight)>[\s\S]*?<\/\1>/gi, '')
        .replace(/^[\s\S]*?<\/(?:think|thinking|reasoning|thought|rp_preflight)>/i, '')
        .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Сообщения в виде «#520 Levi: текст». Скрытые тоже идут. */
export function buildSceneText(from, to) {
    const chat = ctx().chat || [];
    const lines = [];
    for (let i = from; i <= to; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const text = cleanMessageText(msg.mes);
        if (!text) continue;
        lines.push(`#${i} ${msg.name || '???'}: ${text}`);
    }
    return lines.join('\n\n');
}

// ---------- Инструкция ----------

const INSTRUCTION = `You turn one moment of a roleplay story into a collectible "memory" card, in the spirit of the memory cards in the game Love and Deepspace.

Return ONLY a JSON object, no commentary, no markdown fences:
{
  "mes": <number of the message (#N) where the moment happens>,
  "quote": "<the moment, quoted VERBATIM from that message, 1-3 sentences>",
  "title": "<card title in Russian>",
  "rarity": <3, 4 or 5>,
  "note": "<handwritten note on the back of the card, in Russian>",
  "prompt": "<image prompt in English>"
}

TITLE — 2 to 5 words in Russian, evocative and a little poetic, like a memory card name: a concrete image or feeling from the moment, not a plot summary. Examples of the register: «Шёпот у фонтана», «Тепло чужого пальто», «Последний танец до рассвета». No quotation marks inside the title. Do not reuse or closely echo titles already in the album.

RARITY — how much this moment matters for the relationship between {{char}} and {{user}}:
- 5 — a turning point: confession, first kiss, a bond or mark, a major reveal, a sacrifice, a moment after which things are never the same. Rare: roughly one card in ten.
- 4 — an emotionally notable beat: tenderness, real vulnerability, sharp tension, a meaningful gesture.
- 3 — an everyday, warm, funny or quiet moment.
Judge honestly; most moments are 3 or 4. Use the album statistics below to keep 5 rare.

NOTE — written by {{char}} in first person, in their own voice and manner of speech, to {{user}}, as if signing the back of a photo. 1 to 3 sentences, personal, about this exact moment. No signature line.

PROMPT — one vertical 3:4 illustration of the moment for an image model: who is there (use the character names), their poses and expressions, the setting, lighting and mood. Concrete and visual, 60-120 words, no text or lettering in the image. Keep it suggestive, never explicit.`;

const QUOTE_RULE = `The user already chose the moment: it is given as CHOSEN QUOTE. Return it unchanged in "quote", and the number of the message it comes from in "mes". The earlier messages are context only.`;

const SCENE_RULE = `The user gave a whole scene. Pick the single most memorable moment of it yourself, and quote it verbatim from the message where it happens.`;

function albumStats(cards) {
    const count = (r) => cards.filter((c) => Number(c.rarity) === r).length;
    const titles = cards.slice(-30).map((c) => c.title).filter(Boolean);
    let text = `Album so far: ${cards.length} cards (3★: ${count(3)}, 4★: ${count(4)}, 5★: ${count(5)}).`;
    if (titles.length) text += `\nExisting titles: ${titles.map((t) => `«${t}»`).join(', ')}`;
    return text;
}

/**
 * moment: { mode: 'quote', mesId, quote } или { mode: 'scene', from, to }
 * Возвращает { instruction, contextText, from, to }.
 */
export function buildMomentPrompt(moment, cards) {
    const from = moment.mode === 'quote' ? Math.max(0, moment.mesId - CONTEXT_BEFORE) : moment.from;
    const to = moment.mode === 'quote' ? moment.mesId : moment.to;

    const sceneText = buildSceneText(from, to);
    if (!sceneText) throw new Error('В выбранных сообщениях нет текста.');

    const parts = [];
    const card = cardText();
    if (card) parts.push(`# {{char}}\n${card}`);
    const persona = personaText();
    if (persona) parts.push(`# {{user}}\n${persona}`);
    parts.push(`# ${moment.mode === 'quote' ? 'Messages' : 'Scene'}\n${sceneText}`);
    if (moment.mode === 'quote') parts.push(`# CHOSEN QUOTE (from #${moment.mesId})\n${moment.quote}`);
    parts.push(`# Album\n${albumStats(cards)}`);

    const instruction = `${INSTRUCTION}\n\n${moment.mode === 'quote' ? QUOTE_RULE : SCENE_RULE}`;
    return {
        instruction: substitute(instruction),
        contextText: substitute(parts.join('\n\n')),
        from,
        to,
    };
}

// ---------- Разбор ответа ----------

function normalizeSpaces(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Достаёт JSON из ответа модели: рассуждения и обёртки ``` срезаются. */
export function extractJson(raw) {
    let text = String(raw || '')
        .replace(/<(think|thinking|reasoning|thought)>[\s\S]*?<\/\1>/gi, '')
        .replace(/^[\s\S]*?<\/(?:think|thinking|reasoning|thought)>/i, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('Модель ответила не JSON — попробуй ещё раз.');
    text = text.slice(start, end + 1);
    try {
        return JSON.parse(text);
    } catch {
        // Частая поломка — «умные» кавычки или висящая запятая
        try {
            return JSON.parse(text.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1'));
        } catch {
            throw new Error('Модель ответила битым JSON — попробуй ещё раз.');
        }
    }
}

/**
 * Собирает поля карточки из ответа. В режиме выделения цитата всегда твоя,
 * а номер сообщения — того, где выделяла. В режиме сцены номер проверяется:
 * если модель промахнулась, ищем цитату в сцене сами.
 */
export function cardFromAnswer(data, moment, range) {
    const rarity = Math.min(5, Math.max(3, Math.round(Number(data.rarity)) || 3));
    const title = String(data.title || '').replace(/^[«"'\s]+|[»"'\s]+$/g, '').trim() || 'Без названия';
    const note = String(data.note || '').trim();
    const prompt = String(data.prompt || '').trim();

    let quote;
    let mesId;
    if (moment.mode === 'quote') {
        quote = moment.quote;
        mesId = moment.mesId;
    } else {
        quote = String(data.quote || '').trim();
        if (!quote) throw new Error('Модель не выбрала момент — попробуй ещё раз.');
        const chat = ctx().chat || [];
        const asked = Math.round(Number(data.mes));
        const inRange = (i) => Number.isInteger(i) && i >= range.from && i <= range.to && chat[i];
        const needle = normalizeSpaces(quote).slice(0, 60);
        const contains = (i) => normalizeSpaces(cleanMessageText(chat[i]?.mes)).includes(needle);
        if (inRange(asked) && contains(asked)) mesId = asked;
        else {
            mesId = -1;
            for (let i = range.from; i <= range.to; i++) {
                if (contains(i)) { mesId = i; break; }
            }
            if (mesId === -1) mesId = inRange(asked) ? asked : range.to;
        }
    }
    return { title, rarity, quote, note, prompt, mesId };
}
