import { supabase } from './supabase.js';

/* ===================== КОНФИГ ===================== */
const ADMIN_EMAILS = ['kolibri@wosb.ru'];
const APP_VERSION = '1.3.0';

const TABS = ['enemies', 'friends', 'neutral', 'personal'];
const UNLOCK_KEY = 'guild_unlocked';
const LAST_CLAN_KEY = 'guild_last_clan';
const BG_STORAGE_KEY = 'guild_bg_overrides';
const SHARED = '__shared__';

let clansCache = {};
let currentClan = null;
let pendingClanId = null;
let currentTab = 'enemies';
let currentSection = 'lists';
let isAdmin = false;
let movingItem = null;
let editingItem = null;
let editingBuild = null;
let duplicatingBuild = null;

const $ = id => document.getElementById(id);
const screenHome  = $('screen-home');
const screenClan  = $('screen-clan');
const clanView    = $('clanView');
const bgFileInput = $('bgFileInput');

/* ===================== ФОНЫ ===================== */
function getOverrides() {
    try { return JSON.parse(localStorage.getItem(BG_STORAGE_KEY) || '{}'); }
    catch { return {}; }
}
function setOverride(key, dataUrl) {
    const all = getOverrides();
    if (dataUrl) all[key] = dataUrl; else delete all[key];
    try { localStorage.setItem(BG_STORAGE_KEY, JSON.stringify(all)); return true; }
    catch { alert('Фон слишком большой.'); return false; }
}
function currentBgKey() { return currentClan ? currentClan : 'main'; }
function currentBgFallback() {
    if (currentClan && clansCache[currentClan]?.bg) return clansCache[currentClan].bg;
    return 'images/bg-main.jpg';
}
function applyBg() {
    const key = currentBgKey();
    const url = getOverrides()[key] || currentBgFallback();
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
                canvas.width = w; canvas.height = h;
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
    bgFileInput.value = ''; bgFileInput.click();
});
bgFileInput.addEventListener('change', async () => {
    const file = bgFileInput.files[0]; if (!file) return;
    try {
        const dataUrl = await compressImage(file);
        if (setOverride(currentBgKey(), dataUrl)) applyBg();
    } catch (err) { alert('Не удалось обработать: ' + err.message); }
});
$('bgResetBtn').addEventListener('click', () => {
    if (!isAdmin) return;
    const key = currentBgKey();
    if (!getOverrides()[key]) return alert('Уже стоит стандартный фон.');
    if (!confirm('Вернуть стандартный фон?')) return;
    setOverride(key, null); applyBg();
});

/* ===================== ЭКРАНЫ ===================== */
function showScreen(name) {
    screenHome.hidden = name !== 'home';
    screenClan.hidden = name !== 'clan';
    clanView.hidden   = name !== 'lists';
    window.scrollTo(0, 0);
}

/* ===================== САЙДБАР ===================== */
document.querySelectorAll('.side-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        if (!section) return;
        document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.clan-section').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        $('section-' + section).classList.add('active');
        currentSection = section;
        if (section === 'lists') TABS.forEach(loadList);
        else if (section === 'pvp') renderBuilds('pvp');
        else if (section === 'pb') renderBuilds('pb');
        else if (section === 'contacts') renderContacts();
    });
});

