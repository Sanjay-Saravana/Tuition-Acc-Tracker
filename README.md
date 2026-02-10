# Tuition-Acc-Tracker

A modern tuition accounting web app to manage students, session fees, payments, reports, exports, and now **cross-device sync with sign-in**.

## What's new
- Complete UI refresh (glassmorphism cards, modern layout, cleaner typography).
- Email/password sign-in.
- Cloud sync through Supabase so your data can be used across devices.
- Existing local data is preserved and can sync to cloud after login.

## Cloud sync setup (required once per device)
1. Create a Supabase project.
2. Create this table in SQL editor:

```sql
create table if not exists public.tuition_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tuition_profiles enable row level security;

create policy "Users can read own tuition profile"
  on public.tuition_profiles for select
  using (auth.uid() = user_id);

create policy "Users can upsert own tuition profile"
  on public.tuition_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tuition profile"
  on public.tuition_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

3. In the app, click **Cloud Settings** and paste:
   - Project URL
   - Anon Key
4. Click **Sign In** and enter email/password.
   - If email does not exist, the app auto-creates the account.

## Existing data from one device
If you already have data on one device, open that device first, configure cloud settings, and sign in. The app will sync your local data to cloud. Then sign in on other devices to load that same data.

## Run
Open `index.html` directly in a modern browser, or serve using any static server.
