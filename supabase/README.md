# Supabase Setup

Run `supabase/migrations/20260608130000_initial_taskr_schema.sql` in your Supabase project SQL editor, or apply it with the Supabase CLI after installing and linking the CLI.

Required Vercel environment variables are listed in `.env.example`. Use the publishable key for `VITE_SUPABASE_PUBLISHABLE_KEY` and keep `SUPABASE_SERVICE_ROLE_KEY` server-only.

For email code verification screens, configure Supabase Auth email templates to include the OTP token. Google login also needs the Google provider enabled in Supabase Auth and matching redirect URLs for localhost and your Vercel domain.

Stripe checkout is scaffolded through `/api/functions/createCheckoutSession`. Add the Stripe secret and price IDs before enabling billing. Stripe webhooks should be added with signature verification before relying on subscription state changes in production.