/* ===================== АДМИН ===================== */
function openAdminAuth() {
    $('adminAuthModal').hidden = false;
    $('adminAuthError').textContent = '';
    $('adminEmail').value = ''; $('adminPassword').value = '';
    $('adminEmail').focus();
}
function closeAdminAuth() { $('adminAuthModal').hidden = true; }
$('adminLoginBtn').addEventListener('click', openAdminAuth);
$('cancelAdminLogin').addEventListener('click', closeAdminAuth);
$('doAdminLogin').addEventListener('click', async () => {
    const email = $('adminEmail').value.trim();
    const password = $('adminPassword').value;
    const err = $('adminAuthError'); err.textContent = '';
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
async function adminLogout() { await supabase.auth.signOut(); closeAdminPanel(); }
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
        const el = $(id); if (el) el.textContent = label;
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

/* ===================== ГИЛЬДИИ ===================== */
async function loadClans() {
    const { data, error } = await supabase.from('clans').select('*');
    if (error) { console.error(error); return; }
    clansCache = {};
    (data || []).forEach(c => { clansCache[c.id] = c; });
    renderHomeCards();
    renderAdminClanSelect();
    renderScopeSelects();
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
function isUnlocked() { return isAdmin || localStorage.getItem(UNLOCK_KEY) === '1'; }
function handleClanClick(id) { isUnlocked() ? openClan(id) : openClanInfo(id); }

/* ===================== SCOPE SELECT ===================== */
function renderScopeSelects() {
    const clans = Object.values(clansCache);
    ['pvpScope', 'pbScope', 'buildEditScope', 'buildDupScope'].forEach(id => {
        const sel = $(id);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '';
        const opt1 = document.createElement('option');
        opt1.value = SHARED;
        opt1.textContent = '🌐 Общий (для всех гильдий)';
        sel.appendChild(opt1);
        clans.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = '🏰 ' + c.name;
            sel.appendChild(opt);
        });
        if (current && Array.from(sel.options).some(o => o.value === current)) {
            sel.value = current;
        } else if (currentClan && (id === 'pvpScope' || id === 'pbScope')) {
            sel.value = currentClan;
        }
    });
}

/* ===================== ОПИСАНИЕ ГИЛЬДИИ ===================== */
function openClanInfo(id) {
    const clan = clansCache[id];
    if (!clan) return;
    pendingClanId = id;
    $('clanInfoLogo').src = clan.image || '';
    $('clanInfoLogo').alt = clan.name;
    $('clanInfoName').textContent = clan.name;
    $('clanInfoDesc').textContent = clan.description || '';
    $('clanInfoRules').textContent = clan.rules || 'Правила не заданы.';
    const newsWrap = $('clanInfoNewsWrap');
    if (clan.news && clan.news.trim()) {
        newsWrap.hidden = false;
        $('clanInfoNews').textContent = clan.news;
    } else {
        newsWrap.hidden = true;
    }
    $('clanLoginBtn').hidden = isUnlocked();
    $('clanViewBtn').hidden = !isUnlocked();
    showScreen('clan');
}
$('backToHomeBtn').addEventListener('click', () => { pendingClanId = null; showScreen('home'); });
$('clanViewBtn').addEventListener('click', () => { if (pendingClanId) openClan(pendingClanId); });

/* ===================== ВХОД ПО ПАРОЛЮ ===================== */
$('clanLoginBtn').addEventListener('click', () => {
    if (!pendingClanId) return;
    const clan = clansCache[pendingClanId];
    $('clanPassName').textContent = clan.name;
    $('clanPassword').value = '';
    $('clanPassError').textContent = '';
    $('clanPassModal').hidden = false;
    $('clanPassword').focus();
});
$('cancelClanLogin').addEventListener('click', () => { $('clanPassModal').hidden = true; });
$('doClanLogin').addEventListener('click', () => {
    const entered = $('clanPassword').value;
    const clan = clansCache[pendingClanId];
    if (!clan) return;
    if (!entered) { $('clanPassError').textContent = 'Введите пароль'; return; }
    if (entered !== clan.password) { $('clanPassError').textContent = 'Неверный пароль'; return; }
    localStorage.setItem(UNLOCK_KEY, '1');
    $('clanPassModal').hidden = true;
    const cid = pendingClanId; pendingClanId = null;
    openClan(cid);
});
$('clanPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('doClanLogin').click();
});

/* ===================== ОТКРЫТИЕ ГИЛЬДИИ ===================== */
function openClan(id) {
    const clan = clansCache[id];
    if (!clan) return;
    if (!isUnlocked()) { openClanInfo(id); return; }
    currentClan = id;
    localStorage.setItem(LAST_CLAN_KEY, id);
    $('clanTitle').textContent = clan.name;
    $('clanIcon').src = clan.image || '';
    $('clanIcon').alt = clan.name;
    showScreen('lists');
    applyBg();
    currentSection = 'lists';
    document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', b.dataset.section === 'lists'));
    document.querySelectorAll('.clan-section').forEach(s => s.classList.toggle('active', s.id === 'section-lists'));
    currentTab = 'enemies';
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'enemies'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-enemies'));
    renderScopeSelects();
    applyAdminUI();
    renderAll();
    renderBuilds('pvp');
    renderBuilds('pb');
    renderContacts();
}
$('backBtn').addEventListener('click', () => showScreen('home'));
$('clanLeaveBtn').addEventListener('click', () => {
    if (!confirm('Заблокировать просмотр? Пароль потребуется ввести снова.')) return;
    localStorage.removeItem(UNLOCK_KEY);
    localStorage.removeItem(LAST_CLAN_KEY);
    currentClan = null;
    showScreen('home');
    applyBg();
});

