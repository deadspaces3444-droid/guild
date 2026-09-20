import { supabase } from './supabase.js';

const TABS = ['enemies', 'friends', 'neutral', 'personal'];

let currentTab = 'enemies';
let isAdmin = false;
let movingItem = null; // { fromTab, id }

// ================== DOM ==================
const $ = id => document.getElementById(id);
const loginBtn    = $('loginBtn');
const logoutBtn   = $('logoutBtn');
const userInfo    = $('userInfo');
const loginModal  = $('loginModal');
const moveModal   = $('moveModal');

// ================== АДМИН ==================
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
    $('email').value = '';
    $('password').value = '';
    $('email').focus();
});

$('cancelLogin').addEventListener('click', () => { loginModal.hidden = true; });

$('doLogin').addEventListener('click', async () => {
    const email = $('email').value.trim();
    const password = $('password').value;
    $('loginError').textContent = '';

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        $('loginError').textContent = error.message;
        return;
    }
    loginModal.hidden = true;
});

$('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('doLogin').click();
});

logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
});

// ================== СЕССИЯ ==================
supabase.auth.onAuthStateChange((_event, session) => {
    isAdmin = !!session;
    applyAdminUI();
});

// ================== ВКЛАДКИ ==================
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        $('tab-' + currentTab).classList.add('active');
    });
});

// ================== ЗАГРУЗКА ==================
async function loadList(tab) {
    const { data, error } = await supabase
        .from(tab)
        .select('*')
        .order('created_at', { ascending: false });

    const ul = document.querySelector(`[data-list="${tab}"]`);
    if (!ul) return;
    ul.innerHTML = '';

    if (error) {
        ul.innerHTML = `<li class="empty">Ошибка: ${error.message}</li>`;
        return;
    }
    if (!data || data.length === 0) {
        ul.innerHTML = `<li class="empty">Список пуст</li>`;
        return;
    }

    data.forEach(item => {
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

function renderAll() {
    TABS.forEach(loadList);
}

// ================== ДОБАВЛЕНИЕ ==================
$('addBtn').addEventListener('click', async () => {
    if (!isAdmin) return;

    const nickname = $('nickname').value.trim();
    const note = $('note').value.trim();

    if (!nickname) {
        flashStatus('Введите никнейм', '#ff7a7a');
        return;
    }

    const { error } = await supabase
        .from(currentTab)
        .insert({ nickname, note: note || null });

    if (error) {
        flashStatus('Ошибка: ' + error.message, '#ff7a7a');
        return;
    }

    $('nickname').value = '';
    $('note').value = '';
    $('nickname').focus();
    flashStatus('✔ Добавлено', '#6ee7a7');
    loadList(currentTab);
});

[$('nickname'), $('note')].forEach(inp => {
    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') $('addBtn').click();
    });
});

function flashStatus(text, color) {
    const el = $('status');
    el.textContent = text;
    el.style.color = color;
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => el.textContent = '', 2000);
}

// ================== УДАЛЕНИЕ ==================
async function deleteItem(tab, id) {
    if (!confirm('Удалить запись?')) return;
    const { error } = await supabase.from(tab).delete().eq('id', id);
    if (error) return alert(error.message);
    loadList(tab);
}

// ================== ПЕРЕМЕЩЕНИЕ ==================
function openMoveModal(fromTab, id) {
    movingItem = { fromTab, id };
    moveModal.hidden = false;
}

$('cancelMove').addEventListener('click', () => {
    moveModal.hidden = true;
    movingItem = null;
});

document.querySelectorAll('#moveModal [data-target]').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!movingItem) return;
        const { fromTab, id } = movingItem;
        const toTab = btn.dataset.target;

        moveModal.hidden = true;
        movingItem = null;

        if (toTab === fromTab) return;

        const { data, error } = await supabase.from(fromTab).select('*').eq('id', id).single();
        if (error) return alert(error.message);

        const { error: insErr } = await supabase
            .from(toTab)
            .insert({ nickname: data.nickname, note: data.note });
        if (insErr) return alert(insErr.message);

        const { error: delErr } = await supabase.from(fromTab).delete().eq('id', id);
        if (delErr) return alert(delErr.message);

        loadList(fromTab);
        loadList(toTab);
    });
});

// ================== УТИЛИТА ==================
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ================== СТАРТ ==================
(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    isAdmin = !!session;
    applyAdminUI();
})();
