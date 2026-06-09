import { createClient } from '@supabase/supabase-js';

export const ENTITY_TABLES = {
  BrandSettings: 'brand_settings',
  CashDepositReceipt: 'cash_deposit_receipts',
  ChatChannel: 'chat_channels',
  ChatMessage: 'chat_messages',
  Checklist: 'checklists',
  ChecklistInstance: 'checklist_instances',
  Company: 'companies',
  Equipment: 'equipment',
  ForumBoard: 'forum_boards',
  ForumComment: 'forum_comments',
  ForumPost: 'forum_posts',
  KBArticle: 'kb_articles',
  KBFolder: 'kb_folders',
  Location: 'locations',
  PendingInvite: 'pending_invites',
  ServiceRecord: 'service_records',
  ServiceSchedule: 'service_schedules',
  Subscription: 'subscriptions',
  Task: 'tasks',
  TaskCompletion: 'task_completions',
  TaskGroup: 'task_groups',
  User: 'users',
};

export const EXPORT_TABLES = [
  ['companies', 'companies'],
  ['locations', 'locations'],
  ['checklists', 'checklists'],
  ['tasks', 'tasks'],
  ['taskGroups', 'task_groups'],
  ['checklistInstances', 'checklist_instances'],
  ['taskCompletions', 'task_completions'],
  ['cashDepositReceipts', 'cash_deposit_receipts'],
  ['kbFolders', 'kb_folders'],
  ['kbArticles', 'kb_articles'],
  ['forumBoards', 'forum_boards'],
  ['forumPosts', 'forum_posts'],
  ['forumComments', 'forum_comments'],
  ['chatChannels', 'chat_channels'],
  ['equipment', 'equipment'],
  ['serviceSchedules', 'service_schedules'],
  ['serviceRecords', 'service_records'],
  ['brandSettings', 'brand_settings'],
  ['pendingInvites', 'pending_invites'],
  ['subscriptions', 'subscriptions'],
];

export const IMPORT_ORDER = [
  ['companies', 'companies'],
  ['locations', 'locations'],
  ['brandSettings', 'brand_settings'],
  ['subscriptions', 'subscriptions'],
  ['checklists', 'checklists'],
  ['taskGroups', 'task_groups'],
  ['tasks', 'tasks'],
  ['checklistInstances', 'checklist_instances'],
  ['taskCompletions', 'task_completions'],
  ['cashDepositReceipts', 'cash_deposit_receipts'],
  ['kbFolders', 'kb_folders'],
  ['kbArticles', 'kb_articles'],
  ['forumBoards', 'forum_boards'],
  ['forumPosts', 'forum_posts'],
  ['forumComments', 'forum_comments'],
  ['chatChannels', 'chat_channels'],
  ['equipment', 'equipment'],
  ['serviceSchedules', 'service_schedules'],
  ['serviceRecords', 'service_records'],
  ['pendingInvites', 'pending_invites'],
];

export function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw httpError(500, 'Missing Supabase server environment variables.');
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function originFor(req) {
  const origin = req.headers.origin;
  if (origin) return origin;
  const referer = req.headers.referer;
  if (referer) return referer.replace(/\/$/, '');
  return process.env.APP_ORIGIN || 'http://localhost:5173';
}

function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header) return null;
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export function formatUser(authUser, profile = {}) {
  const metadata = authUser?.user_metadata || {};
  return {
    id: authUser?.id || profile.id,
    email: authUser?.email || profile.email,
    full_name: profile.full_name || metadata.full_name || metadata.name || '',
    ...profile,
    role: profile.role || 'employee',
    assigned_locations: profile.assigned_locations || [],
  };
}

export async function requireUser(req, client) {
  const token = bearerToken(req);
  if (!token) throw httpError(401, 'Unauthorized');

  const {
    data: { user: authUser },
    error: authError,
  } = await client.auth.getUser(token);

  if (authError || !authUser) {
    throw httpError(401, 'Unauthorized');
  }

  let { data: profile, error: profileError } = await client
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  if (profileError) throw profileError;

  if (!profile) {
    const payload = formatUser(authUser);
    const { data, error } = await client
      .from('users')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    profile = data;
  }

  return { authUser, user: formatUser(authUser, profile) };
}

export function requireSuperAdmin(user) {
  if (user?.role !== 'super_admin') {
    throw httpError(403, 'Forbidden: Super admin access required');
  }
}

export function requireManagerOrAdmin(user) {
  if (!['admin', 'manager', 'super_admin'].includes(user?.role)) {
    throw httpError(403, 'Forbidden: Manager or admin access required');
  }
}

export function trialDates(days = 15) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + Number(days || 15));
  return {
    trial_start_date: now.toISOString().slice(0, 10),
    trial_end_date: end.toISOString().slice(0, 10),
  };
}

export function withTrialStatus(company) {
  if (!company) return company;
  const trialExpired =
    company.subscription_tier === 'trial' &&
    company.trial_end_date &&
    new Date(company.trial_end_date) < new Date(new Date().toISOString().slice(0, 10));
  return { ...company, trial_expired: Boolean(trialExpired) };
}

export async function defaultTrialDays(client) {
  const { data } = await client
    .from('platform_settings')
    .select('trial_days')
    .eq('id', 'default')
    .maybeSingle();
  return data?.trial_days || 15;
}

export async function upsertPlatformSettings(client, patch) {
  const { data: current } = await client
    .from('platform_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();

  const { data, error } = await client
    .from('platform_settings')
    .upsert({ id: 'default', ...(current || {}), ...patch }, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export function cleanRecord(record) {
  const {
    id,
    created_date,
    updated_date,
    created_by_id,
    created_by,
    ...rest
  } = record;
  return Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined)
  );
}

export function remapRecord(record, idMap) {
  const cleaned = cleanRecord(record);

  const fields = [
    ['company_id', 'companies'],
    ['location_id', 'locations'],
    ['checklist_id', 'checklists'],
    ['group_id', 'taskGroups'],
    ['parent_task_id', 'tasks'],
    ['folder_id', 'kbFolders'],
    ['equipment_id', 'equipment'],
    ['post_id', 'forumPosts'],
    ['task_id', 'tasks'],
    ['instance_id', 'checklistInstances'],
  ];

  for (const [field, mapKey] of fields) {
    if (cleaned[field] && idMap[mapKey]?.[cleaned[field]]) {
      cleaned[field] = idMap[mapKey][cleaned[field]];
    }
  }

  if (cleaned.kb_article_ids?.length) {
    cleaned.kb_article_ids = cleaned.kb_article_ids.map(
      (id) => idMap.kbArticles?.[id] || id
    );
  }

  return cleaned;
}
