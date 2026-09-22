import { supabase } from './supabase.js';

const ADMIN_EMAILS = ['kolibri@wosb.ru'];
const APP_VERSION = '1.6.0';

const TABS = ['enemies', 'friends', 'neutral', 'personal'];
const UNLOCK_KEY = 'guild_unlocked';
const LAST_CLAN_KEY = 'guild_last_clan';
const BG_STORAGE_KEY = 'guild_bg_overrides';
const GAME_STORAGE_KEY = 'selected_game_id';
const ADMIN_NICK_KEY = 'admin_nickname';
const VIEWER_NICK_KEY = 'viewer_nickname';
const SHARED = '__shared__';

let gamesCache    = {};
let clansCache    = {};
let settingsCache = null;
let faqCache      = [];
let partnersCache = [];
let partnerLogoData = null;
let currentGame   = null;
let currentClan   = null;
let pendingClanId = null;
let currentTab    = 'enemies';
let homeCurrentTab = 'enemies';
let isAdmin       = false;
let movingItem    = null;
let editingItem   = null;
let editingBuild  = null;
let editingGame   = null;
let duplicatingBuild = null;

const $ = id => document.getElementById(id);
const screenHome         = $('screen-home');
const screenClan         = $('screen-clan');
const screenMaintenance  = $('screen-maintenance');
const clanView           = $('clanView');
const adminView          = $('adminView');
const bgFileInput        = $('bgFileInput');

/* ===================== ЛОГИ ===================== */
async function logAdminAction(action, target = null, details = null) {
    const admin_nickname = localStorage.getItem(ADMIN_NICK_KEY) || 'неизвестный';
    try {
        const { error } = await supabase.from('admin_log').insert({
            admin_nickname, action, target, details
        });
        if (error) console.warn('admin_log insert error:', error.message);
    } catch (e) { console.warn('logAdminAction:', e); }
}

async function logView(nickname, clanId, page) {
    if (!nickname) return;
    try {
        const { error } = await supabase.from('view_history').insert({
            nickname, clan_id: clanId, page
        });
        if (error) console.warn('view_history insert error:', error.message);
    } catch (e) { console.warn('logView:', e); }
}

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
    if (currentGame && gamesCache[currentGame]?.bg) return gamesCache[currentGame].bg;
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
        if (setOverride(currentBgKey(), dataUrl)) {
            applyBg();
            await logAdminAction('Сменил фон', currentClan || 'main');
        }
    } catch (err) { alert('Не удалось обработать: ' + err.message); }
});
$('bgResetBtn').addEventListener('click', async () => {
    if (!isAdmin) return;
    const key = currentBgKey();
    if (!getOverrides()[key]) return alert('Уже стоит стандартный фон.');
    if (!confirm('Вернуть стандартный фон?')) return;
    setOverride(key, null); applyBg();
    await logAdminAction('Сбросил фон', key);
});

/* ===================== ЭКРАНЫ ===================== */
function showScreen(name) {
    screenHome.hidden        = name !== 'home';
    screenClan.hidden        = name !== 'clan';
    clanView.hidden          = name !== 'lists';
    adminView.hidden         = name !== 'admin';
    screenMaintenance.hidden = name !== 'maintenance';
    window.scrollTo(0, 0);
}

/* ===================== ТЕХРАБОТЫ ===================== */
function isMaintenanceOn() {
    return settingsCache?.maintenance_mode === true;
}

function showMaintenanceScreen() {
    const msg = $('maintenanceMessage');
    if (msg) {
        msg.textContent = settingsCache?.maintenance_message
            || 'Идут технические работы. Заходите позже.';
    }
    showScreen('maintenance');
}

function applyAccessControl() {
    if (isAdmin) return false;
    if (isMaintenanceOn()) {
        showMaintenanceScreen();
        return true;
    }
    return false;
}

/* ===================== ИГРЫ ===================== */
async function loadGames() {
    const { data, error } = await supabase.from('games').select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
    if (error) { console.error('Games load error:', error); return; }
    gamesCache = {};
    (data || []).forEach(g => { gamesCache[g.id] = g; });
    const saved = localStorage.getItem(GAME_STORAGE_KEY);
    if (saved && gamesCache[saved]) currentGame = saved;
    else currentGame = Object.keys(gamesCache)[0] || null;
    renderGamesAdmin();
    renderNewClanGameSelect();
    applyBg();
}

/* ===================== САЙДБАР ГИЛЬДИИ ===================== */
document.querySelectorAll('.side-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        if (!section) return;
        document.querySelectorAll('.side-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.clan-section').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        $('section-' + section).classList.add('active');
        if (section === 'lists') TABS.forEach(loadList);
        else if (section === 'events') renderEvents();
        else if (section === 'treasury') renderTreasury();
        else if (section === 'trade') {
            const tn = $('tm-nickname');
            if (tn && !tn.value) {
                const n = currentViewerNick();
                if (n) tn.value = n;
            }
            renderTrades();
        }
        else if (section === 'pvp') renderBuilds('pvp');
        else if (section === 'pb') renderBuilds('pb');
        else if (section === 'contacts') renderContacts();
        else if (section === 'applications') renderApplications();
    });
});

/* ===================== САЙДБАР АДМИНА ===================== */
document.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('wip')) {
            alert('🚧 В разработке!');
            return;
        }
        const panel = btn.dataset.apanel;
        if (!panel) return;
        document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        const section = document.querySelector(`.admin-section[data-apanel="${panel}"]`);
        if (section) section.classList.add('active');

        if (panel === 'clans') renderAdminClanSelect();
        if (panel === 'games') renderGamesAdmin();
        if (panel === 'partners') renderPartnersAdmin();
        if (panel === 'faq') renderFaqAdmin();
        if (panel === 'settings') renderSiteFields();
        if (panel === 'adminlog') renderAdminLog();
        if (panel === 'viewhistory') renderViewHistory();
    });
});

$('adminBackHome').addEventListener('click', () => {
    if (applyAccessControl()) return;
    showScreen('home');
});

/* ===================== АДМИН ===================== */
function openAdminAuth() {
    $('adminAuthModal').hidden = false;
    $('adminAuthError').textContent = '';
    $('adminNickname').value = localStorage.getItem(ADMIN_NICK_KEY) || '';
    $('adminEmail').value = '';
    $('adminPassword').value = '';
    ($('adminNickname').value ? $('adminEmail') : $('adminNickname')).focus();
}
function closeAdminAuth() { $('adminAuthModal').hidden = true; }
$('adminLoginBtn').addEventListener('click', openAdminAuth);
$('adminLoginBtnM').addEventListener('click', openAdminAuth);
$('cancelAdminLogin').addEventListener('click', closeAdminAuth);

$('doAdminLogin').addEventListener('click', async () => {
    const nick = $('adminNickname').value.trim();
    const email = $('adminEmail').value.trim();
    const password = $('adminPassword').value;
    const err = $('adminAuthError'); err.textContent = '';
    if (!nick) { err.textContent = 'Укажите ваш ник'; return; }
    if (nick.length < 2) { err.textContent = 'Ник слишком короткий'; return; }
    if (!email || !password) { err.textContent = 'Заполни email и пароль'; return; }

    localStorage.setItem(ADMIN_NICK_KEY, nick);

    $('doAdminLogin').disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    $('doAdminLogin').disabled = false;
    if (error) {
        err.textContent = error.message;
        return;
    }
    await logAdminAction('Вход в админ-панель', email, `ник: ${nick}`);
    closeAdminAuth();
});
$('adminPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('doAdminLogin').click();
});

async function adminLogout() {
    await logAdminAction('Выход из админ-панели');
    localStorage.removeItem(ADMIN_NICK_KEY);
    await supabase.auth.signOut();
}
$('adminLogoutBtn').addEventListener('click', adminLogout);
$('adminLogoutBtn2').addEventListener('click', adminLogout);
$('adminLogoutBtnM').addEventListener('click', adminLogout);

supabase.auth.onAuthStateChange((_e, session) => {
    isAdmin = !!session?.user && ADMIN_EMAILS.includes((session.user.email || '').toLowerCase());
    applyAdminUI();

    if (isAdmin) {
        if (!screenMaintenance.hidden) {
            showScreen('home');
            applyBg();
        }
    } else {
        applyAccessControl();
    }
});

