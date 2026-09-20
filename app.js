import { supabase } from './supabase.js';

/* ============================================================
   КОНФИГ ГИЛЬДИЙ
   ============================================================ */
const CLANS = {
    clan1: {
        name: 'Гильдия АОВ',
        image: 'images/aov.png',
        bg: 'images/bg-aov.jpg'
    },
    clan2: {
        name: 'Гильдия -К-',
        image: 'images/k.png',
        bg: 'images/bg-k.jpg'
    },
};

// общий фон на экране выбора гильдии
const MAIN_BG = 'images/bg-main.jpg';

const TABS = ['enemies', 'friends', 'neutral', 'personal'];
const CLAN_STORAGE_KEY = 'guild_current_clan';

let currentClan = null;
let currentTab  = 'enemies';
let isAdmin     = false;
let movingItem  = null;

/* ============================================================
   DOM
   ============================================================ */
const $ = id => document.getElementById(id);

const landing   = $('landing');
const clanView  = $('clanView');
const clanTitle = $('clanTitle');
const clanIcon  = $('clanIcon');

/* ============================================================
   АДМИН
   ============================================================ */
function applyAdminUI() {
    const logged = isAdmin;

    $('loginBtn').hidden  = logged;
    $('logoutBtn').hidden = !logged;
    $('userInfo').textContent = logged ? '✔ Админ' : '';

    $('logoutBtn2').hidden = !logged;
    $('userInfo2').textContent = logged ? '✔ Админ' : '';

    document.querySelectorAll('.admin-only').forEach(el => el.hidden = !logged);

    renderAll();
}

$('loginBtn').addEventListener('click', () => {
    $('loginModal').hidden = false;
    $('loginError').textContent = '';
    $('email').value = '';
    $('password').value = '';
    $('email').focus();
});

$('cancelLogin').addEventListener('click', () => { $('loginModal').hidden = true; });

$('doLogin').addEventListener('click', async () => {
    const email = $('email').value.trim();
    const password = $('password').value;
    $('loginError').textContent = '';

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        $('loginError').textContent = error.message;
        return;
    }
    $('loginModal').hidden = true;
});

$('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('doLogin').click();
});

async function doLogout() {
    await supabase.auth.signOut();
}
$('logoutBtn').addEventListener('click', doLogout);
$('logoutBtn2').addEventListener('click', doLogout);

supabase.auth.onAuthStateChange((_e, session) => {
    isAdmin = !!session;
    applyAdminUI();
});

/* ============================================================
   ВЫБОР ГИЛЬДИИ
   ============================================================ */
document.querySelectorAll('.clan-card').forEach(btn => {
    btn.addEventListener('click', () => openClan(btn.dataset.clan));
});

$('backBtn').addEventListener('click', closeClan);

function openClan(clanId) {
    if (!CLANS[clanId]) return;
    currentClan = clanId;
    localStorage.setItem(CLAN_STORAGE_KEY, clanId);

    clanTitle.textContent = CLANS[clanId].name;
    clanIcon.src = CLANS[clanId].image;
    clanIcon.alt = CLANS[clanId].name;

    // 👇 меняем фон на фон гильдии
    document.body.style.backgroundImage = `url('${CLANS[clanId].bg}')`;

    landing.hidden = true;
    clanView.hidden = false;

    currentTab = 'enemies';
    document.querySelectorAll('.tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === 'enemies'));
    document.querySelectorAll('.tab-content').forEach(c =>
        c.classList.toggle('active', c.id === 'tab-enemies'));

    applyAdminUI();
    renderAll();
}

function closeClan() {
    currentClan = null;
    localStorage.removeItem(CLAN_STORAGE_KEY);
    clanView.hidden = true;
    landing.hidden = false;

    // 👇 возвращаем общий фон
    document.body.style.backgroundImage = `url('${MAIN_BG}')`;
}

/* ============================================================
   ВКЛАДКИ
   ============================================================ */
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        $('tab-' + currentTab).classList.add('active');
    });
});

/* ============================================================
   ЗАГРУЗКА
   ============================================================ */
function renderAll() {
    if (!currentClan) return;
    TABS.forEach(loadList);
}

async function loadList(tab) {
    if (!currentClan) return;

    const ul = document.querySelector(`[data-list="${tab}"]`);
    if (!ul) return;

    ul.innerHTML = '<li class="empty">Загрузка…</li>';

    const { data, error } = await supabase
        .from(tab)
        .select('*')
        .eq('clan', currentClan)
        .order('created_at', { ascending: false });

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

/* ============================================================
   ДОБАВЛЕНИЕ
   ============================================================ */
$('addBtn').addEventListener('click', async () => {
    if (!isAdmin || !currentClan) return;

    const nickname = $('nickname').value.trim();
    const note = $('note').value.trim();

    if (!nickname) {
        flashStatus('Введите никнейм', '#ff7a7a');
        return;
    }

    const { error } = await supabase
        .from(currentTab)
        .insert({ nickname, note: note || null, clan: currentClan });

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

/* ============================================================
   УДАЛЕНИЕ
   ============================================================ */
async function deleteItem(tab, id) {
    if (!confirm('Удалить запись?')) return;
    const { error } = await supabase.from(tab).delete().eq('id', id);
    if (error) return alert(error.message);
    loadList(tab);
}

/* ============================================================
   ПЕРЕМЕЩЕНИЕ
   ============================================================ */
function openMoveModal(fromTab, id) {
    movingItem = { fromTab, id };
    $('moveModal').hidden = false;
}

$('cancelMove').addEventListener('click', () => {
    $('moveModal').hidden = true;
    movingItem = null;
});

document.querySelectorAll('#moveModal [data-target]').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!movingItem || !currentClan) return;
        const { fromTab, id } = movingItem;
        const toTab = btn.dataset.target;

        $('moveModal').hidden = true;
        movingItem = null;

        if (toTab === fromTab) return;

        const { data, error } = await supabase
            .from(fromTab).select('*').eq('id', id).single();
        if (error) return alert(error.message);

        const { error: insErr } = await supabase
            .from(toTab)
            .insert({ nickname: data.nickname, note: data.note, clan: currentClan });
        if (insErr) return alert(insErr.message);

        const { error: delErr } = await supabase.from(fromTab).delete().eq('id', id);
        if (delErr) return alert(delErr.message);

        loadList(fromTab);
        loadList(toTab);
    });
});

/* ============================================================
   УТИЛИТА
   ============================================================ */
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/* ============================================================
   СТАРТ
   ============================================================ */
(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    isAdmin = !!session;
    applyAdminUI();

    const savedClan = localStorage.getItem(CLAN_STORAGE_KEY);
    if (savedClan && CLANS[savedClan]) {
        openClan(savedClan);           // выставит фон гильдии
    } else {
        document.body.style.backgroundImage = `url('${MAIN_BG}')`;
    }
})();
