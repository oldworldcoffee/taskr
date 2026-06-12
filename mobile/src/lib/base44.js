import { supabase } from './supabase';
import { API_BASE } from './config';

// Ported from the web app's src/api/base44Client.js, trimmed to the entities the
// employee daily slice uses and adapted for React Native (no window/relative
// fetch, no crypto.randomUUID for channel names).

const ENTITY_TABLES = {
  Checklist: 'checklists',
  ChecklistInstance: 'checklist_instances',
  Location: 'locations',
  Notification: 'notifications',
  Task: 'tasks',
  TaskCompletion: 'task_completions',
  TaskGroup: 'task_groups',
  Todo: 'todos',
  TodoGroup: 'todo_groups',
  TodoOccurrence: 'todo_occurrences',
  User: 'users',
};

const COMPANY_SCOPED_ENTITIES = new Set([
  'Notification',
  'Todo',
  'TodoGroup',
  'TodoOccurrence',
]);

const ARRAY_COLUMNS = new Set([
  'active_users',
  'assigned_locations',
  'assignee_emails',
  'assignee_roles',
  'delivered_channels',
  'group_ids',
  'member_emails',
  'notify_emails',
  'recurrence_days',
  'scheduled_days',
]);

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
  if (limit) query = query.limit(limit);
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

let channelSeq = 0;

function entityClient(entityName) {
  const table = ENTITY_TABLES[entityName];

  return {
    async list(sort = '-created_date', limit, fields) {
      const query = applySortAndLimit(
        supabase.from(table).select(selectColumns(fields)),
        sort,
        limit
      );
      const { data, error } = await query;
      raise(error);
      return data || [];
    },

    async filter(filters = {}, sort = '-created_date', limit, fields) {
      let query = applyFilters(
        supabase.from(table).select(selectColumns(fields)),
        filters
      );
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
      const payload = await Promise.all(
        records.map((record) => withDefaultCompany(entityName, record))
      );
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
      // crypto.randomUUID() isn't available in RN without a polyfill; a local
      // counter is enough to keep channel names unique within the app session.
      channelSeq += 1;
      const channel = supabase
        .channel(`${table}-changes-${channelSeq}`)
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
  // v1 is dev-only and the employee slice only touches one best-effort function
  // (notifyTodoCompletion). Without an API_BASE configured we no-op loudly so
  // callers' try/catch logging stays meaningful instead of crashing.
  if (!API_BASE) {
    console.warn(`Serverless function "${name}" skipped: no API_BASE configured.`);
    return { data: {} };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const body =
    payload &&
    Object.prototype.hasOwnProperty.call(payload, 'data') &&
    Object.keys(payload).length === 1
      ? payload.data
      : payload;

  const response = await fetch(`${API_BASE}/api/functions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Function ${name} failed`);
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return Boolean(session);
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

    async logout() {
      await supabase.auth.signOut();
      cachedProfile = null;
    },

    async resetPasswordRequest(email) {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email);
      raise(error);
      return data;
    },
  },

  functions: {
    invoke: invokeFunction,
  },
};