function applyAdminUI() {
    $('adminLoginBtn').hidden = isAdmin;
    $('adminLogoutBtn').hidden = !isAdmin;
    $('adminPanelBtn').hidden = !isAdmin;
    $('adminLogoutBtn2').hidden = !isAdmin;
    $('adminPanelBtn2').hidden = !isAdmin;
    $('adminPanelBtn3').hidden = !isAdmin;
    $('adminLoginBtnM').hidden = isAdmin;
    $('adminLogoutBtnM').hidden = !isAdmin;
    $('adminPanelBtnM').hidden = !isAdmin;

    const nick = localStorage.getItem(ADMIN_NICK_KEY);
    const label = isAdmin ? ('👑 ' + (nick || 'Админ')) : '';
    ['adminInfo','adminInfo2','adminInfo3','adminInfoM'].forEach(id => {
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

function openAdminPage() {
    if (!isAdmin) return;
    const firstNav = document.querySelector('.admin-nav-item[data-apanel="clans"]');
    if (firstNav) firstNav.click();
    showScreen('admin');
}
$('adminPanelBtn').addEventListener('click', openAdminPage);
$('adminPanelBtn2').addEventListener('click', openAdminPage);
$('adminPanelBtn3').addEventListener('click', openAdminPage);
$('adminPanelBtnM').addEventListener('click', openAdminPage);

$('maintenanceRefresh')?.addEventListener('click', () => location.reload());

/* ===================== ГИЛЬДИИ ===================== */
async function loadClans() {
    const { data, error } = await supabase.from('clans').select('*');
    if (error) { console.error(error); return; }
    clansCache = {};
    (data || []).forEach(c => { clansCache[c.id] = c; });
    renderHomeCards();
    renderAdminClanSelect();
    renderScopeSelects();
    renderContacts();
}

function getClansForGame(gameId) {
    return Object.values(clansCache).filter(c => (c.game_id || 'wosb') === gameId);
}

function renderHomeCards() {
    const grid = $('clanGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const list = currentGame ? getClansForGame(currentGame) : Object.values(clansCache);
    if (!list.length) {
        grid.innerHTML = '<div class="empty">В этой игре пока нет гильдий</div>';
        return;
    }
    list.forEach(clan => {
        const btn = document.createElement('button');
        btn.className = 'clan-card';
        btn.dataset.clan = clan.id;
        btn.innerHTML = `
            <img src="${escapeHtml(clan.image || '')}" alt="${escapeHtml(clan.name)}" onerror="this.style.display='none'">
            <span class="clan-name">${escapeHtml(clan.name)}</span>
            <span class="clan-desc">${escapeHtml(clan.description || '')}</span>
            <span class="clan-more">Подробнее →</span>
        `;
        btn.addEventListener('click', () => handleClanClick(clan.id));
        grid.appendChild(btn);
    });
}
function isUnlocked() { return isAdmin || localStorage.getItem(UNLOCK_KEY) === '1'; }
function handleClanClick(id) {
    if (applyAccessControl()) return;
    if (isUnlocked()) {
        openHomeLists(id);
    } else {
        openClanInfo(id);
    }
}

/* ===================== SCOPE ===================== */
function renderScopeSelects() {
    const clans = Object.values(clansCache);
    ['pvpScope', 'pbScope', 'buildEditScope', 'buildDupScope', 'evScope'].forEach(id => {
        const sel = $(id);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '';
        const opt1 = document.createElement('option');
        opt1.value = SHARED;
        opt1.textContent = '🌐 Общий';
        sel.appendChild(opt1);
        clans.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = '🏰 ' + c.name;
            sel.appendChild(opt);
        });
        if (current && Array.from(sel.options).some(o => o.value === current)) {
            sel.value = current;
        } else if (currentClan && (id === 'pvpScope' || id === 'pbScope' || id === 'evScope')) {
            sel.value = currentClan;
        }
    });
}

/* ===================== ОПИСАНИЕ ===================== */
function openClanInfo(id) {
    if (applyAccessControl()) return;
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
    } else { newsWrap.hidden = true; }
    $('clanLoginBtn').hidden = isUnlocked();
    $('clanViewBtn').hidden = !isUnlocked();
    showScreen('clan');
}
$('backToHomeBtn').addEventListener('click', () => {
    pendingClanId = null;
    if (applyAccessControl()) return;
    showScreen('home');
});
$('clanViewBtn').addEventListener('click', () => {
    if (pendingClanId) openHomeLists(pendingClanId);
});

/* ===================== ВХОД ПО ПАРОЛЮ ===================== */
$('clanLoginBtn').addEventListener('click', () => {
    if (!pendingClanId) return;
    const clan = clansCache[pendingClanId];
    $('clanPassName').textContent = clan.name;
    $('clanNickname').value = localStorage.getItem(VIEWER_NICK_KEY) || '';
    $('clanPassword').value = '';
    $('clanPassError').textContent = '';
    $('clanPassModal').hidden = false;
    ($('clanNickname').value ? $('clanPassword') : $('clanNickname')).focus();
});
$('cancelClanLogin').addEventListener('click', () => { $('clanPassModal').hidden = true; });

$('doClanLogin').addEventListener('click', async () => {
    const nick = $('clanNickname').value.trim();
    const entered = $('clanPassword').value;
    const clan = clansCache[pendingClanId];
    if (!clan) return;
    if (!nick)             { $('clanPassError').textContent = 'Введите ваш ник'; return; }
    if (nick.length < 2)   { $('clanPassError').textContent = 'Ник слишком короткий'; return; }
    if (!entered)          { $('clanPassError').textContent = 'Введите пароль'; return; }
    if (entered !== clan.password) { $('clanPassError').textContent = 'Неверный пароль'; return; }

    localStorage.setItem(VIEWER_NICK_KEY, nick);
    localStorage.setItem(UNLOCK_KEY, '1');
    $('clanPassModal').hidden = true;

    await logView(nick, pendingClanId, 'вход в гильдию');

    const cid = pendingClanId; pendingClanId = null;

    /* После входа — показываем списки прямо на главной */
    openHomeLists(cid);
});
$('clanNickname').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('clanPassword').focus();
});
$('clanPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('doClanLogin').click();
});

/* ===================== СПИСКИ НА ГЛАВНОЙ ===================== */
function openHomeLists(id) {
    if (applyAccessControl()) return;
    const clan = clansCache[id];
    if (!clan) return;
    if (!isUnlocked()) { openClanInfo(id); return; }

    currentClan = id;
    localStorage.setItem(LAST_CLAN_KEY, id);

    const viewerNick = localStorage.getItem(VIEWER_NICK_KEY);
    if (viewerNick) logView(viewerNick, id, 'просмотр списков на главной');

    /* Показываем главную */
    showScreen('home');
    applyBg();

    /* Скрываем hero и карточки, показываем панель */
    const hero = $('heroVideo');
    const title = $('guildsTitle');
    const grid = $('clanGrid');
    const panel = $('homeListsSection');
    if (hero)  hero.hidden = true;
    if (title) title.hidden = true;
    if (grid)  grid.hidden = true;
    if (panel) panel.hidden = false;

    /* Заполняем шапку панели */
    $('homeListsLogo').src = clan.image || '';
    $('homeListsLogo').alt = clan.name;
    $('homeListsLogo').onerror = () => { $('homeListsLogo').style.display = 'none'; };
    $('homeListsTitle').textContent = clan.name;

    /* Сбрасываем таб на «Враги» */
    homeCurrentTab = 'enemies';
    document.querySelectorAll('[data-home-tab]').forEach(b =>
        b.classList.toggle('active', b.dataset.homeTab === 'enemies')
    );

    /* Сбрасываем поиск */
    const searchEl = $('homeSearchInput');
    if (searchEl) searchEl.value = '';

    /* Загружаем список врагов */
    loadHomeList('enemies');

    /* Автозаполнение ника для торговли (если понадобится) */
    const tn = $('tm-nickname');
    if (tn && !tn.value) {
        const n = currentViewerNick();
        if (n) tn.value = n;
    }
}

function closeHomeLists() {
    const hero = $('heroVideo');
    const title = $('guildsTitle');
    const grid = $('clanGrid');
    const panel = $('homeListsSection');
    if (hero)  hero.hidden = false;
    if (title) title.hidden = false;
    if (grid)  grid.hidden = false;
    if (panel) panel.hidden = true;
}

async function loadHomeList(tab) {
    if (!currentClan) return;
    const ul = $('homePlayerList');
    if (!ul) return;
    ul.innerHTML = '<li class="empty">Загрузка…</li>';

    const { data, error } = await supabase.from(tab).select('*')
        .eq('clan', currentClan)
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
            li.querySelector('.delete').addEventListener('click', async () => {
                if (!confirm('Удалить запись?')) return;
                const { error } = await supabase.from(tab).delete().eq('id', item.id);
                if (error) return alert(error.message);
                await logAdminAction(`Удалил запись (${tab})`, null, `id: ${item.id}`);
                refreshLists(tab);
            });
        }
        ul.appendChild(li);
    });
    applyHomeSearchFilter();
}

function applyHomeSearchFilter() {
    const q = ($('homeSearchInput')?.value || '').toLowerCase().trim();
    document.querySelectorAll('#homePlayerList li').forEach(li => {
        if (!q) { li.style.display = ''; return; }
        li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
}

/* Обработчики панели на главной */
$('homeListsClose').addEventListener('click', () => {
    closeHomeLists();
    /* Оставляем currentClan, чтобы клик по карточке сразу открывал списки */
});

$('homeOpenFullBtn').addEventListener('click', () => {
    if (currentClan) openClan(currentClan);
});

$('homeLeaveBtn').addEventListener('click', () => {
    if (!confirm('Заблокировать просмотр? Пароль потребуется ввести снова.')) return;
    localStorage.removeItem(UNLOCK_KEY);
    localStorage.removeItem(LAST_CLAN_KEY);
    localStorage.removeItem(VIEWER_NICK_KEY);
    currentClan = null;
    closeHomeLists();
    if (applyAccessControl()) return;
    showScreen('home');
    applyBg();
});

document.querySelectorAll('[data-home-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.homeTab;
        homeCurrentTab = tab;
        document.querySelectorAll('[data-home-tab]').forEach(b =>
            b.classList.toggle('active', b.dataset.homeTab === tab)
        );
        loadHomeList(tab);
    });
});

$('homeSearchInput').addEventListener('input', applyHomeSearchFilter);

