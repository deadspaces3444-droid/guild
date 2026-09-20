import { supabase } from './supabase.js';

const tabToTable = {
    enemies:  'enemies',
    friends:  'friends',
    neutral:  'neutral',
    personal: 'personal',
};

let currentTab = 'enemies';

// ---------- Переключение вкладок ----------
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        document.getElementById(`tab-${currentTab}`).classList.add('active');
        loadList(currentTab);
    });
});

// ---------- Загрузка списка ----------
async function loadList(tab) {
    const table = tabToTable[tab];
    const { data, error } = await supabase
        .from(table)
        .select('*')
        .order('created_at', { ascending: false });

    const ul = document.getElementById(`list-${tab}`);
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
        li.innerHTML = `
            <div class="info">
                <span class="nick">${escapeHtml(item.nickname)}</span>
                ${item.note ? `<span class="note">${escapeHtml(item.note)}</span>` : ''}
            </div>
            <div class="actions">
                <button class="move" data-id="${item.id}">➡ Переместить</button>
                <button class="delete" data-id="${item.id}">🗑 Удалить</button>
            </div>
        `;
        li.querySelector('.delete').onclick = () => deleteItem(table, item.id, tab);
        li.querySelector('.move').onclick = () => moveItem(table, item.id, tab);
        ul.appendChild(li);
    });
}

// ---------- Добавление ----------
document.getElementById('addBtn').onclick = async () => {
    const nickname = document.getElementById('nickname').value.trim();
    const note = document.getElementById('note').value.trim();
    const status = document.getElementById('status');

    if (!nickname) {
        status.textContent = 'Введите никнейм';
        status.style.color = '#ff7a7a';
        return;
    }

    const { error } = await supabase
        .from(tabToTable[currentTab])
        .insert({ nickname, note: note || null });

    if (error) {
        status.textContent = 'Ошибка: ' + error.message;
        status.style.color = '#ff7a7a';
        return;
    }

    document.getElementById('nickname').value = '';
    document.getElementById('note').value = '';
    status.textContent = '✔ Добавлено';
    status.style.color = '#6ee7a7';
    setTimeout(() => status.textContent = '', 2000);

    loadList(currentTab);
};

// ---------- Удаление ----------
async function deleteItem(table, id, tab) {
    if (!confirm('Удалить запись?')) return;
    await supabase.from(table).delete().eq('id', id);
    loadList(tab);
}

// ---------- Перемещение в другую вкладку ----------
async function moveItem(fromTable, id, fromTab) {
    const target = prompt(
        'Куда переместить?\n1 — Враги\n2 — Друзья\n3 — Нейтралитет\n4 — Не трогать'
    );
    const map = { '1': 'enemies', '2': 'friends', '3': 'neutral', '4': 'personal' };
    const toTable = map[target];
    if (!toTable || toTable === fromTable) return;

    const { data, error } = await supabase
        .from(fromTable).select('*').eq('id', id).single();
    if (error) return alert(error.message);

    await supabase.from(toTable).insert({ nickname: data.nickname, note: data.note });
    await supabase.from(fromTable).delete().eq('id', id);
    loadList(fromTab);
}

// ---------- Утилита ----------
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

// ---------- Инициализация ----------
loadList(currentTab);