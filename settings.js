// Memento — ящик в расширениях: кнопка альбома и настройки категориями, как в Koma.

import {
    ctx, getSettings, saveSettings, escapeHtml, makeId, confirmPopup,
    DEFAULT_NAISTERA_ENDPOINT, DEFAULT_LOCAL_ENDPOINT, IMAGE_SIZES, TOAST_TITLE,
} from './store.js';
import { fetchCatalog, getCatalog, resetProviderState } from './image.js';
import { THEMES, getTheme } from './themes.js';

export const ICON = 'fa-book-bookmark';

function categoryHtml(icon, title, body) {
    return `
        <div class="mmt-cat">
            <button type="button" class="mmt-cat-head" aria-expanded="false">
                <span><i class="fa-solid ${icon} fa-fw"></i> ${title}</span>
                <i class="fa-solid fa-chevron-down mmt-cat-chevron"></i>
            </button>
            <div class="mmt-cat-body" hidden>${body}</div>
        </div>`;
}

function drawerHtml() {
    const s = getSettings();
    const custom = s.promptSource === 'custom';

    const model = `
        <div class="mmt-label">Источник</div>
        <div class="mmt-seg" id="mmt_source">
            <button type="button" class="mmt-seg-btn ${custom ? '' : 'active'}" data-src="profile">Профиль</button>
            <button type="button" class="mmt-seg-btn ${custom ? 'active' : ''}" data-src="custom">Напрямую</button>
        </div>

        <div id="mmt_src_profile" ${custom ? 'hidden' : ''}>
            <label for="mmt_profile" class="mmt-label">Профиль подключения</label>
            <select id="mmt_profile" class="text_pole"></select>
            <div class="mmt-set-hint" id="mmt_profile_hint">Пусто — используется текущее подключение таверны.</div>
        </div>

        <div id="mmt_src_custom" ${custom ? '' : 'hidden'}>
            <label for="mmt_custom_endpoint" class="mmt-label">Endpoint URL</label>
            <input type="url" id="mmt_custom_endpoint" class="text_pole" placeholder="https://api.example.com/v1" value="${escapeHtml(s.customEndpoint)}">
            <label for="mmt_custom_key" class="mmt-label">API-ключ</label>
            <input type="password" id="mmt_custom_key" class="text_pole" autocomplete="off" placeholder="sk-..." value="${escapeHtml(s.customKey)}">
            <label for="mmt_custom_model" class="mmt-label">ID модели (необязательно)</label>
            <input type="text" id="mmt_custom_model" class="text_pole" placeholder="по умолчанию у API" value="${escapeHtml(s.customModel)}">
            <div class="mmt-set-hint">Любой OpenAI-совместимый адрес, можно с /v1 или полным до /chat/completions.</div>
        </div>

        <label for="mmt_max_tokens" class="mmt-label">Лимит токенов ответа</label>
        <input type="number" id="mmt_max_tokens" class="text_pole" min="500" max="32000" step="500" value="${escapeHtml(s.maxTokens)}">
        <div class="mmt-set-hint">Размышления модели тратятся из этого же лимита.</div>

        <label for="mmt_reasoning" class="mmt-label">Размышления модели</label>
        <select id="mmt_reasoning" class="text_pole">
            <option value="min" ${s.reasoningEffort === 'auto' ? '' : 'selected'}>Минимум</option>
            <option value="auto" ${s.reasoningEffort === 'auto' ? 'selected' : ''}>На усмотрение модели</option>
        </select>`;

    const local = s.provider === 'local';
    const draw = `
        <label for="mmt_provider" class="mmt-label">Кто рисует</label>
        <select id="mmt_provider" class="text_pole">
            <option value="naistera" ${local ? '' : 'selected'}>Naistera</option>
            <option value="local" ${local ? 'selected' : ''}>Gemini-compatible</option>
        </select>

        <div id="mmt_naistera_block" ${local ? 'hidden' : ''}>
            <label for="mmt_naistera_key" class="mmt-label">Ключ</label>
            <input type="password" id="mmt_naistera_key" class="text_pole" autocomplete="off" value="${escapeHtml(s.naisteraKey)}">
            <label for="mmt_naistera_endpoint" class="mmt-label">Endpoint URL</label>
            <input type="text" id="mmt_naistera_endpoint" class="text_pole" autocomplete="off" placeholder="${DEFAULT_NAISTERA_ENDPOINT}" value="${escapeHtml(s.naisteraEndpoint)}">
            <label for="mmt_naistera_model" class="mmt-label">Модель</label>
            <div class="mmt-model-row">
                <select id="mmt_naistera_model" class="text_pole"></select>
                <button type="button" class="mmt-icon-btn" data-refresh="naistera" title="Подтянуть список моделей"><i class="fa-solid fa-rotate"></i></button>
            </div>
        </div>

        <div id="mmt_local_block" ${local ? '' : 'hidden'}>
            <label for="mmt_local_key" class="mmt-label">Ключ</label>
            <input type="password" id="mmt_local_key" class="text_pole" autocomplete="off" value="${escapeHtml(s.localKey)}">
            <label for="mmt_local_endpoint" class="mmt-label">Endpoint URL</label>
            <input type="text" id="mmt_local_endpoint" class="text_pole" autocomplete="off" placeholder="${DEFAULT_LOCAL_ENDPOINT}" value="${escapeHtml(s.localEndpoint)}">
            <label for="mmt_local_model" class="mmt-label">Модель</label>
            <div class="mmt-model-row">
                <select id="mmt_local_model" class="text_pole"></select>
                <button type="button" class="mmt-icon-btn" data-refresh="local" title="Подтянуть список моделей"><i class="fa-solid fa-rotate"></i></button>
            </div>
            <label for="mmt_image_size" class="mmt-label">Размер</label>
            <select id="mmt_image_size" class="text_pole">
                ${IMAGE_SIZES.map((size) => `<option value="${size}" ${s.imageSize === size ? 'selected' : ''}>${size}</option>`).join('')}
            </select>
        </div>

        <label class="checkbox_label mmt-check">
            <input type="checkbox" id="mmt_send_refs" ${s.sendRefs ? 'checked' : ''}>
            <span>Рефы из слотов Frame</span>
        </label>
        <div class="mmt-set-hint">Уходят рефы тех, чьё имя есть в промпте, и те, что во Frame отмечены «всегда». Не больше четырёх. Картинка всегда 3:4.</div>
        <div id="mmt_outfits_row" ${s.sendRefs ? '' : 'hidden'}>
            <label class="checkbox_label mmt-check">
                <input type="checkbox" id="mmt_send_outfits" ${s.sendOutfits ? 'checked' : ''}>
                <span>Аутфиты из гардероба Frame</span>
            </label>
            <div class="mmt-set-hint">То, что надето сейчас, — картинкой сразу после рефа владельца и описанием в промпте. Галки «Отправлять описание / картинку» в гардеробе Frame тоже работают.</div>
        </div>`;

    const styles = `
        <label for="mmt_style" class="mmt-label">Стиль карточек</label>
        <select id="mmt_style" class="text_pole"></select>
        <div id="mmt_styles_list" class="mmt-styles-list"></div>
        <div class="mmt-style-btns">
            <div class="menu_button menu_button_icon" id="mmt_style_add"><i class="fa-solid fa-plus"></i><span>Новый стиль</span></div>
            <div class="menu_button menu_button_icon" id="mmt_style_import"><i class="fa-solid fa-file-import"></i><span>Импорт из Frame</span></div>
        </div>
        <input type="file" id="mmt_style_import_file" accept="application/json,.json" hidden>
        <div class="mmt-set-hint">Текст стиля уходит в начало промпта для бананы.</div>`;

    const themeOptions = THEMES.filter((t) => t.ready)
        .map((t) => `<option value="${t.id}" ${getTheme(s.theme).id === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
    const album = `
        <label for="mmt_default_theme" class="mmt-label">Тема по умолчанию</label>
        <select id="mmt_default_theme" class="text_pole">${themeOptions}</select>
        <div class="mmt-set-hint">Для чатов, где своя тема не выбрана. Свою выбирают кнопкой с палитрой в шапке альбома.</div>
        <label class="checkbox_label mmt-check">
            <input type="checkbox" id="mmt_auto_reveal" ${s.autoReveal ? 'checked' : ''}>
            <span>Открывать вытягивание сразу</span>
        </label>
        <div class="mmt-set-hint">Как только картинка готова, альбом сам откроется на новой карточке. Выключено — придёт тост, по клику на него откроется то же самое.</div>`;

    const jailbreak = `
        <label class="checkbox_label">
            <input type="checkbox" id="mmt_jb_enabled" ${s.jailbreakEnabled ? 'checked' : ''}>
            <span>Блок джейлбрейка</span>
        </label>
        <div id="mmt_jb_body" ${s.jailbreakEnabled ? '' : 'hidden'}>
            <label for="mmt_jb_role" class="mmt-label">Роль</label>
            <select id="mmt_jb_role" class="text_pole">
                <option value="system" ${s.jailbreakRole === 'system' ? 'selected' : ''}>System</option>
                <option value="user" ${s.jailbreakRole === 'user' ? 'selected' : ''}>User</option>
                <option value="assistant" ${s.jailbreakRole === 'assistant' ? 'selected' : ''}>Assistant</option>
            </select>
            <div class="mmt-set-hint">System — дописывается к инструкции. User — перед контекстом. Assistant — начало ответа за модель, не все модели его принимают.</div>
            <label for="mmt_jb_text" class="mmt-label">Текст</label>
            <textarea id="mmt_jb_text" class="text_pole" rows="7" spellcheck="false">${escapeHtml(s.jailbreakText)}</textarea>
            <div class="mmt-set-hint">Макросы таверны работают.</div>
        </div>`;

    return `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid ${ICON}" style="margin-right: 6px;"></i>「 MEMENTO 」</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="mmt-drawer" id="mmt_settings_root">
                    <div class="mmt-drawer-hint">Альбом воспоминаний: любимые моменты чата превращаются в коллекционные карточки.</div>
                    <button class="menu_button mmt-open-btn" type="button">
                        <i class="fa-solid ${ICON}"></i>
                        <span>Открыть альбом</span>
                    </button>
                    ${categoryHtml('fa-book-open', 'Альбом', album)}
                    ${categoryHtml('fa-plug', 'Модель для карточек', model)}
                    ${categoryHtml('fa-paintbrush', 'Рисование', draw)}
                    ${categoryHtml('fa-palette', 'Стили', styles)}
                    ${categoryHtml('fa-key', 'Джейлбрейк', jailbreak)}
                </div>
            </div>
        </div>`;
}

function setupProfileDropdown() {
    const hint = document.getElementById('mmt_profile_hint');
    try {
        ctx().ConnectionManagerRequestService.handleDropdown(
            '#mmt_profile',
            getSettings().profileId,
            (profile) => {
                getSettings().profileId = profile?.id || '';
                saveSettings();
            },
        );
    } catch (error) {
        console.warn('[Memento] профили подключений недоступны:', error?.message);
        const select = document.getElementById('mmt_profile');
        if (select) select.style.display = 'none';
        if (hint) hint.textContent = 'Connection Manager отключён — будет использовано текущее подключение таверны.';
    }
}

function bindText(id, key, transform = (v) => v) {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
        getSettings()[key] = transform(el.value);
        saveSettings();
    });
}

function bindNumber(id, key, min, max, fallback) {
    const el = document.getElementById(id);
    el?.addEventListener('change', () => {
        let n = Math.round(Number(el.value));
        if (!Number.isFinite(n)) n = fallback;
        n = Math.min(max, Math.max(min, n));
        el.value = n;
        getSettings()[key] = n;
        saveSettings();
    });
}

export function addSettingsDrawer(onOpenWindow) {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('mmt-settings')) return;

    const wrap = document.createElement('div');
    wrap.id = 'mmt-settings';
    wrap.innerHTML = drawerHtml();
    host.appendChild(wrap);

    wrap.querySelector('.mmt-open-btn').addEventListener('click', () => onOpenWindow());

    const root = document.getElementById('mmt_settings_root');
    root.addEventListener('click', (e) => {
        const head = e.target.closest('.mmt-cat-head');
        if (!head) return;
        const expanded = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!expanded));
        const body = head.nextElementSibling;
        if (body) body.hidden = expanded;
    });

    document.getElementById('mmt_source').addEventListener('click', (e) => {
        const btn = e.target.closest('.mmt-seg-btn');
        if (!btn) return;
        const custom = btn.dataset.src === 'custom';
        getSettings().promptSource = custom ? 'custom' : 'profile';
        saveSettings();
        document.querySelectorAll('#mmt_source .mmt-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.getElementById('mmt_src_profile').hidden = custom;
        document.getElementById('mmt_src_custom').hidden = !custom;
    });

    setupProfileDropdown();
    bindText('mmt_custom_endpoint', 'customEndpoint', (v) => v.trim());
    bindText('mmt_custom_key', 'customKey', (v) => v.trim());
    bindText('mmt_custom_model', 'customModel', (v) => v.trim());
    bindNumber('mmt_max_tokens', 'maxTokens', 500, 32000, 4000);
    document.getElementById('mmt_reasoning').addEventListener('change', (e) => {
        getSettings().reasoningEffort = e.target.value === 'auto' ? 'auto' : 'min';
        saveSettings();
    });

    document.getElementById('mmt_jb_enabled').addEventListener('change', (e) => {
        getSettings().jailbreakEnabled = !!e.target.checked;
        saveSettings();
        document.getElementById('mmt_jb_body').hidden = !e.target.checked;
    });
    document.getElementById('mmt_jb_role').addEventListener('change', (e) => {
        const v = e.target.value;
        getSettings().jailbreakRole = ['system', 'user', 'assistant'].includes(v) ? v : 'system';
        saveSettings();
    });
    bindText('mmt_jb_text', 'jailbreakText');

    document.getElementById('mmt_default_theme').addEventListener('change', (e) => {
        getSettings().theme = getTheme(e.target.value).id;
        saveSettings();
    });
    document.getElementById('mmt_auto_reveal').addEventListener('change', (e) => {
        getSettings().autoReveal = !!e.target.checked;
        saveSettings();
    });

    bindDrawSettings();
    bindStyles();
}

// ---------- Рисование ----------

function refreshModelSelects() {
    const s = getSettings();
    const fill = (selectId, provider, saved) => {
        const select = document.getElementById(selectId);
        if (!select) return;
        const ids = [...getCatalog(provider)];
        if (saved && !ids.includes(saved)) ids.unshift(saved);
        select.innerHTML = ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
        if (saved) select.value = saved;
    };
    fill('mmt_naistera_model', 'naistera', String(s.naisteraModel || ''));
    fill('mmt_local_model', 'local', String(s.localModel || ''));
}

async function refreshCatalog(provider, button) {
    if (button) button.disabled = true;
    try {
        const ids = await fetchCatalog(provider);
        refreshModelSelects();
        if (ids.length) toastr.success(`Моделей: ${ids.length}`, TOAST_TITLE, { timeOut: 2000 });
        else toastr.warning('Провайдер вернул пустой список', TOAST_TITLE, { timeOut: 3500 });
    } catch (error) {
        toastr.error(`Список моделей не загрузился (${String(error?.message || error).slice(0, 160)})`, TOAST_TITLE, { timeOut: 6000 });
    } finally {
        if (button) button.disabled = false;
    }
}

function bindDrawSettings() {
    document.getElementById('mmt_provider').addEventListener('change', (e) => {
        const provider = e.target.value === 'local' ? 'local' : 'naistera';
        getSettings().provider = provider;
        saveSettings();
        document.getElementById('mmt_naistera_block').hidden = provider !== 'naistera';
        document.getElementById('mmt_local_block').hidden = provider !== 'local';
    });

    const bindTrim = (id, key, provider) => {
        document.getElementById(id).addEventListener('change', (e) => {
            getSettings()[key] = String(e.target.value || '').trim();
            saveSettings();
            if (provider) resetProviderState(provider);
        });
    };
    bindTrim('mmt_naistera_key', 'naisteraKey', 'naistera');
    bindTrim('mmt_naistera_endpoint', 'naisteraEndpoint', 'naistera');
    bindTrim('mmt_local_key', 'localKey');
    bindTrim('mmt_local_endpoint', 'localEndpoint', 'local');
    bindTrim('mmt_naistera_model', 'naisteraModel');
    bindTrim('mmt_local_model', 'localModel');

    document.querySelectorAll('#mmt_settings_root [data-refresh]').forEach((button) => {
        button.addEventListener('click', () => refreshCatalog(button.dataset.refresh, button));
    });
    document.getElementById('mmt_image_size').addEventListener('change', (e) => {
        getSettings().imageSize = IMAGE_SIZES.includes(e.target.value) ? e.target.value : '1K';
        saveSettings();
    });
    document.getElementById('mmt_send_refs').addEventListener('change', (e) => {
        getSettings().sendRefs = !!e.target.checked;
        saveSettings();
        document.getElementById('mmt_outfits_row').hidden = !e.target.checked;
    });
    document.getElementById('mmt_send_outfits').addEventListener('change', (e) => {
        getSettings().sendOutfits = !!e.target.checked;
        saveSettings();
    });
    refreshModelSelects();
}

// ---------- Стили (порт из Reel) ----------

function refreshStyleSelect() {
    const select = document.getElementById('mmt_style');
    if (!select) return;
    const s = getSettings();
    select.innerHTML = `<option value="">Без стиля</option>${s.styles.map((st) => `<option value="${escapeHtml(st.id)}">${escapeHtml(st.name || 'Без названия')}</option>`).join('')}`;
    select.value = s.styles.some((st) => st.id === s.activeStyleId) ? s.activeStyleId : '';
}

function renderStylesList(openId = null) {
    const list = document.getElementById('mmt_styles_list');
    if (!list) return;
    const styles = getSettings().styles;
    if (!styles.length) {
        list.innerHTML = '<div class="mmt-set-hint">Стилей пока нет.</div>';
        return;
    }
    list.innerHTML = styles.map((style) => `
        <details class="mmt-style-item" data-id="${escapeHtml(style.id)}" ${style.id === openId ? 'open' : ''}>
            <summary>${escapeHtml(style.name || 'Без названия')}</summary>
            <div class="mmt-style-body">
                <div class="mmt-style-top">
                    <input type="text" class="text_pole" data-f="name" value="${escapeHtml(style.name)}" placeholder="Название">
                    <button type="button" class="mmt-icon-btn" data-act="remove" title="Удалить"><i class="fa-solid fa-trash"></i></button>
                </div>
                <textarea class="text_pole" data-f="tags" rows="5" spellcheck="false" placeholder="текст стиля — уходит в начало промпта для бананы">${escapeHtml(style.tags)}</textarea>
            </div>
        </details>`).join('');

    list.querySelectorAll('.mmt-style-item').forEach((item) => {
        const find = () => getSettings().styles.find((st) => st.id === item.dataset.id);
        item.querySelector('[data-f="name"]').addEventListener('change', (e) => {
            const target = find();
            if (!target) return;
            target.name = String(e.target.value || '').trim() || 'Без названия';
            item.querySelector('summary').textContent = target.name;
            saveSettings();
            refreshStyleSelect();
        });
        item.querySelector('[data-f="tags"]').addEventListener('change', (e) => {
            const target = find();
            if (!target) return;
            target.tags = String(e.target.value || '').trim();
            saveSettings();
        });
        item.querySelector('[data-act="remove"]').addEventListener('click', async () => {
            const target = find();
            if (!target) return;
            if (!(await confirmPopup(`Удалить стиль «${escapeHtml(target.name)}»?`))) return;
            const s = getSettings();
            s.styles = s.styles.filter((st) => st.id !== item.dataset.id);
            if (s.activeStyleId === item.dataset.id) s.activeStyleId = '';
            saveSettings();
            renderStylesList();
            refreshStyleSelect();
        });
    });
}

/** Импорт из файла экспорта стилей Frame: всё из файла добавляется, ничего не заменяется. */
async function importStylesFromFile(file) {
    let incoming;
    try {
        const parsed = JSON.parse(await file.text());
        const raw = Array.isArray(parsed) ? parsed : parsed?.styles;
        incoming = (Array.isArray(raw) ? raw : [])
            .map((st) => ({ name: String(st?.name || '').trim(), tags: String(st?.value ?? st?.tags ?? '').trim() }))
            .filter((st) => st.tags);
        if (!incoming.length) throw new Error('в файле нет стилей');
    } catch (error) {
        toastr.error(`Не удалось прочитать файл: ${error?.message}`, TOAST_TITLE, { timeOut: 5000 });
        return;
    }
    const s = getSettings();
    for (const st of incoming) s.styles.push({ id: `s${makeId()}`, name: st.name || 'Без названия', tags: st.tags });
    saveSettings();
    renderStylesList();
    refreshStyleSelect();
    toastr.success(`Импортировано стилей: ${incoming.length}`, TOAST_TITLE, { timeOut: 2500 });
}

function bindStyles() {
    document.getElementById('mmt_style').addEventListener('change', (e) => {
        getSettings().activeStyleId = e.target.value;
        saveSettings();
    });
    document.getElementById('mmt_style_add').addEventListener('click', () => {
        const style = { id: `s${makeId()}`, name: 'Новый стиль', tags: '' };
        getSettings().styles.push(style);
        saveSettings();
        renderStylesList(style.id);
        refreshStyleSelect();
    });
    const importFile = document.getElementById('mmt_style_import_file');
    document.getElementById('mmt_style_import').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        importFile.value = '';
        if (file) await importStylesFromFile(file);
    });
    renderStylesList();
    refreshStyleSelect();
}
