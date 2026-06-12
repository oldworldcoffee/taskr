-- Server-side read state for the chat / message-board unread badges.
-- Until now "last seen" timestamps lived only in localStorage (web) and
-- AsyncStorage (mobile), so a fresh browser session, a second device, or an app
-- reinstall lost them and every recent message counted as unread again. Clients
-- now mirror the per-channel map here (channel_id is a location id, chat channel
-- id, or DM channel id, plus the special '__all__' and '__forum__' keys) and
-- merge it back on refresh, taking the newest mark per channel.
create table if not exists public.chat_channel_reads (
  user_email text not null,
  channel_id text not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_email, channel_id)
);

alter table public.chat_channel_reads enable row level security;

drop policy if exists chat_channel_reads_select on public.chat_channel_reads;
create policy chat_channel_reads_select on public.chat_channel_reads
  for select to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists chat_channel_reads_insert on public.chat_channel_reads;
create policy chat_channel_reads_insert on public.chat_channel_reads
  for insert to authenticated
  with check (lower(user_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists chat_channel_reads_update on public.chat_channel_reads;
create policy chat_channel_reads_update on public.chat_channel_reads
  for update to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'))
  with check (lower(user_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists chat_channel_reads_delete on public.chat_channel_reads;
create policy chat_channel_reads_delete on public.chat_channel_reads
  for delete to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'));

grant select, insert, update, delete on public.chat_channel_reads to authenticated;