/* ===================== ОТКРЫТИЕ ГИЛЬДИИ (ПОЛНЫЙ ВИД) ===================== */
function openClan(id) {
    if (applyAccessControl()) return;
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

    const viewerNick = localStorage.getItem(VIEWER_NICK_KEY);
    if (viewerNick) logView(viewerNick, id, 'открытие гильдии');

    document.querySelectorAll('.side-item').forEach(b => b.classList.toggle('active', b.dataset.section === 'lists'));
    document.querySelectorAll('.clan-section').forEach(s => s.classList.toggle('active', s.id === 'section-lists'));
    currentTab = 'enemies';
    document.querySelectorAll('.tab:not([data-trade-filter])').forEach(b => b.classList.toggle('active', b.dataset.tab === 'enemies'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-enemies'));
    renderScopeSelects();
    applyAdminUI();
    renderAll();
    renderBuilds('pvp');
    renderBuilds('pb');
    renderContacts();
    renderEvents();
    renderTreasury();
    renderTrades();
    renderApplications();

    const tn = $('tm-nickname');
    if (tn && !tn.value) {
        const n = currentViewerNick();
        if (n) tn.value = n;
    }
}
$('backBtn').addEventListener('click', () => {
    if (applyAccessControl()) return;
    closeHomeLists();
    showScreen('home');
    applyBg();
});
$('clanLeaveBtn').addEventListener('click', () => {
    if (!confirm('Заблокировать просмотр? Пароль потребуется ввести снова.')) return;
    localStorage.removeItem(UNLOCK_KEY);
    localStorage.removeItem(LAST_CLAN_KEY);
    localStorage.removeItem(VIEWER_NICK_KEY);
    currentClan = null;
    closeHomeLists();
    if (applyAccessControl()) return;
    showScreen('home');
    applyBg();
});

/* ===================== ВКЛАДКИ ===================== */
document.querySelectorAll('.tab:not([data-trade-filter]):not([data-home-tab])').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab:not([data-trade-filter]):not([data-home-tab])').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        $('tab-' + currentTab).classList.add('active');
        applySearchFilter();
    });
});

/* ===================== ПОИСК ===================== */
$('searchInput').addEventListener('input', applySearchFilter);
function applySearchFilter() {
    const q = $('searchInput').value.toLowerCase().trim();
    document.querySelectorAll('.tab-content.active .player-list li').forEach(li => {
        if (!q) { li.style.display = ''; return; }
        li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
}

/* ===================== СПИСКИ ===================== */
function refreshLists(tab) {
    loadList(tab);
    if (currentClan && $('homeListsSection') && !$('homeListsSection').hidden) {
        loadHomeList(tab);
    }
}
function renderAll() {
    if (!currentClan) return;
    TABS.forEach(refreshLists);
}
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
    applySearchFilter();
}

/* ===================== БИЛДЫ ===================== */
function parseLines(text) {
    if (!text) return [];
    return String(text).split('\n').map(s => s.trim()).filter(Boolean);
}
function parseBonus(text) {
    const m = String(text).match(/^(.+?)\s*([+-]\s*\d+)\s*$/);
    if (!m) return { stat: text.trim(), value: null };
    return { stat: m[1].trim(), value: parseInt(m[2].replace(/\s/g, ''), 10) };
}
function parseSpecialists(text) {
    return parseLines(text).map(line => {
        const parts = line.split('|').map(p => p.trim()).filter(Boolean);
        if (!parts.length) return null;
        return { name: parts[0], bonuses: parts.slice(1).map(parseBonus) };
    }).filter(Boolean);
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
    const actions = `<div class="build-actions">
        <button class="share" title="Скопировать ссылку">🔗</button>
        ${isAdmin ? `
            <button class="edit" title="Редактировать">✏️</button>
            <button class="copy" title="Дублировать">📋</button>
            <button class="delete" title="Удалить">🗑</button>
        ` : ''}
    </div>`;

    card.innerHTML = `
        <div class="build-header">
            <h3 class="build-ship">${escapeHtml(item.ship_name)}</h3>
            ${rankBadge}${scopeBadge}${actions}
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
    card.querySelector('.share').addEventListener('click', () => {
        const url = `${location.origin}${location.pathname}#build=${item.id}`;
        navigator.clipboard.writeText(url).then(
            () => alert('🔗 Ссылка на билд скопирована!'),
            () => prompt('Скопируйте ссылку:', url)
        );
    });
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
        clan: clanValue, is_shared: isShared, type,
        rank: rank || null, ship_name: ship,
        upgrades: upgrades || null,
        weapons_small: weapS || null,
        weapons_medium: weapM || null,
        weapons_large: weapL || null,
        consumable1: c1 || null, consumable2: c2 || null, consumable3: c3 || null,
        cargo: cargo || null, specialists: specs || null
    });
    if (error) { flashStatusEl(statusEl, 'Ошибка: ' + error.message, '#ff7a7a'); return; }
    await logAdminAction(
        `Добавил билд ${type.toUpperCase()}`,
        ship,
        isShared ? 'общий' : `гильдия: ${clansCache[clanValue]?.name || clanValue}`
    );
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
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.textContent = '', 2000);
}

/* ===================== РЕДАКТИРОВАНИЕ БИЛДА ===================== */
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
        clan: clanValue, is_shared: isShared,
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
    await logAdminAction(
        `Изменил билд ${editingBuild.type.toUpperCase()}`,
        ship,
        `id: ${editingBuild.id}`
    );
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
        clan: clanValue, is_shared: isShared, type: item.type,
        rank: item.rank || null, ship_name: item.ship_name,
        upgrades: item.upgrades || null,
        weapons_small: item.weapons_small || null,
        weapons_medium: item.weapons_medium || null,
        weapons_large: item.weapons_large || null,
        consumable1: item.consumable1 || null,
        consumable2: item.consumable2 || null,
        consumable3: item.consumable3 || null,
        cargo: item.cargo || null, specialists: item.specialists || null
    });
    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    await logAdminAction(
        'Дублировал билд',
        item.ship_name,
        `тип: ${item.type}, куда: ${isShared ? 'общий' : (clansCache[clanValue]?.name || clanValue)}`
    );
    msg.textContent = '✔ Копия создана';
    msg.style.color = '#6ee7a7';
    setTimeout(() => {
        $('buildDupModal').hidden = true;
        duplicatingBuild = null;
        renderBuilds(item.type);
    }, 700);
});
async function deleteBuild(id, type) {
    if (!confirm('Удалить билд?')) return;
    const { error } = await supabase.from('builds').delete().eq('id', id);
    if (error) return alert(error.message);
    await logAdminAction(`Удалил билд ${type.toUpperCase()}`, null, `id: ${id}`);
    renderBuilds(type);
}

/* ===================== СОБЫТИЯ ===================== */
async function renderEvents() {
    if (!currentClan) return;
    const container = $('eventsList');
    if (!container) return;
    container.innerHTML = '<div class="empty">Загрузка…</div>';
    const { data, error } = await supabase.from('events').select('*')
        .or(`is_shared.eq.true,clan.eq.${currentClan}`)
        .order('event_date', { ascending: true });
    if (error) { container.innerHTML = `<div class="empty">Ошибка: ${error.message}</div>`; return; }
    if (!data?.length) { container.innerHTML = '<div class="empty">Событий пока нет</div>'; return; }
    container.innerHTML = '';
    const now = Date.now();
    const monthNames = ['ЯНВ','ФЕВ','МАР','АПР','МАЯ','ИЮН','ИЮЛ','АВГ','СЕН','ОКТ','НОЯ','ДЕК'];
    data.forEach(ev => {
        const d = new Date(ev.event_date);
        const isPast = d.getTime() < now;
        const day = String(d.getDate()).padStart(2, '0');
        const month = monthNames[d.getMonth()];
        const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const card = document.createElement('div');
        card.className = 'event-card' + (isPast ? ' past' : '');
        const scopeBadge = ev.is_shared
            ? `<span class="event-badge shared">🌐 Общий</span>`
            : `<span class="event-badge clan">🏰 ${escapeHtml(clansCache[ev.clan]?.name || ev.clan)}</span>`;
        const actions = isAdmin ? `<div class="event-actions"><button class="delete" title="Удалить">🗑</button></div>` : '';
        card.innerHTML = `
            <div class="event-date-block">
                <div class="event-day">${day}</div>
                <div class="event-month">${month}</div>
            </div>
            <div class="event-info">
                <div class="event-title">${scopeBadge}${escapeHtml(ev.title)}</div>
                <div class="event-time">🕐 ${d.toLocaleDateString('ru-RU')} в ${time}</div>
                ${ev.description ? `<div class="event-desc">${escapeHtml(ev.description)}</div>` : ''}
            </div>
            ${actions}`;
        if (isAdmin) {
            card.querySelector('.delete').addEventListener('click', async () => {
                if (!confirm('Удалить событие?')) return;
                const { error } = await supabase.from('events').delete().eq('id', ev.id);
                if (error) return alert(error.message);
                await logAdminAction('Удалил событие', ev.title, `id: ${ev.id}`);
                renderEvents();
            });
        }
        container.appendChild(card);
    });
}
$('evAddBtn').addEventListener('click', async () => {
    if (!isAdmin || !currentClan) return;
    const title = $('evTitle').value.trim();
    const dateStr = $('evDate').value;
    const desc = $('evDesc').value.trim();
    const scopeVal = $('evScope').value;
    const isShared = scopeVal === SHARED;
    const clanVal = isShared ? null : scopeVal;
    const statusEl = $('evStatus');
    if (!title) { flashStatusEl(statusEl, 'Введите название', '#ff7a7a'); return; }
    if (!dateStr) { flashStatusEl(statusEl, 'Укажите дату', '#ff7a7a'); return; }
    const { error } = await supabase.from('events').insert({
        clan: clanVal, is_shared: isShared, title,
        event_date: new Date(dateStr).toISOString(),
        description: desc || null
    });
    if (error) { flashStatusEl(statusEl, 'Ошибка: ' + error.message, '#ff7a7a'); return; }
    await logAdminAction(
        'Добавил событие',
        title,
        isShared ? 'общее' : `гильдия: ${clansCache[clanVal]?.name || clanVal}`
    );
    ['evTitle','evDate','evDesc'].forEach(id => $(id).value = '');
    flashStatusEl(statusEl, '✔ Добавлено', '#6ee7a7');
    renderEvents();
    sendDiscordWebhook('📅 **Новое событие**', `**${title}**\n${dateStr}\n${desc || ''}`);
});

