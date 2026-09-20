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

const MAIN_BG = 'images/bg-main.jpg';

const TABS = ['enemies', 'friends', 'neutral', 'personal'];
const CLAN_STORAGE_KEY = 'guild_current_clan';
const BG_STORAGE_KEY   = 'guild_bg_overrides';

let currentClan = null;
let currentTab  = 'enemies';
let isAdmin     = false;
let movingItem  = null;

/* ============================================================
   DOM
   ============================================================ */
const $ = id => document.getElementById(id);

const landing     = $('landing');
const clanView    = $('clanView');
const clanTitle   = $('clanTitle');
const clanIcon    = $('clanIcon');
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
   АДМИН
   ============================================================ */
function applyAdminUI() {
    const logged = isAdmin;

    $('loginBtn').hidden  = logged;
    $('logoutBtn').hidden = !logged;
    $('userInfo').textContent = logged ? '✔ Админ' : '';

    $('logoutBtn2').hidden = !logged;
    $('userInfo2').textContent = logged ? '✔ Админ' : '';

    document.querySelectorAll('.admin-only').forEach(el => {
        el.hidden = !logged;
        if (!logged) el.style.display = '';
    });

    document.querySelectorAll('.add-form.admin-only').forEach(el => {
        el.style.display = logged ? 'flex' : 'none';
    });

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

    landing.hidden = true;
    clanView.hidden = false;

    applyBg();

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

        // Ник + Гильдия + Фракция в одну строку
        const mainRowParts = [];
        if (item.nickname)    mainRowParts.push(`<span class="nick">${escapeHtml(item.nickname)}</span>`);
        if (item.player_guild) mainRowParts.push(`<span class="guild">${escapeHtml(item.player_guild)}</span>`);
        if (item.faction)     mainRowParts.push(`<span class="faction">${escapeHtml(item.faction)}</span>`);

        const actions = isAdmin ? `
            <div class="actions">
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
    isAdmin = !!session;
    applyAdminUI();

    const savedClan = localStorage.getItem(CLAN_STORAGE_KEY);
    if (savedClan && CLANS[savedClan]) {
        openClan(savedClan);
    } else {
        applyBg();
    }
})();
