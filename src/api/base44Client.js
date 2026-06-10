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
  ForumBoard: 'forum_boards',
  ForumComment: 'forum_comments',
  ForumPost: 'forum_posts',
  CommissaryFulfillment: 'inventory_commissary_fulfillments',
  InventoryCategory: 'inventory_categories',
  InventoryCount: 'inventory_counts',
  InventoryItem: 'inventory_items',
  InventoryLocationSetting: 'inventory_location_settings',
  InventorySnapshot: 'inventory_snapshots',
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
  Order: 'inventory_orders',
  PendingInvite: 'pending_invites',
  PrepRecipe: 'inventory_prep_recipes',
  ProductGroup: 'inventory_product_groups',
  RecipeMarginSetting: 'inventory_recipe_margin_settings',
  RecipePackage: 'inventory_packages',
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

const COMPANY_SCOPED_ENTITIES = new Set([
  'CommissaryFulfillment',
  'InventoryCategory',
  'InventoryCount',
  'InventoryItem',
  'InventoryLocationSetting',
  'InventorySnapshot',
  'Invoice',
  'ItemStorageArea',
  'ItemVariant',
  'LocationInventory',
  'RecipeChoiceGroup',
  'RecipeModifier',
  'RecipeSizeSet',
  'MenuRecipe',
  'Order',
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
  'dm_participants',
  'file_urls',
  'kb_article_ids',
  'media_urls',
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

function entityClient(entityName) {
  const table = ENTITY_TABLES[entityName];

  return {
    async list(sort = '-created_date', limit) {
      const query = applySortAndLimit(supabase.from(table).select('*'), sort, limit);
      const { data, error } = await query;
      raise(error);
      return data || [];
    },

    async filter(filters = {}, sort = '-created_date', limit) {
      let query = applyFilters(supabase.from(table).select('*'), filters);
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

  if (existing) return profileFromAuthUser(authUser, existing);

  const profile = profileFromAuthUser(authUser);
  const { data, error } = await supabase
    .from('users')
    .insert(profile)
    .select('*')
    .single();
  raise(error);
  return profileFromAuthUser(authUser, data);
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

function isLocalDevHost() {
  return Boolean(import.meta.env.DEV);
}

function withTrialStatus(company) {
  if (!company) return company;
  const trialExpired =
    company.subscription_tier === 'trial' &&
    company.trial_end_date &&
    new Date(company.trial_end_date) < new Date(new Date().toISOString().slice(0, 10));
  return { ...company, trial_expired: Boolean(trialExpired) };
}

function trialDates(days = 15) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + Number(days || 15));
  return {
    trial_start_date: now.toISOString().slice(0, 10),
    trial_end_date: end.toISOString().slice(0, 10),
  };
}

async function requireLocalSuperAdmin() {
  const profile = await currentProfile();
  if (profile?.role !== 'super_admin') {
    const error = new Error('Forbidden: Super admin access required');
    error.status = 403;
    throw error;
  }
  return profile;
}

async function countRows(table, applyFilters = (query) => query) {
  const query = applyFilters(supabase.from(table).select('id', { count: 'exact', head: true }));
  const { count, error } = await query;
  raise(error);
  return count || 0;
}

async function localCompanyCounts(companyId) {
  const [user_count, location_count] = await Promise.all([
    countRows('users', (query) => query.eq('company_id', companyId)),
    countRows('locations', (query) => query.eq('company_id', companyId)),
  ]);
  return { user_count, location_count };
}

async function localDefaultTrialDays() {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('trial_days')
    .eq('id', 'default')
    .maybeSingle();
  raise(error);
  return data?.trial_days || 15;
}

async function localPlatformSettings() {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  raise(error);
  return {
    pricing_tiers: {
      '1_location': 49,
      '5_locations': 149,
      unlimited: 299,
      ...(data?.pricing_tiers || {}),
    },
    trial_days: data?.trial_days || 15,
  };
}

async function upsertLocalPlatformSettings(patch) {
  const { data: current, error: readError } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  raise(readError);

  const { data, error } = await supabase
    .from('platform_settings')
    .upsert({ id: 'default', ...(current || {}), ...patch }, { onConflict: 'id' })
    .select('*')
    .single();
  raise(error);
  return data;
}

async function localFunctionFallback(name, body = {}) {
  if (!isLocalDevHost()) return null;

  switch (name) {
    case 'getCompanyInfo': {
      const user = await currentProfile();
      if (!user?.company_id) return { success: false, error: 'No company associated with your account' };

      const { data: company, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', user.company_id)
        .single();
      raise(error);

      return {
        success: true,
        company: {
          ...withTrialStatus(company),
          ...(await localCompanyCounts(company.id)),
        },
      };
    }

    case 'getAllCompanies': {
      await requireLocalSuperAdmin();
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('created_date', { ascending: false });
      raise(error);

      const companies = await Promise.all(
        (data || []).map(async (company) => ({
          ...withTrialStatus(company),
          ...(await localCompanyCounts(company.id)),
        }))
      );
      return { companies };
    }

    case 'getSuperUsers': {
      await requireLocalSuperAdmin();
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'super_admin')
        .order('full_name');
      raise(error);
      return { users: data || [] };
    }

    case 'getSuperAdminStats': {
      await requireLocalSuperAdmin();
      const today = new Date().toISOString().slice(0, 10);
      const [
        companies,
        users,
        locations,
        activeSubscriptions,
        activeTrials,
        expiredTrials,
      ] = await Promise.all([
        countRows('companies'),
        countRows('users'),
        countRows('locations'),
        countRows('companies', (query) => query.eq('is_active', true).neq('subscription_tier', 'trial')),
        countRows('companies', (query) =>
          query.eq('is_active', true).eq('subscription_tier', 'trial').gte('trial_end_date', today)
        ),
        countRows('companies', (query) => query.eq('subscription_tier', 'trial').lt('trial_end_date', today)),
      ]);
      return {
        companies,
        users,
        locations,
        total_companies: companies,
        total_users: users,
        total_locations: locations,
        active_subscriptions: activeSubscriptions,
        active_trials: activeTrials,
        expired_trials: expiredTrials,
      };
    }

    case 'getPlatformSettings': {
      await requireLocalSuperAdmin();
      return { settings: await localPlatformSettings() };
    }

    case 'createCompany': {
      const user = await requireLocalSuperAdmin();
      const email = body.email?.trim();
      const companyName = body.companyName?.trim();
      if (!email || !companyName) throw new Error('Company name and admin email are required');
      const days = await localDefaultTrialDays();
      const { data: company, error } = await supabase
        .from('companies')
        .insert({
          name: companyName,
          admin_email: email,
          subscription_tier: 'trial',
          is_active: true,
          ...trialDates(days),
        })
        .select('*')
        .single();
      raise(error);

      await supabase.from('pending_invites').insert({
        email,
        name: body.name || '',
        role: 'admin',
        company_id: company.id,
        invited_by: user.email,
      });
      return { success: true, message: 'Company created', company };
    }

    case 'manageCompanyTrial': {
      await requireLocalSuperAdmin();
      const patch = {};
      if (body.action === 'extend_trial') {
        const { data: company, error } = await supabase
          .from('companies')
          .select('*')
          .eq('id', body.companyId)
          .single();
        raise(error);
        const base = company.trial_end_date ? new Date(company.trial_end_date) : new Date();
        base.setDate(base.getDate() + Number(body.days || 15));
        patch.trial_end_date = base.toISOString().slice(0, 10);
        patch.subscription_tier = 'trial';
      } else if (body.action === 'apply_discount') {
        const expires = new Date();
        expires.setMonth(expires.getMonth() + Number(body.discountMonths || 3));
        patch.discount_coupon = body.coupon || null;
        patch.discount_expires_at = expires.toISOString().slice(0, 10);
      } else if (body.action === 'remove_discount') {
        patch.discount_coupon = null;
        patch.discount_expires_at = null;
      } else if (body.action === 'change_tier') {
        patch.subscription_tier = body.tier;
      } else if (body.action === 'manage_features') {
        const features = Array.isArray(body.enabledFeatures) ? body.enabledFeatures : [];
        patch.enabled_features = [...new Set(features.filter((feature) => feature === 'inventory'))];
      }
      const { error } = await supabase.from('companies').update(patch).eq('id', body.companyId);
      raise(error);
      return { success: true, message: 'Company updated' };
    }

    case 'updateCompanySubscription': {
      await requireLocalSuperAdmin();
      const { error } = await supabase
        .from('companies')
        .update({ subscription_tier: body.tier })
        .eq('id', body.companyId);
      raise(error);
      return { success: true };
    }

    case 'addSuperUser': {
      const user = await requireLocalSuperAdmin();
      const email = body.email?.trim();
      if (!email) throw new Error('Email is required');
      const { data, error } = await supabase
        .from('users')
        .update({ role: 'super_admin', full_name: body.name || body.fullName || undefined })
        .ilike('email', email)
        .select('*');
      raise(error);

      if (!data?.length) {
        await supabase.from('pending_invites').insert({
          email,
          name: body.name || body.fullName || '',
          role: 'super_admin',
          invited_by: user.email,
        });
      }
      return { success: true };
    }

    case 'removeSuperUser': {
      const user = await requireLocalSuperAdmin();
      if (body.userId === user.id) throw new Error('You cannot remove your own super admin access');
      const { error } = await supabase
        .from('users')
        .update({ role: 'employee' })
        .eq('id', body.userId);
      raise(error);
      return { success: true };
    }

    case 'savePricingSettings': {
      await requireLocalSuperAdmin();
      return { success: true, settings: await upsertLocalPlatformSettings({ pricing_tiers: body.tiers || {} }) };
    }

    case 'saveTrialSettings': {
      await requireLocalSuperAdmin();
      return {
        success: true,
        settings: await upsertLocalPlatformSettings({ trial_days: Number(body.trialDays || 15) }),
      };
    }

    default:
      return null;
  }
}

async function withDefaultCompany(entityName, record = {}) {
  const clean = sanitizeRecord(record);
  if (!COMPANY_SCOPED_ENTITIES.has(entityName) || clean.company_id) return clean;
  const profile = await currentProfile();
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

  let response;
  try {
    response = await fetch(`/api/functions/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify(body || {}),
    });
  } catch (error) {
    const fallback = await localFunctionFallback(name, body);
    if (fallback) return { data: fallback };
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const responseText = await response.text().catch(() => '');
    const fallback = await localFunctionFallback(name, body);
    if (fallback) return { data: fallback };
    const route = `/api/functions/${name}`;
    const responsePreview = responseText.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (name === 'extractInvoiceImage') {
      const message = [
        `Invoice AI route returned ${contentType || 'no content type'} instead of JSON`,
        `(HTTP ${response.status})`,
        responsePreview ? `Response started with: ${responsePreview}` : '',
        isLocalDevHost() ? 'Stop and restart npm run dev, then retry AI.' : '',
      ].filter(Boolean).join('. ');
      console.error(`${message} Route: ${route}`);
      throw new Error(message);
    }
    if (isLocalDevHost()) {
      const message = `Local function route ${route} returned ${contentType || 'no content type'} instead of JSON. Stop and restart npm run dev.`;
      console.error(`${message} Response started with: ${responsePreview || '(empty response)'}`);
      throw new Error(message);
    }
    throw new Error(`Function ${name} did not return JSON`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 404 ? await localFunctionFallback(name, body) : null;
    if (fallback) return { data: fallback };
    if (isLocalDevHost() && name === 'extractInvoiceImage' && response.status === 404) {
      throw new Error('Local invoice AI route was not found. Stop and restart npm run dev, then retry AI.');
    }
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
