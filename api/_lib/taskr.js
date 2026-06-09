import { readFileSync } from 'node:fs';
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
  CommissaryFulfillment: 'inventory_commissary_fulfillments',
  InventoryCount: 'inventory_counts',
  InventoryItem: 'inventory_items',
  InventoryLocationSetting: 'inventory_location_settings',
  InventorySnapshot: 'inventory_snapshots',
  Invoice: 'inventory_invoices',
  ItemStorageArea: 'inventory_item_storage_areas',
  KBArticle: 'kb_articles',
  KBFolder: 'kb_folders',
  Location: 'locations',
  LocationInventory: 'inventory_location_stock',
  Order: 'inventory_orders',
  PendingInvite: 'pending_invites',
  ServiceRecord: 'service_records',
  ServiceSchedule: 'service_schedules',
  StorageArea: 'inventory_storage_areas',
  Subscription: 'subscriptions',
  Task: 'tasks',
  TaskCompletion: 'task_completions',
  TaskGroup: 'task_groups',
  Transfer: 'inventory_transfers',
  User: 'users',
  Vendor: 'inventory_vendors',
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

export const IMPORTABLE_COLUMNS = {
  companies: [
    'name',
    'admin_email',
    'stripe_customer_id',
    'stripe_subscription_id',
    'subscription_tier',
    'trial_start_date',
    'trial_end_date',
    'discount_coupon',
    'discount_expires_at',
    'enabled_features',
    'is_active',
  ],
  locations: ['company_id', 'name', 'address', 'is_active'],
  brand_settings: [
    'business_name',
    'logo_url',
    'company_id',
    'primary_color',
    'secondary_color',
  ],
  subscriptions: [
    'company_id',
    'tier',
    'status',
    'stripe_subscription_id',
    'stripe_price_id',
    'current_period_start',
    'current_period_end',
    'cancel_at_period_end',
  ],
  checklists: [
    'name',
    'company_id',
    'location_id',
    'shift_type',
    'recommended_start_time',
    'expected_duration_minutes',
    'is_active',
  ],
  task_groups: ['checklist_id', 'company_id', 'name', 'sort_order'],
  tasks: [
    'checklist_id',
    'company_id',
    'group_id',
    'title',
    'description',
    'task_type',
    'sort_order',
    'is_required',
    'estimated_minutes',
    'parent_task_id',
    'scheduled_days',
    'due_time',
    'kb_article_ids',
  ],
  checklist_instances: [
    'checklist_id',
    'company_id',
    'location_id',
    'date',
    'shift_type',
    'status',
    'started_at',
    'started_by',
    'started_by_name',
    'completed_at',
    'completed_by',
    'flagged_reason',
    'active_users',
    'completion_notes',
  ],
  task_completions: [
    'instance_id',
    'task_id',
    'company_id',
    'completed_by_email',
    'completed_by_name',
    'completed_at',
    'value',
    'notes',
    'is_flag',
  ],
  cash_deposit_receipts: [
    'instance_id',
    'task_id',
    'company_id',
    'location_id',
    'date',
    'initials',
    'expected_amount',
    'actual_amount',
    'deposit_amount',
    'over_short',
    'bills',
    'coins',
    'rolled_coins',
    'notes',
    'completed_by_email',
    'completed_by_name',
  ],
  kb_folders: [
    'name',
    'company_id',
    'location_id',
    'sort_order',
    'authorized_emails',
  ],
  kb_articles: [
    'title',
    'content',
    'folder_id',
    'company_id',
    'location_id',
    'media_urls',
    'file_urls',
    'author_name',
    'author_email',
    'is_draft',
  ],
  forum_boards: [
    'name',
    'company_id',
    'description',
    'location_id',
    'authorized_emails',
    'created_by_email',
  ],
  forum_posts: [
    'title',
    'content',
    'company_id',
    'location_id',
    'board_id',
    'author_name',
    'author_email',
    'is_announcement',
    'is_pinned',
    'kb_article_ids',
  ],
  forum_comments: ['post_id', 'company_id', 'content', 'author_name', 'author_email'],
  chat_channels: [
    'name',
    'company_id',
    'description',
    'location_id',
    'authorized_emails',
    'created_by_email',
  ],
  equipment: [
    'name',
    'company_id',
    'location_id',
    'category',
    'model',
    'serial_number',
    'purchase_date',
    'last_service_date',
    'next_service_date',
    'service_interval_days',
    'notes',
    'is_active',
  ],
  service_schedules: [
    'equipment_id',
    'company_id',
    'location_id',
    'service_type',
    'interval_days',
    'last_scheduled_date',
    'next_due_date',
    'is_active',
    'notes',
  ],
  service_records: [
    'equipment_id',
    'company_id',
    'location_id',
    'service_date',
    'service_type',
    'performed_by',
    'cost',
    'description',
    'next_service_date',
    'logged_by_email',
    'logged_by_name',
  ],
  pending_invites: [
    'email',
    'name',
    'role',
    'assigned_locations',
    'company_id',
    'invited_by',
  ],
};

let localEnvLoaded = false;

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadLocalEnvFallback() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  try {
    const envText = readFileSync('.env.local', 'utf8');
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (!process.env[key]) {
        process.env[key] = unquoteEnvValue(rawValue.trim());
      }
    }
  } catch {
    // Production and linked Vercel dev environments provide env vars directly.
  }
}

export function serviceClient() {
  loadLocalEnvFallback();

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

function keepImportableColumns(record, table) {
  const columns = IMPORTABLE_COLUMNS[table];
  if (!columns) return record;

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => columns.includes(key))
  );
}

export function remapRecord(record, idMap, table) {
  const cleaned = keepImportableColumns(cleanRecord(record), table);

  const fields = [
    ['company_id', 'companies'],
    ['location_id', 'locations'],
    ['checklist_id', 'checklists'],
    ['group_id', 'taskGroups'],
    ['parent_task_id', 'tasks'],
    ['folder_id', 'kbFolders'],
    ['equipment_id', 'equipment'],
    ['board_id', 'forumBoards'],
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