/* ===================== ВКЛАДКИ ===================== */
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        $('tab-' + currentTab).classList.add('active');
    });
});

/* ===================== СПИСКИ ===================== */
function renderAll() { if (currentClan) TABS.forEach(loadList); }
async function loadList(tab) {
    if (!currentClan) return;
    const ul = document.querySelector(`[data-list="${tab}"]`);
    if (!ul) return;
    ul.innerHTML = '<li class="empty">Загрузка…</li>';
    const { data, error } = await supabase.from(tab).select('*').eq('clan', currentClan)
        .order('created_at', { ascending: false });
    ul.innerHTML = '';
    if (error) { ul.innerHTML = `<li class="empty">Ошибка: ${error.message}</li>`; return; }
    if (!data?.length) { ul.innerHTML = '<li class="empty">Список пуст</li>'; return; }
    data.forEach(item => {
        const li = document.createElement('li');
        const parts = [];
        if (item.nickname)     parts.push(`<span class="nick">${escapeHtml(item.nickname)}</span>`);
        if (item.player_guild) parts.push(`<span class="guild">${escapeHtml(item.player_guild)}</span>`);
        if (item.faction)      parts.push(`<span class="faction">${escapeHtml(item.faction)}</span>`);
        const actions = isAdmin ? `<div class="actions">
            <button class="edit" title="Ред.">✏️</button>
            <button class="move" title="Пер.">↔</button>
            <button class="delete" title="Уд.">🗑</button>
        </div>` : '';
        li.innerHTML = `<div class="info"><div class="row-main">${parts.join('')}</div>
            ${item.note ? `<span class="note">${escapeHtml(item.note)}</span>` : ''}</div>${actions}`;
        if (isAdmin) {
            li.querySelector('.edit').addEventListener('click', () => openEditModal(tab, item));
            li.querySelector('.move').addEventListener('click', () => openMoveModal(tab, item.id));
            li.querySelector('.delete').addEventListener('click', () => deleteItem(tab, item.id));
        }
        ul.appendChild(li);
    });
}

/* ===================== БИЛДЫ ===================== */
function parseLines(text) {
    if (!text) return [];
    return String(text).split('\n').map(s => s.trim()).filter(Boolean);
}
function parseSpecialist(line) {
    const parts = line.split('|').map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const name = parts[0];
    const bonuses = parts.slice(1).map(parseBonus).filter(Boolean);
    return { name, bonuses };
}
function parseBonus(text) {
    const m = String(text).match(/^(.+?)\s*([+-]\s*\d+)\s*$/);
    if (!m) return { stat: text.trim(), value: null };
    return { stat: m[1].trim(), value: parseInt(m[2].replace(/\s/g, ''), 10) };
}
function parseSpecialists(text) {
    return parseLines(text).map(parseSpecialist).filter(Boolean);
}

async function renderBuilds(type) {
    if (!currentClan) return;
    const container = type === 'pvp' ? $('pvpList') : $('pbList');
    if (!container) return;
    container.innerHTML = '<div class="empty">Загрузка…</div>';

    const { data, error } = await supabase.from('builds').select('*')
        .eq('type', type)
        .or(`is_shared.eq.true,clan.eq.${currentClan}`)
        .order('created_at', { ascending: false });

    if (error) { container.innerHTML = `<div class="empty">Ошибка: ${error.message}</div>`; return; }
    if (!data?.length) { container.innerHTML = '<div class="empty">Билды пока не добавлены</div>'; return; }

    container.innerHTML = '';

    if (type === 'pb') {
        const groups = {};
        data.forEach(b => {
            const r = b.rank || '—';
            (groups[r] ||= []).push(b);
        });
        const ranks = Object.keys(groups).sort((a, b) => {
            const na = parseInt(a, 10), nb = parseInt(b, 10);
            if (isNaN(na) && isNaN(nb)) return a.localeCompare(b);
            if (isNaN(na)) return 1;
            if (isNaN(nb)) return -1;
            return na - nb;
        });
        ranks.forEach(rank => {
            const g = document.createElement('div');
            g.className = 'build-group';
            const t = document.createElement('h3');
            t.className = 'build-group-title';
            t.textContent = `Ранг ${rank}`;
            g.appendChild(t);
            groups[rank].forEach(item => g.appendChild(createBuildCard(item)));
            container.appendChild(g);
        });
    } else {
        data.forEach(item => container.appendChild(createBuildCard(item)));
    }
}

