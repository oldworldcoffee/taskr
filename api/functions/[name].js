import {
  EXPORT_TABLES,
  IMPORT_ORDER,
  defaultTrialDays,
  httpError,
  originFor,
  readJsonBody,
  remapRecord,
  requireManagerOrAdmin,
  requireSuperAdmin,
  requireUser,
  sendJson,
  serviceClient,
  trialDates,
  upsertPlatformSettings,
  withTrialStatus,
} from '../_lib/taskr.js';
import {
  handleInventoryFunction,
  handlePublicInventoryFunction,
  isInventoryFunction,
  isPublicInventoryFunction,
} from '../_lib/inventory.js';

const PRICE_ENV = {
  '1_location': 'STRIPE_PRICE_1_LOCATION',
  '5_locations': 'STRIPE_PRICE_5_LOCATIONS',
  unlimited: 'STRIPE_PRICE_UNLIMITED',
};

const LOCATION_LIMITS = {
  trial: Infinity,
  free: 1,
  '1_location': 1,
  '5_locations': 5,
  unlimited: Infinity,
};

const COMPANY_INVITE_ROLES = new Set(['employee', 'supervisor', 'manager', 'admin']);

async function selectAll(client, table) {
  const { data, error } = await client.from(table).select('*');
  if (error) throw error;
  return data || [];
}

async function companyCounts(client, companyId) {
  const [{ count: userCount }, { count: locationCount }] = await Promise.all([
    client.from('users').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    client.from('locations').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ]);
  return { user_count: userCount || 0, location_count: locationCount || 0 };
}

async function maybeInviteUser(client, req, email, metadata = {}) {
  const redirectTo = `${originFor(req)}/`;
  const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
    data: metadata,
    redirectTo,
  });

  if (error && !/already|registered|exists/i.test(error.message || '')) {
    throw error;
  }

  return data;
}

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function cleanAssignedLocations(locations) {
  if (!Array.isArray(locations)) return [];
  return [...new Set(locations.map((id) => String(id || '').trim()).filter(Boolean))];
}

function cleanOptionalMoney(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw httpError(400, 'Cash drawer amount must be zero or greater');
  }
  return amount;
}

function companyInvitePayload(user, body) {
  if (!user.company_id) throw httpError(400, 'No company associated with your account');

  const email = cleanEmail(body.email);
  if (!email) throw httpError(400, 'Email is required');

  const role = body.role || 'employee';
  if (!COMPANY_INVITE_ROLES.has(role)) throw httpError(400, 'Invalid invite role');
  if (user.role === 'manager' && role === 'admin') {
    throw httpError(403, 'Managers cannot invite company admins');
  }

  return {
    email,
    name: String(body.name || '').trim(),
    role,
    company_id: user.company_id,
    assigned_locations: cleanAssignedLocations(body.assigned_locations),
    invited_by: user.email,
  };
}

async function upsertPendingCompanyInvite(client, invite) {
  const { data: existing, error: readError } = await client
    .from('pending_invites')
    .select('id')
    .eq('company_id', invite.company_id)
    .ilike('email', invite.email)
    .order('created_date', { ascending: true });
  if (readError) throw readError;

  if (existing?.length) {
    const { data, error } = await client
      .from('pending_invites')
      .update(invite)
      .in('id', existing.map((row) => row.id))
      .select('*');
    if (error) throw error;
    return data?.[0] || null;
  }

  const { data, error } = await client
    .from('pending_invites')
    .insert(invite)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function validateInviteLocations(client, invite) {
  if (!invite.assigned_locations.length) return;

  const { data, error } = await client
    .from('locations')
    .select('id')
    .eq('company_id', invite.company_id)
    .in('id', invite.assigned_locations);
  if (error) throw error;

  const validIds = new Set((data || []).map((location) => location.id));
  const hasInvalidLocation = invite.assigned_locations.some((id) => !validIds.has(id));
  if (hasInvalidLocation) throw httpError(400, 'One or more locations are not available for this company');
}

async function getPlatformSettings(client) {
  const { data } = await client
    .from('platform_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();

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

async function createStripeCheckout(client, req, user, body) {
  const tier = body.tier;
  const price = process.env[PRICE_ENV[tier]];
  const secret = process.env.STRIPE_SECRET_KEY;

  if (!secret || !price) {
    return {
      error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY and Stripe price IDs in Vercel.',
    };
  }

  if (!user.company_id) {
    throw httpError(400, 'No company associated with your account');
  }

  const { data: company, error } = await client
    .from('companies')
    .select('*')
    .eq('id', user.company_id)
    .single();
  if (error) throw error;

  let customerId = company.stripe_customer_id;
  if (!customerId) {
    const customerBody = new URLSearchParams({
      email: user.email,
      name: company.name,
      'metadata[company_id]': company.id,
    });
    const customerRes = await fetch('https://api.stripe.com/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: customerBody,
    });
    const customer = await customerRes.json();
    if (!customerRes.ok) return { error: customer.error?.message || 'Stripe customer creation failed' };
    customerId = customer.id;
    await client.from('companies').update({ stripe_customer_id: customerId }).eq('id', company.id);
  }

  const origin = originFor(req);
  const sessionBody = new URLSearchParams({
    customer: customerId,
    mode: 'subscription',
    success_url: body.successUrl || `${origin}/dashboard/settings?payment=success`,
    cancel_url: body.cancelUrl || `${origin}/dashboard/settings?payment=cancelled`,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    'metadata[company_id]': company.id,
    'metadata[tier]': tier,
    'subscription_data[metadata][company_id]': company.id,
    'subscription_data[metadata][tier]': tier,
  });

  const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: sessionBody,
  });
  const session = await sessionRes.json();
  if (!sessionRes.ok) return { error: session.error?.message || 'Stripe checkout failed' };

  return { success: true, url: session.url };
}

