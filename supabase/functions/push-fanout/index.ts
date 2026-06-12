// Supabase Edge Function: push-fanout
//
// Triggered by Database Webhooks on INSERT into chat_messages, forum_posts, and
// forum_comments. Resolves who should be notified (scope: DMs notify all
// participants; chat channel/Global messages notify everyone in scope; board
// posts notify on @mention or announcement), looks up their Expo push tokens +
// browser subscriptions, and delivers via Expo push and Web Push.
//
// Deploy (from a machine with the Supabase CLI + the DEV project linked):
//   supabase functions deploy push-fanout --project-ref psxytrplryzkrlzhxrhx
// Then add Database Webhooks (Dashboard → Database → Webhooks) for INSERT on
// chat_messages, forum_posts, forum_comments, each POSTing to this function's
// URL. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Web Push (browser) delivery. Uses the same VAPID keypair the web app subscribes
// with. Optional: if the VAPID secrets aren't set on this function, web push is
// silently skipped (mobile Expo push is unaffected).
let vapidReady = false;
try {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (pub && priv) {
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:notifications@taskrapp.io',
      pub,
      priv
    );
    vapidReady = true;
  }
} catch (e) {
  console.error('VAPID setup failed', (e as Error)?.message || e);
}

// Map a resolved notification's data payload to the in-app deep-link path the
// service worker (public/sw.js) opens on click.
function webUrlFor(data: Record<string, any>): string {
  if (data?.type === 'chat') {
    if (data.dmChannelId) return `/Chat?dm=${encodeURIComponent(data.dmChannelId)}`;
    return `/Chat?channel=${data.locationId || 'global'}`;
  }
  if (data?.type === 'forum') return '/Forum';
  return '/';
}

async function sendWebPush(
  recipients: string[],
  payload: { title: string; body: string; url: string }
) {
  if (!vapidReady || recipients.length === 0) return;
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_email')
    .in('user_email', recipients);
  if (!subs?.length) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (err: any) {
        // 404/410 = dead subscription; clean it up. Others: log and move on.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error('web-push send failed', err?.statusCode || '', err?.message || '');
        }
      }
    })
  );
}

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: Record<string, any> | null;
};

function truncate(s: string, n = 140) {
  const t = (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function normalize(s: string) {
  return (s || '').toLowerCase().replace(/\s+/g, '');
}

// Extract @mention tokens (ignoring @[Article Title] KB references).
function mentionTokens(text: string): string[] {
  const out: string[] = [];
  const re = /@([\w.\-@]+)/g;
  let m: RegExpExecArray | null;
  const stripped = (text || '').replace(/@\[[^\]]+\]/g, ' ');
  while ((m = re.exec(stripped)) !== null) out.push(m[1].toLowerCase());
  return out;
}

function isMentioned(user: any, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const email = (user.email || '').toLowerCase();
  const local = email.split('@')[0];
  const name = normalize(user.full_name || '');
  return tokens.some((t) => t === email || t === local || (name && (t === name || name.includes(t))));
}

async function companyUsers(companyId: string) {
  const { data } = await supabase
    .from('users')
    .select('id, email, full_name, role, assigned_locations')
    .eq('company_id', companyId);
  return data || [];
}

async function tokensForEmails(emails: string[]) {
  if (emails.length === 0) return [];
  // device_push_tokens is the mobile-only table and may not exist in every
  // project (e.g. a web-only prod). Treat any error as "no mobile tokens" so the
  // web-push path still runs.
  const { data, error } = await supabase
    .from('device_push_tokens')
    .select('token, user_email')
    .in('user_email', emails);
  if (error) {
    console.error('device_push_tokens lookup skipped', error.message || error);
    return [];
  }
  return (data || [])
    .map((r) => r.token)
    .filter((t) => typeof t === 'string' && /^Expo(nent)?PushToken\[/.test(t));
}

// Emails actively viewing `channelKey` on the web app right now (heartbeat within
// the freshness window). Mobile push is skipped for them — they see it live.
const PRESENCE_FRESH_MS = 40000;
async function activelyViewing(emails: string[], channelKey: string) {
  if (emails.length === 0 || !channelKey) return new Set<string>();
  const cutoff = new Date(Date.now() - PRESENCE_FRESH_MS).toISOString();
  const { data, error } = await supabase
    .from('chat_presence')
    .select('user_email, active_channel, updated_at')
    .in('user_email', emails)
    .gte('updated_at', cutoff);
  if (error) {
    console.error('chat_presence lookup skipped', error.message || error);
    return new Set<string>();
  }
  return new Set(
    (data || [])
      .filter((p) => p.active_channel === channelKey)
      .map((p) => (p.user_email || '').toLowerCase())
  );
}

async function sendExpo(messages: any[]) {
  if (messages.length === 0) return;
  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error('Expo push failed', res.status, await res.text().catch(() => ''));
    }
  }
}

