// Memento — рисование картинки карточки.
// Провайдеры, повторы и обходы — порт из Reel (там они проверены на Наистере и твоей локальной проксе).
// Рефы — из слотов Frame (чтение контейнера — как в Reel «Импорт из Frame»).

import {
    ctx, getSettings, DEFAULT_NAISTERA_ENDPOINT, DEFAULT_LOCAL_ENDPOINT, TOAST_TITLE,
} from './store.js';

const ASPECT = '3:4';                       // карточка всегда вертикальная
const DRAW_TIMEOUT_MS = 300_000;
const CATALOG_TIMEOUT_MS = 30_000;
// Паузы перед повторами на 429 и 502/503/504. 500 не повторяем.
const DRAW_RETRY_DELAYS = [5000, 15000, 30000];
const MAX_REFS = 4;
const FILE_PREFIX = 'memento';

// Та же приписка, что у Frame и Reel: с ней банана уже проверена.
const REF_PROMPT_INSTRUCTION = '[CRITICAL: The reference image(s) attached show the EXACT appearance of the character(s). You MUST precisely copy their: face structure, eye color, hair color and style, skin tone, body type, clothing, and all distinctive features. Do not deviate from the reference appearances.]';

export const PROVIDER_LABELS = { naistera: 'Naistera', local: 'Gemini-compatible' };

// Что выучили по ходу: живёт до перезагрузки страницы
const state = {
    catalogs: { naistera: [], local: [] },
    naisteraCatalogTried: false,
    naisteraLegacyRefs: false,     // Наистера не приняла reference_objects
    localCompatible: false,        // прокся отвечает только под /compatible
};

export function getCatalog(provider) {
    return state.catalogs[provider] || [];
}

/** Сменили адрес или ключ — выученные обходы больше не верны. */
export function resetProviderState(provider) {
    if (provider === 'naistera') {
        state.naisteraCatalogTried = false;
        state.naisteraLegacyRefs = false;
    } else {
        state.localCompatible = false;
    }
}

function log(...args) {
    console.info('[Memento]', ...args);
}

// ---------- Общее ----------

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

function isRetryableStatus(status) {
    return status === 429 || status === 502 || status === 503 || status === 504;
}

function httpError(status, text) {
    const error = new Error(`API Error (${status})${text ? `: ${String(text).slice(0, 400)}` : ''}`);
    error.status = status;
    return error;
}

/** fetch с таймаутом, который уважает и отмену. */
async function timedFetch(url, init, signal, timeoutMs = DRAW_TIMEOUT_MS) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        return await fetch(url, { ...init, signal: timeout.signal });
    } catch (error) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (timeout.signal.aborted) throw new Error(`no response within ${Math.round(timeoutMs / 60000) || 1} min (${new URL(url, window.location.href).origin})`);
        throw new Error(`Network/CORS error: ${error?.message || 'Failed to fetch'} (${new URL(url, window.location.href).origin})`);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

function getNaisteraBase() {
    const raw = String(getSettings().naisteraEndpoint || '').trim().replace(/\/+$/, '');
    return (raw || DEFAULT_NAISTERA_ENDPOINT).replace(/\/api\/(?:generate|models)$/i, '');
}

function getLocalBase() {
    const raw = String(getSettings().localEndpoint || '').trim().replace(/\/+$/, '');
    return (raw || DEFAULT_LOCAL_ENDPOINT)
        .replace(/\/v1beta\/models(?:\/[^?]*)?$/i, '')
        .replace(/\/v1(?:beta)?$/i, '');
}

function encodeModelForPath(model) {
    const segments = String(model || '').split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) {
        throw new Error(`Invalid model id for URL path: ${model}`);
    }
    return segments.map(encodeURIComponent).join('/');
}

function endpointHasCompatiblePrefix(base) {
    try {
        return /(^|\/)compatible(\/|$)/i.test(new URL(base, window.location.href).pathname);
    } catch {
        return true;
    }
}

