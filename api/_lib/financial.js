// Financial Management backend: Square OAuth + sales sync + module context.
// Ported from the base44 "square-link-pro" Deno functions into taskr's Node
// serverless style. Scoping is by the authenticated user's company_id (taskr
// companies replace base44 tenants). Square tokens live in financial_settings
// and never leave this module — financialGetContext strips them.

import { httpError, originFor, requireManagerOrAdmin } from './taskr.js';

const FINANCIAL_FUNCTIONS = new Set([
  'financialGetContext',
  'financialSquareOAuth',
  'financialSquareSalesData',
  'financialDailySalesActual',
  'financialToggleLocation',
]);

const FINANCIAL_ALIASES = {
  getFinancialContext: 'financialGetContext',
  getTenantContext: 'financialGetContext',
  squareOAuth: 'financialSquareOAuth',
  squareSalesData: 'financialSquareSalesData',
  getDailySalesActual: 'financialDailySalesActual',
  toggleLocation: 'financialToggleLocation',
};

const SQUARE_VERSION = '2024-01-18';

function normalizeFinancialFunction(name) {
  return FINANCIAL_ALIASES[name] || name;
}

export function isFinancialFunction(name) {
  return FINANCIAL_FUNCTIONS.has(normalizeFinancialFunction(name));
}

