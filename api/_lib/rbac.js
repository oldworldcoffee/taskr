// RBAC backend: custom roles + the per-(user, location, module) access matrix.
// All writes run on the service-role client (RLS bypassed), so these handlers
// enforce company scoping and the manager/admin guard themselves.
//
// See plan joyful-soaring-wren.md. Module access for a (user, location) resolves
// in SQL (has_module_access); these endpoints power the admin UI that reads and
// writes the underlying roles / role_module_defaults / user_location_module_access
// rows, and keep users.feature_permissions as a flattened "enabled anywhere"
// compatibility shadow during the transition window.

import { httpError, requireManagerOrAdmin } from './taskr.js';

const MODULES = ['task_checklist', 'inventory', 'roastery', 'financial'];
const BASE_ROLES = ['employee', 'supervisor', 'manager', 'admin', 'super_admin'];
const AUTO_GRANT_ROLES = new Set(['manager', 'admin', 'super_admin']);

// Action-level permission keys per module (stored in the `perms` jsonb on
// matrix rows and role templates). Modules absent here have none.
export const MODULE_PERM_KEYS = {
  roastery: ['view_production', 'manage_production', 'inventory_adjustments', 'reporting'],
  inventory: ['take_inventory', 'place_orders', 'intake_invoices', 'manage_pools', 'manage_catalog'],
};

const RBAC_FUNCTIONS = new Set([
  'getRoles',
  'saveRole',
  'deleteRole',
  'getUserModuleAccess',
  'saveUserModuleAccess',
]);

export function isRbacFunction(name) {
  return RBAC_FUNCTIONS.has(name);
}

function requireCompany(user) {
  if (!user?.company_id) throw httpError(400, 'No company associated with your account');
  return user.company_id;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'role';
}

function cleanPerms(module, input) {
  const keys = MODULE_PERM_KEYS[module];
  if (!keys) return {};
  const perms = {};
  for (const key of keys) perms[key] = Boolean(input?.[key]);
  return perms;
}

function fullPerms(module) {
  const keys = MODULE_PERM_KEYS[module];
  if (!keys) return {};
  return Object.fromEntries(keys.map((k) => [k, true]));
}

// Load the target user, ensuring the caller can manage them (same company, or
// super admin). Returns the raw users row.
async function loadManagedUser(client, caller, userId) {
  if (!userId) throw httpError(400, 'userId is required');
  const { data, error } = await client.from('users').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, 'User not found');
  if (caller.role !== 'super_admin' && data.company_id !== caller.company_id) {
    throw httpError(403, 'That user is not in your company');
  }
  return data;
}

// Resolve a user's effective base role and module-default template.
async function loadRoleTemplate(client, targetUser) {
  let roleRow = null;
  if (targetUser.role_id) {
    const { data } = await client.from('roles').select('*').eq('id', targetUser.role_id).maybeSingle();
    roleRow = data || null;
  }
  if (!roleRow) {
    const { data } = await client
      .from('roles')
      .select('*')
      .is('company_id', null)
      .eq('key', targetUser.role)
      .maybeSingle();
    roleRow = data || null;
  }
  const baseRole = roleRow?.base_role || targetUser.role || 'employee';

  const defaults = {};
  if (roleRow) {
    const { data: rows } = await client
      .from('role_module_defaults')
      .select('*')
      .eq('role_id', roleRow.id);
    for (const row of rows || []) {
      defaults[row.module] = { enabled: !!row.enabled, perms: row.perms || {} };
    }
  }
  return { roleRow, baseRole, defaults };
}

// Recompute users.feature_permissions from the matrix as a flattened
// "enabled at any location" view, for legacy SQL reads / pre-Phase-4 frontend.
async function syncFeaturePermissionShadow(client, userId) {
  const { data: rows, error } = await client
    .from('user_location_module_access')
    .select('module, enabled, perms')
    .eq('user_id', userId);
  if (error) throw error;

  const anyEnabled = (mod) => (rows || []).some((r) => r.module === mod && r.enabled);
  const roastery = { enabled: anyEnabled('roastery') };
  for (const key of MODULE_PERM_KEYS.roastery) {
    roastery[key] = (rows || []).some((r) => r.module === 'roastery' && r.enabled && r.perms?.[key]);
  }

  const featurePermissions = {
    inventory: anyEnabled('inventory'),
    financial: anyEnabled('financial'),
    roastery,
  };

  const { error: updateError } = await client
    .from('users')
    .update({ feature_permissions: featurePermissions })
    .eq('id', userId);
  if (updateError) throw updateError;
}

