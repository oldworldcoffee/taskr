# Taskr

Taskr is a Vite React app migrated from Base44 to Vercel and Supabase.

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in your Supabase values.
   Add `OPENAI_API_KEY` to enable scanned invoice image parsing. Without it, invoice uploads still open manual review.
3. Apply the SQL in `supabase/migrations/20260608130000_initial_taskr_schema.sql` to your Supabase project.
4. Run the app:
   ```bash
   npm run dev
   ```

For Vercel, add the same environment variables from `.env.example` in Project Settings. Keep `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` server-only.

## Notes

- The frontend still imports `base44` from `src/api/base44Client.js`, but that file is now a Supabase compatibility facade.
- Vercel server functions live in `api/functions/[name].js`.
- Supabase setup details live in `supabase/README.md`.
- Stripe checkout is scaffolded, but production subscription webhooks should be added with signature verification before billing is relied on.