function endpointNeedsGoogleHeader(base) {
    try {
        return new URL(base, window.location.href).hostname.toLowerCase().endsWith('googleapis.com');
    } catch {
        return false;
    }
}

function getLocalHeaders(withJson = true) {
    const key = String(getSettings().localKey || '').trim();
    const headers = withJson ? { 'Content-Type': 'application/json' } : {};
    if (key) {
        headers.Authorization = `Bearer ${key}`;
        if (endpointNeedsGoogleHeader(getLocalBase())) headers['x-goog-api-key'] = key;
    }
    return headers;
}

function squashModelId(value) {
    return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

// ---------- Списки моделей ----------

export async function fetchCatalog(provider) {
    const settings = getSettings();
    let ids = [];
    if (provider === 'naistera') {
        const key = String(settings.naisteraKey || '').trim();
        const headers = { Accept: 'application/json' };
        if (key) headers.Authorization = `Bearer ${key}`;
        const response = await timedFetch(`${getNaisteraBase()}/api/models`, { method: 'GET', headers }, null, CATALOG_TIMEOUT_MS);
        if (!response.ok) throw httpError(response.status, await response.text().catch(() => ''));
        const payload = await response.json();
        const all = (Array.isArray(payload?.models) ? payload.models : [])
            .filter((m) => m?.id && m.visible !== false && m.deprecated !== true)
            .map((m) => String(m.id));
        const bananas = all.filter((id) => /banana/i.test(id));
        ids = bananas.length ? bananas : all;
        state.naisteraCatalogTried = true;
    } else {
        const base = getLocalBase();
        const urls = [`${base}/v1beta/models`, `${base}/v1/models`];
        if (!endpointHasCompatiblePrefix(base)) urls.push(`${base}/compatible/v1/models`);
        let lastError = null;
        for (const url of urls) {
            try {
                const response = await timedFetch(url, { method: 'GET', headers: getLocalHeaders(false) }, null, CATALOG_TIMEOUT_MS);
                if (!response.ok) { lastError = httpError(response.status, ''); continue; }
                const data = await response.json();
                if (Array.isArray(data?.data)) ids = data.data.map((m) => m?.id).filter(Boolean);
                else if (Array.isArray(data?.models)) {
                    ids = data.models.map((m) => {
                        const n = String(m?.name || m?.id || '');
                        return n.startsWith('models/') ? n.slice('models/'.length) : n;
                    }).filter(Boolean);
                }
                if (ids.length) break;
            } catch (error) {
                lastError = error;
            }
        }
        if (!ids.length && lastError) throw lastError;
    }
    state.catalogs[provider] = ids;
    return ids;
}

async function resolveNaisteraModel() {
    const saved = String(getSettings().naisteraModel || '').trim() || 'nano-banana-2';
    if (!state.catalogs.naistera.length && !state.naisteraCatalogTried) {
        state.naisteraCatalogTried = true;
        try {
            await fetchCatalog('naistera');
        } catch (error) {
            console.warn('[Memento] список моделей Naistera не загрузился:', error?.message);
        }
    }
    const catalog = state.catalogs.naistera;
    if (!catalog.length || catalog.includes(saved)) return saved;
    return catalog.find((id) => squashModelId(id) === squashModelId(saved)) || saved;
}

// ---------- Наистера ----------

function withRefInstruction(prompt, refCount) {
    return refCount > 0 ? `${REF_PROMPT_INSTRUCTION}\n\n${prompt}` : prompt;
}

async function requestNaistera(prompt, refs, signal) {
    const settings = getSettings();
    const url = `${getNaisteraBase()}/api/generate`;
    const model = await resolveNaisteraModel();
    const body = { prompt: withRefInstruction(prompt, refs.length), aspect_ratio: ASPECT, model };
    const setRefs = () => {
        delete body.reference_objects;
        delete body.reference_images;
        if (!refs.length) return;
        if (state.naisteraLegacyRefs) body.reference_images = refs.map((r) => r.dataUrl);
        else body.reference_objects = refs.map((r) => ({ image: r.dataUrl, description: r.name }));
    };
    setRefs();

    const post = () => timedFetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${String(settings.naisteraKey || '').trim()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    }, signal);

    log(`Naistera: ${model}, ${ASPECT}, рефов ${refs.length}`);
    let response = await post();
    let errorText = response.ok ? '' : await response.text().catch(() => '');

    // Старые сборки Наистеры знают только reference_images
    if (!response.ok && response.status === 400 && body.reference_objects && /\breference_objects\b/i.test(errorText)) {
        state.naisteraLegacyRefs = true;
        setRefs();
        response = await post();
        errorText = response.ok ? '' : await response.text().catch(() => '');
    }
    if (!response.ok) throw httpError(response.status, errorText);

    const result = await response.json();
    if (!result?.data_url) throw new Error('No data_url in Naistera response');
    return { image: result.data_url, model };
}

