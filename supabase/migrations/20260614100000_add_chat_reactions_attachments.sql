-- Chat v2: emoji reactions, reply-to, and attachments (images/files).
--
-- chat_messages grows two columns:
--   attachments  jsonb array of {url, name, type, size} uploaded to taskr-uploads
--   reply_to     jsonb snapshot {id, author_name, content} of the quoted message
--     (denormalized so rendering a reply never needs a second fetch and survives
--      the original being deleted)
--
-- chat_message_reactions is one row per (message, user, emoji). channel_key
-- mirrors how the clients address a conversation (dm_channel_id, location id,
-- chat_channel id, or 'global') so a room can load all of its reactions in one
-- query and subscribe to live changes.

alter table public.chat_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists reply_to jsonb;

create table if not exists public.chat_message_reactions (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  company_id text,
  message_id text not null references public.chat_messages(id) on delete cascade,
  channel_key text not null,
  user_email text not null,
  user_name text,
  emoji text not null,
  unique (message_id, user_email, emoji)
);

create index if not exists idx_chat_message_reactions_channel
  on public.chat_message_reactions (channel_key);
create index if not exists idx_chat_message_reactions_message
  on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;

drop policy if exists chat_message_reactions_select on public.chat_message_reactions;
create policy chat_message_reactions_select on public.chat_message_reactions
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists chat_message_reactions_insert on public.chat_message_reactions;
create policy chat_message_reactions_insert on public.chat_message_reactions
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and lower(user_email) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists chat_message_reactions_delete on public.chat_message_reactions;
create policy chat_message_reactions_delete on public.chat_message_reactions
  for delete to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'));

grant select, insert, delete on public.chat_message_reactions to authenticated;

-- Live reaction updates: add to the realtime publication if it isn't already
-- covered (no-op when the publication is FOR ALL TABLES or already includes it).
do $$
begin
  alter publication supabase_realtime add table public.chat_message_reactions;
exception
  when duplicate_object then null;
  when undefined_object then null;
  when others then null;
end $$;
