import { supabase } from './supabase.js';

/* ============================================================
   ⚙️ КОНФИГ
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

const MAIN_BG = 'images/bg-main.jpg';

// ⚠️ АДМИНЫ — email'ы с правами редактирования (в нижнем регистре!).
// Должны совпадать со списком в RLS-политике SQL!
const ADMIN_EMAILS = [
    'kolibri@wosb.ru'
];

const TABS = ['enemies', 'friends', 'neutral', 'personal'];
const CLAN_STORAGE_KEY = 'guild_current_clan';
const BG_STORAGE_KEY   = 'guild_bg_overrides';

let currentClan = null;
let currentTab  = 'enemies';
let currentUser = null;
let isAdmin     = false;
let movingItem  = null;
let editingItem = null;

/* ============================================================
   DOM
   ============================================================ */
const $ = id => document.getElementById(id);

const landing     = $('landing');
const clanView    = $('clanView');
const clanTitle   = $('clanTitle');
const clanIcon    = $('clanIcon');
const bgFileInput = $('bgFileInput');
const authModal   = $('authModal');

/* ============================================================
   ФОНЫ
   ============================================================ */
function getOverrides() {
    try { return JSON.parse(localStorage.getItem(BG_STORAGE_KEY) || '{}'); }
    catch { return {}; }
}

function setOverride(key, dataUrl) {
    const all = getOverrides();
    if (dataUrl) all[key] = dataUrl;
    else delete all[key];
    try {
        localStorage.setItem(BG_STORAGE_KEY, JSON.stringify(all));
        return true;
    } catch (e) {
        alert('Не удалось сохранить фон: файл слишком большой. Возьми картинку поменьше (до 1 МБ).');
        return false;
    }
}

function currentBgKey() {
    return currentClan ? currentClan : 'main';
}

function currentBgFallback() {
    return currentClan ? CLANS[currentClan].bg : MAIN_BG;
}

function applyBg() {
    const key = currentBgKey();
    const overrides = getOverrides();
    const url = overrides[key] || currentBgFallback();
    document.body.style.backgroundImage = `url('${url}')`;
}

function compressImage(file, maxW = 1920, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const scale = img.width > maxW ? maxW / img.width : 1;
                const w = Math.round(img.width * scale);
                const h = Math.round(img.height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function changeBg() {
    if (!isAdmin) return;
    bgFileInput.value = '';
    bgFileInput.click();
}

bgFileInput.addEventListener('change', async () => {
    const file = bgFileInput.files[0];
    if (!file) return;
    try {
        const dataUrl = await compressImage(file);
        const key = currentBgKey();
        if (setOverride(key, dataUrl)) applyBg();
    } catch (err) {
        alert('Не удалось обработать картинку: ' + err.message);
    }
});

function resetBg() {
    if (!isAdmin) return;
    const key = currentBgKey();
    if (!getOverrides()[key]) {
        alert('Уже стоит стандартный фон.');
        return;
    }
    if (!confirm('Вернуть стандартный фон?')) return;
    setOverride(key, null);
    applyBg();
}

['bgChangeBtn', 'bgChangeBtn2'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('click', changeBg);
});
['bgResetBtn', 'bgResetBtn2'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('click', resetBg);
});

/* ============================================================
   АВТОРИЗАЦИЯ / РЕГИСТРАЦИЯ
   ============================================================ */
let authMode = 'login';

function openAuth(mode) {
    authMode = mode;
    authModal.hidden = false;
    $('authError').textContent = '';

    if (mode === 'login') {
        $('tabLogin').classList.add('active');
        $('tabRegister').classList.remove('active');
        $('loginForm').hidden = false;
        $('registerForm').hidden = true;
        $('doAuth').textContent = 'Войти';
        $('email').focus();
    } else {
        $('tabRegister').classList.add('active');
        $('tabLogin').classList.remove('active');
        $('loginForm').hidden = true;
        $('registerForm').hidden = false;
        $('doAuth').textContent = 'Зарегистрироваться';
        $('regEmail').focus();
    }
}

function closeAuth() {
    authModal.hidden = true;
    $('authError').textContent = '';
    ['email', 'password', 'regEmail', 'regPassword', 'regPassword2'].forEach(id => {
        const el = $(id); if (el) el.value = '';
    });
}