// ---------- Gemini-compatible (локальная прокся) ----------

function splitDataUrl(src) {
    const m = String(src || '').match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (m) return { mime: m[1], b64: m[2] };
    return { mime: 'image/png', b64: String(src || '') };
}

function buildGeminiBody(prompt, refs, omitImageConfig) {
    const parts = [];
    for (const ref of refs) {
        const { mime, b64 } = splitDataUrl(ref.dataUrl);
        parts.push({ inlineData: { mimeType: mime, data: b64 } });
    }
    parts.push({ text: withRefInstruction(prompt, refs.length) });
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    if (!omitImageConfig) generationConfig.imageConfig = { aspectRatio: ASPECT, imageSize: getSettings().imageSize };
    return { contents: [{ role: 'user', parts }], generationConfig };
}

function isEmptyEnvelope(r) {
    if (!r || typeof r !== 'object') return false;
    if (r.error || r.promptFeedback || r.prompt_feedback) return false;
    if (Array.isArray(r.candidates) && r.candidates.length > 0) return false;
    if (Array.isArray(r.data) && r.data.length > 0) return false;
    const um = r.usageMetadata || r.usage_metadata;
    const zeroTokens = um && (um.promptTokenCount === 0 || um.prompt_token_count === 0);
    return !!(zeroTokens && (r.candidates === null || r.candidates === undefined));
}

function parseGeminiImage(result) {
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    for (const part of (candidates[0]?.content?.parts || [])) {
        if (part.inlineData?.data) return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        if (part.inline_data?.data) return `data:${part.inline_data.mime_type || 'image/png'};base64,${part.inline_data.data}`;
    }
    const d0 = Array.isArray(result?.data) ? result.data[0] : null;
    if (d0?.b64_json) return `data:image/png;base64,${d0.b64_json}`;
    if (d0?.url) return d0.url;

    if (result?.error && (result.error.message || result.error.code || result.error.status)) {
        const error = new Error(`Provider error: ${result.error.message || 'unspecified'} (code=${result.error.code ?? result.error.status ?? 'n/a'})`);
        if (typeof result.error.code === 'number') error.status = result.error.code;
        throw error;
    }
    const pf = result?.promptFeedback || result?.prompt_feedback;
    if (pf && (pf.blockReason || pf.block_reason)) {
        const detail = pf.blockReasonMessage || pf.block_reason_message || '';
        throw new Error(`Blocked by safety filter (prompt): ${pf.blockReason || pf.block_reason}${detail ? ` — ${detail}` : ''}`);
    }
    if (candidates.length) {
        const fr = candidates[0].finishReason || candidates[0].finish_reason;
        if (fr && /^(IMAGE_SAFETY|SAFETY|PROHIBITED_CONTENT|RECITATION|BLOCKLIST|SPII|IMAGE_PROHIBITED_CONTENT|IMAGE_OTHER)$/i.test(fr)) {
            throw new Error(`Blocked by safety filter (image): ${fr}`);
        }
        if (fr) throw new Error(`Generation stopped without image: finishReason=${fr}`);
    }
    console.warn('[Memento] ответ Gemini-compatible без картинки:', result);
    throw new Error('No image in provider response');
}