async function handleFunction(name, req, client, user, body) {
  if (isInventoryFunction(name)) {
    return handleInventoryFunction(name, req, client, user, body);
  }

  switch (name) {
    case 'cleanupPendingInvite': {
      const email = (body.email || user.email || '').trim();
      const { data: invites, error } = await client
        .from('pending_invites')
        .select('*')
        .ilike('email', email);
      if (error) throw error;
      const invite = invites?.[0];
      if (!invite) return { success: true, user };

      const { data: updated, error: updateError } = await client
        .from('users')
        .update({
          company_id: invite.company_id,
          role: invite.role || 'employee',
          assigned_locations: invite.assigned_locations || [],
          full_name: invite.name || user.full_name,
        })
        .eq('id', user.id)
        .select('*')
        .single();
      if (updateError) throw updateError;

      await client.from('pending_invites').delete().ilike('email', email);
      return { success: true, user: updated };
    }

    case 'getCompanyUsers': {
      let query = client.from('users').select('*').order('full_name');
      if (user.role !== 'super_admin') query = query.eq('company_id', user.company_id);
      const { data, error } = await query;
      if (error) throw error;
      return { users: data || [] };
    }

    case 'inviteUser': {
      requireManagerOrAdmin(user);
      const invite = companyInvitePayload(user, body);
      await validateInviteLocations(client, invite);
      const pendingInvite = await upsertPendingCompanyInvite(client, invite);
      await maybeInviteUser(client, req, invite.email, {
        full_name: invite.name,
        role: invite.role,
        company_id: invite.company_id,
        assigned_locations: invite.assigned_locations,
      });
      return { success: true, invite: pendingInvite };
    }

    case 'updateMe': {
      const allowed = {};
      for (const key of ['avatar_url', 'phone_number', 'full_name']) {
        if (body[key] !== undefined) allowed[key] = body[key];
      }
      const { data, error } = await client
        .from('users')
        .update(allowed)
        .eq('id', user.id)
        .select('*')
        .single();
      if (error) throw error;
      return { success: true, user: data };
    }

    case 'getCompanyInfo': {
      if (!user.company_id) return { success: false, error: 'No company associated with your account' };
      const { data: company, error } = await client
        .from('companies')
        .select('*')
        .eq('id', user.company_id)
        .single();
      if (error) throw error;
      return { success: true, company: { ...withTrialStatus(company), ...(await companyCounts(client, company.id)) } };
    }

    case 'createLocation': {
      requireManagerOrAdmin(user);
      if (!user.company_id) throw httpError(400, 'No company associated with your account');
      const { data: company, error: companyError } = await client
        .from('companies')
        .select('*')
        .eq('id', user.company_id)
        .single();
      if (companyError) throw companyError;

      const { count } = await client
        .from('locations')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', user.company_id)
        .eq('is_active', true);
      const limit = LOCATION_LIMITS[company.subscription_tier] ?? Infinity;
      if (limit !== Infinity && (count || 0) >= limit) {
        return { error: 'Your current plan has reached its active location limit.' };
      }

      const { data, error } = await client
        .from('locations')
        .insert({
          company_id: user.company_id,
          name: body.name,
          address: body.address || null,
          cash_drawer_amount: cleanOptionalMoney(body.cash_drawer_amount),
          is_active: true,
        })
        .select('*')
        .single();
      if (error) throw error;
      return { success: true, location: data };
    }

    case 'selfEnroll': {
      const companyName = body.companyName?.trim();
      if (!companyName) throw httpError(400, 'Company name is required');
      const days = await defaultTrialDays(client);
      const { data: company, error } = await client
        .from('companies')
        .insert({
          name: companyName,
          admin_email: user.email,
          subscription_tier: 'trial',
          is_active: true,
          ...trialDates(days),
        })
        .select('*')
        .single();
      if (error) throw error;

      const { data: updated, error: updateError } = await client
        .from('users')
        .update({
          company_id: company.id,
          role: 'admin',
          full_name: body.fullName || user.full_name,
        })
        .eq('id', user.id)
        .select('*')
        .single();
      if (updateError) throw updateError;

      return { success: true, message: 'Company created', company, user: updated };
    }

    case 'grantFirstSuperAdmin': {
      const targetEmail = (body.targetEmail || user.email || '').trim();
      const { count } = await client
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin');

      if ((count || 0) > 0 && user.role !== 'super_admin') {
        throw httpError(403, 'A super admin already exists');
      }

      const { data, error } = await client
        .from('users')
        .update({ role: 'super_admin' })
        .ilike('email', targetEmail)
        .select('*');
      if (error) throw error;

      if (!data?.length && targetEmail === user.email) {
        const { error: selfError } = await client
          .from('users')
          .update({ role: 'super_admin' })
          .eq('id', user.id);
        if (selfError) throw selfError;
      }

      return { success: true, message: 'Super admin access granted' };
    }

    case 'restoreSuperAdminAccess': {
      if (user.role === 'super_admin') return { success: true, message: 'Already a super admin' };
      const { count } = await client
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin');
      const allowedByEnv =
        process.env.INITIAL_SUPER_ADMIN_EMAIL &&
        process.env.INITIAL_SUPER_ADMIN_EMAIL.toLowerCase() === user.email.toLowerCase();
      if ((count || 0) > 0 && !allowedByEnv) {
        throw httpError(403, 'Super admin access already belongs to another user');
      }
      await client.from('users').update({ role: 'super_admin' }).eq('id', user.id);
      return { success: true, message: 'Super admin access restored' };
    }

    case 'migrateExistingCompany': {
      requireSuperAdmin(user);
      const days = await defaultTrialDays(client);
      const { data: company, error } = await client
        .from('companies')
        .insert({
          name: body.companyName,
          admin_email: body.adminEmail,
          subscription_tier: 'trial',
          is_active: true,
          ...trialDates(days),
        })
        .select('*')
        .single();
      if (error) throw error;

      await client.from('locations').update({ company_id: company.id }).is('company_id', null);
      await client.from('users').update({ company_id: company.id, role: 'admin' }).ilike('email', body.adminEmail || user.email);
      return { success: true, message: 'Company structure created', company };
    }

    case 'getAllCompanies': {
      requireSuperAdmin(user);
      const companies = await selectAll(client, 'companies');
      const enriched = await Promise.all(
        companies.map(async (company) => ({
          ...withTrialStatus(company),
          ...(await companyCounts(client, company.id)),
        }))
      );
      return { companies: enriched };
    }

    case 'createCompany': {
      requireSuperAdmin(user);
      const email = body.email?.trim();
      const companyName = body.companyName?.trim();
      if (!email || !companyName) throw httpError(400, 'Company name and admin email are required');
      const days = await defaultTrialDays(client);
      const { data: company, error } = await client
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
      if (error) throw error;

      await maybeInviteUser(client, req, email, { full_name: body.name || '', role: 'admin' });
      await client.from('pending_invites').insert({
        email,
        name: body.name || '',
        role: 'admin',
        company_id: company.id,
        invited_by: user.email,
      });
      return { success: true, message: 'Company created', company };
    }

    case 'manageCompanyTrial': {
      requireSuperAdmin(user);
      const patch = {};
      if (body.action === 'extend_trial') {
        const { data: company, error } = await client.from('companies').select('*').eq('id', body.companyId).single();
        if (error) throw error;
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
      const { error } = await client.from('companies').update(patch).eq('id', body.companyId);
      if (error) throw error;
      return { success: true, message: 'Company updated' };
    }

    case 'updateCompanySubscription': {
      requireSuperAdmin(user);
      const { error } = await client
        .from('companies')
        .update({ subscription_tier: body.tier })
        .eq('id', body.companyId);
      if (error) throw error;
      return { success: true };
    }

    case 'getSuperAdminStats': {
      requireSuperAdmin(user);
      const [companies, users, locations] = await Promise.all([
        client.from('companies').select('id', { count: 'exact', head: true }),
        client.from('users').select('id', { count: 'exact', head: true }),
        client.from('locations').select('id', { count: 'exact', head: true }),
      ]);
      return {
        companies: companies.count || 0,
        users: users.count || 0,
        locations: locations.count || 0,
      };
    }

    case 'getSuperUsers': {
      requireSuperAdmin(user);
      const { data, error } = await client.from('users').select('*').eq('role', 'super_admin');
      if (error) throw error;
      return { users: data || [] };
    }

    case 'addSuperUser': {
      requireSuperAdmin(user);
      const email = body.email?.trim();
      if (!email) throw httpError(400, 'Email is required');
      const { data, error } = await client
        .from('users')
        .update({ role: 'super_admin', full_name: body.name || undefined })
        .ilike('email', email)
        .select('*');
      if (error) throw error;
      if (!data?.length) {
        await maybeInviteUser(client, req, email, { full_name: body.name || '' });
        await client.from('pending_invites').insert({
          email,
          name: body.name || '',
          role: 'super_admin',
          invited_by: user.email,
        });
      }
      return { success: true };
    }

    case 'removeSuperUser': {
      requireSuperAdmin(user);
      if (body.userId === user.id) throw httpError(400, 'You cannot remove your own super admin access');
      const { error } = await client.from('users').update({ role: 'employee' }).eq('id', body.userId);
      if (error) throw error;
      return { success: true };
    }

    case 'getPlatformSettings':
      requireSuperAdmin(user);
      return { settings: await getPlatformSettings(client) };

    case 'savePricingSettings':
      requireSuperAdmin(user);
      return { success: true, settings: await upsertPlatformSettings(client, { pricing_tiers: body.tiers || {} }) };

    case 'saveTrialSettings':
      requireSuperAdmin(user);
      return { success: true, settings: await upsertPlatformSettings(client, { trial_days: Number(body.trialDays || 15) }) };

    case 'createPrivateChannel':
    case 'createPrivateBoard':
    case 'createPrivateKBFolder': {
      requireManagerOrAdmin(user);
      const table =
        name === 'createPrivateChannel'
          ? 'chat_channels'
          : name === 'createPrivateBoard'
            ? 'forum_boards'
            : 'kb_folders';
      const emails = body.authorized_emails?.includes(user.email)
        ? body.authorized_emails
        : [user.email, ...(body.authorized_emails || [])];
      const payload = {
        name: body.name,
        company_id: user.company_id,
        location_id: body.location_id || null,
        authorized_emails: emails,
        ...(table !== 'kb_folders' ? { description: body.description || null, created_by_email: user.email } : {}),
      };
      const { data, error } = await client.from(table).insert(payload).select('*').single();
      if (error) throw error;
      return { success: true, item: data };
    }

    case 'createCheckoutSession':
      return createStripeCheckout(client, req, user, body);

    case 'exportAppData': {
      requireSuperAdmin(user);
      const data = {};
      await Promise.all(
        EXPORT_TABLES.map(async ([key, table]) => {
          data[key] = await selectAll(client, table);
        })
      );
      data.users = await selectAll(client, 'users');
      const summary = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
      return {
        exported_at: new Date().toISOString(),
        exported_by: user.email,
        version: 'supabase-1.0',
        data,
        summary,
      };
    }

    case 'importAppData': {
      requireSuperAdmin(user);
      const data = body.data;
      if (!data) throw httpError(400, 'No data provided');

      if (body.options?.clearExisting) {
        for (const [, table] of [...IMPORT_ORDER].reverse()) {
          await client.from(table).delete().neq('id', '__never__');
        }
      }

      const idMap = {};
      const details = {};

      for (const [key, table] of IMPORT_ORDER) {
        const rows = data[key] || [];
        const localMap = {};
        let success = 0;
        let failed = 0;
        const errors = [];

        for (const row of rows) {
          try {
            const { data: created, error } = await client
              .from(table)
              .insert(remapRecord(row, idMap, table))
              .select('*')
              .single();
            if (error) throw error;
            if (row.id) localMap[row.id] = created.id;
            success += 1;
          } catch (error) {
            failed += 1;
            errors.push(`${row.id || 'row'}: ${error.message}`);
          }
        }

        idMap[key] = { ...(idMap[key] || {}), ...localMap };
        details[key] = { success, failed, errors, skipped: rows.length === 0 };
      }

      const totalSuccess = Object.values(details).reduce((sum, result) => sum + result.success, 0);
      const totalFailed = Object.values(details).reduce((sum, result) => sum + result.failed, 0);
      return {
        success: true,
        summary: { totalSuccess, totalFailed },
        details,
        note: 'Users are not imported. Invite them in the target app.',
      };
    }

    default:
      throw httpError(404, `Unknown function: ${name}`);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, {});
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const name = Array.isArray(req.query.name) ? req.query.name[0] : req.query.name;
    const client = serviceClient();
    const body = await readJsonBody(req);
    if (isPublicInventoryFunction(name)) {
      const result = await handlePublicInventoryFunction(name, client, body || {});
      return sendJson(res, 200, result);
    }
    const { user } = await requireUser(req, client);
    const result = await handleFunction(name, req, client, user, body || {});
    return sendJson(res, 200, result);
  } catch (error) {
    const status = error.status || 500;
    return sendJson(res, status, { error: error.message || 'Server error' });
  }
}
