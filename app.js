/* ============================================================
   КОНФИГ
   ============================================================ */
const CONFIG = {
    password: 'guild123',          // ← СМЕНИ ПАРОЛЬ ЗДЕСЬ
    storageKey: 'guild_lists_v1'
};

const TABS = ['enemies', 'friends', 'neutral', 'personal'];

/* ============================================================
   СОСТОЯНИЕ
   ============================================================ */
let state = loadState();
let currentTab = 'enemies';
let isAdmin = sessionStorage.getItem('guild_admin') === '1';
let movingItem = null; // { fromTab, id }

/* ============================================================
   ХРАНИЛИЩЕ
   ============================================================ */
function emptyState() {
    return { enemies: [], friends: [], neutral: [], personal: [] };
}

function loadState() {
    try {
        const raw = localStorage.getItem(CONFIG.storageKey);
        if (!raw) return emptyState();
        const parsed = JSON.parse(raw);
        TABS.forEach(t => { if (!Array.isArray(parsed[t])) parsed[t] = []; });
        return parsed;
    } catch {
        return emptyState();
    }
}

function saveState() {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ============================================================
   DOM
   ============================================================ */
const $ = id => document.getElementById(id);

const loginBtn   = $('loginBtn');
const logoutBtn  = $('logoutBtn');
const userInfo   = $('userInfo');
const loginModal = $('loginModal');
const moveModal  = $('moveModal');

const nicknameInput = $('nickname');
const noteInput     = $('note');
const addBtn        = $('addBtn');
const statusEl      = $('status');

/* ============================================================
   АДМИН
   ============================================================ */
function applyAdminUI() {
    if (isAdmin) {
        loginBtn.hidden = true;
        logoutBtn.hidden = false;
        userInfo.textContent = '✔ Админ';
        document.querySelectorAll('.admin-only').forEach(el => el.hidden = false);
    } else {
        loginBtn.hidden = false;
        logoutBtn.hidden = true;
        userInfo.textContent = '';
        document.querySelectorAll('.admin-only').forEach(el => el.hidden = true);
    }
    renderAll();
}

loginBtn.addEventListener('click', () => {
    loginModal.hidden = false;
    $('loginError').textContent = '';
    $('password').value = '';
    $('password').focus();
});

$('cancelLogin').addEventListener('click', () => { loginModal.hidden = true; });

$('doLogin').addEventListener('click', () => {
    if ($('password').value === CONFIG.password) {
        isAdmin = true;
        sessionStorage.setItem('guild_admin', '1');
        loginModal.hidden = true;
        applyAdminUI();
    } else {
        $('loginError').textContent = 'Неверный пароль';
    }
});

$('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('doLogin').click();
});

logoutBtn.addEventListener('click', () => {
    isAdmin = false;
    sessionStorage.removeItem('guild_admin');
    applyAdminUI();
});

/* ============================================================
   ВКЛАДКИ
   ============================================================ */
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        document.getElementById('tab-' + currentTab).classList.add('active');
    });
});

/* ============================================================
   РЕНДЕР
   ============================================================ */
function renderAll() {
    TABS.forEach(renderList);
}

function renderList(tab) {
    const ul = document.querySelector(`[data-list="${tab}"]`);
    if (!ul) return;
    const items = state[tab] || [];
    ul.innerHTML = '';

    if (items.length === 0) {
        ul.innerHTML = `<li class="empty">Список пуст</li>`;
        return;
    }

    items.slice().reverse().forEach(item => {
        const li = document.createElement('li');
        const actions = isAdmin ? `
            <div class="actions">
                <button class="move" title="Переместить">↔</button>
                <button class="delete" title="Удалить">🗑</button>
            </div>` : '';

        li.innerHTML = `
            <div class="info">
                <span class="nick">${escapeHtml(item.nickname)}</span>
                ${item.note ? `<span class="note">${escapeHtml(item.note)}</span>` : ''}
            </div>
            ${actions}`;

        if (isAdmin) {
            li.querySelector('.move').addEventListener('click', () => openMoveModal(tab, item.id));
            li.querySelector('.delete').addEventListener('click', () => deleteItem(tab, item.id));
        }

        ul.appendChild(li);
    });
}

/* ============================================================
   ДОБАВЛЕНИЕ
   ============================================================ */
addBtn.addEventListener('click', () => {
    if (!isAdmin) return;

    const nickname = nicknameInput.value.trim();
    const note = noteInput.value.trim();

    if (!nickname) {
        flashStatus('Введите никнейм', '#ff7a7a');
        return;
    }

    state[currentTab].push({
        id: uid(),
        nickname,
        note: note || '',
        created: Date.now()
    });
    saveState();

    nicknameInput.value = '';
    noteInput.value = '';
    nicknameInput.focus();

    flashStatus('✔ Добавлено', '#6ee7a7');
    renderList(currentTab);
});

[nicknameInput, noteInput].forEach(inp => {
    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') addBtn.click();
    });
});

function flashStatus(text, color) {
    statusEl.textContent = text;
    statusEl.style.color = color;
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => statusEl.textContent = '', 2000);
}

/* ============================================================
   УДАЛЕНИЕ
   ============================================================ */
function deleteItem(tab, id) {
    if (!confirm('Удалить запись?')) return;
    state[tab] = state[tab].filter(x => x.id !== id);
    saveState();
    renderList(tab);
}

/* ============================================================
   ПЕРЕМЕЩЕНИЕ
   ============================================================ */
function openMoveModal(fromTab, id) {
    movingItem = { fromTab, id };
    moveModal.hidden = false;
}

$('cancelMove').addEventListener('click', () => {
    moveModal.hidden = true;
    movingItem = null;
});

document.querySelectorAll('#moveModal [data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!movingItem) return;
        const { fromTab, id } = movingItem;
        const toTab = btn.dataset.target;

        moveModal.hidden = true;
        movingItem = null;

        if (toTab === fromTab) return;

        const idx = state[fromTab].findIndex(x => x.id === id);
        if (idx === -1) return;

        const [item] = state[fromTab].splice(idx, 1);
        item.created = Date.now();
        state[toTab].push(item);
        saveState();

        renderList(fromTab);
        renderList(toTab);
    });
});

/* ============================================================
   УТИЛИТЫ
   ============================================================ */
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/* ============================================================
   СТАРТ
   ============================================================ */
applyAdminUI();