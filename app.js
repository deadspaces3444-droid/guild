import { supabase } from './supabase.js';

/* ============================================================
   ⚙️ КОНФИГ
   ============================================================ */
const ADMIN_EMAILS = ['kolibri@wosb.ru'];

const TABS = ['enemies', 'friends', 'neutral', 'personal'];
const SESSION_CLAN_KEY = 'guild_authed_clan';
const BG_STORAGE_KEY   = 'guild_bg_overrides';

let clansCache    = {};
let currentClan   = null;
let pendingClanId = null;
let currentTab    = 'enemies';
let isAdmin       = false;
let movingItem    = null;
let editingItem   = null;

/* ============================================================
   DOM
   ============================================================ */
const $ = id => document.getElementById(id);

const screenHome  = $('screen-home');
const screenClan  = $('screen-clan');
const clanView    = $('clanView');
const bgFileInput = $('bgFileInput');

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
        alert('Фон слишком большой. Возьми картинку поменьше.');
        return false;
    }
}
function currentBgKey() {
    return currentClan ? currentClan : 'main';
}
function currentBgFallback() {
    if (currentClan && clansCache[currentClan]) return clansCache[currentClan].bg;
    return 'images/bg-main.jpg';
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

$('bgChangeBtn').addEventListener('click', () => {
    if (!isAdmin) return;
    bgFileInput.value = '';
    bgFileInput.click();
});
bgFileInput.addEventListener('change', async () => {
    const file = bgFileInput.files[0];
    if (!file) return;
    try {
        const dataUrl = await compressImage(file);
        if (setOverride(currentBgKey(), dataUrl)) applyBg();
    } catch (err) {
        alert('Не удалось обработать: ' + err.message);
    }
});
$('bgResetBtn').addEventListener('click', () => {
    if (!isAdmin) return;
    const key = currentBgKey();
    if (!getOverrides()[key]) return alert('Уже стоит стандартный фон.');
    if (!confirm('Вернуть стандартный фон?')) return;
    setOverride(key, null);
    applyBg();
});

/* ============================================================
   ЭКРАНЫ
   ============================================================ */
function showScreen(name) {
    screenHome.hidden = name !== 'home';
    screenClan.hidden = name !== 'clan';
    clanView.hidden   = name !== 'lists';
    window.scrollTo(0, 0);
}

/* ============================================================
   АДМИН-АВТОРИЗАЦИЯ
   ============================================================ */
function openAdminAuth() {
    $('adminAuthModal').hidden = false;
    $('adminAuthError').textContent = '';
    $('adminEmail').value = '';
    $('adminPassword').value = '';
    $('adminEmail').focus();
}
function closeAdminAuth() {
    $('adminAuthModal').hidden = true;
}
$('adminLoginBtn').addEventListener('click', openAdminAuth);
$('cancelAdminLogin').addEventListener('click', closeAdminAuth);

$('doAdminLogin').addEventListener('click', async () => {
    const email = $('adminEmail').value.trim();
    const password = $('adminPassword').value;
    const err = $('adminAuthError');
    err.textContent = '';

    if (!email || !password) { err.textContent = 'Заполни email и пароль'; return; }

    $('doAdminLogin').disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    $('doAdminLogin').disabled = false;

    if (error) { err.textContent = error.message; return; }
    closeAdminAuth();
});

$('adminPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('doAdminLogin').click();
});

async function adminLogout() {
    await supabase.auth.signOut();
    closeAdminPanel();
}
$('adminLogoutBtn').addEventListener('click', adminLogout);
$('adminLogoutBtn2').addEventListener('click', adminLogout);

supabase.auth.onAuthStateChange((_e, session) => {
    isAdmin = !!session?.user && ADMIN_EMAILS.includes((session.user.email || '').toLowerCase());
    applyAdminUI();
});