function createBuildCard(item) {
    const card = document.createElement('div');
    card.className = 'build-card';

    const upgrades = parseLines(item.upgrades);
    const weapS = parseLines(item.weapons_small);
    const weapM = parseLines(item.weapons_medium);
    const weapL = parseLines(item.weapons_large);
    const cons = [item.consumable1, item.consumable2, item.consumable3].filter(Boolean);
    const cargo = item.cargo ? parseLines(item.cargo) : [];
    const specs = parseSpecialists(item.specialists);

    const scopeBadge = item.is_shared
        ? `<span class="build-scope shared">🌐 Общий</span>`
        : `<span class="build-scope clan">🏰 ${escapeHtml(clansCache[item.clan]?.name || item.clan || '?')}</span>`;

    const rankBadge = (item.type === 'pb' && item.rank)
        ? `<span class="build-rank">Ранг ${escapeHtml(item.rank)}</span>` : '';

    const actions = isAdmin ? `<div class="build-actions">
        <button class="edit" title="Редактировать">✏️</button>
        <button class="copy" title="Дублировать">📋</button>
        <button class="delete" title="Удалить">🗑</button>
    </div>` : '';

    card.innerHTML = `
        <div class="build-header">
            <h3 class="build-ship">${escapeHtml(item.ship_name)}</h3>
            ${rankBadge}
            ${scopeBadge}
            ${actions}
        </div>
        ${upgrades.length ? `<div class="build-section">
            <div class="build-section-label">🔧 Апгрейды</div>
            <div class="build-chips">${upgrades.map(u => `<span class="chip chip-upgrade">${escapeHtml(u)}</span>`).join('')}</div>
        </div>` : ''}
        ${weapS.length ? `<div class="build-section">
            <div class="build-section-label">🟢 Малые пушки (до 12ф)</div>
            <div class="build-chips">${weapS.map(w => `<span class="chip chip-weap-small">${escapeHtml(w)}</span>`).join('')}</div>
        </div>` : ''}
        ${weapM.length ? `<div class="build-section">
            <div class="build-section-label">🟡 Средние пушки (до 24ф)</div>
            <div class="build-chips">${weapM.map(w => `<span class="chip chip-weap-medium">${escapeHtml(w)}</span>`).join('')}</div>
        </div>` : ''}
        ${weapL.length ? `<div class="build-section">
            <div class="build-section-label">🔴 Большие пушки (до 48ф)</div>
            <div class="build-chips">${weapL.map(w => `<span class="chip chip-weap-large">${escapeHtml(w)}</span>`).join('')}</div>
        </div>` : ''}
        ${cons.length ? `<div class="build-section">
            <div class="build-section-label">⚗️ Расходники</div>
            <div class="build-chips">${cons.map(c => `<span class="chip chip-cons">${escapeHtml(c)}</span>`).join('')}</div>
        </div>` : ''}
        ${cargo.length ? `<div class="build-section">
            <div class="build-section-label">📦 Трюм</div>
            <div class="build-chips">${cargo.map(c => `<span class="chip chip-cargo">${escapeHtml(c)}</span>`).join('')}</div>
        </div>` : ''}
        ${specs.length ? `<div class="build-section">
            <div class="build-section-label">👤 Специалисты</div>
            <div class="spec-list">${specs.map(s => `
                <div class="spec-item">
                    <div class="spec-name">${escapeHtml(s.name)}</div>
                    ${s.bonuses.length ? `<div class="spec-bonuses">${s.bonuses.map(b => {
                        const cls = b.value === null ? 'neutral' : (b.value > 0 ? 'plus' : 'minus');
                        const val = b.value === null ? '' : ` ${b.value > 0 ? '+' : ''}${b.value}`;
                        return `<span class="spec-bonus ${cls}">${escapeHtml(b.stat)}${val}</span>`;
                    }).join('')}</div>` : ''}
                </div>`).join('')}</div>
        </div>` : ''}
    `;

    if (isAdmin) {
        card.querySelector('.edit').addEventListener('click', () => openBuildEdit(item));
        card.querySelector('.copy').addEventListener('click', () => openBuildDup(item));
        card.querySelector('.delete').addEventListener('click', () => deleteBuild(item.id, item.type));
    }
    return card;
}

