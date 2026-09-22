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
    if (isMaintenanceOn()) { showMaintenanceScreen(); return true; }
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
        if (btn.classList.contains('wip')) { alert('🚧 В разработке!'); return; }
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
    if (error) { err.textContent = error.message; return; }
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
    updateApplyVisibility();
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
    updateApplyVisibility();
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
    if (isUnlocked()) openHomeLists(id);
    else openClanInfo(id);
}

/* Видимость формы «Подать заявку» — только для неавторизованных */
function updateApplyVisibility() {
    const el = $('applySection');
    if (!el) return;
    const panel = $('homeListsSection');
    /* Если открыты списки на главной — форма точно скрыта */
    if (panel && !panel.hidden) {
        el.hidden = true;
        return;
    }
    el.hidden = isUnlocked();
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

    showScreen('home');
    applyBg();

    /* Скрываем hero, карточки, заявку, партнёров, FAQ и благодарности */
    const hideOnLists = ['heroVideo', 'guildsTitle', 'clanGrid', 'applySection', 'partnersSection'];
    hideOnLists.forEach(elId => {
        const el = $(elId);
        if (el) el.hidden = true;
    });
    document.querySelectorAll('.faq-section, .thanks-section').forEach(el => {
        el.hidden = true;
    });

    /* Показываем панель списков */
    const panel = $('homeListsSection');
    if (panel) panel.hidden = false;

    /* Шапка панели */
    const logo = $('homeListsLogo');
    logo.src = clan.image || '';
    logo.alt = clan.name;
    logo.style.display = '';
    logo.onerror = () => { logo.style.display = 'none'; };
    $('homeListsTitle').textContent = clan.name;

    /* Сброс таба и поиска */
    homeCurrentTab = 'enemies';
    document.querySelectorAll('[data-home-tab]').forEach(b =>
        b.classList.toggle('active', b.dataset.homeTab === 'enemies')
    );
    const searchEl = $('homeSearchInput');
    if (searchEl) searchEl.value = '';

    loadHomeList('enemies');
    updateApplyVisibility();

    window.scrollTo(0, 0);
}

function closeHomeLists() {
    /* Возвращаем hero, карточки, партнёров */
    const showOnHome = ['heroVideo', 'guildsTitle', 'clanGrid', 'partnersSection'];
    showOnHome.forEach(elId => {
        const el = $(elId);
        if (el) el.hidden = false;
    });
    document.querySelectorAll('.faq-section, .thanks-section').forEach(el => {
        el.hidden = false;
    });

    /* Скрываем панель */
    const panel = $('homeListsSection');
    if (panel) panel.hidden = true;

    /* Форма заявки — только для неавторизованных */
    updateApplyVisibility();

    window.scrollTo(0, 0);
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
    updateApplyVisibility();
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
    document.querySelectorAll('.tab:not([data-trade-filter]):not([data-home-tab])').forEach(b => b.classList.toggle('active', b.dataset.tab === 'enemies'));
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
    updateApplyVisibility();
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
    sel.innerHTML = '<option value="">— Не выбрано —