/* ===================== КАЗНА ===================== */
async function renderTreasury() {
    if (!currentClan) return;
    const container = $('treasuryList');
    if (!container) return;
    container.innerHTML = '<div class="empty">Загрузка…</div>';
    const { data, error } = await supabase.from('treasury').select('*')
        .eq('clan', currentClan)
        .order('created_at', { ascending: false });
    if (error) { container.innerHTML = `<div class="empty">Ошибка: ${error.message}</div>`; return; }
    const list = data || [];
    let balance = 0;
    list.forEach(t => {
        const amt = Number(t.amount) || 0;
        balance += t.type === 'in' ? amt : -amt;
    });
    const balEl = $('treasuryBalance');
    balEl.textContent = balance.toLocaleString('ru-RU');
    balEl.classList.toggle('negative', balance < 0);
    if (!list.length) { container.innerHTML = '<div class="empty">Операций пока нет</div>'; return; }
    container.innerHTML = '';
    list.forEach(t => {
        const amt = Number(t.amount) || 0;
        const d = new Date(t.created_at);
        const dateStr = d.toLocaleDateString('ru-RU') + ' ' +
                        String(d.getHours()).padStart(2,'0') + ':' +
                        String(d.getMinutes()).padStart(2,'0');
        const item = document.createElement('div');
        item.className = 'treasury-item ' + (t.type === 'in' ? 'in' : 'out');
        const delBtn = isAdmin ? `<button title="Удалить">🗑</button>` : '';
        item.innerHTML = `
            <div class="treasury-amount">${t.type === 'in' ? '+' : '−'}${amt.toLocaleString('ru-RU')}</div>
            <div class="treasury-info">
                <div class="treasury-desc">${escapeHtml(t.description || '—')}</div>
                <div class="treasury-date">${dateStr}</div>
            </div>
            ${delBtn}`;
        if (isAdmin) {
            item.querySelector('button').addEventListener('click', async () => {
                if (!confirm('Удалить операцию?')) return;
                const { error } = await supabase.from('treasury').delete().eq('id', t.id);
                if (error) return alert(error.message);
                await logAdminAction('Удалил операцию казны', null, `id: ${t.id}`);
                renderTreasury();
            });
        }
        container.appendChild(item);
    });
}
$('trAddBtn').addEventListener('click', async () => {
    if (!isAdmin || !currentClan) return;
    const type = $('trType').value;
    const amount = Number($('trAmount').value);
    const desc = $('trDesc').value.trim();
    const statusEl = $('trStatus');
    if (!amount || amount <= 0) { flashStatusEl(statusEl, 'Введите сумму > 0', '#ff7a7a'); return; }
    if (!desc) { flashStatusEl(statusEl, 'Добавьте описание', '#ff7a7a'); return; }
    const { error } = await supabase.from('treasury').insert({
        clan: currentClan, type, amount, description: desc
    });
    if (error) { flashStatusEl(statusEl, 'Ошибка: ' + error.message, '#ff7a7a'); return; }
    await logAdminAction(
        `Казна: ${type === 'in' ? 'доход' : 'расход'}`,
        `${amount}`,
        desc
    );
    $('trAmount').value = '';
    $('trDesc').value = '';
    flashStatusEl(statusEl, '✔ Добавлено', '#6ee7a7');
    renderTreasury();
});

/* ===================== ТОРГОВЛЯ (БИРЖА) ===================== */
const TRADE_CATEGORIES = [
    { id: 'resource',  name: 'Ресурс',    icon: '🪵' },
    { id: 'ship',      name: 'Корабль',   icon: '⛵' },
    { id: 'module',    name: 'Модуль',    icon: '⚙️' },
    { id: 'weapon',    name: 'Оружие',    icon: '⚔️' },
    { id: 'ammo',      name: 'Боеприпас', icon: '💣' },
    { id: 'blueprint', name: 'Чертёж',    icon: '📜' },
    { id: 'consum',    name: 'Расходник', icon: '🧪' },
    { id: 'other',     name: 'Прочее',    icon: '📦' },
];

let tradesCache = [];
let tradeFormType = 'buy';
let tradeFilterType = 'all';
let tradeFilterCat = 'all';

function tradeCatById(id) {
    return TRADE_CATEGORIES.find(c => c.id === id)
        || TRADE_CATEGORIES[TRADE_CATEGORIES.length - 1];
}

function tradeFmtGold(n) {
    return Number(n).toLocaleString('ru-RU') + ' 🪙';
}

function tradePlural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
}

function tradeTimeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60)    return 'только что';
    if (s < 3600)  return `${Math.floor(s / 60)} мин назад`;
    if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
    return `${Math.floor(s / 86400)} дн назад`;
}

function currentViewerNick() {
    return (localStorage.getItem(VIEWER_NICK_KEY)
        || localStorage.getItem(ADMIN_NICK_KEY) || '').trim();
}

async function renderTrades() {
    if (!currentClan) return;
    const container = $('tm-listings');
    if (!container) return;
    container.innerHTML = '<div class="empty">Загрузка…</div>';
    const { data, error } = await supabase.from('trades').select('*')
        .eq('clan', currentClan)
        .order('created_at', { ascending: false });
    if (error) {
        container.innerHTML = `<div class="empty">Ошибка: ${error.message}</div>`;
        return;
    }
    tradesCache = data || [];
    renderTradeCounters();
    renderTradeListings();
}

function renderTradeCounters() {
    let buyGold = 0, sellGold = 0, buyN = 0, sellN = 0;
    tradesCache.forEach(t => {
        const total = Number(t.price) * Number(t.qty);
        if (t.type === 'buy') { buyGold  += total; buyN++;  }
        else                  { sellGold += total; sellN++; }
    });
    const elBuy     = $('tm-counter-buy-gold');
    const elSell    = $('tm-counter-sell-gold');
    const elBuySub  = $('tm-counter-buy-sub');
    const elSellSub = $('tm-counter-sell-sub');
    if (elBuy)     elBuy.textContent     = tradeFmtGold(buyGold);
    if (elSell)    elSell.textContent    = tradeFmtGold(sellGold);
    if (elBuySub)  elBuySub.textContent  = buyN  + ' ' + tradePlural(buyN,  'заявка', 'заявки', 'заявок');
    if (elSellSub) elSellSub.textContent = sellN + ' ' + tradePlural(sellN, 'заявка', 'заявки', 'заявок');
}

function tradeVisibleListings() {
    const q        = ($('tm-search')?.value || '').trim().toLowerCase();
    const onlyMine = $('tm-only-mine')?.checked;
    const myNick   = currentViewerNick().toLowerCase();

    return tradesCache.filter(t => {
        if (tradeFilterType !== 'all' && t.type !== tradeFilterType) return false;
        if (tradeFilterCat  !== 'all' && t.category !== tradeFilterCat) return false;
        if (q && !(t.name || '').toLowerCase().includes(q)) return false;
        if (onlyMine && (t.nickname || '').toLowerCase() !== myNick) return false;
        return true;
    });
}

function renderTradeListings() {
    const container = $('tm-listings');
    if (!container) return;
    const items = tradeVisibleListings();
    if (!items.length) {
        container.innerHTML = '<p class="empty">Заявок пока нет. Будьте первым!</p>';
        return;
    }
    const myNick = currentViewerNick().toLowerCase();
    container.innerHTML = '';

    items.forEach(t => {
        const cat   = tradeCatById(t.category);
        const total = Number(t.price) * Number(t.qty);
        const isMine    = myNick && (t.nickname || '').toLowerCase() === myNick;
        const canDelete = isAdmin || isMine;
        const typeLabel = t.type === 'buy' ? '🛒 Куплю' : '💰 Продам';

        const el = document.createElement('article');
        el.className = 'tm-listing ' + t.type + (isMine ? ' mine' : '');
        el.dataset.id = t.id;
        el.innerHTML = `
            <div class="tm-listing-head">
                <div class="tm-listing-icon">${cat.icon}</div>
                <div class="tm-listing-title">
                    <h4>${escapeHtml(t.name)}</h4>
                    <div class="tm-listing-tags">
                        <span class="tm-tag ${t.type}">${typeLabel}</span>
                        <span class="tm-tag cat">${cat.name}</span>
                    </div>
                </div>
            </div>
            <div class="tm-listing-price">
                <span class="amount">${Number(t.price).toLocaleString('ru-RU')}</span>
                <span class="per">🪙 / шт.</span>
                ${Number(t.qty) > 1 ? `<span class="total">×${t.qty} = ${tradeFmtGold(total)}</span>` : ''}
            </div>
            ${t.port ? `<div class="tm-listing-port">⚓ Порт: ${escapeHtml(t.port)}</div>` : ''}
            ${t.note ? `<div class="tm-listing-note">«${escapeHtml(t.note)}»</div>` : ''}
            <div class="tm-listing-foot">
                <span class="author">👤 ${escapeHtml(t.nickname)}</span>
                <span class="time">${tradeTimeAgo(t.created_at)}</span>
                ${canDelete ? `<button class="tm-delete" data-id="${t.id}" title="Удалить">✕</button>` : ''}
            </div>
        `;
        container.appendChild(el);
    });
}

function updateTradeFormTotal() {
    const p = parseInt($('tm-price')?.value) || 0;
    const q = parseInt($('tm-qty')?.value)   || 0;
    const el = $('tm-total');
    if (el) el.value = tradeFmtGold(p * q);
}