async function getRoles(client, user) {
  requireManagerOrAdmin(user);
  const companyId = requireCompany(user);

  const { data: roles, error } = await client
    .from('roles')
    .select('*')
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order('sort_order');
  if (error) throw error;

  const roleIds = (roles || []).map((r) => r.id);
  const defaultsByRole = {};
  if (roleIds.length) {
    const { data: defaults, error: defaultsError } = await client
      .from('role_module_defaults')
      .select('*')
      .in('role_id', roleIds);
    if (defaultsError) throw defaultsError;
    for (const row of defaults || []) {
      (defaultsByRole[row.role_id] ||= {})[row.module] = {
        enabled: !!row.enabled,
        perms: row.perms || {},
      };
    }
  }

  return {
    roles: (roles || []).map((role) => ({
      ...role,
      modules: defaultsByRole[role.id] || {},
    })),
  };
}

async function saveRole(client, user, body) {
  requireManagerOrAdmin(user);
  const companyId = requireCompany(user);

  const label = String(body.label || '').trim();
  if (!label) throw httpError(400, 'Role name is required');

  const baseRole = body.base_role;
  if (!BASE_ROLES.includes(baseRole)) throw httpError(400, 'Invalid base role');
  if (baseRole === 'super_admin') throw httpError(400, 'Custom roles cannot use the super admin base role');
  if (user.role === 'manager' && baseRole === 'admin') {
    throw httpError(403, 'Managers cannot create admin-level roles');
  }

  const modules = Array.isArray(body.modules) ? body.modules : [];

  let roleId = body.id || null;
  if (roleId) {
    // Editing an existing custom role — must belong to this company and not be a system role.
    const { data: existing, error } = await client.from('roles').select('*').eq('id', roleId).maybeSingle();
    if (error) throw error;
    if (!existing) throw httpError(404, 'Role not found');
    if (existing.is_system || existing.company_id !== companyId) {
      throw httpError(403, 'That role cannot be edited');
    }
    const { error: updateError } = await client
      .from('roles')
      .update({ label, base_role: baseRole, sort_order: body.sort_order ?? existing.sort_order })
      .eq('id', roleId);
    if (updateError) throw updateError;
  } else {
    const key = `${slugify(label)}_${Math.abs(hashKey(label + companyId))}`;
    const { data: inserted, error } = await client
      .from('roles')
      .insert({
        company_id: companyId,
        key,
        label,
        is_system: false,
        base_role: baseRole,
        sort_order: body.sort_order ?? 100,
      })
      .select('*')
      .single();
    if (error) throw error;
    roleId = inserted.id;
  }

  // Upsert the module template (one row per module; missing modules default off).
  const rows = MODULES.map((module) => {
    const entry = modules.find((m) => m.module === module) || {};
    return {
      role_id: roleId,
      module,
      enabled: module === 'task_checklist' ? true : Boolean(entry.enabled),
      perms: cleanPerms(module, entry.perms),
    };
  });
  const { error: upsertError } = await client
    .from('role_module_defaults')
    .upsert(rows, { onConflict: 'role_id,module' });
  if (upsertError) throw upsertError;

  return { success: true, role_id: roleId };
}