$('loginBtn').addEventListener('click', () => openAuth('login'));
$('registerBtn').addEventListener('click', () => openAuth('register'));
$('cancelAuth').addEventListener('click', closeAuth);

$('tabLogin').addEventListener('click', () => openAuth('login'));
$('tabRegister').addEventListener('click', () => openAuth('register'));

$('doAuth').addEventListener('click', async () => {
    const err = $('authError');
    err.style.color = '';
    err.textContent = '';

    if (authMode === 'login') {
        const email = $('email').value.trim();
        const password = $('password').value;

        if (!email || !password) {
            err.textContent = 'Заполни email и пароль';
            return;
        }

        $('doAuth').disabled = true;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        $('doAuth').disabled = false;

        if (error) { err.textContent = error.message; return; }
        closeAuth();
    } else {
        const email = $('regEmail').value.trim();
        const p1 = $('regPassword').value;
        const p2 = $('regPassword2').value;

        if (!email || !p1) {
            err.textContent = 'Заполни email и пароль';
            return;
        }
        if (p1.length < 6) {
            err.textContent = 'Пароль должен быть не короче 6 символов';
            return;
        }
        if (p1 !== p2) {
            err.textContent = 'Пароли не совпадают';
            return;
        }

        $('doAuth').disabled = true;
        const { error } = await supabase.auth.signUp({ email, password: p1 });
        $('doAuth').disabled = false;

        if (error) { err.textContent = error.message; return; }

        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            closeAuth();
        } else {
            err.style.color = '#6ee7a7';
            err.textContent = '✔ Проверь почту — мы отправили ссылку для подтверждения';
            setTimeout(closeAuth, 4000);
        }
    }
});

['email', 'password', 'regEmail', 'regPassword', 'regPassword2'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('keydown', e => {
        if (e.key === 'Enter') $('doAuth').click();
    });
});

async function doLogout() {
    await supabase.auth.signOut();
}
$('logoutBtn').addEventListener('click', doLogout);
$('logoutBtn2').addEventListener('click', doLogout);

supabase.auth.onAuthStateChange((_e, session) => {
    currentUser = session?.user || null;
    isAdmin = !!currentUser && ADMIN_EMAILS.includes((currentUser.email || '').toLowerCase());
    applyAuthUI();
});

function applyAuthUI() {
    const logged = !!currentUser;

    $('loginBtn').hidden    = logged;
    $('registerBtn').hidden = logged;
    $('logoutBtn').hidden   = !logged;
    $('logoutBtn2').hidden  = !logged;

    document.querySelectorAll('.logged-only').forEach(el => {
        el.hidden = !logged;
    });

    const label = logged
        ? (isAdmin ? '👑 ' + currentUser.email : '👤 ' + currentUser.email)
        : '';
    $('userInfo').textContent  = label;
    $('userInfo2').textContent = label;
    $('userInfo').classList.toggle('admin', isAdmin);
    $('userInfo2').classList.toggle('admin', isAdmin);

    document.querySelectorAll('.admin-only').forEach(el => {
        el.hidden = !isAdmin;
        if (!isAdmin) el.style.display = '';
    });
    document.querySelectorAll('.add-form.admin-only').forEach(el => {
        el.style.display = isAdmin ? 'flex' : 'none';
    });

    renderAll();
}

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

    landing.hidden = true;
    clanView.hidden = false;

    applyBg();

    currentTab = 'enemies';
    document.querySelectorAll('.tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === 'enemies'));
    document.querySelectorAll('.tab-content').forEach(c =>
        c.classList.toggle('active', c.id === 'tab-enemies'));

    applyAuthUI();
    renderAll();
}