function setTradeStatus(msg, type = '') {
    const el = $('tm-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'tm-status ' + type;
    if (msg) setTimeout(() => {
        if (el.textContent === msg) el.textContent = '';
    }, 3500);
}

function initTradeCategorySelect() {
    const sel = $('tm-category');
    if (!sel) return;
    sel.innerHTML = TRADE_CATEGORIES.map(c =>
        `<option value="${c.id}">${c.icon} ${c.name}</option>`
    ).join('');
}

function initTradeCategoryFilters() {
    const wrap = $('tm-cat-filters');
    if (!wrap) return;
    wrap.innerHTML =
        `<span class="tm-chip active" data-cat="all">Все категории</span>` +
        TRADE_CATEGORIES.map(c =>
            `<span class="tm-chip" data-cat="${c.id}">${c.icon} ${c.name}</span>`
        ).join('');
}

document.querySelectorAll('.tm-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tm-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tradeFormType = btn.dataset.type;
    });
});

$('tm-price')?.addEventListener('input', updateTradeFormTotal);
$('tm-qty')?.addEventListener('input',   updateTradeFormTotal);

$('tm-search')?.addEventListener('input', renderTradeListings);
$('tm-only-mine')?.addEventListener('change', renderTradeListings);

$('tm-type-filters')?.addEventListener('click', e => {
    const chip = e.target.closest('.tm-chip');
    if (!chip) return;
    document.querySelectorAll('#tm-type-filters .tm-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    tradeFilterType = chip.dataset.type;
    renderTradeListings();
});

$('tm-cat-filters')?.addEventListener('click', e => {
    const chip = e.target.closest('.tm-chip');
    if (!chip) return;
    document.querySelectorAll('#tm-cat-filters .tm-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    tradeFilterCat = chip.dataset.cat;
    renderTradeListings();
});

$('tm-listings')?.addEventListener('click', async e => {
    const btn = e.target.closest('.tm-delete');
    if (!btn) return;
    const id = btn.dataset.id;
    const t = tradesCache.find(x => String(x.id) === String(id));
    if (!t) return;
    if (!confirm(`Удалить заявку «${t.name}»?`)) return;
    const { error } = await supabase.from('trades').delete().eq('id', id);
    if (error) return alert(error.message);
    await logAdminAction('Удалил торговую заявку', `${t.nickname} — ${t.name}`, `id: ${id}`);
    renderTrades();
});

$('tm-submit')?.addEventListener('click', async () => {
    if (!currentClan) return;
    const category = $('tm-category').value;
    const name     = $('tm-name').value.trim();
    const price    = parseInt($('tm-price').value);
    const qty      = parseInt($('tm-qty').value);
    const port     = $('tm-port').value.trim();
    const nickname = $('tm-nickname').value.trim();
    const note     = $('tm-note').value.trim();

    if (!name)                  return setTradeStatus('Укажите название.', 'error');
    if (!price || price <= 0)   return setTradeStatus('Укажите корректную цену.', 'error');
    if (!qty   || qty   <= 0)   return setTradeStatus('Укажите корректное количество.', 'error');
    if (!nickname)              return setTradeStatus('Укажите ваш ник.', 'error');
    if (nickname.length < 2)    return setTradeStatus('Ник слишком короткий.', 'error');

    const { error } = await supabase.from('trades').insert({
        clan: currentClan,
        type: tradeFormType,
        category,
        name,
        price,
        qty,
        port: port || null,
        nickname,
        note: note || null,
        status: 'active'
    });
    if (error) return setTradeStatus('Ошибка: ' + error.message, 'error');

    await logAdminAction(
        `Новая торговая заявка (${tradeFormType === 'buy' ? 'куплю' : 'продам'})`,
        `${nickname} — ${name} — ${price}×${qty}`,
        port ? `порт: ${port}` : null
    );

    localStorage.setItem(VIEWER_NICK_KEY, nickname);

    $('tm-name').value  = '';
    $('tm-price').value = '';
    $('tm-qty').value   = 1;
    $('tm-port').value  = '';
    $('tm-note').value  = '';
    updateTradeFormTotal();

    setTradeStatus('✅ Заявка опубликована!', 'success');
    renderTrades();
});

/* ===================== ЗАЯВКИ ===================== */
async function renderApplications() {
    const container = $('applicationsList');
    if (!container || !isAdmin) return;
    container.innerHTML = '<div class="empty">Загрузка…</div>';
    const { data, error } = await supabase.from('applications').select('*')
        .order('created_at', { ascending: false });
    if (error) { container.innerHTML = `<div class="empty">Ошибка: ${error.message}</div>`; return; }
    if (!data?.length) { container.innerHTML = '<div class="empty">Заявок пока нет</div>'; return; }
    container.innerHTML = '';
    data.forEach(app => {
        const d = new Date(app.created_at);
        const dateStr = d.toLocaleDateString('ru-RU') + ' ' +
                        String(d.getHours()).padStart(2,'0') + ':' +
                        String(d.getMinutes()).padStart(2,'0');
        const card = document.createElement('div');
        card.className = 'application-card ' + (app.status || 'new');
        const targetClanName = app.target_clan && clansCache[app.target_clan]
            ? clansCache[app.target_clan].name : (app.target_clan || '—');
        card.innerHTML = `
            <div class="application-head">
                <div class="application-nick">👤 ${escapeHtml(app.nickname)}</div>
                <div class="application-date">${dateStr}</div>
            </div>
            <div class="application-grid">
                <div><b>Возраст</b>${escapeHtml(app.age || '—')}</div>
                <div><b>Опыт</b>${escapeHtml(app.experience || '—')}</div>
                <div><b>Контакт</b>${escapeHtml(app.contact || '—')}</div>
                <div><b>Гильдия</b>${escapeHtml(targetClanName)}</div>
            </div>
            ${app.why ? `<div class="application-why">${escapeHtml(app.why)}</div>` : ''}
            <div class="application-actions">
                ${app.status !== 'approved' ? `<button class="approve">✅ Принять</button>` : ''}
                ${app.status !== 'rejected' ? `<button class="reject">❌ Отклонить</button>` : ''}
                <button class="delete">🗑 Удалить</button>
            </div>`;
        const approveBtn = card.querySelector('.approve');
        const rejectBtn = card.querySelector('.reject');
        const deleteBtn = card.querySelector('.delete');
        if (approveBtn) approveBtn.addEventListener('click', () => updateAppStatus(app.id, 'approved', app.nickname));
        if (rejectBtn)  rejectBtn.addEventListener('click', () => updateAppStatus(app.id, 'rejected', app.nickname));
        if (deleteBtn)  deleteBtn.addEventListener('click', async () => {
            if (!confirm('Удалить заявку?')) return;
            await supabase.from('applications').delete().eq('id', app.id);
            await logAdminAction('Удалил заявку', app.nickname, `id: ${app.id}`);
            renderApplications();
        });
        container.appendChild(card);
    });
}
async function updateAppStatus(id, status, nickname) {
    const { error } = await supabase.from('applications').update({ status }).eq('id', id);
    if (error) return alert(error.message);
    await logAdminAction(
        `Заявка → ${status === 'approved' ? 'принята' : 'отклонена'}`,
        nickname || null,
        `id: ${id}`
    );
    renderApplications();
}

/* ===================== ФОРМА ЗАЯВКИ ===================== */
function renderApplyClanSelect() {
    const sel = $('applyClan');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Не выбрано —</option>';
    const list = currentGame ? getClansForGame(currentGame) : Object.values(clansCache);
    list.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
}
$('applyBtn').addEventListener('click', async () => {
    if (applyAccessControl()) return;
    const nick = $('applyNick').value.trim();
    const why = $('applyWhy').value.trim();
    const msg = $('applyMsg');
    msg.style.color = '';
    if (!nick) { msg.textContent = 'Введите никнейм'; msg.style.color = '#ff7a7a'; return; }
    if (!why) { msg.textContent = 'Расскажите, почему хотите вступить'; msg.style.color = '#ff7a7a'; return; }
    const payload = {
        nickname: nick,
        age: $('applyAge').value.trim() || null,
        experience: $('applyExp').value.trim() || null,
        why,
        contact: $('applyContact').value.trim() || null,
        target_clan: $('applyClan').value || null
    };
    $('applyBtn').disabled = true;
    const { error } = await supabase.from('applications').insert(payload);
    $('applyBtn').disabled = false;
    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    msg.textContent = '✔ Заявка отправлена! С вами свяжутся.';
    msg.style.color = '#6ee7a7';
    sendDiscordWebhook('📝 **Новая заявка в гильдию**',
        `**Ник:** ${payload.nickname}\n**Возраст:** ${payload.age || '—'}\n` +
        `**Опыт:** ${payload.experience || '—'}\n**Контакт:** ${payload.contact || '—'}\n` +
        `**Гильдия:** ${payload.target_clan ? (clansCache[payload.target_clan]?.name || payload.target_clan) : '—'}\n\n` +
        `**Зачем:** ${payload.why}`);
    ['applyNick','applyAge','applyExp','applyContact','applyWhy'].forEach(id => $(id).value = '');
    $('applyClan').value = '';
});

/* ===================== FAQ ===================== */
async function loadFaq() {
    const { data, error } = await supabase.from('faq').select('*').order('sort_order');
    if (error) { console.warn(error); return; }
    faqCache = data || [];
    renderFaq();
    renderFaqAdmin();
}
function renderFaq() {
    const container = $('faqList');
    if (!container) return;
    container.innerHTML = '';
    if (!faqCache.length) { container.innerHTML = '<div class="empty">Пока нет вопросов</div>'; return; }
    faqCache.forEach(item => {
        const details = document.createElement('details');
        details.className = 'faq-item';
        details.innerHTML = `<summary class="faq-q">${escapeHtml(item.question)}</summary>
            <div class="faq-a">${escapeHtml(item.answer)}</div>`;
        container.appendChild(details);
    });
}
function renderFaqAdmin() {
    const container = $('faqAdminList');
    if (!container) return;
    container.innerHTML = '';
    if (!faqCache.length) { container.innerHTML = '<div class="empty">Пока нет</div>'; return; }
    faqCache.forEach(item => {
        const el = document.createElement('div');
        el.className = 'faq-admin-item';
        el.innerHTML = `
            <div class="txt"><b>${escapeHtml(item.question)}</b><span>${escapeHtml(item.answer)}</span></div>
            <button title="Удалить">🗑</button>`;
        el.querySelector('button').addEventListener('click', async () => {
            if (!confirm('Удалить вопрос?')) return;
            await supabase.from('faq').delete().eq('id', item.id);
            await logAdminAction('Удалил вопрос FAQ', item.question);
            loadFaq();
        });
        container.appendChild(el);
    });
}
$('faqAddBtn').addEventListener('click', async () => {
    const q = $('faqQ').value.trim();
    const a = $('faqA').value.trim();
    if (!q || !a) { alert('Заполни вопрос и ответ'); return; }
    const { error } = await supabase.from('faq').insert({
        question: q, answer: a, sort_order: faqCache.length + 1
    });
    if (error) return alert(error.message);
    await logAdminAction('Добавил вопрос FAQ', q);
    $('faqQ').value = ''; $('faqA').value = '';
    loadFaq();
});

/* ===================== ПАРТНЁРЫ ===================== */
async function loadPartners() {
    const { data, error } = await supabase.from('partners').select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
    if (error) { console.warn('Партнёры не загружены:', error.message); return; }
    partnersCache = data || [];
    renderPartnersHome();
    renderPartnersAdmin();
}
function isYouTubeUrl(url) {
    if (!url) return false;
    try { return /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(new URL(url.trim()).hostname); }
    catch { return false; }
}
function extractYouTubeHandle(url) {
    if (!url) return '';
    try {
        const u = new URL(url.trim());
        if (!/(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(u.hostname)) return '';
        const path = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
        if (!path) return '';
        if (path.startsWith('@')) return path.split('/')[0];
        if (path.startsWith('channel/')) return path.replace('channel/', '').split('/')[0];
        if (path.startsWith('c/'))       return path.replace('c/', '').split('/')[0];
        if (path.startsWith('user/'))    return path.replace('user/', '').split('/')[0];
        return path.split('/')[0] || '';
    } catch { return ''; }
}
function getPartnerLogo(p) {
    if (p.logo_url && p.logo_url.startsWith('data:')) return p.logo_url;
    const handle = extractYouTubeHandle(p.url);
    if (handle) return `https://unavatar.io/youtube/${handle}`;
    if (p.logo_url) return p.logo_url;
    return null;
}
function renderPartnersHome() {
    const section = $('partnersSection');
    const list = $('partnersList');
    if (!section || !list) return;
    list.innerHTML = '';
    if (!partnersCache.length) { section.hidden = true; return; }
    section.hidden = false;
    partnersCache.forEach(p => {
        if (isYouTubeUrl(p.url)) list.appendChild(createYouTubeCard(p));
        else list.appendChild(createPartnerCard(p));
    });
}
function createYouTubeCard(p) {
    const a = document.createElement('a');
    a.className = 'yt-promo-card';
    a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
    const logoSrc = getPartnerLogo(p);
    const logoEl = document.createElement('img');
    logoEl.className = 'yt-promo-logo';
    logoEl.alt = p.name;
    logoEl.src = logoSrc || 'images/aov.png';
    logoEl.onerror = () => {
        logoEl.onerror = null;
        logoEl.classList.add('yt-promo-logo-fallback');
        logoEl.src = 'images/aov.png';
    };
    const info = document.createElement('div');
    info.className = 'yt-promo-info';
    info.innerHTML = `
        <div class="yt-promo-name">${escapeHtml(p.name)}</div>
        ${p.description ? `<div class="yt-promo-desc">${escapeHtml(p.description)}</div>` : ''}
        <div class="yt-promo-btn">Смотреть на YouTube</div>`;
    a.appendChild(logoEl); a.appendChild(info);
    return a;
}
function createPartnerCard(p) {
    const a = document.createElement('a');
    a.className = 'partner-card';
    a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
    const logoEl = document.createElement('div');
    logoEl.className = 'partner-logo';
    const logoSrc = getPartnerLogo(p);
    if (logoSrc) {
        const img = document.createElement('img');
        img.src = logoSrc; img.alt = '';
        img.onerror = () => img.replaceWith(makePartnerLetter(p.name));
        logoEl.appendChild(img);
    } else {
        logoEl.appendChild(makePartnerLetter(p.name));
    }
    const info = document.createElement('div');
    info.className = 'partner-info';
    info.innerHTML = `
        <div class="partner-name">${escapeHtml(p.name)}</div>
        ${p.description ? `<div class="partner-desc">${escapeHtml(p.description)}</div>` : ''}
        <div class="partner-link">🔗 ${escapeHtml(p.url)}</div>`;
    a.appendChild(logoEl); a.appendChild(info);
    return a;
}
function makePartnerLetter(name) {
    const span = document.createElement('span');
    span.className = 'partner-letter';
    span.textContent = (name || '?').trim()[0]?.toUpperCase() || '?';
    span.style.background = colorFromString(name || '?');
    return span;
}
function colorFromString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return `linear-gradient(135deg, hsl(${hue}, 55%, 45%), hsl(${hue}, 55%, 30%))`;
}
function renderPartnersAdmin() {
    const container = $('partnersAdminList');
    if (!container) return;
    container.innerHTML = '';
    if (!partnersCache.length) {
        container.innerHTML = '<div class="empty">Пока нет партнёров</div>';
        return;
    }
    partnersCache.forEach((p, idx) => {
        const el = document.createElement('div');
        el.className = 'partners-admin-item';
        const letter = (p.name || '?')[0].toUpperCase();
        const logoSrc = getPartnerLogo(p);
        const logoHtml = logoSrc
            ? `<img src="${escapeHtml(logoSrc)}" alt="" onerror="this.outerHTML='<span>${escapeHtml(letter)}</span>'">`
            : `<span>${escapeHtml(letter)}</span>`;
        el.innerHTML = `
            <div class="logo-mini">${logoHtml}</div>
            <div class="txt"><b>${escapeHtml(p.name)}</b>
                <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.url)}</a>
            </div>
            <div class="actions">
                <button class="up" ${idx === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button>
                <button class="down" ${idx === partnersCache.length - 1 ? 'disabled style="opacity:.3"' : ''}>▼</button>
                <button class="delete">🗑</button>
            </div>`;
        el.querySelector('.up')?.addEventListener('click', () => movePartner(p.id, -1, p.name));
        el.querySelector('.down')?.addEventListener('click', () => movePartner(p.id, +1, p.name));
        el.querySelector('.delete').addEventListener('click', () => deletePartner(p.id, p.name));
        container.appendChild(el);
    });
}
async function movePartner(id, dir, name) {
    const idx = partnersCache.findIndex(p => p.id === id);
    if (idx === -1) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= partnersCache.length) return;
    const a = partnersCache[idx]; const b = partnersCache[swapIdx];
    await supabase.from('partners').update({ sort_order: swapIdx }).eq('id', a.id);
    await supabase.from('partners').update({ sort_order: idx }).eq('id', b.id);
    await logAdminAction('Переместил партнёра', name || null, `id: ${id}, dir: ${dir}`);
    await loadPartners();
}
async function deletePartner(id, name) {
    if (!confirm('Удалить партнёра?')) return;
    await supabase.from('partners').delete().eq('id', id);
    await logAdminAction('Удалил партнёра', name || null, `id: ${id}`);
    await loadPartners();
}
function compressLogo(file, maxSize = 128, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = maxSize; canvas.height = maxSize;
                const ctx = canvas.getContext('2d');
                const minSide = Math.min(img.width, img.height);
                const sx = (img.width - minSide) / 2;
                const sy = (img.height - minSide) / 2;
                ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxSize, maxSize);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
$('partnerLogoPick').addEventListener('click', () => $('partnerLogoFile').click());
$('partnerLogoFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        partnerLogoData = await compressLogo(file);
        $('partnerLogoImg').src = partnerLogoData;
        $('partnerLogoPreview').hidden = false;
        $('partnerLogoName').textContent = file.name;
    } catch (err) { alert('Не удалось загрузить картинку: ' + err.message); }
});
$('partnerLogoClear').addEventListener('click', () => {
    partnerLogoData = null;
    $('partnerLogoFile').value = '';
    $('partnerLogoPreview').hidden = true;
    $('partnerLogoName').textContent = '';
});
$('partnerAddBtn').addEventListener('click', async () => {
    const name = $('partnerName').value.trim();
    const url = $('partnerUrl').value.trim();
    const desc = $('partnerDesc').value.trim();
    const statusEl = $('partnerStatus');
    if (!name) { flashStatusEl(statusEl, 'Укажи название', '#ff7a7a'); return; }
    if (!url) { flashStatusEl(statusEl, 'Укажи ссылку', '#ff7a7a'); return; }
    if (!/^https?:\/\//i.test(url)) { flashStatusEl(statusEl, 'Ссылка должна начинаться с http:// или https://', '#ff7a7a'); return; }
    const { error } = await supabase.from('partners').insert({
        name, url,
        logo_url: partnerLogoData || null,
        description: desc || null,
        sort_order: partnersCache.length
    });
    if (error) { flashStatusEl(statusEl, 'Ошибка: ' + error.message, '#ff7a7a'); return; }
    await logAdminAction('Добавил партнёра', name, url);
    ['partnerName','partnerUrl','partnerDesc'].forEach(id => $(id).value = '');
    partnerLogoData = null;
    $('partnerLogoFile').value = '';
    $('partnerLogoPreview').hidden = true;
    $('partnerLogoName').textContent = '';
    flashStatusEl(statusEl, '✔ Добавлено', '#6ee7a7');
    await loadPartners();
});

/* ===================== НАСТРОЙКИ ===================== */
async function loadSettings() {
    const { data, error } = await supabase.from('site_settings').select('*').eq('id', 'main').single();
    if (error) { console.warn('Настройки не загружены:', error.message); return; }
    settingsCache = data;
}

/* ===================== DISCORD ===================== */
async function sendDiscordWebhook(title, content) {
    const webhookUrl = settingsCache?.discord_webhook;
    if (!webhookUrl) return;
    const payload = {
        embeds: [{
            title,
            description: content.substring(0, 4000),
            color: 0x2b6cb0,
            timestamp: new Date().toISOString()
        }]
    };
    const proxied = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(webhookUrl);
    try {
        const res = await fetch(proxied, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log('Discord webhook response:', res.status);
    } catch (err) { console.warn('Webhook error:', err); }
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
            ${btn}`;
        container.appendChild(card);
    });
}

/* ===================== АДМИН: ИГРЫ ===================== */
function renderGamesAdmin() {
    const container = $('gamesAdminList');
    if (!container) return;
    container.innerHTML = '';
    const list = Object.values(gamesCache);
    if (!list.length) {
        container.innerHTML = '<div class="empty">Пока нет игр</div>';
        return;
    }
    list.forEach(g => {
        const el = document.createElement('div');
        el.className = 'games-admin-item partners-admin-item';
        const logoHtml = g.image
            ? `<img src="${escapeHtml(g.image)}" alt="" onerror="this.outerHTML='<span>🎮</span>'">`
            : `<span>🎮</span>`;
        el.innerHTML = `
            <div class="logo-mini">${logoHtml}</div>
            <div class="txt">
                <b>${escapeHtml(g.name)}</b>
                <span>ID: ${escapeHtml(g.id)}${g.bg ? ' · 🎨 фон' : ''}</span>
            </div>
            <div class="actions">
                <button class="edit" title="Редактировать">✏️</button>
                <button class="delete" title="Удалить">🗑</button>
            </div>`;
        el.querySelector('.edit').addEventListener('click', () => openGameEdit(g));
        el.querySelector('.delete').addEventListener('click', () => deleteGame(g.id, g.name));
        container.appendChild(el);
    });
}

function openGameEdit(g) {
    editingGame = g;
    $('gameEditId').value = g.id;
    $('gameEditName').value = g.name;
    $('gameEditImage').value = g.image || '';
    $('gameEditBg').value = g.bg || '';
    $('gameEditMsg').textContent = '';
    $('gameEditModal').hidden = false;
    $('gameEditName').focus();
}
$('cancelGameEdit').addEventListener('click', () => {
    $('gameEditModal').hidden = true; editingGame = null;
});
$('saveGameEdit').addEventListener('click', async () => {
    if (!editingGame) return;
    const name = $('gameEditName').value.trim();
    const image = $('gameEditImage').value.trim();
    const bg = $('gameEditBg').value.trim();
    const msg = $('gameEditMsg');
    if (!name) { msg.textContent = 'Укажи название'; msg.style.color = '#ff7a7a'; return; }
    const oldName = editingGame.name;
    const { error } = await supabase.from('games').update({
        name,
        image: image || null,
        bg: bg || null
    }).eq('id', editingGame.id);
    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    await logAdminAction('Изменил игру', name, `id: ${editingGame.id} (было: ${oldName})`);
    $('gameEditModal').hidden = true;
    editingGame = null;
    await loadGames();
});

async function deleteGame(id, name) {
    const count = Object.values(clansCache).filter(c => (c.game_id || 'wosb') === id).length;
    let msg = `Удалить игру «${name}»?`;
    if (count > 0) {
        msg += `\n\n⚠️ К этой игре привязано гильдий: ${count}.\n` +
               `Они ОСТАНУТСЯ в БД, но пропадут с главной,\n` +
               `пока ты не назначишь им другую игру.`;
    }
    if (!confirm(msg)) return;
    const { error } = await supabase.from('games').delete().eq('id', id);
    if (error) return alert('Ошибка: ' + error.message);
    await logAdminAction('Удалил игру', name, `id: ${id}`);
    if (currentGame === id) {
        currentGame = null;
        localStorage.removeItem(GAME_STORAGE_KEY);
    }
    await loadGames();
    await loadClans();
    renderHomeCards();
}

/* ===================== АДМИН: ГИЛЬДИИ ===================== */
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
function renderGameSelectForClanAdmin() {
    const sel = $('adminClanGame');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    Object.values(gamesCache).forEach(g => {
        const o = document.createElement('option');
        o.value = g.id; o.textContent = g.name; sel.appendChild(o);
    });
    if (cur && gamesCache[cur]) sel.value = cur;
}
function renderNewClanGameSelect() {
    const sel = $('newClanGame');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    Object.values(gamesCache).forEach(g => {
        const o = document.createElement('option');
        o.value = g.id; o.textContent = g.name; sel.appendChild(o);
    });
    if (cur && gamesCache[cur]) sel.value = cur;
    else if (currentGame && gamesCache[currentGame]) sel.value = currentGame;
}
$('adminClanSelect').addEventListener('change', updateAdminFields);
function updateAdminFields() {
    const cid = $('adminClanSelect').value;
    const clan = clansCache[cid];
    renderGameSelectForClanAdmin();
    if (clan) {
        $('adminClanGame').value = clan.game_id || 'wosb';
    }
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
    const newGame = $('adminClanGame').value;
    const msg = $('adminPanelMsg');
    if (!cid) return;
    const clan = clansCache[cid]; if (!clan) return;
    const payload = {
        discord: newDiscord || null,
        news: newNews || null,
        rules: newRules,
        game_id: newGame || null,
        updated_at: new Date().toISOString()
    };
    if (newPass) payload.password = newPass;
    const { error } = await supabase.from('clans').update(payload).eq('id', cid);
    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    await logAdminAction(
        'Изменил настройки гильдии',
        clan.name,
        `игра: ${gamesCache[newGame]?.name || newGame}` + (newPass ? ', сменён пароль' : '')
    );
    Object.assign(clansCache[cid], payload);
    msg.textContent = '✔ Сохранено'; msg.style.color = '#6ee7a7';
    $('adminNewPass').value = '';
    if (pendingClanId === cid) {
        $('clanInfoRules').textContent = newRules || 'Правила не заданы.';
        const nw = $('clanInfoNewsWrap');
        if (newNews?.trim()) { nw.hidden = false; $('clanInfoNews').textContent = newNews; }
        else nw.hidden = true;
    }
    renderHomeCards();
    renderContacts();
});

/* ---------- УДАЛЕНИЕ ГИЛЬДИИ ---------- */
$('deleteClanBtn').addEventListener('click', async () => {
    const cid = $('adminClanSelect').value;
    if (!cid) return alert('Выберите гильдию');
    const clan = clansCache[cid];
    if (!clan) return alert('Гильдия не найдена');

    const confirmText = `Удалить гильдию «${clan.name}»?\n\n` +
        `⚠️ Вместе с ней удалятся ВСЕ записи:\n` +
        `• Списки игроков (враги, друзья, нейтралы, личное)\n` +
        `• События гильдии\n` +
        `• Операции казны\n` +
        `• Торговые заявки (биржа)\n` +
        `• Билды ПВП и ПБ (только этой гильдии, общие останутся)\n\n` +
        `Это действие НЕОБРАТИМО. Продолжить?`;

    if (!confirm(confirmText)) return;

    const typed = prompt(`Для подтверждения введи название гильдии:\n«${clan.name}»`);
    if (typed !== clan.name) {
        alert('Название не совпадает. Удаление отменено.');
        return;
    }

    const btn = $('deleteClanBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Удаление…';

    try {
        for (const t of TABS) {
            await supabase.from(t).delete().eq('clan', cid);
        }
        await supabase.from('events').delete().eq('clan', cid).eq('is_shared', false);
        await supabase.from('treasury').delete().eq('clan', cid);
        await supabase.from('trades').delete().eq('clan', cid);
        await supabase.from('builds').delete().eq('clan', cid).eq('is_shared', false);

        const { error } = await supabase.from('clans').delete().eq('id', cid);
        if (error) throw error;

        await logAdminAction('Удалил гильдию', clan.name, `id: ${cid}`);

        delete clansCache[cid];
        if (currentClan === cid) {
            currentClan = null;
            localStorage.removeItem(LAST_CLAN_KEY);
            localStorage.removeItem(UNLOCK_KEY);
            closeHomeLists();
            showScreen('home');
        }
        renderHomeCards();
        renderAdminClanSelect();
        renderScopeSelects();
        renderContacts();
        applyBg();
        $('adminPanelMsg').textContent = `✔ Гильдия «${clan.name}» удалена`;
        $('adminPanelMsg').style.color = '#6ee7a7';
    } catch (err) {
        $('adminPanelMsg').textContent = 'Ошибка: ' + err.message;
        $('adminPanelMsg').style.color = '#ff7a7a';
    } finally {
        btn.disabled = false;
        btn.textContent = '🗑 Удалить гильдию';
    }
});

function renderSiteFields() {
    const s = settingsCache || {};
    $('adminWebhook').value = s.discord_webhook || '';
    $('adminMaintenance').checked = s.maintenance_mode === true;
    $('adminMaintenanceMsg').value = s.maintenance_message || '';
    $('adminSiteMsg').textContent = '';
}
$('saveSiteSettings').addEventListener('click', async () => {
    const msg = $('adminSiteMsg');
    msg.style.color = '';
    const maintenanceOn = $('adminMaintenance').checked;
    const payload = {
        discord_webhook: $('adminWebhook').value.trim() || null,
        maintenance_mode: maintenanceOn,
        maintenance_message: $('adminMaintenanceMsg').value.trim() || null,
        updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('site_settings').update(payload).eq('id', 'main');
    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    settingsCache = Object.assign({ id: 'main' }, settingsCache || {}, payload);
    await logAdminAction(
        maintenanceOn ? 'Включил режим техработ' : 'Отключил режим техработ',
        null,
        maintenanceOn ? (payload.maintenance_message || '') : null
    );
    msg.textContent = '✔ Сохранено';
    msg.style.color = '#6ee7a7';
});

/* ===================== ДОБАВЛЕНИЕ ГИЛЬДИИ ===================== */
$('openAddClan').addEventListener('click', () => {
    ['newClanId','newClanName','newClanDesc','newClanRules','newClanPass','newClanDiscord','newClanImage','newClanBg']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });
    renderNewClanGameSelect();
    $('addClanMsg').textContent = '';
    $('addClanModal').hidden = false;
    $('newClanId').focus();
});
$('cancelAddClan').addEventListener('click', () => { $('addClanModal').hidden = true; });
$('saveNewClan').addEventListener('click', async () => {
    const id = $('newClanId').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const name = $('newClanName').value.trim();
    const pass = $('newClanPass').value.trim();
    const game = $('newClanGame').value;
    const msg = $('addClanMsg');
    if (!id || !name || !pass) { msg.textContent = 'ID, название и пароль обязательны'; msg.style.color = '#ff7a7a'; return; }
    if (!game) { msg.textContent = 'Выберите игру'; msg.style.color = '#ff7a7a'; return; }
    if (clansCache[id]) { msg.textContent = 'ID уже занят'; msg.style.color = '#ff7a7a'; return; }
    const payload = {
        id, name, game_id: game,
        description: $('newClanDesc').value.trim(),
        rules: $('newClanRules').value,
        password: pass,
        discord: $('newClanDiscord').value.trim() || null,
        image: $('newClanImage').value.trim() || 'images/aov.png',
        bg: $('newClanBg').value.trim() || 'images/bg-main.jpg'
    };
    const { error } = await supabase.from('clans').insert(payload);
    if (error) { msg.textContent = 'Ошибка: ' + error.message; msg.style.color = '#ff7a7a'; return; }
    await logAdminAction('Создал гильдию', name, `id: ${id}, игра: ${gamesCache[game]?.name || game}`);
    clansCache[id] = payload;
    renderHomeCards(); renderAdminClanSelect(); renderScopeSelects(); renderContacts();
    msg.textContent = '✔ Гильдия создана'; msg.style.color = '#6ee7a7';
    setTimeout(() => { $('addClanModal').hidden = true; }, 800);
});

/* ===================== РЕДАКТИРОВАНИЕ ЗАПИСИ ===================== */
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
    await logAdminAction(`Изменил запись (${tab})`, nick || pg, `id: ${id}`);
    $('editModal').hidden = true; editingItem = null;
    refreshLists(tab);
});
['editPlayerGuild','editNickname','editFaction','editNote'].forEach(id => {
    $(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') $('saveEdit').click();
    });
});

/* ===================== ДОБАВЛЕНИЕ ЗАПИСИ ===================== */
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
    await logAdminAction(
        `Добавил запись (${currentTab})`,
        nick || pg,
        `гильдия: ${clansCache[currentClan]?.name || currentClan}`
    );
    ['playerGuild','nickname','faction','note'].forEach(id => $(id).value = '');
    $('playerGuild').focus();
    flashStatus('✔ Добавлено', '#6ee7a7');
    refreshLists(currentTab);
});
['playerGuild','nickname','faction','note'].forEach(id => {
    $(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') $('addBtn').click();
    });
});
function flashStatus(text, color) {
    const el = $('status');
    if (!el) return;
    el.textContent = text; el.style.color = color;
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => el.textContent = '', 2000);
}

/* ===================== УДАЛЕНИЕ И ПЕРЕМЕЩЕНИЕ ===================== */
async function deleteItem(tab, id) {
    if (!confirm('Удалить запись?')) return;
    const { error } = await supabase.from(tab).delete().eq('id', id);
    if (error) return alert(error.message);
    await logAdminAction(`Удалил запись (${tab})`, null, `id: ${id}`);
    refreshLists(tab);
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
        await logAdminAction(
            `Переместил запись ${fromTab} → ${toTab}`,
            data.nickname || data.player_guild || null,
            `id: ${id}`
        );
        refreshLists(fromTab); refreshLists(toTab);
    });
});

/* ===================== ЖУРНАЛЫ (РЕНДЕР) ===================== */
async function renderAdminLog() {
    const container = $('adminLogList');
    if (!container) return;
    container.innerHTML = '<div class="empty">Загрузка…</div>';
    const { data, error } = await supabase.from('admin_log').select('*')
        .order('created_at', { ascending: false }).limit(500);
    if (error) { container.innerHTML = `<div class="empty">Ошибка: ${error.message}</div>`; return; }
    if (!data?.length) { container.innerHTML = '<div class="empty">Пока пусто</div>'; return; }
    container.innerHTML = '';
    data.forEach(entry => container.appendChild(buildAdminLogItem(entry)));
}

async function renderViewHistory() {
    const container = $('viewHistoryList');
    if (!container) return;
    container.innerHTML = '<div class="empty">Загрузка…</div>';
    const { data, error } = await supabase.from('view_history').select('*')
        .order('created_at', { ascending: false }).limit(500);
    if (error) { container.innerHTML = `<div class="empty">Ошибка: ${error.message}</div>`; return; }
    if (!data?.length) { container.innerHTML = '<div class="empty">Пока пусто</div>'; return; }
    container.innerHTML = '';
    data.forEach(entry => container.appendChild(buildViewLogItem(entry)));
}

function formatLogDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0') + ':' +
        String(d.getSeconds()).padStart(2, '0');
}

function buildAdminLogItem(entry) {
    const el = document.createElement('div');
    el.className = 'log-item';
    el.innerHTML = `
        <div class="log-head">
            <span class="log-admin">👑 ${escapeHtml(entry.admin_nickname || '—')}</span>
            <span class="log-date">${formatLogDate(entry.created_at)}</span>
        </div>
        <div class="log-action">
            ${escapeHtml(entry.action || '')}
            ${entry.target ? ` — <b>${escapeHtml(entry.target)}</b>` : ''}
        </div>
        ${entry.details ? `<div class="log-details">${escapeHtml(entry.details)}</div>` : ''}`;
    return el;
}

function buildViewLogItem(entry) {
    const el = document.createElement('div');
    el.className = 'log-item';
    const clanName = entry.clan_id && clansCache[entry.clan_id]?.name
        ? clansCache[entry.clan_id].name : (entry.clan_id || '—');
    el.innerHTML = `
        <div class="log-head">
            <span class="log-admin">👤 ${escapeHtml(entry.nickname || '—')}</span>
            <span class="log-date">${formatLogDate(entry.created_at)}</span>
        </div>
        <div class="log-action">Просмотр — <b>${escapeHtml(clanName)}</b></div>
        ${entry.page ? `<div class="log-details">${escapeHtml(entry.page)}</div>` : ''}`;
    return el;
}

$('refreshAdminLog')?.addEventListener('click', renderAdminLog);
$('refreshViewHistory')?.addEventListener('click', renderViewHistory);

/* ===================== #build=ID ===================== */
async function handleBuildHash() {
    if (applyAccessControl()) return;
    const m = location.hash.match(/^#build=([a-f0-9-]+)$/i);
    if (!m) return;
    const { data, error } = await supabase.from('builds').select('*').eq('id', m[1]).single();
    if (error || !data) return;

    /* Нужно открыть полный вид гильдии, чтобы показать билды */
    let openClanId = null;
    if (data.clan && clansCache[data.clan]) openClanId = data.clan;
    else openClanId = localStorage.getItem(LAST_CLAN_KEY) || null;
    if (openClanId && clansCache[openClanId]) openClan(openClanId);

    const section = data.type === 'pvp' ? 'pvp' : 'pb';
    document.querySelector(`.side-item[data-section="${section}"]`)?.click();
    setTimeout(() => {
        document.querySelectorAll('.build-card').forEach(c => {
            if (c.querySelector('.build-ship')?.textContent === data.ship_name) {
                c.scrollIntoView({ behavior: 'smooth', block: 'center' });
                c.style.boxShadow = '0 0 0 3px #b48aff';
                setTimeout(() => c.style.boxShadow = '', 2500);
            }
        });
    }, 600);
}
window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#build=')) handleBuildHash();
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

    await loadGames();
    await loadClans();
    await loadSettings();
    await loadPartners();
    renderApplyClanSelect();
    await loadFaq();

    /* Инициализация UI биржи (один раз) */
    initTradeCategorySelect();
    initTradeCategoryFilters();
    updateTradeFormTotal();

    const { data: { session } } = await supabase.auth.getSession();
    isAdmin = !!session?.user && ADMIN_EMAILS.includes((session.user.email || '').toLowerCase());
    applyAdminUI();

    if (applyAccessControl()) {
        applyBg();
        return;
    }

    showScreen('home');
    applyBg();

    /* Если пользователь уже авторизован в гильдию и есть последняя гильдия —
       показываем списки прямо на главной */
    if (isUnlocked()) {
        const lastClan = localStorage.getItem(LAST_CLAN_KEY);
        if (lastClan && clansCache[lastClan]) {
            openHomeLists(lastClan);
        }
    }

    setTimeout(handleBuildHash, 800);
})();