/* ===================== ДОБАВЛЕНИЕ БИЛДА ===================== */
async function addBuild(type) {
    if (!isAdmin || !currentClan) return;
    const isPvp = type === 'pvp';
    const scopeVal = $(isPvp ? 'pvpScope' : 'pbScope').value;
    const isShared = scopeVal === SHARED;
    const clanValue = isShared ? null : scopeVal;

    const rank = isPvp ? null : $(`${type}Rank`).value.trim();
    const ship = $(`${type}Ship`).value.trim();
    const upgrades = $(`${type}Upgrades`).value;
    const weapS = $(`${type}WeapS`).value;
    const weapM = $(`${type}WeapM`).value;
    const weapL = $(`${type}WeapL`).value;
    const c1 = $(`${type}Cons1`).value.trim();
    const c2 = $(`${type}Cons2`).value.trim();
    const c3 = $(`${type}Cons3`).value.trim();
    const cargo = $(`${type}Cargo`).value;
    const specs = $(`${type}Specs`).value;
    const statusEl = $(`${type}Status`);

    if (!ship) { flashStatusEl(statusEl, 'Введите название корабля', '#ff7a7a'); return; }
    if (!isPvp && !rank) { flashStatusEl(statusEl, 'Укажите ранг', '#ff7a7a'); return; }

    const { error } = await supabase.from('builds').insert({
        clan: clanValue,
        is_shared: isShared,
        type,
        rank: rank || null,
        ship_name: ship,
        upgrades: upgrades || null,
        weapons_small: weapS || null,
        weapons_medium: weapM || null,
        weapons_large: weapL || null,
        consumable1: c1 || null,
        consumable2: c2 || null,
        consumable3: c3 || null,
        cargo: cargo || null,
        specialists: specs || null
    });

    if (error) { flashStatusEl(statusEl, 'Ошибка: ' + error.message, '#ff7a7a'); return; }

    ['Rank','Ship','Upgrades','WeapS','WeapM','WeapL','Cons1','Cons2','Cons3','Cargo','Specs']
        .forEach(suffix => {
            const el = $(`${type}${suffix}`);
            if (el) el.value = '';
        });

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

/* ===================== РЕДАКТИРОВАНИЕ ===================== */
function openBuildEdit(item) {
    editingBuild = { id: item.id, type: item.type };
    $('buildEditTitle').textContent = item.type === 'pvp'
        ? '✏️ Редактировать ПВП-билд' : '✏️ Редактировать ПБ-билд';

    const rankField = $('buildEditRankField');
    if (item.type === 'pb') { rankField.hidden = false; $('buildEditRank').value = item.rank || ''; }
    else { rankField.hidden = true; $('buildEditRank').value = ''; }

    $('buildEditShip').value = item.ship_name || '';
    $('buildEditUpgrades').value = item.upgrades || '';
    $('buildEditWeapS').value = item.weapons_small || '';
    $('buildEditWeapM').value = item.weapons_medium || '';
    $('buildEditWeapL').value = item.weapons_large || '';
    $('buildEditCons1').value = item.consumable1 || '';
    $('buildEditCons2').value = item.consumable2 || '';
    $('buildEditCons3').value = item.consumable3 || '';
    $('buildEditCargo').value = item.cargo || '';
    $('buildEditSpecs').value = item.specialists || '';

    renderScopeSelects();
    $('buildEditScope').value = item.is_shared ? SHARED : (item.clan || SHARED);

    $('buildEditError').textContent = '';
    $('buildEditModal').hidden = false;
    $('buildEditShip').focus();
}
$('cancelBuildEdit').addEventListener('click', () => {
    $('buildEditModal').hidden = true; editingBuild = null;
});
$('saveBuildEdit').addEventListener('click', async () => {
    if (!editingBuild) return;
    const scopeVal = $('buildEditScope').value;
    const isShared = scopeVal === SHARED;
    const clanValue = isShared ? null : scopeVal;

    const rank = $('buildEditRank').value.trim();
    const ship = $('buildEditShip').value.trim();
    if (!ship) { $('buildEditError').textContent = 'Введите название корабля'; return; }
    if (editingBuild.type === 'pb' && !rank) { $('buildEditError').textContent = 'Укажите ранг'; return; }

    const { error } = await supabase.from('builds').update({
        clan: clanValue,
        is_shared: isShared,
        rank: editingBuild.type === 'pb' ? rank : null,
        ship_name: ship,
        upgrades: $('buildEditUpgrades').value || null,
        weapons_small: $('buildEditWeapS').value || null,
        weapons_medium: $('buildEditWeapM').value || null,
        weapons_large: $('buildEditWeapL').value || null,
        consumable1: $('buildEditCons1').value.trim() || null,
        consumable2: $('buildEditCons2').value.trim() || null,
        consumable3: $('buildEditCons3').value.trim() || null,
        cargo: $('buildEditCargo').value || null,
        specialists: $('buildEditSpecs').value || null
    }).eq('id', editingBuild.id);

    if (error) { $('buildEditError').textContent = 'Ошибка: ' + error.message; return; }
    const type = editingBuild.type;
    $('buildEditModal').hidden = true;
    editingBuild = null;
    renderBuilds(type);
});

/* ===================== ДУБЛИРОВАНИЕ ===================== */
function openBuildDup(item) {
    duplicatingBuild = item;
    $('buildDupName').textContent = item.ship_name;
    renderScopeSelects();
    $('buildDupScope').value = SHARED;
    $('buildDupMsg').textContent = '';
    $('buildDupModal').hidden = false;
}
$('cancelBuildDup').addEventListener('click', () => {
    $('buildDupModal').hidden = true; duplicatingBuild = null;
});
$('doBuildDup').addEventListener('click', async () => {
    if (!duplicatingBuild) return;
    const scopeVal = $('buildDupScope').value;
    const isShared = scopeVal === SHARED;
    const clanValue = isShared ? null : scopeVal;
    const msg = $('buildDupMsg');
    msg.style.color = '';

    const item = duplicatingBuild;
    const { error } = await supabase.from('builds').insert({
        clan: clanValue,
        is_shared: isShared,
        type: item.type,
        rank: item.rank || null,
        ship_name: item.ship_name,
        upgrades: item.upgrades || null,
        weapons_small: item.weapons_small || null,
        weapons_medium: item.weapons_medium || null,
        weapons_large: item.weapons_large || null,
        consumable1: item.consumable1 || null,
        consumable2: item.consumable2 || null,
        consumable3: item.consumable3 || null,
        cargo: item.cargo || null,
        specialists: item.specialists || null
    });

    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    msg.textContent = '✔ Копия создана';
    msg.style.color = '#6ee7a7';
    setTimeout(() => {
        $('buildDupModal').hidden = true;
        duplicatingBuild = null;
        renderBuilds(item.type);
    }, 700);
});

/* ===================== УДАЛЕНИЕ БИЛДА ===================== */
async function deleteBuild(id, type) {
    if (!confirm('Удалить билд?')) return;
    const { error } = await supabase.from('builds').delete().eq('id', id);
    if (error) return alert(error.message);
    renderBuilds(type);
}

/* ===================== КОНТАКТЫ ===================== */
function renderContacts() {
    const container = $('contactsList');
    if (!container) return;
    container.innerHTML = '';
    const clans = Object.values(clansCache);
    if (!clans.length) { container.innerHTML = '<div class="empty">Гильдий пока нет</div>'; return; }
    clans.forEach(clan => {
        const card = document.createElement('div');
        card.className = 'contact-card';
        const hasLink = clan.discord && clan.discord.trim();
        const btn = hasLink
            ? `<a class="contact-btn" href="${escapeHtml(clan.discord)}" target="_blank" rel="noopener">💬 Discord</a>`
            : `<span class="contact-btn disabled">💬 Нет ссылки</span>`;
        card.innerHTML = `
            <img src="${escapeHtml(clan.image || '')}" alt="${escapeHtml(clan.name)}">
            <div class="contact-info">
                <div class="contact-name">${escapeHtml(clan.name)}</div>
                <div class="contact-discord">${hasLink ? escapeHtml(clan.discord) : 'Ссылка не указана'}</div>
            </div>
            ${btn}
        `;
        container.appendChild(card);
    });
}

/* ===================== АДМИН-ПАНЕЛЬ ===================== */
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
function closeAdminPanel() { $('adminPanelModal').hidden = true; }
$('closeAdminPanel').addEventListener('click', closeAdminPanel);

function renderAdminClanSelect() {
    const sel = $('adminClanSelect');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    Object.values(clansCache).forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
    if (cur && clansCache[cur]) sel.value = cur;
    updateAdminFields();
}
$('adminClanSelect').addEventListener('change', updateAdminFields);
function updateAdminFields() {
    const cid = $('adminClanSelect').value;
    const clan = clansCache[cid];
    $('adminCurrentPass').value = clan?.password || '—';
    $('adminNewPass').value = '';
    $('adminDiscord').value = clan?.discord || '';
    $('adminNews').value = clan?.news || '';
    $('adminRules').value = clan?.rules || '';
    $('adminPanelMsg').textContent = '';
}
$('saveAdminSettings').addEventListener('click', async () => {
    const cid = $('adminClanSelect').value;
    const newPass = $('adminNewPass').value.trim();
    const newDiscord = $('adminDiscord').value.trim();
    const newNews = $('adminNews').value;
    const newRules = $('adminRules').value;
    const msg = $('adminPanelMsg');
    if (!cid) return;
    const clan = clansCache[cid]; if (!clan) return;
    const payload = { discord: newDiscord || null, news: newNews || null, rules: newRules,
        updated_at: new Date().toISOString() };
    if (newPass) payload.password = newPass;
    const { error } = await supabase.from('clans').update(payload).eq('id', cid);
    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    Object.assign(clansCache[cid], payload);
    msg.textContent = '✔ Сохранено'; msg.style.color = '#6ee7a7';
    $('adminNewPass').value = '';
    if (pendingClanId === cid) {
        $('clanInfoRules').textContent = newRules || 'Правила не заданы.';
        const nw = $('clanInfoNewsWrap');
        if (newNews?.trim()) { nw.hidden = false; $('clanInfoNews').textContent = newNews; }
        else nw.hidden = true;
    }
    renderContacts();
});

/* ===================== ДОБАВЛЕНИЕ ГИЛЬДИИ ===================== */
$('openAddClan').addEventListener('click', () => {
    ['newClanId','newClanName','newClanDesc','newClanRules','newClanPass','newClanDiscord','newClanImage','newClanBg']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });
    $('addClanMsg').textContent = '';
    $('addClanModal').hidden = false;
    $('newClanId').focus();
});
$('cancelAddClan').addEventListener('click', () => { $('addClanModal').hidden = true; });
$('saveNewClan').addEventListener('click', async () => {
    const id = $('newClanId').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const name = $('newClanName').value.trim();
    const pass = $('newClanPass').value.trim();
    const msg = $('addClanMsg');
    if (!id || !name || !pass) { msg.textContent = 'ID, название и пароль обязательны'; msg.style.color = '#ff7a7a'; return; }
    if (clansCache[id]) { msg.textContent = 'ID уже занят'; msg.style.color = '#ff7a7a'; return; }
    const payload = {
        id, name,
        description: $('newClanDesc').value.trim(),
        rules: $('newClanRules').value,
        password: pass,
        discord: $('newClanDiscord').value.trim() || null,
        image: $('newClanImage').value.trim() || 'images/aov.png',
        bg: $('newClanBg').value.trim() || 'images/bg-main.jpg'
    };
    const { error } = await supabase.from('clans').insert(payload);
    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    clansCache[id] = payload;
    renderHomeCards(); renderAdminClanSelect(); renderScopeSelects(); renderContacts();
    msg.textContent = '✔ Гильдия создана'; msg.style.color = '#6ee7a7';
    setTimeout(() => { $('addClanModal').hidden = true; }, 800);
});

