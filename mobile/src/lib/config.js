// Dev-only configuration for the taskr iOS app.
//
// These point at the DEV Supabase project (psxytrplryzkrlzhxrhx). The
// publishable/anon key is safe to ship in a client bundle — row-level security
// on the backend is what protects data. Do NOT put service-role keys here.
//
// When a production build is needed later, swap these (ideally via
// app.config.js + EXPO_PUBLIC_* env vars) rather than hardcoding.

export const SUPABASE_URL = 'https://psxytrplryzkrlzhxrhx.supabase.co';
export const SUPABASE_ANON_KEY =
  'sb_publishable_cwcNKviPDvOqbUY6NdysZA_tyM_cxHz';

export const SUPABASE_STORAGE_BUCKET = 'taskr-uploads';

// Optional: base URL of the deployed web app's serverless functions
// (e.g. https://app2.taskrapp.io). Left null for v1 — the only function the
// employee slice touches is best-effort todo-completion notify, which no-ops
// gracefully when this is unset.
export const API_BASE = null;