function squareBaseUrl() {
  const env = (process.env.SQUARE_ENV || 'production').toLowerCase();
  return env === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

function squareRedirectUri(req) {
  const base = process.env.APP_BASE_URL || originFor(req);
  return `${base.replace(/\/$/, '')}/dashboard/financial/square-callback`;
}

function requireCompany(user) {
  if (!user?.company_id) throw httpError(400, 'No company associated with your account');
  return user.company_id;
}

async function getSettingsRow(client, companyId) {
  const { data, error } = await client
    .from('financial_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function upsertSettings(client, companyId, patch) {
  const existing = await getSettingsRow(client, companyId);
  if (existing) {
    const { data, error } = await client
      .from('financial_settings')
      .update({ ...patch, updated_date: new Date().toISOString() })
      .eq('company_id', companyId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await client
    .from('financial_settings')
    .insert({ company_id: companyId, ...patch })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function stripTokens(settings) {
  if (!settings) return null;
  const { square_access_token, square_refresh_token, ...safe } = settings;
  return { ...safe, square_connected: Boolean(settings.square_connected) };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
async function financialGetContext(client, user) {
  const companyId = requireCompany(user);

  const [settings, locationsRes, laborRes] = await Promise.all([
    getSettingsRow(client, companyId),
    client.from('locations').select('*').eq('company_id', companyId),
    client.from('financial_labor_settings').select('*').eq('company_id', companyId),
  ]);
  if (locationsRes.error) throw locationsRes.error;
  if (laborRes.error) throw laborRes.error;

  return {
    settings: stripTokens(settings) || { company_id: companyId, square_connected: false },
    locations: locationsRes.data || [],
    laborSettings: laborRes.data || [],
  };
}

// ---------------------------------------------------------------------------
// Square OAuth
// ---------------------------------------------------------------------------
async function syncSquareLocations(client, companyId, accessToken) {
  const locRes = await fetch(`${squareBaseUrl()}/v2/locations`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': SQUARE_VERSION },
  });
  const locData = await locRes.json();
  const squareLocations = locData.locations || [];

  const { data: existing, error } = await client
    .from('locations')
    .select('*')
    .eq('company_id', companyId);
  if (error) throw error;
  const existingList = existing || [];

  let matched = 0;
  let created = 0;

  for (const sq of squareLocations) {
    const byId = existingList.find((l) => l.square_location_id === sq.id);
    if (byId) {
      matched += 1;
      continue;
    }
    // Match an existing taskr location by name (case-insensitive) that isn't
    // already linked to a different Square location.
    const byName = existingList.find(
      (l) =>
        !l.square_location_id &&
        (l.name || '').trim().toLowerCase() === (sq.name || '').trim().toLowerCase()
    );
    const address = sq.address
      ? `${sq.address.address_line_1 || ''} ${sq.address.locality || ''}`.trim()
      : null;

    if (byName) {
      const { error: updateError } = await client
        .from('locations')
        .update({ square_location_id: sq.id })
        .eq('id', byName.id);
      if (updateError) throw updateError;
      byName.square_location_id = sq.id;
      matched += 1;
    } else {
      // Unmatched Square location → create it inactive so it can be reviewed.
      const { error: insertError } = await client.from('locations').insert({
        company_id: companyId,
        name: sq.name || 'Square Location',
        address,
        square_location_id: sq.id,
        location_type: 'retail',
        is_active: false,
      });
      if (insertError) throw insertError;
      created += 1;
    }
  }

  return { matched, created, total: squareLocations.length };
}

async function financialSquareOAuth(client, user, body, req) {
  const companyId = requireCompany(user);
  requireManagerOrAdmin(user);
  const action = body.action;

  const clientId = process.env.SQUARE_CLIENT_ID;
  const clientSecret = process.env.SQUARE_CLIENT_SECRET;
  const redirectUri = squareRedirectUri(req);

  if (action === 'get_auth_url') {
    if (!clientId) {
      return { error: 'Square is not configured. Add SQUARE_CLIENT_ID in Vercel.' };
    }
    const state = Buffer.from(
      JSON.stringify({ userId: user.id, company_id: companyId, ts: Date.now() })
    ).toString('base64');
    const scope = 'ORDERS_READ+PAYMENTS_READ+MERCHANT_PROFILE_READ+ITEMS_READ';
    const authUrl =
      `${squareBaseUrl()}/oauth2/authorize?client_id=${clientId}` +
      `&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}&session=false`;
    return { auth_url: authUrl };
  }

  if (action === 'exchange_code') {
    if (!clientId || !clientSecret) {
      return { error: 'Square is not configured. Add SQUARE_CLIENT_ID and SQUARE_CLIENT_SECRET in Vercel.' };
    }
    const tokenRes = await fetch(`${squareBaseUrl()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': SQUARE_VERSION },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: body.code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return {
        error: tokenData.message || tokenData.errors?.[0]?.detail || 'Square token exchange failed',
      };
    }

    let merchantId = '';
    try {
      const merchantRes = await fetch(`${squareBaseUrl()}/v2/merchants/me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Square-Version': SQUARE_VERSION },
      });
      const merchantData = await merchantRes.json();
      merchantId = merchantData.merchant?.id || '';
    } catch {
      merchantId = '';
    }

    await upsertSettings(client, companyId, {
      square_access_token: tokenData.access_token,
      square_refresh_token: tokenData.refresh_token || '',
      square_token_expires_at: tokenData.expires_at || '',
      square_merchant_id: merchantId,
      square_connected: true,
    });

    const sync = await syncSquareLocations(client, companyId, tokenData.access_token);
    return { success: true, locations_count: sync.total, sync };
  }

  if (action === 'disconnect') {
    await upsertSettings(client, companyId, {
      square_access_token: '',
      square_refresh_token: '',
      square_token_expires_at: '',
      square_merchant_id: '',
      square_connected: false,
    });
    return { success: true };
  }

  throw httpError(400, 'Unknown Square action');
}

// ---------------------------------------------------------------------------
// Sales helpers
// ---------------------------------------------------------------------------
async function requireSquareToken(client, companyId) {
  const settings = await getSettingsRow(client, companyId);
  if (!settings?.square_connected || !settings.square_access_token) {
    throw httpError(400, 'Square not connected');
  }
  return settings.square_access_token;
}

async function fetchOrders(token, locationId, startIso, endIso) {
  const orders = [];
  let cursor = null;
  do {
    const orderBody = {
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { closed_at: { start_at: startIso, end_at: endIso } },
          state_filter: { states: ['COMPLETED', 'OPEN'] },
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' },
      },
      limit: 500,
    };
    if (cursor) orderBody.cursor = cursor;

    const res = await fetch(`${squareBaseUrl()}/v2/orders/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderBody),
    });
    const data = await res.json();
    if (!res.ok) {
      throw httpError(400, data.errors?.[0]?.detail || 'Square Orders API error');
    }
    if (data.orders) orders.push(...data.orders);
    cursor = data.cursor || null;
  } while (cursor);
  return orders;
}

// Net Sales per order = total - tip - tax + discount (matches Square "Net Sales").
function netAmount(order) {
  const total = order.total_money?.amount || 0;
  const tip = order.total_tip_money?.amount || 0;
  const tax = order.total_tax_money?.amount || 0;
  const discount = order.total_discount_money?.amount || 0;
  return (total - tip - tax + discount) / 100;
}

function localParts(dateStr, tz) {
  const local = new Date(new Date(dateStr).toLocaleString('en-US', { timeZone: tz }));
  return { dow: local.getDay(), hour: local.getHours() };
}

function summarizeByDayHour(orders, startDate, tz, { trim }) {
  const getWeekIndex = (dateStr) =>
    Math.floor((new Date(dateStr) - startDate) / (7 * 24 * 60 * 60 * 1000));

  const weekTotals = {};
  const weekDayHour = {};
  const weeksSeen = new Set();

  for (const o of orders) {
    const amt = netAmount(o);
    const wk = getWeekIndex(o.closed_at);
    const { dow, hour } = localParts(o.closed_at, tz);
    const dateKey = new Date(o.closed_at).toLocaleDateString('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    weeksSeen.add(wk);
    weekTotals[wk] = (weekTotals[wk] || 0) + amt;
    weekDayHour[wk] = weekDayHour[wk] || {};
    weekDayHour[wk][dow] = weekDayHour[wk][dow] || { hours: {}, dates: new Set() };
    weekDayHour[wk][dow].hours[hour] = (weekDayHour[wk][dow].hours[hour] || 0) + amt;
    weekDayHour[wk][dow].dates.add(dateKey);
  }

  const weekIndices = Object.keys(weekTotals).map(Number);
  let weeksToUse = weekIndices;
  if (trim && weekIndices.length >= 3) {
    const sorted = [...weekIndices].sort((a, b) => weekTotals[a] - weekTotals[b]);
    weeksToUse = sorted.slice(1, sorted.length - 1);
  }

  const dayHourAccum = {};
  const dayCounts = {};
  for (const wk of weeksToUse) {
    for (const dow of Object.keys(weekDayHour[wk] || {})) {
      dayHourAccum[dow] = dayHourAccum[dow] || {};
      dayCounts[dow] = dayCounts[dow] || new Set();
      const dowData = weekDayHour[wk][dow];
      for (const hr of Object.keys(dowData.hours)) {
        dayHourAccum[dow][hr] = (dayHourAccum[dow][hr] || 0) + dowData.hours[hr];
      }
      for (const date of dowData.dates) dayCounts[dow].add(date);
    }
  }

  const byDayHour = {};
  let totalSales = 0;
  const hourlyTotals = {};
  const daysWithSales = new Set();
  for (const dow of Object.keys(dayHourAccum)) {
    const actualCount = dayCounts[dow].size || 1;
    for (const hr of Object.keys(dayHourAccum[dow])) {
      const avg = dayHourAccum[dow][hr] / actualCount;
      byDayHour[`${dow}-${hr}`] = avg;
      totalSales += avg;
      hourlyTotals[hr] = (hourlyTotals[hr] || 0) + avg;
      daysWithSales.add(dow);
    }
  }

  return {
    by_day_hour: byDayHour,
    avg_daily_sales: totalSales / (daysWithSales.size || 1),
    peak_hourly_avg: Math.max(...Object.values(hourlyTotals), 0),
    weeks_used: trim ? weeksToUse.length : weeksSeen.size,
    total_weeks: weekIndices.length,
  };
}

function quarterRange(quarter, now) {
  const prevYear = now.getFullYear() - 1;
  const month = now.getMonth();
  const fallback =
    month < 3 ? 'Q1' : month < 6 ? 'Q2' : month < 9 ? 'Q3' : 'Q4';
  const q = ['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter) ? quarter : fallback;
  const ranges = {
    Q1: [new Date(prevYear, 0, 1), new Date(prevYear, 2, 31, 23, 59, 59)],
    Q2: [new Date(prevYear, 3, 1), new Date(prevYear, 5, 30, 23, 59, 59)],
    Q3: [new Date(prevYear, 6, 1), new Date(prevYear, 8, 30, 23, 59, 59)],
    Q4: [new Date(prevYear, 9, 1), new Date(prevYear, 11, 31, 23, 59, 59)],
  };
  return { label: q, start: ranges[q][0], end: ranges[q][1] };
}

async function financialSquareSalesData(client, user, body) {
  const companyId = requireCompany(user);
  const { location_id, metric, quarter, force_refresh } = body;
  const tz = body.timezone || 'America/Los_Angeles';
  const token = await requireSquareToken(client, companyId);
  const now = new Date();

  const resolved = metric === 'quarterly' ? quarterRange(quarter, now) : null;
  const periodStartKey = metric === 'quarterly' ? resolved.label : null;

  if (!force_refresh) {
    let cacheQuery = client
      .from('financial_sales_cache')
      .select('*')
      .eq('company_id', companyId)
      .eq('location_id', location_id)
      .eq('metric_type', metric);
    if (metric === 'quarterly') cacheQuery = cacheQuery.eq('period_start', periodStartKey);
    const { data: cachedRows, error } = await cacheQuery.order('cached_at', { ascending: false }).limit(1);
    if (error) throw error;
    const cache = cachedRows?.[0];
    if (cache?.cached_at) {
      const ageHours = (now.getTime() - new Date(cache.cached_at).getTime()) / (1000 * 60 * 60);
      const isFresh = metric === 'quarterly' ? ageHours < 24 * 7 : ageHours < 24;
      if (isFresh) return { ...cache.data, cached: true, cached_at: cache.cached_at };
    }
  }

  let startDate;
  let endDate;
  if (metric === 'quarterly') {
    startDate = resolved.start;
    endDate = resolved.end;
  } else {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    endDate = yesterday;
    startDate = new Date(yesterday);
    startDate.setDate(startDate.getDate() - 21);
  }

  const orders = await fetchOrders(token, location_id, startDate.toISOString(), endDate.toISOString());
  const summary = summarizeByDayHour(orders, startDate, tz, { trim: metric === 'quarterly' });
  const result = { metric_type: metric === 'quarterly' ? 'quarterly' : 'rolling_3_week', ...summary };

  const cached_at = new Date().toISOString();
  const { error: insertError } = await client.from('financial_sales_cache').insert({
    company_id: companyId,
    location_id,
    metric_type: metric,
    data: result,
    cached_at,
    period_start: metric === 'quarterly' ? periodStartKey : startDate.toISOString(),
    period_end: endDate.toISOString(),
  });
  if (insertError) throw insertError;

  return { ...result, cached: false, cached_at };
}

async function financialDailySalesActual(client, user, body) {
  const companyId = requireCompany(user);
  const { location_id } = body;
  const tz = body.timezone || 'America/Los_Angeles';
  const token = await requireSquareToken(client, companyId);

  const dateStr =
    body.date ||
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    })();

  const refDate = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(refDate);
  const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-08:00';
  const offsetMatch = offsetStr.match(/GMT([+-]\d{2}:\d{2})/);
  const offset = offsetMatch ? offsetMatch[1] : '-08:00';

  const beginTime = new Date(`${dateStr}T00:00:00${offset}`).toISOString();
  const endTime = new Date(`${dateStr}T23:59:59${offset}`).toISOString();

  const orders = await fetchOrders(token, location_id, beginTime, endTime);

  let totalGross = 0;
  let count = 0;
  const byHour = {};
  for (const o of orders) {
    const amt = netAmount(o);
    totalGross += amt;
    count += 1;
    const { hour } = localParts(o.created_at, tz);
    byHour[hour] = (byHour[hour] || 0) + amt;
  }

  return {
    date: dateStr,
    location_id,
    total_gross_sales: Math.round(totalGross * 100) / 100,
    total_refunds: 0,
    total_net_sales: Math.round(totalGross * 100) / 100,
    transaction_count: count,
    by_hour: byHour,
    begin_time: beginTime,
    end_time: endTime,
  };
}

async function financialToggleLocation(client, user, body) {
  const companyId = requireCompany(user);
  requireManagerOrAdmin(user);
  const { location_id, is_active } = body;
  if (location_id === undefined || is_active === undefined) {
    throw httpError(400, 'location_id and is_active are required');
  }
  const { data, error } = await client
    .from('locations')
    .update({ is_active })
    .eq('id', location_id)
    .eq('company_id', companyId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, 'Location not found');
  return { success: true, location_id, is_active };
}

export async function handleFinancialFunction(name, req, client, user, body) {
  switch (normalizeFinancialFunction(name)) {
    case 'financialGetContext':
      return financialGetContext(client, user);
    case 'financialSquareOAuth':
      return financialSquareOAuth(client, user, body, req);
    case 'financialSquareSalesData':
      return financialSquareSalesData(client, user, body);
    case 'financialDailySalesActual':
      return financialDailySalesActual(client, user, body);
    case 'financialToggleLocation':
      return financialToggleLocation(client, user, body);
    default:
      throw httpError(404, `Unknown financial function: ${name}`);
  }
}