// Stable small hash so a custom role gets a deterministic, unique-ish key.
function hashKey(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

async function deleteRole(client, user, body) {
  requireManagerOrAdmin(user);
  const companyId = requireCompany(user);
  const roleId = body.id;
  if (!roleId) throw httpError(400, 'Role id is required');

  const { data: role, error } = await client.from('roles').select('*').eq('id', roleId).maybeSingle();
  if (error) throw error;
  if (!role) throw httpError(404, 'Role not found');
  if (role.is_system || role.company_id !== companyId) {
    throw httpError(403, 'That role cannot be deleted');
  }

  const { count } = await client
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role_id', roleId);
  if ((count || 0) > 0) {
    throw httpError(409, `That role is still assigned to ${count} user(s). Reassign them first.`);
  }

  const { error: deleteError } = await client.from('roles').delete().eq('id', roleId);
  if (deleteError) throw deleteError;
  return { success: true };
}

async function getUserModuleAccess(client, user, body) {
  requireManagerOrAdmin(user);
  const targetUser = await loadManagedUser(client, user, body.userId);
  const companyId = targetUser.company_id;

  const [{ data: locations }, { data: matrixRows }, template] = await Promise.all([
    client.from('locations').select('*').eq('company_id', companyId).order('name'),
    client
      .from('user_location_module_access')
      .select('*')
      .eq('user_id', targetUser.id),
    loadRoleTemplate(client, targetUser),
  ]);

  const overrideByKey = {};
  for (const row of matrixRows || []) {
    overrideByKey[`${row.location_id}:${row.module}`] = row;
  }

  const roleAuto = AUTO_GRANT_ROLES.has(template.baseRole);

  const cells = [];
  for (const location of locations || []) {
    for (const module of MODULES) {
      const override = overrideByKey[`${location.id}:${module}`];
      const def = template.defaults[module] || { enabled: false, perms: {} };
      let source;
      let enabled;
      let perms;
      if (roleAuto) {
        source = 'role_auto';
        enabled = true;
        perms = fullPerms(module);
      } else if (override) {
        source = 'override';
        enabled = !!override.enabled;
        perms = override.perms || {};
      } else {
        source = 'role_default';
        enabled = !!def.enabled;
        perms = def.perms || {};
      }
      cells.push({
        location_id: location.id,
        module,
        enabled,
        source,
        perms,
      });
    }
  }

  return {
    user: { id: targetUser.id, full_name: targetUser.full_name, email: targetUser.email, role: targetUser.role, role_id: targetUser.role_id },
    base_role: template.baseRole,
    role_auto: roleAuto,
    locations: (locations || []).map((l) => ({ id: l.id, name: l.name })),
    modules: MODULES,
    cells,
  };
}

async function saveUserModuleAccess(client, user, body) {
  requireManagerOrAdmin(user);
  const targetUser = await loadManagedUser(client, user, body.userId);
  const companyId = targetUser.company_id;

  const entries = Array.isArray(body.entries) ? body.entries : [];

  // Validate the locations belong to this company.
  const { data: companyLocations, error: locError } = await client
    .from('locations')
    .select('id')
    .eq('company_id', companyId);
  if (locError) throw locError;
  const validLocations = new Set((companyLocations || []).map((l) => l.id));

  const toUpsert = [];
  const toDelete = [];
  for (const entry of entries) {
    if (!validLocations.has(entry.location_id)) {
      throw httpError(400, 'One or more locations are not in this company');
    }
    if (!MODULES.includes(entry.module)) {
      throw httpError(400, `Invalid module: ${entry.module}`);
    }
    if (entry.inherit) {
      toDelete.push(entry);
      continue;
    }
    toUpsert.push({
      company_id: companyId,
      user_id: targetUser.id,
      location_id: entry.location_id,
      module: entry.module,
      enabled: Boolean(entry.enabled),
      perms: cleanPerms(entry.module, entry.perms),
    });
  }

  if (toUpsert.length) {
    const { error } = await client
      .from('user_location_module_access')
      .upsert(toUpsert, { onConflict: 'user_id,location_id,module' });
    if (error) throw error;
  }

  for (const entry of toDelete) {
    const { error } = await client
      .from('user_location_module_access')
      .delete()
      .eq('user_id', targetUser.id)
      .eq('location_id', entry.location_id)
      .eq('module', entry.module);
    if (error) throw error;
  }

  await syncFeaturePermissionShadow(client, targetUser.id);

  return { success: true };
}

export async function handleRbacFunction(name, req, client, user, body) {
  switch (name) {
    case 'getRoles':
      return getRoles(client, user);
    case 'saveRole':
      return saveRole(client, user, body);
    case 'deleteRole':
      return deleteRole(client, user, body);
    case 'getUserModuleAccess':
      return getUserModuleAccess(client, user, body);
    case 'saveUserModuleAccess':
      return saveUserModuleAccess(client, user, body);
    default:
      throw httpError(404, `Unknown RBAC function: ${name}`);
  }
}

// Shared helper used by inviteUser / cleanupPendingInvite to seed a new user's
// matrix from their role template across the locations they can access.
export async function materializeMatrixFromRole(client, { userId, companyId, role, roleId, assignedLocations }) {
  if (!companyId) return;
  if (AUTO_GRANT_ROLES.has(role)) return; // managers/admins auto-grant; no rows needed

  // Resolve the template (custom role via roleId, else the system role).
  let templateRoleId = roleId || null;
  if (!templateRoleId) {
    const { data } = await client
      .from('roles')
      .select('id')
      .is('company_id', null)
      .eq('key', role)
      .maybeSingle();
    templateRoleId = data?.id || null;
  }
  if (!templateRoleId) return;

  const { data: defaults } = await client
    .from('role_module_defaults')
    .select('*')
    .eq('role_id', templateRoleId);
  const enabledModules = (defaults || []).filter(
    (d) => d.enabled && d.module !== 'task_checklist'
  );
  if (!enabledModules.length) return;

  // Which locations? assignedLocations, else every company location.
  let locationIds = Array.isArray(assignedLocations) ? assignedLocations.filter(Boolean) : [];
  if (!locationIds.length) {
    const { data: locs } = await client.from('locations').select('id').eq('company_id', companyId);
    locationIds = (locs || []).map((l) => l.id);
  }
  if (!locationIds.length) return;

  const rows = [];
  for (const locationId of locationIds) {
    for (const def of enabledModules) {
      rows.push({
        company_id: companyId,
        user_id: userId,
        location_id: locationId,
        module: def.module,
        enabled: true,
        perms: def.perms || {},
      });
    }
  }
  if (rows.length) {
    await client
      .from('user_location_module_access')
      .upsert(rows, { onConflict: 'user_id,location_id,module' });
  }
}