async function requestLocal(prompt, refs, signal) {
    const base = getLocalBase();
    const model = String(getSettings().localModel || '').trim();
    const suffix = `/v1beta/models/${encodeModelForPath(model)}:generateContent`;
    const canProbe = !endpointHasCompatiblePrefix(base);
    let url = canProbe && state.localCompatible ? `${base}/compatible${suffix}` : `${base}${suffix}`;

    let currentRefs = refs;
    let omitImageConfig = false;
    const post = () => timedFetch(url, {
        method: 'POST',
        headers: getLocalHeaders(),
        body: JSON.stringify(buildGeminiBody(prompt, currentRefs, omitImageConfig)),
    }, signal);

    log(`Gemini-compatible: ${model}, ${ASPECT}, ${getSettings().imageSize}, рефов ${refs.length}, ${url}`);
    let response = await post();

    // Некоторые прокси отвечают только под /compatible: пробуем один раз и запоминаем
    if (!response.ok && response.status === 404 && canProbe && !state.localCompatible) {
        const firstText = await response.text().catch(() => '');
        url = `${base}/compatible${suffix}`;
        const probe = await post();
        if (!probe.ok) throw httpError(404, firstText);
        state.localCompatible = true;
        response = probe;
    }
    if (!response.ok) throw httpError(response.status, await response.text().catch(() => ''));
    let result = await response.json();

    // Пустой конверт: сначала без imageConfig, потом без рефов — как во Frame и Reel
    if (isEmptyEnvelope(result)) {
        omitImageConfig = true;
        response = await post();
        if (!response.ok) throw httpError(response.status, await response.text().catch(() => ''));
        result = await response.json();
        if (isEmptyEnvelope(result) && currentRefs.length) {
            toastr.warning('Банана не приняла рефы — рисую без них', TOAST_TITLE, { timeOut: 4000 });
            currentRefs = [];
            response = await post();
            if (!response.ok) throw httpError(response.status, await response.text().catch(() => ''));
            result = await response.json();
        }
        if (isEmptyEnvelope(result)) throw new Error('Provider returned an empty envelope. Check model access on the proxy.');
    }
    return { image: parseGeminiImage(result), model };
}

// ---------- Файлы ----------

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('не прочитался файл'));
        reader.readAsDataURL(blob);
    });
}

async function toDataUrl(image, signal) {
    if (/^data:image\//i.test(image)) return image;
    const response = await fetch(image, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`не скачалась картинка (${response.status})`);
    return await blobToDataUrl(await response.blob());
}

/** Папка на сервере — имя персонажа (в группе — группы), как в Reel. */
function getUploadFolderName() {
    const c = ctx();
    let name = '';
    if (c.groupId) name = (c.groups || []).find((g) => g.id === c.groupId)?.name || '';
    else if (c.characterId !== undefined && c.characterId !== null) name = c.characters?.[c.characterId]?.name || '';
    name = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 64);
    return name || 'memento';
}

/** Сохраняет картинку через таверну в /user/images/<папка>/. */
async function uploadImage(dataUrl) {
    const match = String(dataUrl).match(/^data:image\/([\w+.-]+);base64,(.+)$/);
    if (!match) throw new Error('картинка пришла в странном формате');
    const format = match[1] === 'jpeg' ? 'jpg' : match[1];
    const filename = `${FILE_PREFIX}_${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 6)}`;
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ image: match[2], format, ch_name: getUploadFolderName(), filename }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || `сохранение не удалось (${response.status})`);
    }
    const result = await response.json();
    if (!result?.path) throw new Error('таверна не вернула путь к файлу');
    return result.path;
}