function applyAdminUI() {
    $('adminLoginBtn').hidden = isAdmin;
    $('adminLogoutBtn').hidden = !isAdmin;
    $('adminPanelBtn').hidden = !isAdmin;
    $('adminLogoutBtn2').hidden = !isAdmin;
    $('adminPanelBtn2').hidden = !isAdmin;
    $('adminPanelBtn3').hidden = !isAdmin;

    const label = isAdmin ? '👑 Админ' : '';
    ['adminInfo','adminInfo2','adminInfo3'].forEach(id => {
        const el = $(id);
        if (el) el.textContent = label;
    });

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
   ГИЛЬДИИ
   ============================================================ */
async function loadClans() {
    const { data, error } = await supabase.from('clans').select('*');
    if (error) {
        console.error('Ошибка загрузки гильдий:', error);
        return;
    }
    clansCache = {};
    (data || []).forEach(c => { clansCache[c.id] = c; });
    renderHomeCards();
    renderAdminClanSelect();
}

function renderHomeCards() {
    const grid = $('clanGrid');
    grid.innerHTML = '';
    Object.values(clansCache).forEach(clan => {
        const btn = document.createElement('button');
        btn.className = 'clan-card';
        btn.dataset.clan = clan.id;
        btn.innerHTML = `
            <img src="${escapeHtml(clan.image)}" alt="${escapeHtml(clan.name)}">
            <span class="clan-name">${escapeHtml(clan.name)}</span>
            <span class="clan-desc">${escapeHtml(clan.description || '')}</span>
            <span class="clan-more">Подробнее →</span>
        `;
        btn.addEventListener('click', () => openClanInfo(clan.id));
        grid.appendChild(btn);
    });
}

/* ============================================================
   ОПИСАНИЕ ГИЛЬДИИ
   ============================================================ */
function openClanInfo(clanId) {
    const clan = clansCache[clanId];
    if (!clan) return;
    pendingClanId = clanId;

    $('clanInfoLogo').src = clan.image;
    $('clanInfoLogo').alt = clan.name;
    $('clanInfoName').textContent = clan.name;
    $('clanInfoDesc').textContent = clan.description || '';
    $('clanInfoRules').textContent = clan.rules || 'Правила не заданы.';

    showScreen('clan');
}

$('backToHomeBtn').addEventListener('click', () => {
    pendingClanId = null;
    showScreen('home');
});

/* ============================================================
   ВХОД ПО ПАРОЛЮ
   ============================================================ */
$('clanLoginBtn').addEventListener('click', () => {
    if (!pendingClanId) return;
    const clan = clansCache[pendingClanId];
    $('clanPassName').textContent = clan.name;
    $('clanPassword').value = '';
    $('clanPassError').textContent = '';
    $('clanPassModal').hidden = false;
    $('clanPassword').focus();
});

$('cancelClanLogin').addEventListener('click', () => {
    $('clanPassModal').hidden = true;
});

$('doClanLogin').addEventListener('click', () => {
    const entered = $('clanPassword').value;
    const clan = clansCache[pendingClanId];
    if (!clan) return;

    if (!entered) { $('clanPassError').textContent = 'Введите пароль'; return; }
    if (entered !== clan.password) { $('clanPassError').textContent = 'Неверный пароль'; return; }

    localStorage.setItem(SESSION_CLAN_KEY, pendingClanId);
    $('clanPassModal').hidden = true;
    const cid = pendingClanId;
    pendingClanId = null;
    openClan(cid);
});

$('clanPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('doClanLogin').click();
});

/* ============================================================
   СПИСКИ ГИЛЬДИИ
   ============================================================ */
function openClan(clanId) {
    const clan = clansCache[clanId];
    if (!clan) return;

    if (localStorage.getItem(SESSION_CLAN_KEY) !== clanId) {
        openClanInfo(clanId);
        return;
    }

    currentClan = clanId;
    $('clanTitle').textContent = clan.name;
    $('clanIcon').src = clan.image;
    $('clanIcon').alt = clan.name;

    showScreen('lists');
    applyBg();

    currentTab = 'enemies';
    document.querySelectorAll('.tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === 'enemies'));
    document.querySelectorAll('.tab-content').forEach(c =>
        c.classList.toggle('active', c.id === 'tab-enemies'));

    applyAdminUI();
    renderAll();
}

$('backBtn').addEventListener('click', () => {
    if (currentClan && clansCache[currentClan]) {
        pendingClanId = currentClan;
        openClanInfo(currentClan);
    } else {
        showScreen('home');
    }
});

$('clanLeaveBtn').addEventListener('click', () => {
    if (!confirm('Выйти из гильдии? Пароль потребуется ввести снова.')) return;
    localStorage.removeItem(SESSION_CLAN_KEY);
    currentClan = null;
    showScreen('home');
    applyBg();
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
        $('tab-' + currentTab).classList.add('active');
    });
});

