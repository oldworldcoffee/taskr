// Supabase Edge Function: update-profile
//
// Lets an authenticated user edit their own profile (full_name, phone_number,
// avatar_url) from the mobile app. The web app does this via the Vercel
// `updateMe` serverless function, but the mobile app talks only to Supabase, and
// the `users` table RLS (`users_update_managed`) blocks employee self-update.
// This function validates the caller's JWT, then uses the service role to update
// the whitelisted columns on the caller's own row only.
//
// full_name is ALSO written to auth user_metadata, because the client resolves
// the display name from metadata first (metadata.full_name || profile.full_name).
//
// Deploy (DEV): supabase functions deploy update-profile --project-ref psxytrplryzkrlzhxrhx
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_FIELDS = ['full_name', 'phone_number', 'avatar_url'] as const;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Missing authorization' }, 401);

  // Resolve the caller from their JWT.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'Invalid session' }, 401);
  const authUser = userData.user;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return json({ error: 'No editable fields provided' }, 400);
  }

  // Update the user's own row. Match on id OR auth_user_id to cover both linkage
  // styles (mirrors the users_select / users_insert_self RLS predicates).
  const { data: rows, error: updErr } = await admin
    .from('users')
    .update(updates)
    .or(`id.eq.${authUser.id},auth_user_id.eq.${authUser.id}`)
    .select('*');
  if (updErr) return json({ error: updErr.message }, 400);
  if (!rows || rows.length === 0) {
    return json({ error: 'Profile row not found' }, 404);
  }

  // Keep auth metadata in sync so the client (which reads metadata.full_name
  // first) reflects a name change immediately.
  if (updates.full_name !== undefined) {
    await admin.auth.admin.updateUserById(authUser.id, {
      user_metadata: {
        ...(authUser.user_metadata || {}),
        full_name: updates.full_name,
      },
    });
  }

  return json({ success: true, user: rows[0] });
});