/** Удаляет файл картинки, но только наш: в картинках таверны и с нашим префиксом. */
export async function deleteImageFile(path) {
    const p = String(path || '');
    const file = p.split('/').pop() || '';
    if (!/(^|\/)user\/images\//.test(p) || p.includes('..') || p.includes('\\') || !file.startsWith(`${FILE_PREFIX}_`)) {
        console.warn('[Memento] не трогаю чужой файл:', p);
        return false;
    }
    try {
        const response = await fetch('/api/images/delete', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ path: p }),
        });
        return response.ok || response.status === 404;
    } catch (error) {
        console.warn('[Memento] файл не удалился:', p, error?.message);
        return false;
    }
}

// ---------- Рефы из слотов Frame ----------

function hasFrameImage(ref) {
    return !!(ref && (ref.imagePath || ref.imageBase64 || ref.imageData));
}

/** Контейнер слотов Frame в том же порядке, как его ищет Reel: сначала область, выбранная во Frame. */
function getFrameRefContainer() {
    const c = ctx();
    const fw = c.extensionSettings?.inline_image_gen;
    if (!fw || typeof fw !== 'object') return { container: null, fw: null };

    const chatBucket = c.chatMetadata?.iig_refs;
    let ownerKey = null;
    if (c.groupId) ownerKey = `group:${String(c.groupId)}`;
    else {
        const avatar = c.characters?.[c.characterId]?.avatar;
        if (avatar) ownerKey = `character:${avatar}`;
    }
    const charBucket = ownerKey ? fw.characterRefs?.[ownerKey] : null;
    const byScope = { 'per-chat': chatBucket, 'per-character': charBucket, global: fw };
    const order = [fw.refScope, 'per-chat', 'per-character', 'global'];
    const filled = (box) => box && typeof box === 'object'
        && [box.charRef, box.userRef, ...(Array.isArray(box.npcReferences) ? box.npcReferences : [])].some(hasFrameImage);
    for (const scope of order) {
        if (filled(byScope[scope])) return { container: byScope[scope], fw };
    }
    return { container: null, fw };
}

/**
 * Персонажи из слотов Frame: { name, aliases, ref, always }.
 * Пустое имя у слота перса/юзера — имя из таверны, как во Frame.
 */
export function getFrameCast() {
    const { container, fw } = getFrameRefContainer();
    if (!container) return [];
    const c = ctx();
    const out = [];
    const push = (ref, fallback, always) => {
        if (!hasFrameImage(ref)) return;
        const name = String(ref.name || fallback || '').trim();
        if (!name) return;
        out.push({ name, aliases: name.split(',').map((a) => a.trim()).filter(Boolean), ref, always: !!always });
    };
    if (!c.groupId) push(container.charRef, c.name2, fw?.charRefAlways);
    push(container.userRef, c.name1, fw?.userRefAlways);
    for (const npc of Array.isArray(container.npcReferences) ? container.npcReferences : []) push(npc, '', false);
    return out;
}