// Returns { recipientEmails, title, body, data } or null if no one to notify.
async function resolve(table: string, record: Record<string, any>) {
  const companyId = record.company_id;
  if (!companyId) return null;
  const author = (record.author_email || '').toLowerCase();
  const authorName = record.author_name || 'Someone';

  if (table === 'chat_messages') {
    const content = record.content || '';
    if (record.dm_channel_id) {
      // DM: notify all participants except the sender.
      const recipients = (record.dm_participants || [])
        .map((e: string) => e.toLowerCase())
        .filter((e: string) => e && e !== author);
      return {
        recipients,
        title: authorName,
        body: truncate(content),
        data: { type: 'chat', dmChannelId: record.dm_channel_id },
      };
    }
    // Channel/Global message: notify everyone in scope (not just @mentions).
    // Global (no location) -> whole company; a location channel -> that
    // location's staff (users with no assigned_locations are admins/managers who
    // see every channel, mirroring the app's access). Author always excluded.
    const locId = record.location_id || null;
    const users = await companyUsers(companyId);
    const recipients = users
      .filter((u) => u.email.toLowerCase() !== author)
      .filter(
        (u) => !locId || !u.assigned_locations?.length || u.assigned_locations.includes(locId)
      )
      .map((u) => u.email.toLowerCase());
    if (recipients.length === 0) return null;

    // Title shows which conversation it came from so the banner is self-explanatory.
    let channelName = 'Global Chat';
    if (locId) {
      const { data: loc } = await supabase
        .from('locations')
        .select('name')
        .eq('id', locId)
        .maybeSingle();
      channelName = loc?.name || 'Channel';
    }
    return {
      recipients,
      title: `${authorName} · ${channelName}`,
      body: truncate(content),
      data: { type: 'chat', locationId: locId },
    };
  }

  if (table === 'forum_posts') {
    const users = await companyUsers(companyId);
    const text = `${record.title || ''} ${record.content || ''}`;
    if (record.is_announcement) {
      // Announcement: everyone in scope except the author.
      const locId = record.location_id;
      const recipients = users
        .filter((u) => u.email.toLowerCase() !== author)
        .filter((u) =>
          !locId ||
          !u.assigned_locations?.length ||
          u.assigned_locations.includes(locId)
        )
        .map((u) => u.email.toLowerCase());
      return {
        recipients,
        title: `📣 ${record.title || 'Announcement'}`,
        body: truncate(record.content || ''),
        data: { type: 'forum', postId: record.id },
      };
    }
    // Regular post: only @mentioned users.
    const tokens = mentionTokens(text);
    const recipients = users
      .filter((u) => u.email.toLowerCase() !== author && isMentioned(u, tokens))
      .map((u) => u.email.toLowerCase());
    if (recipients.length === 0) return null;
    return {
      recipients,
      title: `${authorName} mentioned you`,
      body: truncate(record.title || record.content || ''),
      data: { type: 'forum', postId: record.id },
    };
  }

  if (table === 'forum_comments') {
    const users = await companyUsers(companyId);
    const tokens = mentionTokens(record.content || '');
    const recipients = users
      .filter((u) => u.email.toLowerCase() !== author && isMentioned(u, tokens))
      .map((u) => u.email.toLowerCase());
    if (recipients.length === 0) return null;
    return {
      recipients,
      title: `${authorName} mentioned you`,
      body: truncate(record.content || ''),
      data: { type: 'forum', postId: record.post_id },
    };
  }

  return null;
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload;
    if (payload.type !== 'INSERT' || !payload.record) {
      return new Response('ignored', { status: 200 });
    }

    const resolved = await resolve(payload.table, payload.record);
    if (!resolved || resolved.recipients.length === 0) {
      return new Response('no recipients', { status: 200 });
    }

    // Mute MOBILE push for recipients actively viewing this exact conversation
    // on the web app (they see it live). Web push is unaffected.
    let mobileRecipients = resolved.recipients;
    if (resolved.data?.type === 'chat') {
      const channelKey =
        resolved.data.dmChannelId || resolved.data.locationId || 'global';
      const viewing = await activelyViewing(resolved.recipients, channelKey);
      if (viewing.size > 0) {
        mobileRecipients = resolved.recipients.filter((e) => !viewing.has(e));
      }
    }

    // Deliver to both transports. A recipient may have a mobile token, a browser
    // subscription, or both — so don't bail early when one is empty.
    const tokens = await tokensForEmails(mobileRecipients);
    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title: resolved.title,
      body: resolved.body,
      data: resolved.data,
    }));
    const url = webUrlFor(resolved.data);

    await Promise.all([
      sendExpo(messages),
      sendWebPush(resolved.recipients, {
        title: resolved.title,
        body: resolved.body,
        url,
      }),
    ]);

    return new Response(JSON.stringify({ expo: messages.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('push-fanout error', e);
    return new Response('error', { status: 200 }); // 200 so webhooks don't retry-storm
  }
});
