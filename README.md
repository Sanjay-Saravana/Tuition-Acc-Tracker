# Tuition-Acc-Tracker

Modern tuition accounting app with students, sessions, payments, reports, export, and cross-device sync.

## Major updates in this version
- Fully redesigned UI with a new sidebar layout, cleaner typography, and responsive design.
- Fixed sign-in state reliability so authenticated users no longer incorrectly appear signed out.
- Added legacy data migration support from previous local keys (`tuition_accounts_v1` and `tuition_accounts_v2`) into the current format.
- Hardened cloud sync strategy to avoid accidental cloud overwrite when local state is empty.

## Cloud sync setup (Supabase)
1. Create a Supabase project.
2. Run this SQL:

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

create policy "Users can insert own tuition profile"
  on public.tuition_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tuition profile"
  on public.tuition_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

3. Open app → **Cloud Settings**.
4. Save your Supabase URL + anon key.
5. Click **Sign In** and enter email/password.

## Recovering existing data
- If you had data on older app versions, this version automatically imports local data from previous storage keys.
- If your data is already in Supabase, sign in and the app will prefer cloud data during initial sync.
- If local has data and cloud is empty, local data is pushed to cloud.

## Run
Open `index.html` in a modern browser, or serve as static files.
