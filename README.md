# ⚔️ Guild Site

Сайт для управления списками гильдии. 4 вкладки:
- 🔴 Враги гильдии
- 🟢 Друзья гильдии (полное содействие)
- ⚪ Нейтралитет
- 🟡 Индивидуальный список — не трогать

Стек: чистый HTML/CSS/JS + Supabase (PostgreSQL) + хостинг Render.

## 🚀 Локальный запуск

1. Клонируй репозиторий:
   ```bash
   git clone https://github.com/ТВОЙ_ЛОГИН/guild-site.git
   cd guild-site
   ```

2. Настрой Supabase (см. ниже) и вставь ключи в `supabase.js`.

3. Запусти локальный сервер:
   ```bash
   python -m http.server 8000
   ```
   Открой http://localhost:8000

## 🗄️ Настройка Supabase

1. Создай проект на https://supabase.com
2. SQL Editor → New query → выполни SQL из раздела «SQL схема» ниже.
3. Project Settings → API → скопируй **Project URL** и **anon key** → вставь в `supabase.js`.

### SQL схема

```sql
create table enemies (
    id uuid primary key default gen_random_uuid(),
    nickname text not null,
    note text,
    created_at timestamptz default now()
);

create table friends (
    id uuid primary key default gen_random_uuid(),
    nickname text not null,
    note text,
    created_at timestamptz default now()
);

create table neutral (
    id uuid primary key default gen_random_uuid(),
    nickname text not null,
    note text,
    created_at timestamptz default now()
);

create table personal (
    id uuid primary key default gen_random_uuid(),
    nickname text not null,
    note text,
    created_at timestamptz default now()
);

alter table enemies  enable row level security;
alter table friends  enable row level security;
alter table neutral  enable row level security;
alter table personal enable row level security;

create policy "public read enemies"   on enemies   for select using (true);
create policy "public insert enemies" on enemies   for insert with check (true);
create policy "public update enemies" on enemies   for update using (true);
create policy "public delete enemies" on enemies   for delete using (true);

create policy "public read friends"   on friends   for select using (true);
create policy "public insert friends" on friends   for insert with check (true);
create policy "public update friends" on friends   for update using (true);
create policy "public delete friends" on friends   for delete using (true);

create policy "public read neutral"   on neutral   for select using (true);
create policy "public insert neutral" on neutral   for insert with check (true);
create policy "public update neutral" on neutral   for update using (true);
create policy "public delete neutral" on neutral   for delete using (true);

create policy "public read personal"   on personal   for select using (true);
create policy "public insert personal" on personal   for insert with check (true);
create policy "public update personal" on personal   for update using (true);
create policy "public delete personal" on personal   for delete using (true);
```

## ☁️ Деплой на Render

1. Push в GitHub
2. render.com → New + → **Static Site**
3. Подключи репозиторий, Branch: `main`
4. Build Command: пусто
5. Publish Directory: `.`
6. Create Static Site