alter table public.companies
add column if not exists cash_drawer_amount double precision not null default 200;

alter table public.locations
add column if not exists cash_drawer_amount double precision;

alter table public.cash_deposit_receipts
add column if not exists drawer_amount double precision;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_cash_drawer_amount_nonnegative'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
    add constraint companies_cash_drawer_amount_nonnegative
    check (cash_drawer_amount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'locations_cash_drawer_amount_nonnegative'
      and conrelid = 'public.locations'::regclass
  ) then
    alter table public.locations
    add constraint locations_cash_drawer_amount_nonnegative
    check (cash_drawer_amount is null or cash_drawer_amount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'cash_deposit_receipts_drawer_amount_nonnegative'
      and conrelid = 'public.cash_deposit_receipts'::regclass
  ) then
    alter table public.cash_deposit_receipts
    add constraint cash_deposit_receipts_drawer_amount_nonnegative
    check (drawer_amount is null or drawer_amount >= 0);
  end if;
end $$;
