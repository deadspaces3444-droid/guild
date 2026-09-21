import { supabase } from './supabase.js';

/* ============================================================
   КОНФИГ
   ============================================================ */
const ADMIN_EMAILS = ['kolibri@wosb.ru'];

const TABS = ['enemies', 'friends', 'neutral', 'personal'];
const UNLOCK_KEY = 'guild_unlocked';
const LAST_CLAN_KEY = 'guild_last_clan';
const BG_STORAGE_KEY = 'guild_bg_overrides';

let clansCache    = {};
let currentClan   = null;
let pendingClanId = null;
let currentTab    = 'enemies';
let currentSection = 'lists';
let isAdmin       = false;
let movingItem    = null;
let editingItem   = null;
let editingBuild  = null;   // { id, type }

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
    if (currentClan && clansCache[currentClan] && clansCache[currentClan].bg) {
        return clansCache[currentClan].bg;
    }
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
   САЙДБАР
   ============================================================ */
document.querySelectorAll('.side-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        if (!section) return;

        document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.clan-section').forEach(s => s.classList.remove('active'));

        btn.classList.add('active');
        $('section-' + section).classList.add('active');
        currentSection = section;

        if (section === 'lists') {
            TABS.forEach(loadList);
        } else if (section === 'pvp') {
            renderBuilds('pvp');
        } else if (section === 'pb') {
            renderBuilds('pb');
        }
    });
});

/* ============================================================
   АДМИН
   ============================================================ */
