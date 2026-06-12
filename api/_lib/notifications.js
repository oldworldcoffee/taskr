import webpush from 'web-push';
import { httpError, originFor } from './taskr.js';

const NOTIFICATION_FUNCTIONS = new Set([
  'notifyTodoCompletion',
  'savePushSubscription',
  'deletePushSubscription',
]);

export function isNotificationFunction(name) {
  return NOTIFICATION_FUNCTIONS.has(name);
}

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:notifications@taskrapp.io',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  vapidConfigured = true;
  return true;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function notificationEmailHtml({ title, body, url }) {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
      <h2 style="margin:0 0 8px;font-size:18px;">${escapeHtml(title)}</h2>
      <p style="margin:0 0 20px;font-size:15px;color:#444;">${escapeHtml(body)}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">Open in Taskr</a>
    </div>
  `;
}

async function sendResendEmail({ to, subject, html }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM ||
    recipients.length === 0
  ) {
    return false;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: recipients, subject, html }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    console.error('Resend send failed', response.status, result?.name || '', result?.message || '');
    return false;
  }
  return true;
}

async function sendPushToUser(client, recipientEmail, payload) {
  if (!ensureVapid()) return false;

  const { data: subs, error } = await client
    .from('push_subscriptions')
    .select('*')
    .eq('user_email', recipientEmail);
  if (error || !subs?.length) return false;

  let delivered = false;
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, body);
        delivered = true;
      } catch (err) {
        // 404/410 mean the subscription is dead — clean it up.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await client.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error('web-push send failed', err?.statusCode || '', err?.message || '');
        }
      }
    })
  );

  return delivered;
}

export async function handleNotificationFunction(name, req, client, user, body) {
  switch (name) {
    case 'savePushSubscription': {
      const sub = body.subscription;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        throw httpError(400, 'Invalid push subscription');
      }
      // Replace any existing row for this endpoint (re-subscription / device reuse).
      await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      const { error } = await client.from('push_subscriptions').insert({
        company_id: user.company_id || null,
        user_email: user.email,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: String(body.userAgent || '').slice(0, 300) || null,
      });
      if (error) throw error;
      return { success: true };
    }

    case 'deletePushSubscription': {
      if (!body.endpoint) throw httpError(400, 'Endpoint is required');
      await client
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', body.endpoint)
        .eq('user_email', user.email);
      return { success: true };
    }

    case 'notifyTodoCompletion': {
      const { todoId, occurrenceId } = body;
      if (!todoId) throw httpError(400, 'todoId is required');

      const { data: todo, error } = await client
        .from('todos')
        .select('*')
        .eq('id', todoId)
        .maybeSingle();
      if (error) throw error;
      if (!todo) return { success: true, delivered: 0 };
      if (user.company_id && todo.company_id && todo.company_id !== user.company_id) {
        throw httpError(403, 'Forbidden');
      }

      const recipients = [...new Set((todo.notify_emails || []).filter(Boolean))].filter(
        (email) => email !== user.email
      );
      if (recipients.length === 0) return { success: true, delivered: 0 };

      const doneBy = user.full_name || user.email;
      const title = 'To-Do completed';
      const messageBody = `${doneBy} completed "${todo.name}"`;
      const link = '/dashboard/todos';
      const absoluteUrl = `${originFor(req)}${link}`;

      for (const recipient of recipients) {
        const channels = ['inapp'];

        const emailed = await sendResendEmail({
          to: recipient,
          subject: title,
          html: notificationEmailHtml({ title, body: messageBody, url: absoluteUrl }),
        });
        if (emailed) channels.push('email');

        const pushed = await sendPushToUser(client, recipient, {
          title,
          body: messageBody,
          url: link,
        });
        if (pushed) channels.push('push');

        await client.from('notifications').insert({
          company_id: todo.company_id || user.company_id || null,
          recipient_email: recipient,
          type: 'todo_completed',
          title,
          body: messageBody,
          link,
          source_id: occurrenceId || null,
          delivered_channels: channels,
        });
      }

      return { success: true, delivered: recipients.length };
    }

    default:
      throw httpError(404, `Unknown notification function: ${name}`);
  }
}
