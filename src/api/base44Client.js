import { supabase } from '@/api/supabaseClient';

const ENTITY_TABLES = {
  BrandSettings: 'brand_settings',
  CashDepositReceipt: 'cash_deposit_receipts',
  ChatChannel: 'chat_channels',
  ChatMessage: 'chat_messages',
  Checklist: 'checklists',
  ChecklistInstance: 'checklist_instances',
  Company: 'companies',
  Equipment: 'equipment',
  FinancialLaborSettings: 'financial_labor_settings',
  FinancialSchedule: 'financial_schedules',
  FinancialShift: 'financial_shifts',
  FinancialSalesCache: 'financial_sales_cache',
  ForumBoard: 'forum_boards',
  ForumComment: 'forum_comments',
  ForumPost: 'forum_posts',
  CommissaryFulfillment: 'inventory_commissary_fulfillments',
  InventoryCategory: 'inventory_categories',
  InventoryCount: 'inventory_counts',
  InventoryItem: 'inventory_items',
  InventoryLocationSetting: 'inventory_location_settings',
  InventoryMovement: 'inventory_movements',
  InventorySnapshot: 'inventory_snapshots',
  InventorySnapshotAudit: 'inventory_snapshot_audits',
  Invoice: 'inventory_invoices',
  ItemStorageArea: 'inventory_item_storage_areas',
  ItemVariant: 'inventory_item_variants',
  KBArticle: 'kb_articles',
  KBFolder: 'kb_folders',
  Location: 'locations',
  LocationInventory: 'inventory_location_stock',
  RecipeChoiceGroup: 'inventory_recipe_choice_groups',
  RecipeModifier: 'inventory_recipe_modifiers',
  RecipeSizeSet: 'inventory_recipe_size_sets',
  MenuRecipe: 'inventory_menu_recipes',
  Notification: 'notifications',
  Order: 'inventory_orders',
  OrderLine: 'inventory_order_lines',
  PendingInvite: 'pending_invites',
  ReceivingEvent: 'inventory_receiving_events',
  ReceivingLine: 'inventory_receiving_lines',
  PoolDrawdown: 'inventory_pool_drawdowns',
  PrepaidPool: 'inventory_prepaid_pools',
  PrepRecipe: 'inventory_prep_recipes',
  ProductGroup: 'inventory_product_groups',
  RecipeMarginSetting: 'inventory_recipe_margin_settings',
  RecipePackage: 'inventory_packages',
  Role: 'roles',
  RoleModuleDefault: 'role_module_defaults',
  UserLocationModuleAccess: 'user_location_module_access',
  ServiceRecord: 'service_records',
  ServiceSchedule: 'service_schedules',
  StorageArea: 'inventory_storage_areas',
  Subscription: 'subscriptions',
  Task: 'tasks',
  TaskCompletion: 'task_completions',
  TaskGroup: 'task_groups',
  Todo: 'todos',
  TodoGroup: 'todo_groups',
  TodoOccurrence: 'todo_occurrences',
  Transfer: 'inventory_transfers',
  User: 'users',
  Vendor: 'inventory_vendors',
};

const COMPANY_SCOPED_ENTITIES = new Set([
  'CommissaryFulfillment',
  'FinancialLaborSettings',
  'FinancialSchedule',
  'FinancialShift',
  'FinancialSalesCache',
  'Notification',
  'Todo',
  'TodoGroup',
  'TodoOccurrence',
  'InventoryCategory',
  'InventoryCount',
  'InventoryItem',
  'InventoryLocationSetting',
  'InventoryMovement',
  'InventorySnapshot',
  'InventorySnapshotAudit',
  'Invoice',
  'ItemStorageArea',
  'ItemVariant',
  'LocationInventory',
  'RecipeChoiceGroup',
  'RecipeModifier',
  'RecipeSizeSet',
  'MenuRecipe',
  'Order',
  'OrderLine',
  'ReceivingEvent',
  'ReceivingLine',
  'PoolDrawdown',
  'PrepaidPool',
  'PrepRecipe',
  'ProductGroup',
  'RecipeMarginSetting',
  'RecipePackage',
  'StorageArea',
  'Transfer',
  'Vendor',
]);

const ARRAY_COLUMNS = new Set([
  'active_users',
  'assigned_locations',
  'authorized_emails',
  'assignee_emails',
  'assignee_roles',
  'delivered_channels',
  'dm_participants',
  'file_urls',
  'group_ids',
  'kb_article_ids',
  'media_urls',
  'member_emails',
  'notify_emails',
  'recurrence_days',
  'scheduled_days',
]);