function openAdminAuth() {
    $('adminAuthModal').hidden = false;
    $('adminAuthError').textContent = '';
    $('adminEmail').value = '';
    $('adminPassword').value = '';
    $('adminEmail').focus();
}
function closeAdminAuth() { $('adminAuthModal').hidden = true; }
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
            <img src="${escapeHtml(clan.image || '')}" alt="${escapeHtml(clan.name)}">
            <span class="clan-name">${escapeHtml(clan.name)}</span>
            <span class="clan-desc">${escapeHtml(clan.description || '')}</span>
            <span class="clan-more">Подробнее →</span>
        `;
        btn.addEventListener('click', () => handleClanClick(clan.id));
        grid.appendChild(btn);
    });
}

function isUnlocked() {
    return isAdmin || localStorage.getItem(UNLOCK_KEY) === '1';
}

function handleClanClick(clanId) {
    if (isUnlocked()) {
        openClan(clanId);
    } else {
        openClanInfo(clanId);
    }
}

/* ============================================================
   ОПИСАНИЕ ГИЛЬДИИ
   ============================================================ */
function openClanInfo(clanId) {
    const clan = clansCache[clanId];
    if (!clan) return;
    pendingClanId = clanId;

    $('clanInfoLogo').src = clan.image || '';
    $('clanInfoLogo').alt = clan.name;
    $('clanInfoName').textContent = clan.name;
    $('clanInfoDesc').textContent = clan.description || '';
    $('clanInfoRules').textContent = clan.rules || 'Правила не заданы.';

    if (isUnlocked()) {
        $('clanLoginBtn').hidden = true;
        $('clanViewBtn').hidden = false;
    } else {
        $('clanLoginBtn').hidden = false;
        $('clanViewBtn').hidden = true;
    }

    showScreen('clan');
}

$('backToHomeBtn').addEventListener('click', () => {
    pendingClanId = null;
    showScreen('home');
});

$('clanViewBtn').addEventListener('click', () => {
    if (pendingClanId) openClan(pendingClanId);
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

    localStorage.setItem(UNLOCK_KEY, '1');
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

    if (!isUnlocked()) {
        openClanInfo(clanId);
        return;
    }

    currentClan = clanId;
    localStorage.setItem(LAST_CLAN_KEY, clanId);

    $('clanTitle').textContent = clan.name;
    $('clanIcon').src = clan.image || '';
    $('clanIcon').alt = clan.name;

    showScreen('lists');
    applyBg();

    // сброс сайдбара на "Списки"
    currentSection = 'lists';
    document.querySelectorAll('.side-item').forEach(b =>
        b.classList.toggle('active', b.dataset.section === 'lists'));
    document.querySelectorAll('.clan-section').forEach(s =>
        s.classList.toggle('active', s.id === 'section-lists'));

    currentTab = 'enemies';
    document.querySelectorAll('.tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === 'enemies'));
    document.querySelectorAll('.tab-content').forEach(c =>
        c.classList.toggle('active', c.id === 'tab-enemies'));

    applyAdminUI();
    renderAll();
    renderBuilds('pvp');
    renderBuilds('pb');
}

$('backBtn').addEventListener('click', () => {
    showScreen('home');
});

$('clanLeaveBtn').addEventListener('click', () => {
    if (!confirm('Заблокировать просмотр списков? Пароль потребуется ввести снова.')) return;
    localStorage.removeItem(UNLOCK_KEY);
    localStorage.removeItem(LAST_CLAN_KEY);
    currentClan = null;
    showScreen('home');
    applyBg();
});

/* ============================================================
   ВКЛАДКИ СПИСКОВ
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
   БИЛДЫ
   ============================================================ */
async function renderBuilds(type) {
    if (!currentClan) return;
    const container = type === 'pvp' ? $('pvpList') : $('pbList');
    if (!container) return;

    container.innerHTML = '<div class="empty">Загрузка…</div>';

    const { data, error } = await supabase
        .from('builds')
        .select('*')
        .eq('clan', currentClan)
        .eq('type', type)
        .order('created_at', { ascending: false });

    if (error) {
        container.innerHTML = `<div class="empty">Ошибка: ${error.message}</div>`;
        return;
    }
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty">Билды пока не добавлены</div>';
        return;
    }

    container.innerHTML = '';

    if (type === 'pb') {
        // группировка по рангам
        const groups = {};
        data.forEach(b => {
            const r = b.rank || '—';
            if (!groups[r]) groups[r] = [];
            groups[r].push(b);
        });

        const ranks = Object.keys(groups).sort((a, b) => {
            const na = parseInt(a, 10), nb = parseInt(b, 10);
            if (isNaN(na) && isNaN(nb)) return a.localeCompare(b);
            if (isNaN(na)) return 1;
            if (isNaN(nb)) return -1;
            return na - nb;
        });

        ranks.forEach(rank => {
            const group = document.createElement('div');
            group.className = 'build-group';

            const title = document.createElement('h3');
            title.className = 'build-group-title';
            title.textContent = `Ранг ${rank}`;
            group.appendChild(title);

            groups[rank].forEach(item => group.appendChild(createBuildCard(item)));
            container.appendChild(group);
        });
    } else {
        data.forEach(item => container.appendChild(createBuildCard(item)));
    }
}

function createBuildCard(item) {
    const card = document.createElement('div');
    card.className = 'build-card';

    const consumables = [item.consumable1, item.consumable2, item.consumable3]
        .filter(Boolean).join(' · ');

    const actions = isAdmin ? `
        <div class="build-actions">
            <button class="edit" title="Редактировать">✏️</button>
            <button class="delete" title="Удалить">🗑</button>
        </div>` : '';

    const rankBadge = (item.type === 'pb' && item.rank)
        ? `<span class="build-rank">Ранг ${escapeHtml(item.rank)}</span>`
        : '';

    card.innerHTML = `
        <div class="build-header">
            <h3 class="build-ship">${escapeHtml(item.ship_name)}</h3>
            ${rankBadge}
            ${actions}
        </div>
        ${item.upgrades ? `
        <div class="build-row">
            <span class="build-label">🔧 Апгрейды:</span>
            <span class="build-value">${escapeHtml(item.upgrades)}</span>
        </div>` : ''}
        ${consumables ? `
        <div class="build-row">
            <span class="build-label">⚗️ Расходники:</span>
            <span class="build-value">${escapeHtml(consumables)}</span>
        </div>` : ''}
        ${item.cargo ? `
        <div class="build-row">
            <span class="build-label">📦 Трюм:</span>
            <span class="build-value">${escapeHtml(item.cargo)}</span>
        </div>` : ''}
    `;

    if (isAdmin) {
        card.querySelector('.edit').addEventListener('click', () => openBuildEdit(item));
        card.querySelector('.delete').addEventListener('click', () => deleteBuild(item.id, item.type));
    }

    return card;
}

async function addBuild(type) {
    if (!isAdmin || !currentClan) return;

    const isPvp = type === 'pvp';
    const rank = isPvp ? null : $('pbRank').value.trim();
    const ship = (isPvp ? $('pvpShip') : $('pbShip')).value.trim();
    const upgrades = (isPvp ? $('pvpUpgrades') : $('pbUpgrades')).value.trim();
    const c1 = (isPvp ? $('pvpCons1') : $('pbCons1')).value.trim();
    const c2 = (isPvp ? $('pvpCons2') : $('pbCons2')).value.trim();
    const c3 = (isPvp ? $('pvpCons3') : $('pbCons3')).value.trim();
    const cargo = (isPvp ? $('pvpCargo') : $('pbCargo')).value.trim();
    const statusEl = $(isPvp ? 'pvpStatus' : 'pbStatus');

    if (!ship) {
        flashStatusEl(statusEl, 'Введите название корабля', '#ff7a7a');
        return;
    }
    if (!isPvp && !rank) {
        flashStatusEl(statusEl, 'Укажите ранг', '#ff7a7a');
        return;
    }

    const { error } = await supabase.from('builds').insert({
        clan: currentClan,
        type,
        rank,
        ship_name: ship,
        upgrades: upgrades || null,
        consumable1: c1 || null,
        consumable2: c2 || null,
        consumable3: c3 || null,
        cargo: cargo || null
    });

    if (error) {
        flashStatusEl(statusEl, 'Ошибка: ' + error.message, '#ff7a7a');
        return;
    }

    if (isPvp) {
        ['pvpShip','pvpUpgrades','pvpCons1','pvpCons2','pvpCons3','pvpCargo']
            .forEach(id => $(id).value = '');
    } else {
        ['pbRank','pbShip','pbUpgrades','pbCons1','pbCons2','pbCons3','pbCargo']
            .forEach(id => $(id).value = '');
    }

    flashStatusEl(statusEl, '✔ Добавлено', '#6ee7a7');
    renderBuilds(type);
}

$('pvpAddBtn').addEventListener('click', () => addBuild('pvp'));
$('pbAddBtn').addEventListener('click', () => addBuild('pb'));

function flashStatusEl(el, text, color) {
    el.textContent = text;
    el.style.color = color;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.textContent = '', 2000);
}

/* ============================================================
   РЕДАКТИРОВАНИЕ БИЛДА
   ============================================================ */
function openBuildEdit(item) {
    editingBuild = { id: item.id, type: item.type };
    $('buildEditTitle').textContent = item.type === 'pvp'
        ? '✏️ Редактировать ПВП-билд'
        : '✏️ Редактировать ПБ-билд';

    const rankField = $('buildEditRankField');
    if (item.type === 'pb') {
        rankField.hidden = false;
        $('buildEditRank').value = item.rank || '';
    } else {
        rankField.hidden = true;
        $('buildEditRank').value = '';
    }

    $('buildEditShip').value = item.ship_name || '';
    $('buildEditUpgrades').value = item.upgrades || '';
    $('buildEditCons1').value = item.consumable1 || '';
    $('buildEditCons2').value = item.consumable2 || '';
    $('buildEditCons3').value = item.consumable3 || '';
    $('buildEditCargo').value = item.cargo || '';
    $('buildEditError').textContent = '';
    $('buildEditModal').hidden = false;
    $('buildEditShip').focus();
}

$('cancelBuildEdit').addEventListener('click', () => {
    $('buildEditModal').hidden = true;
    editingBuild = null;
});

$('saveBuildEdit').addEventListener('click', async () => {
    if (!editingBuild) return;

    const rank = $('buildEditRank').value.trim();
    const ship = $('buildEditShip').value.trim();
    const upgrades = $('buildEditUpgrades').value.trim();
    const c1 = $('buildEditCons1').value.trim();
    const c2 = $('buildEditCons2').value.trim();
    const c3 = $('buildEditCons3').value.trim();
    const cargo = $('buildEditCargo').value.trim();

    if (!ship) {
        $('buildEditError').textContent = 'Введите название корабля';
        return;
    }
    if (editingBuild.type === 'pb' && !rank) {
        $('buildEditError').textContent = 'Укажите ранг';
        return;
    }

    const { error } = await supabase
        .from('builds')
        .update({
            rank: editingBuild.type === 'pb' ? rank : null,
            ship_name: ship,
            upgrades: upgrades || null,
            consumable1: c1 || null,
            consumable2: c2 || null,
            consumable3: c3 || null,
            cargo: cargo || null
        })
        .eq('id', editingBuild.id);

    if (error) {
        $('buildEditError').textContent = 'Ошибка: ' + error.message;
        return;
    }

    const type = editingBuild.type;
    $('buildEditModal').hidden = true;
    editingBuild = null;
    renderBuilds(type);
});

async function deleteBuild(id, type) {
    if (!confirm('Удалить билд?')) return;
    const { error } = await supabase.from('builds').delete().eq('id', id);
    if (error) return alert(error.message);
    renderBuilds(type);
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
    updateAdminFields();
}

$('adminClanSelect').addEventListener('change', updateAdminFields);

function updateAdminFields() {
    const cid = $('adminClanSelect').value;
    const clan = clansCache[cid];
    $('adminCurrentPass').value = clan?.password || '—';
    $('adminNewPass').value = '';
    $('adminRules').value = clan?.rules || '';
    $('adminPanelMsg').textContent = '';
    $('adminPanelMsg').style.color = '';
}

$('saveAdminSettings').addEventListener('click', async () => {
    const cid = $('adminClanSelect').value;
    const newPass = $('adminNewPass').value.trim();
    const newRules = $('adminRules').value;
    const msg = $('adminPanelMsg');

    if (!cid) { msg.textContent = 'Выбери гильдию'; msg.style.color = '#ff7a7a'; return; }

    const clan = clansCache[cid];
    if (!clan) { msg.textContent = 'Гильдия не найдена'; msg.style.color = '#ff7a7a'; return; }

    const payload = {
        rules: newRules,
        updated_at: new Date().toISOString()
    };
    if (newPass) payload.password = newPass;

    const { error } = await supabase.from('clans').update(payload).eq('id', cid);
    if (error) {
        msg.textContent = 'Ошибка: ' + error.message;
        msg.style.color = '#ff7a7a';
        return;
    }

    clansCache[cid].rules = newRules;
    if (newPass) clansCache[cid].password = newPass;

    msg.textContent = newPass ? '✔ Пароль и правила обновлены' : '✔ Правила обновлены';
    msg.style.color = '#6ee7a7';
    $('adminNewPass').value = '';
    updateAdminFields();

    if (pendingClanId === cid) {
        $('clanInfoRules').textContent = newRules || 'Правила не заданы.';
    }
});

/* ============================================================
   ДОБАВЛЕНИЕ ГИЛЬДИИ
   ============================================================ */
$('openAddClan').addEventListener('click', () => {
    ['newClanId','newClanName','newClanDesc','newClanRules','newClanPass','newClanImage','newClanBg']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });
    $('addClanMsg').textContent = '';
    $('addClanMsg').style.color = '';
    $('addClanModal').hidden = false;
    $('newClanId').focus();
});

$('cancelAddClan').addEventListener('click', () => {
    $('addClanModal').hidden = true;
});

$('saveNewClan').addEventListener('click', async () => {
    const id = $('newClanId').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const name = $('newClanName').value.trim();
    const desc = $('newClanDesc').value.trim();
    const rules = $('newClanRules').value;
    const pass = $('newClanPass').value.trim();
    const image = $('newClanImage').value.trim();
    const bg = $('newClanBg').value.trim();
    const msg = $('addClanMsg');

    msg.style.color = '';

    if (!id) { msg.textContent = 'Укажи ID (латиница)'; msg.style.color = '#ff7a7a'; return; }
    if (!name) { msg.textContent = 'Укажи название'; msg.style.color = '#ff7a7a'; return; }
    if (!pass) { msg.textContent = 'Укажи пароль'; msg.style.color = '#ff7a7a'; return; }
    if (clansCache[id]) { msg.textContent = 'Гильдия с таким ID уже есть'; msg.style.color = '#ff7a7a'; return; }

    const payload = {
        id,
        name,
        description: desc,
        rules,
        password: pass,
        image: image || 'images/aov.png',
        bg: bg || 'images/bg-main.jpg'
    };

    const { error } = await supabase.from('clans').insert(payload);
    if (error) {
        msg.textContent = 'Ошибка: ' + error.message;
        msg.style.color = '#ff7a7a';
        return;
    }

    clansCache[id] = payload;
    renderHomeCards();
    renderAdminClanSelect();

    msg.textContent = '✔ Гильдия создана';
    msg.style.color = '#6ee7a7';
    setTimeout(() => {
        $('addClanModal').hidden = true;
    }, 800);
});

/* ============================================================
   РЕДАКТИРОВАНИЕ ЗАПИСЕЙ СПИСКА
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
   ДОБАВЛЕНИЕ ЗАПИСИ В СПИСОК
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
   УДАЛЕНИЕ ЗАПИСИ СПИСКА
   ============================================================ */
async function deleteItem(tab, id) {
    if (!confirm('Удалить запись?')) return;
    const { error } = await supabase.from(tab).delete().eq('id', id);
    if (error) return alert(error.message);
    loadList(tab);
}

/* ============================================================
   ПЕРЕМЕЩЕНИЕ ЗАПИСИ СПИСКА
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

    showScreen('home');
    applyBg();
})();