/* ===================== РЕДАКТИРОВАНИЕ ЗАПИСЕЙ СПИСКА ===================== */
function openEditModal(tab, item) {
    editingItem = { tab, id: item.id };
    $('editPlayerGuild').value = item.player_guild || '';
    $('editNickname').value = item.nickname || '';
    $('editFaction').value = item.faction || '';
    $('editNote').value = item.note || '';
    $('editError').textContent = '';
    $('editModal').hidden = false;
    $('editPlayerGuild').focus();
}
$('cancelEdit').addEventListener('click', () => { $('editModal').hidden = true; editingItem = null; });
$('saveEdit').addEventListener('click', async () => {
    if (!editingItem) return;
    const pg = $('editPlayerGuild').value.trim();
    const nick = $('editNickname').value.trim();
    if (!pg && !nick) { $('editError').textContent = 'Заполни Гильдию или Никнейм'; return; }
    const { tab, id } = editingItem;
    const { error } = await supabase.from(tab).update({
        nickname: nick || null, player_guild: pg || null,
        faction: $('editFaction').value.trim() || null,
        note: $('editNote').value.trim() || null
    }).eq('id', id);
    if (error) { $('editError').textContent = 'Ошибка: ' + error.message; return; }
    $('editModal').hidden = true; editingItem = null;
    loadList(tab);
});
['editPlayerGuild','editNickname','editFaction','editNote'].forEach(id => {
    $(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') $('saveEdit').click();
    });
});

