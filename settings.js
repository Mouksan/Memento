// Memento — ящик в расширениях: кнопка альбома и настройки категориями, как в Koma.

import { ctx, getSettings, saveSettings, escapeHtml } from './store.js';

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
                    ${categoryHtml('fa-plug', 'Модель для карточек', model)}
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
}