const UPLOAD_BUCKET =
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'taskr-uploads';

function raise(error) {
  if (!error) return;
  const err = new Error(error.message || 'Request failed');
  err.status = error.status;
  err.details = error;
  throw err;
}

function applyFilters(query, filters = {}) {
  for (const [column, value] of Object.entries(filters || {})) {
    if (value === undefined) continue;
    if (value === null) {
      query = query.is(column, null);
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      if ('$in' in value) {
        const values = value.$in || [];
        if (values.length === 0) return null;
        query = query.in(column, values);
      } else if ('$ne' in value) {
        query = query.neq(column, value.$ne);
      } else if ('$gt' in value) {
        query = query.gt(column, value.$gt);
      } else if ('$gte' in value) {
        query = query.gte(column, value.$gte);
      } else if ('$lt' in value) {
        query = query.lt(column, value.$lt);
      } else if ('$lte' in value) {
        query = query.lte(column, value.$lte);
      } else if ('$contains' in value) {
        query = query.contains(column, value.$contains);
      } else {
        query = query.eq(column, value);
      }
      continue;
    }

    if (ARRAY_COLUMNS.has(column)) {
      query = query.contains(column, Array.isArray(value) ? value : [value]);
    } else {
      query = query.eq(column, value);
    }
  }

  return query;
}

function applySortAndLimit(query, sort, limit) {
  if (sort) {
    const descending = sort.startsWith('-');
    const column = descending ? sort.slice(1) : sort;
    query = query.order(column, { ascending: !descending });
  }

  if (limit) {
    query = query.limit(limit);
  }

  return query;
}

function sanitizeRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

function selectColumns(fields) {
  if (Array.isArray(fields) && fields.length) return fields.join(',');
  if (typeof fields === 'string' && fields) return fields;
  return '*';
}