/** Канонические имена для промпта: первое имя каждого слота. */
export function getFrameNames() {
    return getFrameCast().map((entry) => entry.aliases[0]).filter(Boolean);
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameInText(aliases, text) {
    return aliases.some((alias) => {
        const words = alias.split(/\s+/).filter(Boolean).map(escapeRegExp);
        if (!words.length) return false;
        return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${words.join('\\s+')}(?![\\p{L}\\p{M}\\p{N}_])`, 'iu').test(text);
    });
}

async function frameRefToDataUrl(ref, signal) {
    if (ref.imagePath) {
        try {
            const response = await fetch(ref.imagePath, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await blobToDataUrl(await response.blob());
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            if (!ref.imageBase64 && !ref.imageData) throw error;
        }
    }
    const b64 = String(ref.imageBase64 || ref.imageData || '');
    if (b64.startsWith('data:')) return b64;
    const mime = b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('UklGR') ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${b64}`;
}

/** Рефы под этот промпт: «всегда» из Frame и те, чьё имя есть в промпте. Не больше 4. Битый — пропускаем. */
async function collectRefs(prompt, signal) {
    const picked = getFrameCast().filter((e) => e.always || nameInText(e.aliases, prompt)).slice(0, MAX_REFS);
    const refs = [];
    for (const entry of picked) {
        try {
            refs.push({
                name: entry.aliases[0],
                dataUrl: await frameRefToDataUrl(entry.ref, signal),
                appearance: String(entry.ref.appearance || '').trim(),
            });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            console.warn(`[Memento] реф «${entry.name}» не прочитался:`, error);
            toastr.warning(`Реф «${entry.aliases[0]}» не найден, рисую без него`, TOAST_TITLE, { timeOut: 4000 });
        }
    }
    return refs;
}

/** Заметки о внешности из слотов Frame — в конец промпта, только для тех, кто в кадре (как во Frame). */
function withAppearance(prompt, refs) {
    const notes = refs
        .filter((r) => r.appearance)
        .map((r) => `${r.name}: ${r.appearance.replace(/\s+/g, ' ').replace(/[.\s]+$/, '')}.`);
    if (!notes.length) return prompt;
    const base = String(prompt).trim();
    return /[.!?]$/.test(base) ? `${base} ${notes.join(' ')}` : `${base}. ${notes.join(' ')}`;
}

// ---------- Стили ----------

export function getActiveStyle() {
    const s = getSettings();
    if (!s.activeStyleId) return null;
    return s.styles.find((st) => st.id === s.activeStyleId) || null;
}

function composeFinalPrompt(prompt, style) {
    const styleText = String(style?.tags || '').trim();
    const body = String(prompt || '').trim();
    return styleText ? `${styleText}\n\n${body}` : body;
}

// ---------- Рисование ----------

/** Чего не хватает в настройках, или пусто. */
export function getMissingDrawSetting() {
    const s = getSettings();
    if (s.provider === 'local') return String(s.localModel || '').trim() ? '' : 'Не задана модель Gemini-compatible';
    return String(s.naisteraKey || '').trim() ? '' : 'Не задан ключ Naistera';
}

/**
 * Рисует картинку по промпту карточки и сохраняет файл.
 * Возвращает { path, provider, model, refs, style, createdAt }.
 */
export async function drawImage(prompt, signal) {
    const settings = getSettings();
    const missing = getMissingDrawSetting();
    if (missing) throw new Error(`${missing} — загляни в настройки Memento, «Рисование»`);
    if (!String(prompt || '').trim()) throw new Error('У карточки нет промпта для картинки');

    const style = getActiveStyle();
    const refs = settings.sendRefs ? await collectRefs(prompt, signal) : [];
    const finalPrompt = withAppearance(composeFinalPrompt(prompt, style), refs);
    const provider = settings.provider === 'local' ? 'local' : 'naistera';
    log(`рисую: ${PROVIDER_LABELS[provider]}, стиль: ${style?.name || 'нет'}, рефы: ${refs.map((r) => r.name).join(', ') || 'нет'}`, finalPrompt);

    let result;
    for (let attempt = 0; ; attempt++) {
        try {
            result = provider === 'local'
                ? await requestLocal(finalPrompt, refs, signal)
                : await requestNaistera(finalPrompt, refs, signal);
            break;
        } catch (error) {
            const retryable = error?.name !== 'AbortError' && isRetryableStatus(error?.status);
            if (!retryable || attempt >= DRAW_RETRY_DELAYS.length) throw error;
            console.warn(`[Memento] банана: ${error.message}, повтор через ${DRAW_RETRY_DELAYS[attempt] / 1000} с`);
            await sleep(DRAW_RETRY_DELAYS[attempt], signal);
        }
    }

    const dataUrl = await toDataUrl(result.image, signal);
    const path = await uploadImage(dataUrl);
    return {
        path,
        provider,
        model: result.model,
        refs: refs.map((r) => r.name),
        style: style?.name || '',
        createdAt: Date.now(),
    };
}
