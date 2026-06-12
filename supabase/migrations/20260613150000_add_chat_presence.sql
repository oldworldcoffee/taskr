-- Chat presence for "active on web ⇒ mute mobile push for the open conversation".
-- The web chat heartbeats the channel a user is currently viewing here; the
-- push-fanout edge function reads it (service role) and skips MOBILE push for
-- users actively viewing that same conversation. Going stale (~40s after the tab
-- closes/blurs) restores mobile push automatically.
create table if not exists public.chat_presence (
  user_email text primary key,
  active_channel text,
  updated_at timestamptz not null default now()
);

alter table public.chat_presence enable row level security;

drop policy if exists chat_presence_select on public.chat_presence;
create policy chat_presence_select on public.chat_presence
  for select to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists chat_presence_insert on public.chat_presence;
create policy chat_presence_insert on public.chat_presence
  for insert to authenticated
  with check (lower(user_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists chat_presence_update on public.chat_presence;
create policy chat_presence_update on public.chat_presence
  for update to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'))
  with check (lower(user_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists chat_presence_delete on public.chat_presence;
create policy chat_presence_delete on public.chat_presence
  for delete to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'));

grant select, insert, update, delete on public.chat_presence to authenticated;