function entityClient(entityName) {
  const table = ENTITY_TABLES[entityName];

  return {
    async list(sort = '-created_date', limit, fields) {
      const query = applySortAndLimit(supabase.from(table).select(selectColumns(fields)), sort, limit);
      const { data, error } = await query;
      raise(error);
      return data || [];
    },

    async filter(filters = {}, sort = '-created_date', limit, fields) {
      let query = applyFilters(supabase.from(table).select(selectColumns(fields)), filters);
      if (!query) return [];
      query = applySortAndLimit(query, sort, limit);
      const { data, error } = await query;
      raise(error);
      return data || [];
    },

    async get(id) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      raise(error);
      return data;
    },

    async create(record) {
      const payload = await withDefaultCompany(entityName, record);
      const { data, error } = await supabase
        .from(table)
        .insert(payload)
        .select('*')
        .single();
      raise(error);
      return data;
    },

    async bulkCreate(records) {
      if (!records?.length) return [];
      const payload = await Promise.all(records.map((record) => withDefaultCompany(entityName, record)));
      const { data, error } = await supabase
        .from(table)
        .insert(payload)
        .select('*');
      raise(error);
      return data || [];
    },

    async update(id, record) {
      const { data, error } = await supabase
        .from(table)
        .update(sanitizeRecord(record))
        .eq('id', id)
        .select('*')
        .single();
      raise(error);
      return data;
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      raise(error);
      return { id };
    },

    subscribe(callback) {
      const channel = supabase
        .channel(`${table}-changes-${crypto.randomUUID()}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => callback(payload)
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    },
  };
}

async function currentSession() {
  const { data, error } = await supabase.auth.getSession();
  raise(error);
  return data.session;
}

let cachedProfile = null;
let profileRequest = null;

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
    cachedProfile = null;
    profileRequest = null;
  }
});

async function cachedCurrentProfile() {
  if (cachedProfile) return cachedProfile;
  if (!profileRequest) {
    profileRequest = currentProfile()
      .then((profile) => {
        cachedProfile = profile;
        return profile;
      })
      .finally(() => {
        profileRequest = null;
      });
  }
  return profileRequest;
}

function profileFromAuthUser(authUser, profile = {}) {
  const metadata = authUser?.user_metadata || {};
  return {
    id: authUser.id,
    email: authUser.email,
    full_name: metadata.full_name || metadata.name || profile.full_name || '',
    ...profile,
    role: profile.role || 'employee',
    assigned_locations: profile.assigned_locations || [],
  };
}

async function ensureProfile(authUser) {
  const { data: existing, error: readError } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();
  raise(readError);

  if (existing) {
    cachedProfile = profileFromAuthUser(authUser, existing);
    return cachedProfile;
  }

  const profile = profileFromAuthUser(authUser);
  const { data, error } = await supabase
    .from('users')
    .insert(profile)
    .select('*')
    .single();
  raise(error);
  cachedProfile = profileFromAuthUser(authUser, data);
  return cachedProfile;
}

async function currentProfile() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  raise(error);
  if (!user) return null;
  return ensureProfile(user);
}

async function withDefaultCompany(entityName, record = {}) {
  const clean = sanitizeRecord(record);
  if (!COMPANY_SCOPED_ENTITIES.has(entityName) || clean.company_id) return clean;
  const profile = await cachedCurrentProfile();
  return profile?.company_id ? { ...clean, company_id: profile.company_id } : clean;
}

async function invokeFunction(name, payload = {}) {
  const session = await currentSession();
  const body =
    payload &&
    Object.prototype.hasOwnProperty.call(payload, 'data') &&
    Object.keys(payload).length === 1
      ? payload.data
      : payload;

  const response = await fetch(`/api/functions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify(body || {}),
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const responseText = await response.text().catch(() => '');
    const responsePreview = responseText.replace(/\s+/g, ' ').trim().slice(0, 300);
    const message = `Function ${name} returned ${contentType || 'no content type'} instead of JSON (HTTP ${response.status})`;
    console.error(`${message}. Response started with: ${responsePreview || '(empty response)'}`);
    throw new Error(message);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Function ${name} failed`);
  }

  return { data };
}

export const base44 = {
  entities: Object.fromEntries(
    Object.keys(ENTITY_TABLES).map((entityName) => [
      entityName,
      entityClient(entityName),
    ])
  ),

  auth: {
    async me() {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      raise(error);
      if (!user) {
        const err = new Error('Not authenticated');
        err.status = 401;
        throw err;
      }
      return ensureProfile(user);
    },

    async isAuthenticated() {
      return Boolean(await currentSession());
    },

    async register({ email, password, fullName, name }) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName || name || '' },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      raise(error);
      return data;
    },

    async verifyOtp({ email, otpCode, token }) {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode || token,
        type: 'signup',
      });
      raise(error);
      return {
        ...data,
        access_token: data.session?.access_token,
      };
    },

    async resendOtp(email) {
      const { data, error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      raise(error);
      return data;
    },

    async loginViaEmailPassword(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      raise(error);
      if (data.user) await ensureProfile(data.user);
      return data;
    },

    async loginWithProvider(provider, redirectPath = '/') {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}${redirectPath}`,
        },
      });
      raise(error);
      return data;
    },

    setToken() {
      return null;
    },

    async logout(redirectTo = '/login') {
      await supabase.auth.signOut();
      window.location.href = redirectTo === true ? '/login' : '/login';
    },

    redirectToLogin() {
      window.location.href = '/login';
    },

    async updateMe(updates) {
      const { data } = await invokeFunction('updateMe', updates);
      cachedProfile = null;
      return data.user;
    },

    async updatePassword({ currentPassword, newPassword }) {
      const user = await this.me();
      if (currentPassword) {
        const { error: verifyError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        raise(verifyError);
      }
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      raise(error);
      return data;
    },

    async resetPasswordRequest(email) {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      raise(error);
      return data;
    },

    async resetPassword({ newPassword }) {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      raise(error);
      return data;
    },
  },

  functions: {
    invoke: invokeFunction,
  },

  users: {
    inviteUser(invite, role = 'employee') {
      const payload = typeof invite === 'string' ? { email: invite, role } : invite;
      return invokeFunction('inviteUser', payload);
    },
  },

  integrations: {
    Core: {
      async UploadFile({ file }) {
        const session = await currentSession();
        if (!session) throw new Error('Please log in before uploading files.');

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const path = `${session.user.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from(UPLOAD_BUCKET)
          .upload(path, file, {
            contentType: file.type || 'application/octet-stream',
          });
        raise(error);

        const { data } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
        return { file_url: data.publicUrl };
      },

      async InvokeLLM(payload = {}) {
        const { data } = await invokeFunction('extractInvoiceImage', payload);
        return data;
      },
    },
  },
};