/* ============================================================
   ЗАГРУЗКА СПИСКОВ
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
        ul.innerHTML = '<li class="empty">Список пуст</li>';
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
   АДМИН-ПАНЕЛЬ
   ============================================================ */
function openAdminPanel() {
    if (!isAdmin) return;
    renderAdminClanSelect();
    $('adminPanelMsg').textContent = '';
    $('adminNewPass').value = '';
    $('adminPanelModal').hidden = false;
}
$('adminPanelBtn').addEventListener('click', openAdminPanel);
$('adminPanelBtn2').addEventListener('click', openAdminPanel);
$('adminPanelBtn3').addEventListener('click', openAdminPanel);

function closeAdminPanel() {
    $('adminPanelModal').hidden = true;
}
$('closeAdminPanel').addEventListener('click', closeAdminPanel);

function renderAdminClanSelect() {
    const sel = $('adminClanSelect');
    if (!sel) return;
    const currentValue = sel.value;
    sel.innerHTML = '';
    Object.values(clansCache).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        sel.appendChild(opt);
    });
    if (currentValue && clansCache[currentValue]) sel.value = currentValue;
    updateAdminCurrentPass();
}

$('adminClanSelect').addEventListener('change', updateAdminCurrentPass);

function updateAdminCurrentPass() {
    const cid = $('adminClanSelect').value;
    const clan = clansCache[cid];
    $('adminCurrentPass').value = clan?.password || '—';
    $('adminNewPass').value = '';
    $('adminPanelMsg').textContent = '';
}

$('saveAdminPass').addEventListener('click', async () => {
    const cid = $('adminClanSelect').value;
    const newPass = $('adminNewPass').value.trim();
    const msg = $('adminPanelMsg');

    if (!cid) { msg.textContent = 'Выбери гильдию'; return; }
    if (!newPass) { msg.textContent = 'Введи новый пароль'; msg.style.color = '#ff7a7a'; return; }

    const { error } = await supabase
        .from('clans')
        .update({ password: newPass, updated_at: new Date().toISOString() })
        .eq('id', cid);

    if (error) {
        msg.textContent = 'Ошибка: ' + error.message;
        msg.style.color = '#ff7a7a';
        return;
    }

    clansCache[cid].password = newPass;
    msg.textContent = '✔ Пароль обновлён';
    msg.style.color = '#6ee7a7';
    $('adminNewPass').value = '';
    updateAdminCurrentPass();
});

/* ============================================================
   РЕДАКТИРОВАНИЕ ЗАПИСЕЙ
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
    const { error } = await supabase.from(tab).update({
        nickname: nickname || null,
        player_guild: playerGuild || null,
        faction: faction || null,
        note: note || null
    }).eq('id', id);
    if (error) { $('editError').textContent = 'Ошибка: ' + error.message; return; }
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
    const { error } = await supabase.from(currentTab).insert({
        nickname: nickname || null,
        player_guild: playerGuild || null,
        faction: faction || null,
        note: note || null,
        clan: currentClan
    });
    if (error) { flashStatus('Ошибка: ' + error.message, '#ff7a7a'); return; }
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

        const { data, error } = await supabase.from(fromTab).select('*').eq('id', id).single();
        if (error) return alert(error.message);

        const { error: insErr } = await supabase.from(toTab).insert({
            nickname: data.nickname,
            player_guild: data.player_guild,
            faction: data.faction,
            note: data.note,
            clan: currentClan
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
    await loadClans();

    const { data: { session } } = await supabase.auth.getSession();
    isAdmin = !!session?.user && ADMIN_EMAILS.includes((session.user.email || '').toLowerCase());
    applyAdminUI();

    const savedClan = localStorage.getItem(SESSION_CLAN_KEY);
    if (savedClan && clansCache[savedClan]) {
        openClan(savedClan);
    } else {
        showScreen('home');
        applyBg();
    }
})();