function closeClan() {
    currentClan = null;
    localStorage.removeItem(CLAN_STORAGE_KEY);
    clanView.hidden = true;
    landing.hidden = false;
    applyBg();
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

        const mainRowParts = [];
        if (item.nickname)     mainRowParts.push(`<span class="nick">${escapeHtml(item.nickname)}</span>`);
        if (item.player_guild) mainRowParts.push(`<span class="guild">${escapeHtml(item.player_guild)}</span>`);
        if (item.faction)      mainRowParts.push(`<span class="faction">${escapeHtml(item.faction)}</span>`);

        const actions = isAdmin ? `
            <div class="actions">
                <button class="edit" title="Редактировать">✏️</button>
                <button class="move" title="Переместить">↔</button>
                <button class="delete" title="Удалить">🗑</button>
            </div>` : '';

        li.innerHTML = `
            <div class="info">
                <div class="row-main">${mainRowParts.join('')}</div>
                ${item.note ? `<span class="note">${escapeHtml(item.note)}</span>` : ''}
            </div>
            ${actions}`;

        if (isAdmin) {
            li.querySelector('.edit').addEventListener('click',   () => openEditModal(tab, item));
            li.querySelector('.move').addEventListener('click',   () => openMoveModal(tab, item.id));
            li.querySelector('.delete').addEventListener('click', () => deleteItem(tab, item.id));
        }

        ul.appendChild(li);
    });
}

/* ============================================================
   РЕДАКТИРОВАНИЕ
   ============================================================ */
function openEditModal(tab, item) {
    editingItem = { tab, id: item.id };
    $('editPlayerGuild').value = item.player_guild || '';
    $('editNickname').value    = item.nickname     || '';
    $('editFaction').value     = item.faction      || '';
    $('editNote').value        = item.note         || '';
    $('editError').textContent = '';
    $('editModal').hidden = false;
    $('editPlayerGuild').focus();
}

$('cancelEdit').addEventListener('click', () => {
    $('editModal').hidden = true;
    editingItem = null;
});

$('saveEdit').addEventListener('click', async () => {
    if (!editingItem) return;

    const playerGuild = $('editPlayerGuild').value.trim();
    const nickname    = $('editNickname').value.trim();
    const faction     = $('editFaction').value.trim();
    const note        = $('editNote').value.trim();

    if (!playerGuild && !nickname) {
        $('editError').textContent = 'Заполни Гильдию или Никнейм';
        return;
    }

    const { tab, id } = editingItem;

    const { error } = await supabase
        .from(tab)
        .update({
            nickname:     nickname || null,
            player_guild: playerGuild || null,
            faction:      faction || null,
            note:         note || null
        })
        .eq('id', id);

    if (error) {
        $('editError').textContent = 'Ошибка: ' + error.message;
        return;
    }

    $('editModal').hidden = true;
    editingItem = null;
    loadList(tab);
});

['editPlayerGuild', 'editNickname', 'editFaction', 'editNote'].forEach(id => {
    $(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') $('saveEdit').click();
    });
});

/* ============================================================
   ДОБАВЛЕНИЕ
   ============================================================ */
$('addBtn').addEventListener('click', async () => {
    if (!isAdmin || !currentClan) return;

    const playerGuild = $('playerGuild').value.trim();
    const nickname    = $('nickname').value.trim();
    const faction     = $('faction').value.trim();
    const note        = $('note').value.trim();

    if (!playerGuild && !nickname) {
        flashStatus('Заполни Гильдию или Никнейм', '#ff7a7a');
        return;
    }

    const { error } = await supabase
        .from(currentTab)
        .insert({
            nickname:     nickname || null,
            player_guild: playerGuild || null,
            faction:      faction || null,
            note:         note || null,
            clan:         currentClan
        });

    if (error) {
        flashStatus('Ошибка: ' + error.message, '#ff7a7a');
        return;
    }

    $('playerGuild').value = '';
    $('nickname').value = '';
    $('faction').value = '';
    $('note').value = '';
    $('playerGuild').focus();
    flashStatus('✔ Добавлено', '#6ee7a7');
    loadList(currentTab);
});

[$('playerGuild'), $('nickname'), $('faction'), $('note')].forEach(inp => {
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
            .insert({
                nickname:     data.nickname,
                player_guild: data.player_guild,
                faction:      data.faction,
                note:         data.note,
                clan:         currentClan
            });
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
    currentUser = session?.user || null;
    isAdmin = !!currentUser && ADMIN_EMAILS.includes((currentUser.email || '').toLowerCase());
    applyAuthUI();

    const savedClan = localStorage.getItem(CLAN_STORAGE_KEY);
    if (savedClan && CLANS[savedClan]) {
        openClan(savedClan);
    } else {
        applyBg();
    }
})();