/* ===================== ДОБАВЛЕНИЕ ЗАПИСИ В СПИСОК ===================== */
$('addBtn').addEventListener('click', async () => {
    if (!isAdmin || !currentClan) return;
    const pg = $('playerGuild').value.trim();
    const nick = $('nickname').value.trim();
    if (!pg && !nick) { flashStatus('Заполни Гильдию или Никнейм', '#ff7a7a'); return; }
    const { error } = await supabase.from(currentTab).insert({
        nickname: nick || null, player_guild: pg || null,
        faction: $('faction').value.trim() || null,
        note: $('note').value.trim() || null,
        clan: currentClan
    });
    if (error) { flashStatus('Ошибка: ' + error.message, '#ff7a7a'); return; }
    ['playerGuild','nickname','faction','note'].forEach(id => $(id).value = '');
    $('playerGuild').focus();
    flashStatus('✔ Добавлено', '#6ee7a7');
    loadList(currentTab);
});
['playerGuild','nickname','faction','note'].forEach(id => {
    $(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') $('addBtn').click();
    });
});
function flashStatus(text, color) {
    const el = $('status');
    el.textContent = text; el.style.color = color;
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => el.textContent = '', 2000);
}

/* ===================== УДАЛЕНИЕ И ПЕРЕМЕЩЕНИЕ ===================== */
async function deleteItem(tab, id) {
    if (!confirm('Удалить запись?')) return;
    const { error } = await supabase.from(tab).delete().eq('id', id);
    if (error) return alert(error.message);
    loadList(tab);
}
function openMoveModal(fromTab, id) {
    movingItem = { fromTab, id };
    $('moveModal').hidden = false;
}
$('cancelMove').addEventListener('click', () => { $('moveModal').hidden = true; movingItem = null; });
document.querySelectorAll('#moveModal [data-target]').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!movingItem || !currentClan) return;
        const { fromTab, id } = movingItem;
        const toTab = btn.dataset.target;
        $('moveModal').hidden = true; movingItem = null;
        if (toTab === fromTab) return;
        const { data, error } = await supabase.from(fromTab).select('*').eq('id', id).single();
        if (error) return alert(error.message);
        const { error: insErr } = await supabase.from(toTab).insert({
            nickname: data.nickname, player_guild: data.player_guild,
            faction: data.faction, note: data.note, clan: currentClan
        });
        if (insErr) return alert(insErr.message);
        await supabase.from(fromTab).delete().eq('id', id);
        loadList(fromTab); loadList(toTab);
    });
});

/* ===================== УТИЛИТА ===================== */
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

/* ===================== СТАРТ ===================== */
(async () => {
    const verEl = document.querySelector('.footer-right');
    if (verEl) verEl.textContent = 'v' + APP_VERSION;

    await loadClans();

    const { data: { session } } = await supabase.auth.getSession();
    isAdmin = !!session?.user && ADMIN_EMAILS.includes((session.user.email || '').toLowerCase());
    applyAdminUI();

    showScreen('home');
    applyBg();
})();
