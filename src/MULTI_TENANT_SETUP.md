# Multi-Tenant Setup

Taskr uses Supabase Auth, Supabase Postgres, Supabase Storage, and Vercel Functions.

## Roles

- `super_admin`: platform owner; can manage every company.
- `admin`: company administrator; can manage company settings, locations, users, and billing.
- `manager`: can manage operations for the company.
- `supervisor` and `employee`: use the employee-facing workflow.

## First Run

1. Apply `supabase/migrations/20260608130000_initial_taskr_schema.sql`.
2. Create a user through the app or Supabase Auth.
3. Set `INITIAL_SUPER_ADMIN_EMAIL` in Vercel/local env to your email.
4. Log in and visit `/restore-super-admin` or `/setup`.

## Data Migration

Use `/super-admin/migration` after you have super-admin access. The Supabase import/export path includes companies, locations, checklists, tasks, checklist instances, task completions, cash deposit receipts, knowledge base records, forum records, chat channels, equipment, service records, brand settings, pending invites, subscriptions, and users.

Users are exported as profiles, but auth accounts should be recreated/invited in Supabase.

## Billing

`createCheckoutSession` is available through the Vercel function facade. Add these env vars before enabling checkout:

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_1_LOCATION`
- `STRIPE_PRICE_5_LOCATIONS`
- `STRIPE_PRICE_UNLIMITED`

Add a Stripe webhook later with signature verification before relying on automated subscription updates.
