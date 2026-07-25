-- =============================================================
-- نظام إدارة الزكاة والتبرعات - مخطط Supabase / PostgreSQL
-- يشمل الجداول، العلاقات، RLS، العروض، التدقيق، والترحيل الآمن.
-- نفّذ الملف في Supabase SQL Editor على مشروع جديد.
-- =============================================================

BEGIN;

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','supervisor','accountant','distributor','data_entry','warehouse','auditor');
create type public.document_status as enum ('draft','under_review','approved','posted','cancelled');
create type public.campaign_type as enum ('cash','in_kind','mixed');
create type public.campaign_status as enum ('setup','open','closed');
create type public.beneficiary_status as enum ('draft','under_review','approved','rejected','suspended');
create type public.distributor_type as enum ('cash','in_kind','both');
create type public.donor_type as enum ('individual','organization');
create type public.receipt_status as enum ('pending','received','rejected');
create type public.distribution_type as enum ('manual','basket');
create type public.closing_type as enum ('partial','full');
create type public.closing_status as enum ('closed','reopened');
create type public.sync_status as enum ('queued','syncing','synced','failed','review');
create type public.inventory_movement_type as enum ('in','out','adjustment');

create sequence if not exists public.beneficiary_file_seq start 1;
create sequence if not exists public.cash_receipt_seq start 1;
create sequence if not exists public.cash_payment_seq start 1;
create sequence if not exists public.inkind_receipt_seq start 1;
create sequence if not exists public.inkind_payment_seq start 1;
create sequence if not exists public.closing_seq start 1;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- حسابات المستخدمين. كلمات المرور تبقى داخل Supabase Auth فقط.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null,
  username text not null unique,
  email text,
  phone text,
  role public.app_role not null default 'data_entry',
  is_active boolean not null default true,
  expires_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9._-]{3,50}$')
);
create index profiles_role_idx on public.profiles(role);
create index profiles_active_idx on public.profiles(is_active);
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create table public.role_permissions (
  role public.app_role not null,
  permission text not null,
  allowed boolean not null default true,
  primary key (role, permission)
);

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, username, email, phone, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,'user'), '@', 1)),
    coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(coalesce(new.email, new.id::text), '@', 1) || '_' || substr(new.id::text, 1, 6)),
    new.email,
    nullif(new.raw_user_meta_data->>'phone',''),
    'data_entry'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create table public.delegates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  phone text not null,
  national_id text unique,
  delegate_type public.distributor_type not null default 'both',
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index delegates_profile_idx on public.delegates(profile_id);
create trigger delegates_updated_at before update on public.delegates for each row execute function public.set_updated_at();

create table public.donors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  donor_type public.donor_type not null default 'individual',
  phone text,
  identity_no text unique,
  email text,
  is_anonymous boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index donors_name_idx on public.donors using gin (to_tsvector('simple', name));
create trigger donors_updated_at before update on public.donors for each row execute function public.set_updated_at();

create table public.beneficiary_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  priority smallint not null default 3 check (priority between 1 and 5),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger beneficiary_categories_updated_at before update on public.beneficiary_categories for each row execute function public.set_updated_at();

create table public.health_conditions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  priority smallint not null default 3 check (priority between 1 and 5),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger health_conditions_updated_at before update on public.health_conditions for each row execute function public.set_updated_at();

create table public.beneficiaries (
  id uuid primary key default gen_random_uuid(),
  file_no text not null unique default ('BEN-' || lpad(nextval('public.beneficiary_file_seq')::text, 6, '0')),
  full_name text not null,
  national_id text unique,
  phone text,
  gender text check (gender in ('male','female')),
  age smallint check (age between 0 and 120),
  marital_status text check (marital_status in ('single','married','widowed','divorced')),
  family_size smallint not null default 1 check (family_size > 0),
  category_id uuid not null references public.beneficiary_categories(id) on delete restrict,
  health_condition_id uuid references public.health_conditions(id) on delete set null,
  delegate_id uuid references public.delegates(id) on delete set null,
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  status public.beneficiary_status not null default 'under_review',
  source text,
  notes text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index beneficiaries_name_idx on public.beneficiaries using gin (to_tsvector('simple', full_name));
create index beneficiaries_phone_idx on public.beneficiaries(phone);
create index beneficiaries_status_idx on public.beneficiaries(status);
create trigger beneficiaries_updated_at before update on public.beneficiaries for each row execute function public.set_updated_at();

create table public.beneficiary_household_members (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries(id) on delete cascade,
  full_name text not null,
  relationship text,
  gender text check (gender in ('male','female')),
  birth_date date,
  national_id text,
  notes text,
  created_at timestamptz not null default now()
);
create index household_beneficiary_idx on public.beneficiary_household_members(beneficiary_id);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  campaign_type public.campaign_type not null,
  start_date date not null,
  end_date date not null,
  planned_budget numeric(18,2) not null default 0 check (planned_budget >= 0),
  ceiling numeric(18,2) not null default 0 check (ceiling >= 0),
  currency char(3) not null default 'YER',
  responsible_id uuid references public.profiles(id) on delete set null,
  status public.campaign_status not null default 'setup',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_dates_check check (end_date >= start_date)
);
create index campaigns_status_idx on public.campaigns(status);
create trigger campaigns_updated_at before update on public.campaigns for each row execute function public.set_updated_at();

create table public.cash_receipts (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null unique default ('CR-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.cash_receipt_seq')::text, 6, '0')),
  receipt_date date not null default current_date,
  donor_id uuid not null references public.donors(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  delegate_id uuid not null references public.delegates(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null default 'YER',
  method text not null check (method in ('cash','bank','exchange','online')),
  reference_no text unique,
  notes text,
  attachment_url text,
  status public.document_status not null default 'draft',
  posted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  idempotency_key uuid not null default gen_random_uuid() unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cash_receipts_campaign_idx on public.cash_receipts(campaign_id, status);
create index cash_receipts_delegate_idx on public.cash_receipts(delegate_id, status);
create index cash_receipts_donor_idx on public.cash_receipts(donor_id);
create trigger cash_receipts_updated_at before update on public.cash_receipts for each row execute function public.set_updated_at();

create table public.cash_payments (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null unique default ('CP-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.cash_payment_seq')::text, 6, '0')),
  payment_date date not null default current_date,
  delegate_id uuid not null references public.delegates(id) on delete restrict,
  beneficiary_id uuid not null references public.beneficiaries(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  cash_receipt_id uuid not null references public.cash_receipts(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null default 'YER',
  delivery_method text not null check (delivery_method in ('cash','transfer','bank')),
  receipt_status public.receipt_status not null default 'pending',
  actual_recipient text,
  transfer_no text,
  proof_url text,
  notes text,
  override_reason text,
  status public.document_status not null default 'draft',
  posted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  idempotency_key uuid not null default gen_random_uuid() unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cash_payments_campaign_idx on public.cash_payments(campaign_id, status);
create index cash_payments_delegate_idx on public.cash_payments(delegate_id, status);
create index cash_payments_beneficiary_idx on public.cash_payments(beneficiary_id, campaign_id, status);
create index cash_payments_receipt_idx on public.cash_payments(cash_receipt_id, status);
create trigger cash_payments_updated_at before update on public.cash_payments for each row execute function public.set_updated_at();

create table public.items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('ITM-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  name text not null unique,
  category text not null,
  unit text not null,
  weight_volume text,
  min_stock numeric(18,3) not null default 0 check (min_stock >= 0),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger items_updated_at before update on public.items for each row execute function public.set_updated_at();

create table public.in_kind_receipts (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null unique default ('IKR-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.inkind_receipt_seq')::text, 6, '0')),
  receipt_date date not null default current_date,
  donor_id uuid not null references public.donors(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  delegate_id uuid not null references public.delegates(id) on delete restrict,
  notes text,
  status public.document_status not null default 'draft',
  posted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  idempotency_key uuid not null default gen_random_uuid() unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inkind_receipts_campaign_idx on public.in_kind_receipts(campaign_id, status);
create trigger inkind_receipts_updated_at before update on public.in_kind_receipts for each row execute function public.set_updated_at();

create table public.in_kind_receipt_details (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.in_kind_receipts(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  quantity numeric(18,3) not null check (quantity > 0),
  valid_qty numeric(18,3) not null check (valid_qty >= 0),
  damaged_qty numeric(18,3) not null default 0 check (damaged_qty >= 0),
  lot_no text,
  expiry_date date,
  created_at timestamptz not null default now(),
  constraint receipt_qty_parts_check check (valid_qty + damaged_qty = quantity),
  constraint receipt_detail_unique unique (receipt_id, item_id, lot_no, expiry_date)
);
create index inkind_receipt_details_receipt_idx on public.in_kind_receipt_details(receipt_id);

create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  delegate_id uuid references public.delegates(id) on delete set null,
  source_receipt_detail_id uuid unique references public.in_kind_receipt_details(id) on delete restrict,
  lot_no text,
  expiry_date date,
  quantity_received numeric(18,3) not null check (quantity_received >= 0),
  quantity_damaged numeric(18,3) not null default 0 check (quantity_damaged >= 0),
  quantity_available numeric(18,3) not null check (quantity_available >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inventory_lots_item_idx on public.inventory_lots(item_id, campaign_id, expiry_date);
create trigger inventory_lots_updated_at before update on public.inventory_lots for each row execute function public.set_updated_at();

create table public.baskets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, name)
);
create trigger baskets_updated_at before update on public.baskets for each row execute function public.set_updated_at();

create table public.basket_items (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  quantity numeric(18,3) not null check (quantity > 0),
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (basket_id, item_id)
);

create table public.in_kind_payments (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null unique default ('IKP-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.inkind_payment_seq')::text, 6, '0')),
  payment_date date not null default current_date,
  beneficiary_id uuid not null references public.beneficiaries(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  delegate_id uuid not null references public.delegates(id) on delete restrict,
  distribution_type public.distribution_type not null default 'basket',
  basket_id uuid references public.baskets(id) on delete restrict,
  receipt_status public.receipt_status not null default 'pending',
  actual_recipient text,
  proof_url text,
  override_reason text,
  notes text,
  status public.document_status not null default 'draft',
  posted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  idempotency_key uuid not null default gen_random_uuid() unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint basket_required_for_basket_payment check (distribution_type <> 'basket' or basket_id is not null)
);
create index inkind_payments_beneficiary_idx on public.in_kind_payments(beneficiary_id, campaign_id, status);
create trigger inkind_payments_updated_at before update on public.in_kind_payments for each row execute function public.set_updated_at();

create table public.in_kind_payment_details (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.in_kind_payments(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  quantity numeric(18,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, item_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  quantity numeric(18,3) not null check (quantity > 0),
  source_table text not null,
  source_id uuid not null,
  source_detail_id uuid,
  reversed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index inventory_movements_source_idx on public.inventory_movements(source_table, source_id);
create index inventory_movements_lot_idx on public.inventory_movements(lot_id);

create table public.account_closings (
  id uuid primary key default gen_random_uuid(),
  closing_no text not null unique default ('CLS-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.closing_seq')::text, 6, '0')),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  donor_id uuid references public.donors(id) on delete restrict,
  cash_receipt_id uuid references public.cash_receipts(id) on delete restrict,
  total_received numeric(18,2) not null default 0,
  total_spent numeric(18,2) not null default 0,
  balance numeric(18,2) not null default 0,
  difference numeric(18,2) not null default 0,
  closing_type public.closing_type not null,
  notes text,
  closed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  closed_at timestamptz not null default now(),
  status public.closing_status not null default 'closed',
  created_at timestamptz not null default now()
);
create index account_closings_campaign_idx on public.account_closings(campaign_id, status);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments(entity_type, entity_id);

create table public.sync_queue (
  id uuid primary key default gen_random_uuid(),
  local_id text not null,
  idempotency_key uuid not null unique,
  user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  operation text not null,
  table_name text not null,
  payload jsonb not null,
  status public.sync_status not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

create table public.system_settings (
  id smallint primary key default 1 check (id = 1),
  organization_name text not null default 'مؤسسة الزكاة والتبرعات',
  system_name text not null default 'نظام إدارة الزكاة والتبرعات',
  logo_url text,
  voucher_prefixes jsonb not null default '{"cash_receipt":"CR","cash_payment":"CP","in_kind_receipt":"IKR","in_kind_payment":"IKP"}'::jsonb,
  duplicate_policy jsonb not null default '{"national_id":"block","phone":"warn","name":"warn"}'::jsonb,
  require_payment_approval boolean not null default true,
  allow_offline_drafts boolean not null default true,
  allow_final_offline boolean not null default false,
  sync_mode text not null default 'automatic' check (sync_mode in ('automatic','manual')),
  max_login_attempts integer not null default 5 check (max_login_attempts between 1 and 20),
  lockout_minutes integer not null default 15 check (lockout_minutes between 1 and 1440),
  stock_alert_days integer not null default 30 check (stock_alert_days between 0 and 365),
  currency char(3) not null default 'YER',
  print_footer text,
  retention_years integer not null default 10 check (retention_years between 1 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid()
);
insert into public.system_settings(id) values (1) on conflict (id) do nothing;
create trigger system_settings_updated_at before update on public.system_settings for each row execute function public.set_updated_at();

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  session_info jsonb not null default '{}'::jsonb,
  result text not null default 'success' check (result in ('success','failed')),
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id);

-- =============================================================
-- دوال الصلاحيات
-- =============================================================
create or replace function public.current_user_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and is_active = true and (expires_at is null or expires_at >= current_date) $$;

create or replace function public.has_role(allowed public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() = any(allowed), false) $$;

create or replace function public.current_delegate_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select id from public.delegates where profile_id = auth.uid() and is_active = true limit 1 $$;

create or replace function public.resolve_username(p_username text)
returns text
language sql stable security definer set search_path = public
as $$ select email from public.profiles where lower(username) = lower(p_username) and is_active = true and (expires_at is null or expires_at >= current_date) limit 1 $$;

-- =============================================================
-- سجل التدقيق التلقائي
-- =============================================================
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
begin
  if tg_op = 'INSERT' then
    v_old := null; v_new := to_jsonb(new); v_id := new.id;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_id := new.id;
  else
    v_old := to_jsonb(old); v_new := null; v_id := old.id;
  end if;
  insert into public.audit_logs(user_id, action, table_name, record_id, old_data, new_data, session_info, result)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_old, v_new,
    jsonb_build_object('request_id', coalesce(nullif(current_setting('request.headers', true),''),'{}')::jsonb->>'x-request-id'), 'success');
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);
end;
$$;

create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function public.audit_row_change();
create trigger audit_delegates after insert or update or delete on public.delegates for each row execute function public.audit_row_change();
create trigger audit_donors after insert or update or delete on public.donors for each row execute function public.audit_row_change();
create trigger audit_beneficiaries after insert or update or delete on public.beneficiaries for each row execute function public.audit_row_change();
create trigger audit_campaigns after insert or update or delete on public.campaigns for each row execute function public.audit_row_change();
create trigger audit_cash_receipts after insert or update or delete on public.cash_receipts for each row execute function public.audit_row_change();
create trigger audit_cash_payments after insert or update or delete on public.cash_payments for each row execute function public.audit_row_change();
create trigger audit_items after insert or update or delete on public.items for each row execute function public.audit_row_change();
create trigger audit_inkind_receipts after insert or update or delete on public.in_kind_receipts for each row execute function public.audit_row_change();
create trigger audit_baskets after insert or update or delete on public.baskets for each row execute function public.audit_row_change();
create trigger audit_inkind_payments after insert or update or delete on public.in_kind_payments for each row execute function public.audit_row_change();
create trigger audit_closings after insert or update or delete on public.account_closings for each row execute function public.audit_row_change();
create trigger audit_settings after update on public.system_settings for each row execute function public.audit_row_change();

-- =============================================================
-- دوال الترحيل النقدي
-- =============================================================
-- Compatibility fix: PostgreSQL cannot change an existing function return type with CREATE OR REPLACE.
-- Drop the previous signature before rebuilding it.
drop function if exists public.post_cash_receipt(uuid);

create or replace function public.post_cash_receipt(p_id uuid)
returns public.cash_receipts
language plpgsql security definer set search_path = public as $$
declare
  r public.cash_receipts;
  c public.campaigns;
  d public.delegates;
  v_total numeric(18,2);
begin
  if not public.has_role(array['admin','supervisor','accountant']::public.app_role[]) then raise exception 'غير مصرح بترحيل سند القبض'; end if;
  select * into r from public.cash_receipts where id = p_id for update;
  if not found then raise exception 'سند القبض غير موجود'; end if;
  if r.status = 'posted' then return r; end if;
  if r.status = 'cancelled' then raise exception 'السند ملغي'; end if;
  select * into c from public.campaigns where id = r.campaign_id for update;
  select * into d from public.delegates where id = r.delegate_id;
  if c.status <> 'open' then raise exception 'الحملة غير مفتوحة'; end if;
  if not d.is_active then raise exception 'الموزع موقوف'; end if;
  select coalesce(sum(amount),0) into v_total from public.cash_receipts where campaign_id = r.campaign_id and status = 'posted' and id <> r.id;
  if c.ceiling > 0 and v_total + r.amount > c.ceiling then raise exception 'المبلغ يتجاوز سقف الحملة'; end if;
  update public.cash_receipts set status='posted', posted_at=now() where id=p_id returning * into r;
  return r;
end;
$$;

create or replace function public.post_cash_payment(p_id uuid)
returns public.cash_payments
language plpgsql security definer set search_path = public as $$
declare
  p public.cash_payments;
  b public.beneficiaries;
  c public.campaigns;
  d public.delegates;
  r public.cash_receipts;
  v_receipt_used numeric(18,2);
  v_campaign_in numeric(18,2);
  v_campaign_out numeric(18,2);
  v_delegate_in numeric(18,2);
  v_delegate_out numeric(18,2);
  v_require_approval boolean;
begin
  if not public.has_role(array['admin','supervisor','accountant','distributor']::public.app_role[]) then raise exception 'غير مصرح بترحيل سند الصرف'; end if;
  select * into p from public.cash_payments where id=p_id for update;
  if not found then raise exception 'سند الصرف غير موجود'; end if;
  if p.status='posted' then return p; end if;
  if p.status='cancelled' then raise exception 'السند ملغي'; end if;
  select require_payment_approval into v_require_approval from public.system_settings where id=1;
  if v_require_approval and p.status <> 'approved' and public.current_user_role() = 'distributor' then raise exception 'السند يحتاج اعتماد المشرف قبل الترحيل'; end if;
  select * into b from public.beneficiaries where id=p.beneficiary_id;
  select * into c from public.campaigns where id=p.campaign_id for update;
  select * into d from public.delegates where id=p.delegate_id;
  select * into r from public.cash_receipts where id=p.cash_receipt_id for update;
  if b.status <> 'approved' then raise exception 'المستفيد غير معتمد'; end if;
  if c.status <> 'open' then raise exception 'الحملة مغلقة'; end if;
  if not d.is_active then raise exception 'الموزع موقوف'; end if;
  if r.status <> 'posted' then raise exception 'سند القبض غير مرحل'; end if;
  if r.campaign_id <> p.campaign_id or r.delegate_id <> p.delegate_id then raise exception 'سند القبض لا يطابق الحملة أو الموزع'; end if;
  if exists(select 1 from public.cash_payments x where x.id<>p.id and x.status='posted' and x.beneficiary_id=p.beneficiary_id and x.campaign_id=p.campaign_id) and nullif(trim(p.override_reason),'') is null then
    raise exception 'المستفيد استلم سابقاً من الحملة';
  end if;
  select coalesce(sum(amount),0) into v_receipt_used from public.cash_payments where cash_receipt_id=r.id and status='posted' and id<>p.id;
  if p.amount > r.amount-v_receipt_used then raise exception 'رصيد سند القبض غير كاف'; end if;
  select coalesce(sum(amount),0) into v_campaign_in from public.cash_receipts where campaign_id=p.campaign_id and status='posted';
  select coalesce(sum(amount),0) into v_campaign_out from public.cash_payments where campaign_id=p.campaign_id and status='posted' and id<>p.id;
  if p.amount > v_campaign_in-v_campaign_out then raise exception 'رصيد الحملة غير كاف'; end if;
  select coalesce(sum(amount),0) into v_delegate_in from public.cash_receipts where delegate_id=p.delegate_id and status='posted';
  select coalesce(sum(amount),0) into v_delegate_out from public.cash_payments where delegate_id=p.delegate_id and status='posted' and id<>p.id;
  if p.amount > v_delegate_in-v_delegate_out then raise exception 'رصيد الموزع غير كاف'; end if;
  update public.cash_payments set status='posted', posted_at=now() where id=p_id returning * into p;
  return p;
end;
$$;

create or replace function public.cancel_cash_receipt(p_id uuid, p_reason text)
returns public.cash_receipts language plpgsql security definer set search_path=public as $$
declare r public.cash_receipts;
begin
  if not public.has_role(array['admin','supervisor','accountant']::public.app_role[]) then raise exception 'غير مصرح'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into r from public.cash_receipts where id=p_id for update;
  if r.status='cancelled' then return r; end if;
  if exists(select 1 from public.cash_payments where cash_receipt_id=p_id and status='posted') then raise exception 'لا يمكن إلغاء سند قبض مستخدم في الصرف'; end if;
  update public.cash_receipts set status='cancelled', cancelled_at=now(), cancellation_reason=p_reason where id=p_id returning * into r;
  return r;
end; $$;

create or replace function public.cancel_cash_payment(p_id uuid, p_reason text)
returns public.cash_payments language plpgsql security definer set search_path=public as $$
declare p public.cash_payments;
begin
  if not public.has_role(array['admin','supervisor','accountant']::public.app_role[]) then raise exception 'غير مصرح'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'سبب الإلغاء مطلوب'; end if;
  update public.cash_payments set status='cancelled', cancelled_at=now(), cancellation_reason=p_reason where id=p_id returning * into p;
  return p;
end; $$;

-- =============================================================
-- دوال الترحيل العيني والمخزون
-- =============================================================
create or replace function public.post_in_kind_receipt(p_id uuid)
returns public.in_kind_receipts language plpgsql security definer set search_path=public as $$
declare
  r public.in_kind_receipts;
  c public.campaigns;
  det public.in_kind_receipt_details;
  v_lot uuid;
begin
  if not public.has_role(array['admin','supervisor','accountant','warehouse']::public.app_role[]) then raise exception 'غير مصرح'; end if;
  select * into r from public.in_kind_receipts where id=p_id for update;
  if not found then raise exception 'السند غير موجود'; end if;
  if r.status='posted' then return r; end if;
  if r.status='cancelled' then raise exception 'السند ملغي'; end if;
  select * into c from public.campaigns where id=r.campaign_id;
  if c.status <> 'open' then raise exception 'الحملة مغلقة'; end if;
  if not exists(select 1 from public.in_kind_receipt_details where receipt_id=p_id) then raise exception 'السند لا يحتوي أصنافاً'; end if;
  for det in select * from public.in_kind_receipt_details where receipt_id=p_id loop
    if det.valid_qty <= 0 then raise exception 'الكمية الصالحة يجب أن تكون أكبر من صفر'; end if;
    if det.expiry_date is not null and det.expiry_date <= current_date then raise exception 'يوجد صنف منتهي الصلاحية'; end if;
    insert into public.inventory_lots(item_id,campaign_id,delegate_id,source_receipt_detail_id,lot_no,expiry_date,quantity_received,quantity_damaged,quantity_available)
    values(det.item_id,r.campaign_id,r.delegate_id,det.id,det.lot_no,det.expiry_date,det.quantity,det.damaged_qty,det.valid_qty)
    returning id into v_lot;
    insert into public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
    values(v_lot,det.item_id,'in',det.valid_qty,'in_kind_receipts',r.id,det.id);
  end loop;
  update public.in_kind_receipts set status='posted', posted_at=now() where id=p_id returning * into r;
  return r;
end; $$;

create or replace function public.cancel_in_kind_receipt(p_id uuid, p_reason text)
returns public.in_kind_receipts language plpgsql security definer set search_path=public as $$
declare r public.in_kind_receipts; lot public.inventory_lots;
begin
  if not public.has_role(array['admin','supervisor','warehouse']::public.app_role[]) then raise exception 'غير مصرح'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into r from public.in_kind_receipts where id=p_id for update;
  if r.status='cancelled' then return r; end if;
  for lot in select l.* from public.inventory_lots l join public.in_kind_receipt_details d on d.id=l.source_receipt_detail_id where d.receipt_id=p_id for update loop
    if lot.quantity_available <> lot.quantity_received-lot.quantity_damaged then raise exception 'لا يمكن إلغاء السند لأن جزءاً من المخزون صُرف'; end if;
    update public.inventory_lots set quantity_available=0 where id=lot.id;
  end loop;
  update public.inventory_movements set reversed_at=now() where source_table='in_kind_receipts' and source_id=p_id and reversed_at is null;
  update public.in_kind_receipts set status='cancelled',cancelled_at=now(),cancellation_reason=p_reason where id=p_id returning * into r;
  return r;
end; $$;

create or replace function public.post_in_kind_payment(p_id uuid)
returns public.in_kind_payments language plpgsql security definer set search_path=public as $$
declare
  p public.in_kind_payments;
  b public.beneficiaries;
  c public.campaigns;
  det public.in_kind_payment_details;
  lot public.inventory_lots;
  v_needed numeric(18,3);
  v_take numeric(18,3);
  v_available numeric(18,3);
  v_require_approval boolean;
begin
  if not public.has_role(array['admin','supervisor','warehouse','distributor']::public.app_role[]) then raise exception 'غير مصرح'; end if;
  select * into p from public.in_kind_payments where id=p_id for update;
  if not found then raise exception 'السند غير موجود'; end if;
  if p.status='posted' then return p; end if;
  if p.status='cancelled' then raise exception 'السند ملغي'; end if;
  select require_payment_approval into v_require_approval from public.system_settings where id=1;
  if v_require_approval and p.status <> 'approved' and public.current_user_role()='distributor' then raise exception 'السند يحتاج اعتماد المشرف'; end if;
  select * into b from public.beneficiaries where id=p.beneficiary_id;
  select * into c from public.campaigns where id=p.campaign_id;
  if b.status <> 'approved' then raise exception 'المستفيد غير معتمد'; end if;
  if c.status <> 'open' then raise exception 'الحملة مغلقة'; end if;
  if exists(select 1 from public.in_kind_payments x where x.id<>p.id and x.status='posted' and x.beneficiary_id=p.beneficiary_id and x.campaign_id=p.campaign_id and (p.basket_id is null or x.basket_id=p.basket_id)) and nullif(trim(p.override_reason),'') is null then
    raise exception 'المستفيد استلم السلة سابقاً';
  end if;
  if p.distribution_type='basket' and not exists(select 1 from public.in_kind_payment_details where payment_id=p.id) then
    insert into public.in_kind_payment_details(payment_id,item_id,quantity)
    select p.id, bi.item_id, bi.quantity from public.basket_items bi join public.baskets bs on bs.id=bi.basket_id where bi.basket_id=p.basket_id and bs.is_active=true;
  end if;
  if not exists(select 1 from public.in_kind_payment_details where payment_id=p.id) then raise exception 'السند لا يحتوي أصنافاً'; end if;
  for det in select * from public.in_kind_payment_details where payment_id=p.id loop
    select coalesce(sum(quantity_available),0) into v_available from public.inventory_lots
      where item_id=det.item_id and campaign_id=p.campaign_id and quantity_available>0 and (expiry_date is null or expiry_date>current_date);
    if v_available < det.quantity then raise exception 'المخزون غير كاف للصنف %، المتاح %', det.item_id, v_available; end if;
    v_needed := det.quantity;
    for lot in select * from public.inventory_lots where item_id=det.item_id and campaign_id=p.campaign_id and quantity_available>0 and (expiry_date is null or expiry_date>current_date) order by expiry_date nulls last, created_at for update loop
      exit when v_needed<=0;
      v_take := least(v_needed, lot.quantity_available);
      update public.inventory_lots set quantity_available=quantity_available-v_take where id=lot.id;
      insert into public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
      values(lot.id,det.item_id,'out',v_take,'in_kind_payments',p.id,det.id);
      v_needed := v_needed-v_take;
    end loop;
  end loop;
  update public.in_kind_payments set status='posted',posted_at=now() where id=p_id returning * into p;
  return p;
end; $$;

create or replace function public.cancel_in_kind_payment(p_id uuid, p_reason text)
returns public.in_kind_payments language plpgsql security definer set search_path=public as $$
declare p public.in_kind_payments; mv public.inventory_movements;
begin
  if not public.has_role(array['admin','supervisor','warehouse']::public.app_role[]) then raise exception 'غير مصرح'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into p from public.in_kind_payments where id=p_id for update;
  if p.status='cancelled' then return p; end if;
  for mv in select * from public.inventory_movements where source_table='in_kind_payments' and source_id=p_id and movement_type='out' and reversed_at is null for update loop
    update public.inventory_lots set quantity_available=quantity_available+mv.quantity where id=mv.lot_id;
    update public.inventory_movements set reversed_at=now() where id=mv.id;
  end loop;
  update public.in_kind_payments set status='cancelled',cancelled_at=now(),cancellation_reason=p_reason where id=p_id returning * into p;
  return p;
end; $$;

-- =============================================================
-- الإقفال
-- =============================================================
create or replace function public.prepare_account_closing()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_received numeric(18,2);
  v_spent numeric(18,2);
  v_pending integer;
begin
  if not public.has_role(array['admin','supervisor','accountant']::public.app_role[]) then raise exception 'غير مصرح بالإقفال'; end if;
  select coalesce(sum(amount),0) into v_received from public.cash_receipts where campaign_id=new.campaign_id and status='posted' and (new.donor_id is null or donor_id=new.donor_id) and (new.cash_receipt_id is null or id=new.cash_receipt_id);
  select coalesce(sum(amount),0) into v_spent from public.cash_payments where campaign_id=new.campaign_id and status='posted' and (new.cash_receipt_id is null or cash_receipt_id=new.cash_receipt_id);
  select (
    (select count(*) from public.cash_receipts where campaign_id=new.campaign_id and status not in ('posted','cancelled')) +
    (select count(*) from public.cash_payments where campaign_id=new.campaign_id and status not in ('posted','cancelled')) +
    (select count(*) from public.in_kind_receipts where campaign_id=new.campaign_id and status not in ('posted','cancelled')) +
    (select count(*) from public.in_kind_payments where campaign_id=new.campaign_id and status not in ('posted','cancelled'))
  ) into v_pending;
  if v_pending > 0 then raise exception 'توجد سندات غير مرحلة أو معلقة'; end if;
  new.total_received := v_received;
  new.total_spent := v_spent;
  new.balance := v_received-v_spent;
  new.closed_by := auth.uid();
  new.closed_at := now();
  new.status := 'closed';
  if new.closing_type='full' and abs((new.balance + coalesce(new.difference,0))) > 0.009 then raise exception 'يوجد رصيد غير معالج؛ لا يمكن الإقفال الكامل'; end if;
  return new;
end; $$;
create trigger prepare_account_closing_before before insert on public.account_closings for each row execute function public.prepare_account_closing();

create or replace function public.finish_account_closing()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.closing_type='full' then update public.campaigns set status='closed' where id=new.campaign_id; end if;
  return new;
end; $$;
create trigger finish_account_closing_after after insert on public.account_closings for each row execute function public.finish_account_closing();

create or replace function public.reopen_account_closing(p_id uuid, p_reason text default null)
returns public.account_closings language plpgsql security definer set search_path=public as $$
declare c public.account_closings;
begin
  if not public.has_role(array['admin','supervisor']::public.app_role[]) then raise exception 'غير مصرح بإعادة الفتح'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'سبب إعادة الفتح مطلوب'; end if;
  update public.account_closings set status='reopened', notes=concat_ws(E'\n',notes,'سبب إعادة الفتح: '||p_reason) where id=p_id returning * into c;
  update public.campaigns set status='open' where id=c.campaign_id;
  return c;
end; $$;

-- =============================================================
-- عروض الواجهة والتقارير (security_invoker يحافظ على RLS)
-- =============================================================
-- =============================================================
-- حذف عروض الواجهة القديمة قبل إعادة بنائها
-- هذا يجعل الملف قابلاً لإعادة التشغيل فوق أي محاولة سابقة
-- =============================================================
DROP VIEW IF EXISTS
  public.v_profiles,
  public.v_beneficiary_categories,
  public.v_health_conditions,
  public.v_campaign_cash_balances,
  public.v_delegate_cash_balances,
  public.v_delegates,
  public.v_donors,
  public.v_beneficiaries,
  public.v_campaigns,
  public.v_cash_receipts,
  public.v_cash_payments,
  public.v_items_inventory,
  public.v_inventory_lots,
  public.v_in_kind_receipts,
  public.v_baskets,
  public.v_in_kind_payments,
  public.v_account_closings,
  public.v_audit_logs,
  public.cashbox_balances,
  public.campaign_balances,
  public.v_cashboxes,
  public.v_cashbox_users,
  public.v_cash_transfers,
  public.v_delegate_advances,
  public.v_authorized_devices,
  public.v_user_sessions,
  public.v_user_archives,
  public.v_warehouses,
  public.v_stock_balances,
  public.v_bulk_disbursements,
  public.v_disbursement_results,
  public.v_distribution_assignments,
  public.v_campaign_funding,
  public.v_campaign_distributors
CASCADE;

create or replace view public.v_profiles with (security_invoker=true) as
select p.*, lower(concat_ws(' ',p.full_name,p.username,p.email,p.phone,p.role::text)) as search_text from public.profiles p;

create or replace view public.v_beneficiary_categories with (security_invoker=true) as
select c.*, lower(concat_ws(' ',c.name,c.description)) as search_text from public.beneficiary_categories c;

create or replace view public.v_health_conditions with (security_invoker=true) as
select h.*, lower(concat_ws(' ',h.name,h.description)) as search_text from public.health_conditions h;

create or replace view public.v_campaign_cash_balances with (security_invoker=true) as
select c.id,
  coalesce((select sum(r.amount) from public.cash_receipts r where r.campaign_id=c.id and r.status='posted'),0)::numeric(18,2) as received_total,
  coalesce((select sum(p.amount) from public.cash_payments p where p.campaign_id=c.id and p.status='posted'),0)::numeric(18,2) as spent_total
from public.campaigns c;

create or replace view public.v_delegate_cash_balances with (security_invoker=true) as
select d.id,
  coalesce((select sum(r.amount) from public.cash_receipts r where r.delegate_id=d.id and r.status='posted'),0)::numeric(18,2) -
  coalesce((select sum(p.amount) from public.cash_payments p where p.delegate_id=d.id and p.status='posted'),0)::numeric(18,2) as cash_balance
from public.delegates d;

create or replace view public.v_delegates with (security_invoker=true) as
select d.*, coalesce(cb.cash_balance,0) as cash_balance,
  coalesce((select sum(l.quantity_available) from public.inventory_lots l where l.delegate_id=d.id),0) as inventory_count,
  lower(concat_ws(' ',d.full_name,d.phone,d.national_id,d.delegate_type::text)) as search_text
from public.delegates d left join public.v_delegate_cash_balances cb on cb.id=d.id;

create or replace view public.v_donors with (security_invoker=true) as
select d.*,
  coalesce((select sum(r.amount) from public.cash_receipts r where r.donor_id=d.id and r.status='posted'),0)::numeric(18,2) as cash_total,
  (select count(*) from public.in_kind_receipts ir where ir.donor_id=d.id and ir.status='posted') as in_kind_total,
  lower(concat_ws(' ',d.name,d.phone,d.identity_no,d.email,d.donor_type::text)) as search_text
from public.donors d;

create or replace view public.v_beneficiaries with (security_invoker=true) as
select b.*, c.name as category_name, h.name as health_condition_name, d.full_name as delegate_name,
  lower(concat_ws(' ',b.file_no,b.full_name,b.national_id,b.phone,c.name,h.name,d.full_name,b.status::text)) as search_text
from public.beneficiaries b
join public.beneficiary_categories c on c.id=b.category_id
left join public.health_conditions h on h.id=b.health_condition_id
left join public.delegates d on d.id=b.delegate_id;

create or replace view public.v_campaigns with (security_invoker=true) as
select c.*, p.full_name as responsible_name, cb.received_total, cb.spent_total, (cb.received_total-cb.spent_total)::numeric(18,2) as balance,
 lower(concat_ws(' ',c.name,c.description,c.campaign_type::text,c.status::text,p.full_name)) as search_text
from public.campaigns c left join public.profiles p on p.id=c.responsible_id join public.v_campaign_cash_balances cb on cb.id=c.id;

create or replace view public.v_cash_receipts with (security_invoker=true) as
select r.*, d.name as donor_name, c.name as campaign_name, g.full_name as delegate_name,
  (case when r.status='posted' then r.amount-coalesce((select sum(p.amount) from public.cash_payments p where p.cash_receipt_id=r.id and p.status='posted'),0) else 0 end)::numeric(18,2) as available_balance,
  lower(concat_ws(' ',r.voucher_no,d.name,c.name,g.full_name,r.reference_no,r.method,r.status::text)) as search_text
from public.cash_receipts r join public.donors d on d.id=r.donor_id join public.campaigns c on c.id=r.campaign_id join public.delegates g on g.id=r.delegate_id;

create or replace view public.v_cash_payments with (security_invoker=true) as
select p.*, b.full_name as beneficiary_name, c.name as campaign_name, d.full_name as delegate_name, r.voucher_no as receipt_no,
  lower(concat_ws(' ',p.voucher_no,b.full_name,c.name,d.full_name,r.voucher_no,p.transfer_no,p.status::text,p.receipt_status::text)) as search_text
from public.cash_payments p join public.beneficiaries b on b.id=p.beneficiary_id join public.campaigns c on c.id=p.campaign_id join public.delegates d on d.id=p.delegate_id join public.cash_receipts r on r.id=p.cash_receipt_id;

create or replace view public.v_items_inventory with (security_invoker=true) as
select i.*,
  coalesce(sum(l.quantity_available),0) as available_qty,
  coalesce(sum(l.quantity_damaged),0) as damaged_qty,
  case when count(*) filter(where l.expiry_date is not null and l.expiry_date <= current_date + (select stock_alert_days from public.system_settings where id=1) and l.quantity_available>0)>0
    then count(*) filter(where l.expiry_date is not null and l.expiry_date <= current_date + (select stock_alert_days from public.system_settings where id=1) and l.quantity_available>0)::text || ' تشغيلة قريبة'
    else 'سليم' end as expiry_alert,
  lower(concat_ws(' ',i.name,i.category,i.unit,i.notes)) as search_text
from public.items i left join public.inventory_lots l on l.item_id=i.id group by i.id;

create or replace view public.v_inventory_lots with (security_invoker=true) as
select l.*, i.name as item_name, c.name as campaign_name, d.full_name as delegate_name,
 lower(concat_ws(' ',i.name,c.name,d.full_name,l.lot_no,l.expiry_date::text)) as search_text
from public.inventory_lots l join public.items i on i.id=l.item_id join public.campaigns c on c.id=l.campaign_id left join public.delegates d on d.id=l.delegate_id;

create or replace view public.v_in_kind_receipts with (security_invoker=true) as
select r.*, d.name as donor_name, c.name as campaign_name, g.full_name as delegate_name,
  count(rd.id) as items_count, coalesce(sum(rd.valid_qty),0) as valid_total,
  lower(concat_ws(' ',r.voucher_no,d.name,c.name,g.full_name,r.status::text)) as search_text
from public.in_kind_receipts r join public.donors d on d.id=r.donor_id join public.campaigns c on c.id=r.campaign_id join public.delegates g on g.id=r.delegate_id left join public.in_kind_receipt_details rd on rd.receipt_id=r.id
group by r.id,d.name,c.name,g.full_name;

create or replace view public.v_baskets with (security_invoker=true) as
select b.*, c.name as campaign_name, count(bi.id) as items_count,
  coalesce(min(floor(coalesce(inv.available_qty,0)/nullif(bi.quantity,0))),0) as available_sets,
  lower(concat_ws(' ',b.name,b.description,c.name)) as search_text
from public.baskets b join public.campaigns c on c.id=b.campaign_id left join public.basket_items bi on bi.basket_id=b.id
left join lateral (select coalesce(sum(l.quantity_available),0) as available_qty from public.inventory_lots l where l.item_id=bi.item_id and l.campaign_id=b.campaign_id and (l.expiry_date is null or l.expiry_date>current_date)) inv on true
group by b.id,c.name;

create or replace view public.v_in_kind_payments with (security_invoker=true) as
select p.*, b.full_name as beneficiary_name, c.name as campaign_name, d.full_name as delegate_name, bs.name as basket_name,
  count(pd.id) as items_count,
  lower(concat_ws(' ',p.voucher_no,b.full_name,c.name,d.full_name,bs.name,p.status::text,p.receipt_status::text)) as search_text
from public.in_kind_payments p join public.beneficiaries b on b.id=p.beneficiary_id join public.campaigns c on c.id=p.campaign_id join public.delegates d on d.id=p.delegate_id left join public.baskets bs on bs.id=p.basket_id left join public.in_kind_payment_details pd on pd.payment_id=p.id
group by p.id,b.full_name,c.name,d.full_name,bs.name;

create or replace view public.v_account_closings with (security_invoker=true) as
select ac.*, c.name as campaign_name, d.name as donor_name, r.voucher_no as receipt_no,
 lower(concat_ws(' ',ac.closing_no,c.name,d.name,r.voucher_no,ac.status::text,ac.closing_type::text)) as search_text
from public.account_closings ac join public.campaigns c on c.id=ac.campaign_id left join public.donors d on d.id=ac.donor_id left join public.cash_receipts r on r.id=ac.cash_receipt_id;

create or replace view public.v_audit_logs with (security_invoker=true) as
select a.*, p.full_name as user_name, p.role::text as user_role,
 lower(concat_ws(' ',p.full_name,p.role::text,a.action,a.table_name,a.record_id::text,a.result)) as search_text
from public.audit_logs a left join public.profiles p on p.id=a.user_id;

-- =============================================================
-- Row Level Security
-- =============================================================
alter table public.profiles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.delegates enable row level security;
alter table public.donors enable row level security;
alter table public.beneficiary_categories enable row level security;
alter table public.health_conditions enable row level security;
alter table public.beneficiaries enable row level security;
alter table public.beneficiary_household_members enable row level security;
alter table public.campaigns enable row level security;
alter table public.cash_receipts enable row level security;
alter table public.cash_payments enable row level security;
alter table public.items enable row level security;
alter table public.in_kind_receipts enable row level security;
alter table public.in_kind_receipt_details enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.baskets enable row level security;
alter table public.basket_items enable row level security;
alter table public.in_kind_payments enable row level security;
alter table public.in_kind_payment_details enable row level security;
alter table public.account_closings enable row level security;
alter table public.attachments enable row level security;
alter table public.sync_queue enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (id=auth.uid() or public.has_role(array['admin','supervisor','accountant','auditor']::public.app_role[]));
create policy profiles_update_admin on public.profiles for update to authenticated using (public.has_role(array['admin']::public.app_role[])) with check (public.has_role(array['admin']::public.app_role[]));
create policy profiles_admin_insert on public.profiles for insert to authenticated with check (public.has_role(array['admin']::public.app_role[]));

create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy role_permissions_admin on public.role_permissions for all to authenticated using (public.has_role(array['admin']::public.app_role[])) with check (public.has_role(array['admin']::public.app_role[]));

create policy delegates_read on public.delegates for select to authenticated using (true);
create policy delegates_write on public.delegates for all to authenticated using (public.has_role(array['admin','supervisor','accountant']::public.app_role[])) with check (public.has_role(array['admin','supervisor','accountant']::public.app_role[]));
create policy donors_read on public.donors for select to authenticated using (true);
create policy donors_write on public.donors for all to authenticated using (public.has_role(array['admin','supervisor','accountant','data_entry']::public.app_role[])) with check (public.has_role(array['admin','supervisor','accountant','data_entry']::public.app_role[]));
create policy categories_read on public.beneficiary_categories for select to authenticated using (true);
create policy categories_write on public.beneficiary_categories for all to authenticated using (public.has_role(array['admin','supervisor']::public.app_role[])) with check (public.has_role(array['admin','supervisor']::public.app_role[]));
create policy health_read on public.health_conditions for select to authenticated using (true);
create policy health_write on public.health_conditions for all to authenticated using (public.has_role(array['admin','supervisor']::public.app_role[])) with check (public.has_role(array['admin','supervisor']::public.app_role[]));

create policy beneficiaries_read on public.beneficiaries for select to authenticated using (public.has_role(array['admin','supervisor','accountant','data_entry','auditor']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy beneficiaries_insert on public.beneficiaries for insert to authenticated with check (public.has_role(array['admin','supervisor','data_entry']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy beneficiaries_update on public.beneficiaries for update to authenticated using (public.has_role(array['admin','supervisor','data_entry']::public.app_role[]) or delegate_id=public.current_delegate_id()) with check (public.has_role(array['admin','supervisor','data_entry']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy household_read on public.beneficiary_household_members for select to authenticated using (exists(select 1 from public.beneficiaries b where b.id=beneficiary_id));
create policy household_write on public.beneficiary_household_members for all to authenticated using (public.has_role(array['admin','supervisor','data_entry']::public.app_role[])) with check (public.has_role(array['admin','supervisor','data_entry']::public.app_role[]));

create policy campaigns_read on public.campaigns for select to authenticated using (true);
create policy campaigns_write on public.campaigns for all to authenticated using (public.has_role(array['admin','supervisor','accountant']::public.app_role[])) with check (public.has_role(array['admin','supervisor','accountant']::public.app_role[]));

create policy cash_receipts_read on public.cash_receipts for select to authenticated using (public.has_role(array['admin','supervisor','accountant','auditor']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy cash_receipts_insert on public.cash_receipts for insert to authenticated with check (public.has_role(array['admin','supervisor','accountant']::public.app_role[]));
create policy cash_receipts_update on public.cash_receipts for update to authenticated using (public.has_role(array['admin','supervisor','accountant']::public.app_role[]) and status<>'posted') with check (public.has_role(array['admin','supervisor','accountant']::public.app_role[]));

create policy cash_payments_read on public.cash_payments for select to authenticated using (public.has_role(array['admin','supervisor','accountant','auditor']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy cash_payments_insert on public.cash_payments for insert to authenticated with check (public.has_role(array['admin','supervisor','accountant']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy cash_payments_update on public.cash_payments for update to authenticated using ((public.has_role(array['admin','supervisor','accountant']::public.app_role[]) or delegate_id=public.current_delegate_id()) and status<>'posted') with check (public.has_role(array['admin','supervisor','accountant']::public.app_role[]) or delegate_id=public.current_delegate_id());

create policy items_read on public.items for select to authenticated using (true);
create policy items_write on public.items for all to authenticated using (public.has_role(array['admin','supervisor','warehouse']::public.app_role[])) with check (public.has_role(array['admin','supervisor','warehouse']::public.app_role[]));
create policy inkind_receipts_read on public.in_kind_receipts for select to authenticated using (public.has_role(array['admin','supervisor','accountant','warehouse','auditor']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy inkind_receipts_insert on public.in_kind_receipts for insert to authenticated with check (public.has_role(array['admin','supervisor','accountant','warehouse']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy inkind_receipts_update on public.in_kind_receipts for update to authenticated using ((public.has_role(array['admin','supervisor','accountant','warehouse']::public.app_role[]) or delegate_id=public.current_delegate_id()) and status<>'posted') with check (public.has_role(array['admin','supervisor','accountant','warehouse']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy inkind_receipt_details_read on public.in_kind_receipt_details for select to authenticated using (exists(select 1 from public.in_kind_receipts r where r.id=receipt_id));
create policy inkind_receipt_details_write on public.in_kind_receipt_details for all to authenticated using (exists(select 1 from public.in_kind_receipts r where r.id=receipt_id and r.status<>'posted' and (public.has_role(array['admin','supervisor','warehouse','accountant']::public.app_role[]) or r.delegate_id=public.current_delegate_id()))) with check (exists(select 1 from public.in_kind_receipts r where r.id=receipt_id and r.status<>'posted' and (public.has_role(array['admin','supervisor','warehouse','accountant']::public.app_role[]) or r.delegate_id=public.current_delegate_id())));

create policy inventory_lots_read on public.inventory_lots for select to authenticated using (true);
create policy inventory_movements_read on public.inventory_movements for select to authenticated using (public.has_role(array['admin','supervisor','warehouse','accountant','auditor']::public.app_role[]) or exists(select 1 from public.inventory_lots l where l.id=lot_id and l.delegate_id=public.current_delegate_id()));

create policy baskets_read on public.baskets for select to authenticated using (true);
create policy baskets_write on public.baskets for all to authenticated using (public.has_role(array['admin','supervisor','warehouse']::public.app_role[])) with check (public.has_role(array['admin','supervisor','warehouse']::public.app_role[]));
create policy basket_items_read on public.basket_items for select to authenticated using (true);
create policy basket_items_write on public.basket_items for all to authenticated using (public.has_role(array['admin','supervisor','warehouse']::public.app_role[])) with check (public.has_role(array['admin','supervisor','warehouse']::public.app_role[]));

create policy inkind_payments_read on public.in_kind_payments for select to authenticated using (public.has_role(array['admin','supervisor','warehouse','auditor']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy inkind_payments_insert on public.in_kind_payments for insert to authenticated with check (public.has_role(array['admin','supervisor','warehouse']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy inkind_payments_update on public.in_kind_payments for update to authenticated using ((public.has_role(array['admin','supervisor','warehouse']::public.app_role[]) or delegate_id=public.current_delegate_id()) and status<>'posted') with check (public.has_role(array['admin','supervisor','warehouse']::public.app_role[]) or delegate_id=public.current_delegate_id());
create policy inkind_payment_details_read on public.in_kind_payment_details for select to authenticated using (exists(select 1 from public.in_kind_payments p where p.id=payment_id));
create policy inkind_payment_details_write on public.in_kind_payment_details for all to authenticated using (exists(select 1 from public.in_kind_payments p where p.id=payment_id and p.status<>'posted' and (public.has_role(array['admin','supervisor','warehouse']::public.app_role[]) or p.delegate_id=public.current_delegate_id()))) with check (exists(select 1 from public.in_kind_payments p where p.id=payment_id and p.status<>'posted' and (public.has_role(array['admin','supervisor','warehouse']::public.app_role[]) or p.delegate_id=public.current_delegate_id())));

create policy closings_read on public.account_closings for select to authenticated using (public.has_role(array['admin','supervisor','accountant','auditor']::public.app_role[]));
create policy closings_insert on public.account_closings for insert to authenticated with check (public.has_role(array['admin','supervisor','accountant']::public.app_role[]));
create policy attachments_read on public.attachments for select to authenticated using (true);
create policy attachments_write on public.attachments for insert to authenticated with check (true);
create policy sync_own on public.sync_queue for all to authenticated using (user_id=auth.uid() or public.has_role(array['admin','supervisor']::public.app_role[])) with check (user_id=auth.uid() or public.has_role(array['admin','supervisor']::public.app_role[]));
create policy settings_read on public.system_settings for select to authenticated using (true);
create policy settings_admin on public.system_settings for update to authenticated using (public.has_role(array['admin']::public.app_role[])) with check (public.has_role(array['admin']::public.app_role[]));
create policy audit_read on public.audit_logs for select to authenticated using (public.has_role(array['admin','supervisor','auditor']::public.app_role[]));

-- لا توجد سياسات حذف للسندات المالية المرحلة أو سجل التدقيق.

-- مرفقات خاصة: يحفظ المسار باسم المستخدم ثم نوع المستند.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('zakat-attachments', 'zakat-attachments', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy zakat_attachments_insert on storage.objects for insert to authenticated
with check (bucket_id='zakat-attachments' and (storage.foldername(name))[1]=auth.uid()::text);
create policy zakat_attachments_select on storage.objects for select to authenticated
using (bucket_id='zakat-attachments' and ((storage.foldername(name))[1]=auth.uid()::text or public.has_role(array['admin','supervisor','accountant','warehouse','auditor']::public.app_role[])));
create policy zakat_attachments_update on storage.objects for update to authenticated
using (bucket_id='zakat-attachments' and ((storage.foldername(name))[1]=auth.uid()::text or public.has_role(array['admin','supervisor']::public.app_role[])))
with check (bucket_id='zakat-attachments' and ((storage.foldername(name))[1]=auth.uid()::text or public.has_role(array['admin','supervisor']::public.app_role[])));

-- صلاحيات API
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant delete on public.beneficiary_household_members, public.in_kind_receipt_details, public.basket_items, public.in_kind_payment_details to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.resolve_username(text) to anon, authenticated;
grant execute on function public.post_cash_receipt(uuid) to authenticated;
grant execute on function public.post_cash_payment(uuid) to authenticated;
grant execute on function public.cancel_cash_receipt(uuid,text) to authenticated;
grant execute on function public.cancel_cash_payment(uuid,text) to authenticated;
grant execute on function public.post_in_kind_receipt(uuid) to authenticated;
grant execute on function public.cancel_in_kind_receipt(uuid,text) to authenticated;
grant execute on function public.post_in_kind_payment(uuid) to authenticated;
grant execute on function public.cancel_in_kind_payment(uuid,text) to authenticated;
grant execute on function public.reopen_account_closing(uuid,text) to authenticated;

-- منع المستخدمين من استدعاء دوال الصلاحية الداخلية بتعديل السياق.
revoke execute on function public.current_user_role() from public;
revoke execute on function public.has_role(public.app_role[]) from public;
revoke execute on function public.current_delegate_id() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_role(public.app_role[]) to authenticated;
grant execute on function public.current_delegate_id() to authenticated;


-- =========================================================
-- V2 modules added from manager notes
-- =========================================================
create table if not exists public.branches (id uuid primary key default gen_random_uuid(), name text not null, code text unique not null, governorate text, district text, address text, manager_name text, phone text, is_active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.cashboxes (id uuid primary key default gen_random_uuid(), branch_id uuid references public.branches(id), name text not null, code text unique not null, currency text default 'YER', opening_balance numeric(18,2) default 0, current_balance numeric(18,2) default 0, responsible_name text, is_active boolean default true, notes text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.cashbox_users (id uuid primary key default gen_random_uuid(), cashbox_id uuid references public.cashboxes(id) on delete cascade, user_id uuid references public.profiles(id), delegate_id uuid references public.delegates(id), can_receive boolean default false, can_pay boolean default false, daily_limit numeric(18,2) default 0, is_active boolean default true, unique(cashbox_id,user_id,delegate_id));
create table if not exists public.cash_transfers (id uuid primary key default gen_random_uuid(), transfer_no text unique not null, transfer_date date not null, from_cashbox_id uuid references public.cashboxes(id), to_cashbox_id uuid references public.cashboxes(id), amount numeric(18,2) check(amount>0), currency text default 'YER', status text default 'draft', notes text, created_by uuid references public.profiles(id), created_at timestamptz default now());
create table if not exists public.delegate_advances (id uuid primary key default gen_random_uuid(), advance_no text unique not null, advance_date date not null, delegate_id uuid references public.delegates(id), cashbox_id uuid references public.cashboxes(id), amount numeric(18,2) check(amount>0), spent_amount numeric(18,2) default 0, remaining_amount numeric(18,2) generated always as (amount-spent_amount) stored, status text default 'open', notes text, created_at timestamptz default now());
create table if not exists public.authorized_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  device_name text not null,
  fingerprint text unique not null,
  platform text,
  status text not null default 'pending' check (status in ('pending','approved','blocked')),
  is_active boolean not null default false,
  last_seen_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

-- Compatibility for databases created by older releases.
alter table public.authorized_devices add column if not exists is_active boolean;
update public.authorized_devices
set is_active = (status = 'approved')
where is_active is null;
alter table public.authorized_devices alter column is_active set default false;
alter table public.authorized_devices alter column is_active set not null;
create table if not exists public.login_attempts (id bigserial primary key, phone text, device_fingerprint text, device_name text, ip_address inet, result text not null, attempted_at timestamptz default now(), lockout_until timestamptz);
create table if not exists public.user_sessions (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id), device_id uuid references public.authorized_devices(id), branch_id uuid references public.branches(id), login_at timestamptz default now(), last_activity_at timestamptz, logout_at timestamptz, status text default 'active');
create table if not exists public.user_archives (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id), archive_type text, title text not null, description text, reference_no text, payload jsonb, created_at timestamptz default now());
create table if not exists public.wallet_providers (id uuid primary key default gen_random_uuid(), name text not null, provider_type text not null, account_format text, export_format text default 'xlsx', is_active boolean default true, notes text, created_at timestamptz default now());
create table if not exists public.bulk_disbursements (id uuid primary key default gen_random_uuid(), batch_no text unique not null, batch_date date not null, provider_id uuid references public.wallet_providers(id), campaign_id uuid references public.campaigns(id), cashbox_id uuid references public.cashboxes(id), beneficiaries_count integer default 0, total_amount numeric(18,2) default 0, success_count integer default 0, failed_count integer default 0, status text default 'draft', notes text, created_at timestamptz default now());
create table if not exists public.disbursement_results (id uuid primary key default gen_random_uuid(), batch_id uuid references public.bulk_disbursements(id) on delete cascade, beneficiary_id uuid references public.beneficiaries(id), wallet_no text, amount numeric(18,2), provider_reference text, result text, error_message text, processed_at timestamptz);
create table if not exists public.units (id uuid primary key default gen_random_uuid(), name text unique not null, symbol text, unit_type text, is_default boolean default false, is_active boolean default true);
create table if not exists public.warehouses (id uuid primary key default gen_random_uuid(), branch_id uuid references public.branches(id), name text not null, code text unique not null, address text not null, manager_name text not null, phone text, is_active boolean default true, created_at timestamptz default now());
create table if not exists public.stock_balances (id uuid primary key default gen_random_uuid(), warehouse_id uuid references public.warehouses(id), item_id uuid references public.items(id), available_qty numeric(18,3) default 0, reserved_qty numeric(18,3) default 0, damaged_qty numeric(18,3) default 0, updated_at timestamptz default now(), unique(warehouse_id,item_id));
create table if not exists public.messages (id uuid primary key default gen_random_uuid(), recipient_type text, recipient_id uuid, recipient_name text, phone text not null, channel text not null, subject text, message text not null, status text default 'queued', provider_reference text, sent_at timestamptz, created_at timestamptz default now());
create table if not exists public.message_templates (id uuid primary key default gen_random_uuid(), name text not null, event_key text unique not null, channel text not null, body text not null, is_active boolean default true, updated_at timestamptz default now());
create table if not exists public.import_jobs (id uuid primary key default gen_random_uuid(), target_table text not null, file_name text, total_rows integer default 0, success_rows integer default 0, error_rows integer default 0, errors jsonb, status text default 'queued', created_by uuid references public.profiles(id), created_at timestamptz default now());
create table if not exists public.distribution_assignments (id uuid primary key default gen_random_uuid(), beneficiary_id uuid references public.beneficiaries(id), delegate_id uuid references public.delegates(id), campaign_id uuid references public.campaigns(id), amount numeric(18,2), area text, delivery_status text default 'pending', delivered_at timestamptz, verification_message_id uuid references public.messages(id), created_at timestamptz default now());


-- Link existing cash vouchers to cashboxes
alter table public.cash_receipts add column if not exists cashbox_id uuid references public.cashboxes(id);
alter table public.cash_payments add column if not exists cashbox_id uuid references public.cashboxes(id);
create index if not exists cash_receipts_cashbox_idx on public.cash_receipts(cashbox_id, status);
create index if not exists cash_payments_cashbox_idx on public.cash_payments(cashbox_id, status);

-- =============================================================
-- V7 CONSOLIDATED DATABASE EXTENSIONS — RUN AS PART OF THIS FILE
-- =============================================================

-- Profiles compatibility
alter table public.profiles add column if not exists role_id uuid;
alter table public.profiles add column if not exists branch_id uuid references public.branches(id);
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists status text default 'active';
create unique index if not exists profiles_phone_unique_idx on public.profiles(phone) where phone is not null;

-- Finance ledger and campaign funding
create table if not exists public.cashbox_ledger (
  id uuid primary key default gen_random_uuid(),
  cashbox_id uuid not null references public.cashboxes(id),
  transaction_type text not null check (transaction_type in ('opening','donation','campaign_funding','payment','transfer_in','transfer_out','refund','adjustment')),
  reference_table text,
  reference_id uuid,
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  currency text not null default 'YER',
  description text,
  transaction_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create unique index if not exists cashbox_ledger_reference_uq on public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id) where reference_id is not null;
create index if not exists cashbox_ledger_box_date_idx on public.cashbox_ledger(cashbox_id,transaction_at desc);

create table if not exists public.campaign_funding (
  id uuid primary key default gen_random_uuid(),
  funding_no text unique not null default ('CF-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '-' || upper(substr(gen_random_uuid()::text,1,4))),
  funding_date date not null default current_date,
  campaign_id uuid not null references public.campaigns(id),
  cashbox_id uuid not null references public.cashboxes(id),
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'YER',
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  notes text,
  posted_at timestamptz,
  posted_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_distributors (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  delegate_id uuid not null references public.delegates(id),
  cashbox_id uuid references public.cashboxes(id),
  area_name text not null,
  allocated_amount numeric(18,2) not null default 0 check (allocated_amount >= 0),
  spent_amount numeric(18,2) not null default 0 check (spent_amount >= 0),
  returned_amount numeric(18,2) not null default 0 check (returned_amount >= 0),
  remaining_amount numeric(18,2) generated always as (allocated_amount-spent_amount-returned_amount) stored,
  status text not null default 'active' check (status in ('active','settled','suspended')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) default auth.uid(),
  notes text,
  unique(campaign_id,delegate_id)
);

-- Compatibility balance views. cashbox_balances exposes created_at and all cashbox fields.
drop view if exists public.cashbox_balances cascade;
create view public.cashbox_balances with (security_invoker=true) as
select c.id,c.branch_id,c.name,c.code,c.currency,c.opening_balance,
       c.opening_balance + coalesce(sum(l.credit-l.debit),0) as current_balance,
       c.responsible_name,c.is_active,c.notes,c.created_at,c.updated_at,
       max(l.transaction_at) as last_movement_at
from public.cashboxes c
left join public.cashbox_ledger l on l.cashbox_id=c.id
group by c.id;

create or replace view public.campaign_balances with (security_invoker=true) as
select c.id,c.name,c.currency,c.status,c.created_at,
       coalesce(f.funded,0) as funded_total,
       coalesce(d.allocated,0) as allocated_total,
       coalesce(d.spent,0) as spent_total,
       coalesce(d.returned,0) as returned_total,
       coalesce(f.funded,0)-coalesce(d.allocated,0) as unallocated_balance,
       coalesce(f.funded,0)-coalesce(d.spent,0)-coalesce(d.returned,0) as operational_balance
from public.campaigns c
left join (select campaign_id,sum(amount) funded from public.campaign_funding where status='posted' group by campaign_id) f on f.campaign_id=c.id
left join (select campaign_id,sum(allocated_amount) allocated,sum(spent_amount) spent,sum(returned_amount) returned from public.campaign_distributors group by campaign_id) d on d.campaign_id=c.id;

-- Frontend contract views
create or replace view public.v_cashboxes with (security_invoker=true) as
select c.id,c.branch_id,c.name,c.code,c.currency,c.opening_balance,
       c.opening_balance + coalesce(sum(l.credit-l.debit),0) as current_balance,
       c.responsible_name,c.is_active,c.notes,c.created_at,c.updated_at,
       b.name as branch_name,
       max(l.transaction_at) as last_movement_at,
       lower(concat_ws(' ',c.name,c.code,c.currency,b.name,c.responsible_name,c.notes)) as search_text
from public.cashboxes c
left join public.branches b on b.id=c.branch_id
left join public.cashbox_ledger l on l.cashbox_id=c.id
group by c.id,b.name;

create or replace view public.v_cashbox_users with (security_invoker=true) as
select x.*, b.name cashbox_name, br.name branch_name, p.full_name user_name, d.full_name delegate_name,
 lower(concat_ws(' ',b.name,br.name,p.full_name,d.full_name)) search_text
from public.cashbox_users x join public.cashboxes b on b.id=x.cashbox_id
left join public.branches br on br.id=b.branch_id left join public.profiles p on p.id=x.user_id left join public.delegates d on d.id=x.delegate_id;

create or replace view public.v_cash_transfers with (security_invoker=true) as
select t.*, f.name from_cashbox_name, x.name to_cashbox_name,
 lower(concat_ws(' ',t.transfer_no,f.name,x.name,t.status,t.notes)) search_text
from public.cash_transfers t join public.cashboxes f on f.id=t.from_cashbox_id join public.cashboxes x on x.id=t.to_cashbox_id;

create or replace view public.v_delegate_advances with (security_invoker=true) as
select a.*, d.full_name delegate_name, b.name cashbox_name,
 lower(concat_ws(' ',a.advance_no,d.full_name,b.name,a.status,a.notes)) search_text
from public.delegate_advances a join public.delegates d on d.id=a.delegate_id join public.cashboxes b on b.id=a.cashbox_id;

create or replace view public.v_authorized_devices with (security_invoker=true) as
select d.*, p.full_name user_name,
 lower(concat_ws(' ',d.device_name,p.full_name,d.platform,d.status,d.fingerprint)) search_text
from public.authorized_devices d left join public.profiles p on p.id=d.user_id;

create or replace view public.v_user_sessions with (security_invoker=true) as
select s.*, p.full_name user_name, p.role::text role_name, d.device_name, b.name branch_name,
 lower(concat_ws(' ',p.full_name,p.role::text,d.device_name,b.name,s.status)) search_text
from public.user_sessions s left join public.profiles p on p.id=s.user_id left join public.authorized_devices d on d.id=s.device_id left join public.branches b on b.id=s.branch_id;

create or replace view public.v_user_archives with (security_invoker=true) as
select a.*, p.full_name user_name,
 lower(concat_ws(' ',p.full_name,a.archive_type,a.title,a.description,a.reference_no)) search_text
from public.user_archives a left join public.profiles p on p.id=a.user_id;

create or replace view public.v_warehouses with (security_invoker=true) as
select w.*, b.name branch_name, lower(concat_ws(' ',w.name,w.code,b.name,w.address,w.manager_name,w.phone)) search_text
from public.warehouses w left join public.branches b on b.id=w.branch_id;

create or replace view public.v_stock_balances with (security_invoker=true) as
select s.*, w.name warehouse_name, i.name item_name, i.code item_code,
 lower(concat_ws(' ',w.name,i.name,i.code)) search_text
from public.stock_balances s join public.warehouses w on w.id=s.warehouse_id join public.items i on i.id=s.item_id;

create or replace view public.v_bulk_disbursements with (security_invoker=true) as
select x.*, w.name provider_name, c.name campaign_name, b.name cashbox_name,
 lower(concat_ws(' ',x.batch_no,w.name,c.name,b.name,x.status,x.notes)) search_text
from public.bulk_disbursements x left join public.wallet_providers w on w.id=x.provider_id left join public.campaigns c on c.id=x.campaign_id left join public.cashboxes b on b.id=x.cashbox_id;

create or replace view public.v_disbursement_results with (security_invoker=true) as
select r.*, x.batch_no, b.full_name beneficiary_name,
 lower(concat_ws(' ',x.batch_no,b.full_name,r.wallet_no,r.provider_reference,r.result,r.error_message)) search_text
from public.disbursement_results r left join public.bulk_disbursements x on x.id=r.batch_id left join public.beneficiaries b on b.id=r.beneficiary_id;

create or replace view public.v_distribution_assignments with (security_invoker=true) as
select a.*, b.full_name beneficiary_name,b.phone,d.full_name delegate_name,c.name campaign_name,
 lower(concat_ws(' ',b.full_name,b.phone,d.full_name,c.name,a.area,a.delivery_status)) search_text
from public.distribution_assignments a join public.beneficiaries b on b.id=a.beneficiary_id left join public.delegates d on d.id=a.delegate_id left join public.campaigns c on c.id=a.campaign_id;

create or replace view public.v_campaign_funding with (security_invoker=true) as
select f.*, c.name campaign_name, b.name cashbox_name, p.full_name created_by_name,
 lower(concat_ws(' ',f.funding_no,c.name,b.name,p.full_name,f.status,f.notes)) search_text
from public.campaign_funding f join public.campaigns c on c.id=f.campaign_id join public.cashboxes b on b.id=f.cashbox_id left join public.profiles p on p.id=f.created_by;

create or replace view public.v_campaign_distributors with (security_invoker=true) as
select d.*, c.name campaign_name, g.full_name delegate_name, b.name cashbox_name,
 lower(concat_ws(' ',c.name,g.full_name,b.name,d.area_name,d.status,d.notes)) search_text
from public.campaign_distributors d join public.campaigns c on c.id=d.campaign_id join public.delegates g on g.id=d.delegate_id left join public.cashboxes b on b.id=d.cashbox_id;

-- Replace receipt/payment display views to include cashbox name.
-- DROP ضروري لأن إضافة cashbox_id إلى الجداول غيّرت ترتيب أعمدة r.* و p.*
DROP VIEW IF EXISTS public.v_cash_receipts CASCADE;
DROP VIEW IF EXISTS public.v_cash_payments CASCADE;

create view public.v_cash_receipts with (security_invoker=true) as
select r.*, d.name donor_name, c.name campaign_name, g.full_name delegate_name, bx.name cashbox_name,
 (case when r.status='posted' then r.amount-coalesce((select sum(p.amount) from public.cash_payments p where p.cash_receipt_id=r.id and p.status='posted'),0) else 0 end)::numeric(18,2) available_balance,
 lower(concat_ws(' ',r.voucher_no,d.name,c.name,g.full_name,bx.name,r.reference_no,r.method,r.status::text)) search_text
from public.cash_receipts r join public.donors d on d.id=r.donor_id join public.campaigns c on c.id=r.campaign_id join public.delegates g on g.id=r.delegate_id left join public.cashboxes bx on bx.id=r.cashbox_id;

create view public.v_cash_payments with (security_invoker=true) as
select p.*, b.full_name beneficiary_name, c.name campaign_name, d.full_name delegate_name, r.voucher_no receipt_no, bx.name cashbox_name,
 lower(concat_ws(' ',p.voucher_no,b.full_name,c.name,d.full_name,r.voucher_no,bx.name,p.transfer_no,p.status::text,p.receipt_status::text)) search_text
from public.cash_payments p join public.beneficiaries b on b.id=p.beneficiary_id join public.campaigns c on c.id=p.campaign_id join public.delegates d on d.id=p.delegate_id join public.cash_receipts r on r.id=p.cash_receipt_id left join public.cashboxes bx on bx.id=p.cashbox_id;

-- Posting functions. Drop first so return type can never conflict.
drop function if exists public.post_campaign_funding(uuid);
create function public.post_campaign_funding(p_funding_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v public.campaign_funding%rowtype; v_balance numeric(18,2);
begin
 select * into v from public.campaign_funding where id=p_funding_id for update;
 if not found then raise exception 'التمويل غير موجود'; end if;
 if v.status<>'draft' then raise exception 'لا يمكن ترحيل هذا التمويل'; end if;
 select current_balance into v_balance from public.v_cashboxes where id=v.cashbox_id;
 if coalesce(v_balance,0)<v.amount then raise exception 'رصيد الصندوق غير كافٍ'; end if;
 insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
 values(v.cashbox_id,'campaign_funding','campaign_funding',v.id,v.amount,0,v.currency,'تمويل حملة - '||v.funding_no,auth.uid());
 update public.campaign_funding set status='posted',posted_at=now(),posted_by=auth.uid(),updated_at=now() where id=v.id;
end $$;

drop function if exists public.assign_campaign_distributor(uuid,uuid,uuid,text,numeric,text);
create function public.assign_campaign_distributor(p_campaign_id uuid,p_delegate_id uuid,p_cashbox_id uuid,p_area_name text,p_amount numeric,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_available numeric(18,2); v_old numeric(18,2); v_id uuid;
begin
 select unallocated_balance into v_available from public.campaign_balances where id=p_campaign_id;
 if not found then raise exception 'الحملة غير موجودة'; end if;
 select allocated_amount into v_old from public.campaign_distributors where campaign_id=p_campaign_id and delegate_id=p_delegate_id;
 if coalesce(p_amount,0)-coalesce(v_old,0)>coalesce(v_available,0) then raise exception 'المبلغ يتجاوز الرصيد غير الموزع للحملة'; end if;
 insert into public.campaign_distributors(campaign_id,delegate_id,cashbox_id,area_name,allocated_amount,notes)
 values(p_campaign_id,p_delegate_id,p_cashbox_id,p_area_name,coalesce(p_amount,0),p_notes)
 on conflict(campaign_id,delegate_id) do update set cashbox_id=excluded.cashbox_id,area_name=excluded.area_name,allocated_amount=excluded.allocated_amount,notes=excluded.notes returning id into v_id;
 return v_id;
end $$;

drop function if exists public.post_cash_receipt(uuid);
create function public.post_cash_receipt(p_receipt_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v public.cash_receipts%rowtype; v_box public.cashboxes%rowtype;
begin
 select * into v from public.cash_receipts where id=p_receipt_id for update;
 if not found then raise exception 'سند القبض غير موجود'; end if;
 if v.cashbox_id is null then raise exception 'يجب تحديد الصندوق المستلم'; end if;
 if v.status not in ('draft','approved') then raise exception 'السند مرحل أو ملغي مسبقاً'; end if;
 select * into v_box from public.cashboxes where id=v.cashbox_id and is_active=true;
 if not found then raise exception 'الصندوق غير موجود أو موقوف'; end if;
 if v_box.currency<>v.currency then raise exception 'عملة السند لا تطابق عملة الصندوق'; end if;
 insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
 values(v.cashbox_id,'donation','cash_receipts',v.id,0,v.amount,v.currency,'تبرع نقدي - '||v.voucher_no,auth.uid()) on conflict do nothing;
 update public.cash_receipts set status='posted',posted_at=coalesce(posted_at,now()),updated_at=now() where id=v.id;
end $$;

drop function if exists public.post_cash_transfer(uuid);
create function public.post_cash_transfer(p_transfer_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v public.cash_transfers%rowtype; v_balance numeric(18,2);
begin
 select * into v from public.cash_transfers where id=p_transfer_id for update;
 if not found then raise exception 'التحويل غير موجود'; end if;
 if v.status<>'draft' then raise exception 'لا يمكن ترحيل هذا التحويل'; end if;
 if v.from_cashbox_id=v.to_cashbox_id then raise exception 'لا يمكن التحويل إلى نفس الصندوق'; end if;
 select current_balance into v_balance from public.v_cashboxes where id=v.from_cashbox_id;
 if coalesce(v_balance,0)<v.amount then raise exception 'رصيد الصندوق المحول منه غير كافٍ'; end if;
 insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by) values(v.from_cashbox_id,'transfer_out','cash_transfers',v.id,v.amount,0,v.currency,'تحويل صادر - '||v.transfer_no,auth.uid()) on conflict do nothing;
 insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by) values(v.to_cashbox_id,'transfer_in','cash_transfers',v.id,0,v.amount,v.currency,'تحويل وارد - '||v.transfer_no,auth.uid()) on conflict do nothing;
 update public.cash_transfers set status='posted' where id=v.id;
end $$;

-- Auth profile trigger. Email provider remains enabled; hidden email is generated by the Edge Function.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();
create function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,full_name,username,email,phone,role,status)
 values(new.id,
   coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(coalesce(new.email,'user'),'@',1)),
   coalesce(nullif(new.raw_user_meta_data->>'username',''),split_part(coalesce(new.email,new.id::text),'@',1)||'_'||substr(new.id::text,1,6)),
   new.email,nullif(new.raw_user_meta_data->>'phone',''),
   coalesce(nullif(new.raw_user_meta_data->>'role','')::public.app_role,'data_entry'::public.app_role),'active')
 on conflict(id) do update set full_name=excluded.full_name,phone=coalesce(excluded.phone,public.profiles.phone),email=excluded.email;
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

-- RLS and permissions for added objects
alter table public.cashbox_ledger enable row level security;
alter table public.campaign_funding enable row level security;
alter table public.campaign_distributors enable row level security;
drop policy if exists authenticated_read_cashbox_ledger on public.cashbox_ledger;
create policy authenticated_read_cashbox_ledger on public.cashbox_ledger for select to authenticated using (true);
drop policy if exists authenticated_manage_campaign_funding on public.campaign_funding;
create policy authenticated_manage_campaign_funding on public.campaign_funding for all to authenticated using (true) with check (true);
drop policy if exists authenticated_manage_campaign_distributors on public.campaign_distributors;
create policy authenticated_manage_campaign_distributors on public.campaign_distributors for all to authenticated using (true) with check (true);

grant select on public.cashbox_balances,public.campaign_balances,public.v_cashboxes,public.v_cashbox_users,public.v_cash_transfers,public.v_delegate_advances,public.v_authorized_devices,public.v_user_sessions,public.v_user_archives,public.v_warehouses,public.v_stock_balances,public.v_bulk_disbursements,public.v_disbursement_results,public.v_distribution_assignments,public.v_campaign_funding,public.v_campaign_distributors to authenticated;
grant select on public.cashbox_ledger to authenticated;
grant select,insert,update on public.campaign_funding,public.campaign_distributors to authenticated;
grant execute on function public.post_campaign_funding(uuid) to authenticated;
grant execute on function public.assign_campaign_distributor(uuid,uuid,uuid,text,numeric,text) to authenticated;
grant execute on function public.post_cash_receipt(uuid) to authenticated;
grant execute on function public.post_cash_transfer(uuid) to authenticated;

-- Installation marker
create table if not exists public.system_installation(id integer primary key default 1 check(id=1), version text not null, installed_at timestamptz not null default now());
insert into public.system_installation(id,version) values(1,'7.0.0') on conflict(id) do update set version=excluded.version,installed_at=now();

-- =============================================================
-- V8 FRONTEND CONTRACT VIEWS
-- كل شاشة في الواجهة تقرأ من View ثابت يحتوي search_text والأعمدة المعروضة.
-- =============================================================

DROP VIEW IF EXISTS public.v_branches CASCADE;
CREATE VIEW public.v_branches WITH (security_invoker=true) AS
SELECT b.*, lower(concat_ws(' ',b.name,b.code,b.governorate,b.district,b.address,b.manager_name,b.phone)) AS search_text
FROM public.branches b;

DROP VIEW IF EXISTS public.v_login_attempts CASCADE;
CREATE VIEW public.v_login_attempts WITH (security_invoker=true) AS
SELECT l.*, lower(concat_ws(' ',l.phone,l.device_fingerprint,l.device_name,l.ip_address::text,l.result)) AS search_text
FROM public.login_attempts l;

DROP VIEW IF EXISTS public.v_wallet_providers CASCADE;
CREATE VIEW public.v_wallet_providers WITH (security_invoker=true) AS
SELECT w.*, lower(concat_ws(' ',w.name,w.provider_type,w.account_format,w.export_format,w.notes)) AS search_text
FROM public.wallet_providers w;

DROP VIEW IF EXISTS public.v_units CASCADE;
CREATE VIEW public.v_units WITH (security_invoker=true) AS
SELECT u.*, lower(concat_ws(' ',u.name,u.symbol,u.unit_type)) AS search_text
FROM public.units u;

DROP VIEW IF EXISTS public.v_messages CASCADE;
CREATE VIEW public.v_messages WITH (security_invoker=true) AS
SELECT m.*, lower(concat_ws(' ',m.recipient_type,m.recipient_name,m.phone,m.channel,m.subject,m.message,m.status,m.provider_reference)) AS search_text
FROM public.messages m;

DROP VIEW IF EXISTS public.v_message_templates CASCADE;
CREATE VIEW public.v_message_templates WITH (security_invoker=true) AS
SELECT t.*, lower(concat_ws(' ',t.name,t.event_key,t.channel,t.body)) AS search_text
FROM public.message_templates t;

DROP VIEW IF EXISTS public.v_import_jobs CASCADE;
CREATE VIEW public.v_import_jobs WITH (security_invoker=true) AS
SELECT j.*, p.full_name AS created_by_name,
       lower(concat_ws(' ',j.target_table,j.file_name,j.status,p.full_name)) AS search_text
FROM public.import_jobs j
LEFT JOIN public.profiles p ON p.id=j.created_by;

DROP VIEW IF EXISTS public.v_system_settings CASCADE;
CREATE VIEW public.v_system_settings WITH (security_invoker=true) AS
SELECT
  s.*,
  lower(concat_ws(
    ' ',
    s.organization_name,
    s.system_name,
    s.logo_url,
    s.voucher_prefixes::text,
    s.duplicate_policy::text,
    s.sync_mode,
    s.currency,
    s.print_footer
  )) AS search_text
FROM public.system_settings s;

-- فهارس تمنع التكرار المنطقي في الشاشات الحرجة.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_distributors_campaign_delegate_uidx
ON public.campaign_distributors(campaign_id, delegate_id);
CREATE UNIQUE INDEX IF NOT EXISTS cashboxes_code_uidx ON public.cashboxes(code);
CREATE UNIQUE INDEX IF NOT EXISTS branches_code_uidx ON public.branches(code);

-- فحص عقد الواجهة: يعيد صفاً واحداً عند اكتمال جميع الجداول والعروض الأساسية.
CREATE OR REPLACE FUNCTION public.system_contract_check()
RETURNS TABLE(object_name text, object_type text, status text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT required.name, required.kind,
         CASE WHEN (required.kind='table' AND to_regclass('public.'||required.name) IS NOT NULL)
                OR (required.kind='view' AND to_regclass('public.'||required.name) IS NOT NULL)
              THEN 'ok' ELSE 'missing' END
  FROM (VALUES
    ('profiles','table'),('campaigns','table'),('campaign_funding','table'),('campaign_distributors','table'),
    ('cashboxes','table'),('cash_receipts','table'),('cash_payments','table'),('cash_transfers','table'),
    ('v_campaign_funding','view'),('v_campaign_distributors','view'),('v_cashboxes','view'),
    ('v_cash_receipts','view'),('v_cash_payments','view'),('v_cash_transfers','view'),
    ('v_branches','view'),('v_wallet_providers','view'),('v_units','view'),('v_messages','view')
  ) AS required(name,kind)
  ORDER BY required.kind, required.name;
$$;
GRANT EXECUTE ON FUNCTION public.system_contract_check() TO authenticated;

INSERT INTO public.system_installation(id,version,installed_at)
VALUES (1,'8.0.0',now())
ON CONFLICT (id) DO UPDATE SET version=excluded.version,installed_at=excluded.installed_at;

-- =============================================================
-- V8.3: سياسات RLS موحدة لجميع شاشات النظام الإضافية
-- الهدف: السماح للأدمن النشط بالقراءة والإضافة والتعديل والحذف،
-- مع السماح للمستخدمين المسجلين بالقراءة فقط.
-- هذا الجزء قابل لإعادة التشغيل.
-- =============================================================

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'::public.app_role
      AND p.is_active IS TRUE
      AND COALESCE(p.status, 'active') = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

DO $$
DECLARE
  t text;
  p record;
  target_tables text[] := ARRAY[
    'branches',
    'cashboxes',
    'cashbox_users',
    'cash_transfers',
    'delegate_advances',
    'authorized_devices',
    'user_sessions',
    'user_archives',
    'login_attempts',
    'wallet_providers',
    'bulk_disbursements',
    'disbursement_results',
    'distribution_assignments',
    'warehouses',
    'units',
    'stock_balances',
    'messages',
    'message_templates',
    'import_jobs',
    'system_installation'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- إزالة أي سياسات متضاربة أو ناقصة من محاولات سابقة.
    FOR p IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_authenticated_select', t
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_active_admin()) WITH CHECK (public.is_active_admin())',
      t || '_admin_manage', t
    );
  END LOOP;
END
$$;

-- تسجيل محاولات الدخول يجب أن يعمل قبل تسجيل الدخول كذلك.
DO $$
BEGIN
  IF to_regclass('public.login_attempts') IS NOT NULL THEN
    DROP POLICY IF EXISTS login_attempts_anon_insert ON public.login_attempts;
    CREATE POLICY login_attempts_anon_insert
      ON public.login_attempts
      FOR INSERT
      TO anon
      WITH CHECK (true);
  END IF;
END
$$;

-- منح الصلاحيات الأساسية للأدوار التي تستخدمها واجهة Supabase.
DO $$
DECLARE
  t text;
  target_tables text[] := ARRAY[
    'branches','cashboxes','cashbox_users','cash_transfers','delegate_advances',
    'authorized_devices','user_sessions','user_archives','login_attempts',
    'wallet_providers','bulk_disbursements','disbursement_results',
    'distribution_assignments','warehouses','units','stock_balances',
    'messages','message_templates','import_jobs','system_installation'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    END IF;
  END LOOP;

  IF to_regclass('public.login_attempts') IS NOT NULL THEN
    GRANT INSERT ON TABLE public.login_attempts TO anon;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.rls_contract_check()
RETURNS TABLE(table_name text, rls_enabled boolean, select_policy boolean, manage_policy boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH required(table_name) AS (
    VALUES
      ('branches'),('cashboxes'),('cashbox_users'),('cash_transfers'),
      ('delegate_advances'),('authorized_devices'),('user_sessions'),
      ('user_archives'),('login_attempts'),('wallet_providers'),
      ('bulk_disbursements'),('disbursement_results'),
      ('distribution_assignments'),('warehouses'),('units'),
      ('stock_balances'),('messages'),('message_templates'),
      ('import_jobs'),('system_installation')
  )
  SELECT
    r.table_name,
    COALESCE(c.relrowsecurity, false),
    EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname='public' AND p.tablename=r.table_name AND p.cmd='SELECT'
    ),
    EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname='public' AND p.tablename=r.table_name AND p.cmd='ALL'
    )
  FROM required r
  LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || r.table_name)
  ORDER BY r.table_name;
$$;

GRANT EXECUTE ON FUNCTION public.rls_contract_check() TO authenticated;

UPDATE public.system_installation
SET version='8.3.0', installed_at=now()
WHERE id=1;

-- V9 business rules hotfix

-- Simplify receipt forms: campaign and receiving distributor are no longer required.
alter table public.cash_receipts alter column campaign_id drop not null;
alter table public.cash_receipts alter column delegate_id drop not null;
alter table public.in_kind_receipts alter column campaign_id drop not null;
alter table public.in_kind_receipts alter column delegate_id drop not null;
-- Cash payment is no longer tied to one funding receipt.
alter table public.cash_payments alter column cash_receipt_id drop not null;

-- Auto-select the distributor linked to the current login for any distributor operation.
create or replace function public.current_delegate_id()
returns uuid language sql stable security definer set search_path=public as $$
  select d.id from public.delegates d
  where d.profile_id=auth.uid() and d.is_active=true
  order by d.created_at limit 1
$$;
grant execute on function public.current_delegate_id() to authenticated;

create or replace function public.autofill_operation_delegate()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role()='distributor' then
    new.delegate_id := public.current_delegate_id();
    if new.delegate_id is null then raise exception 'لا يوجد موزع نشط مرتبط بالحساب الحالي'; end if;
  end if;
  return new;
end $$;

drop trigger if exists cash_payments_autofill_delegate on public.cash_payments;
create trigger cash_payments_autofill_delegate before insert or update on public.cash_payments
for each row execute function public.autofill_operation_delegate();
drop trigger if exists in_kind_payments_autofill_delegate on public.in_kind_payments;
create trigger in_kind_payments_autofill_delegate before insert or update on public.in_kind_payments
for each row execute function public.autofill_operation_delegate();

-- A distributor sees only beneficiaries assigned to that distributor; management roles see all.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='beneficiaries'
  loop execute format('drop policy if exists %I on public.beneficiaries',pol.policyname); end loop;
end $$;
create policy beneficiaries_select_scoped on public.beneficiaries for select to authenticated using (
  public.current_user_role() in ('admin','supervisor','accountant','data_entry','auditor')
  or delegate_id=public.current_delegate_id()
);
create policy beneficiaries_manage_admin on public.beneficiaries for all to authenticated
using (public.current_user_role() in ('admin','supervisor','data_entry'))
with check (public.current_user_role() in ('admin','supervisor','data_entry'));
create policy beneficiaries_distributor_update on public.beneficiaries for update to authenticated
using (delegate_id=public.current_delegate_id()) with check (delegate_id=public.current_delegate_id());

-- Rebuild cash receipt posting without requiring campaign/distributor.
-- Compatibility: remove the previous signature before recreating with a possibly different return type.
drop function if exists public.post_cash_receipt(uuid);
create or replace function public.post_cash_receipt(p_id uuid)
returns public.cash_receipts language plpgsql security definer set search_path=public as $$
declare r public.cash_receipts;
begin
  if not public.has_role(array['admin','supervisor','accountant']::public.app_role[]) then raise exception 'غير مصرح بترحيل سند القبض'; end if;
  select * into r from public.cash_receipts where id=p_id for update;
  if not found then raise exception 'سند القبض غير موجود'; end if;
  if r.status='posted' then return r; end if;
  if r.status='cancelled' then raise exception 'السند ملغي'; end if;
  if r.cashbox_id is null then raise exception 'يجب تحديد الصندوق'; end if;
  insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,credit,currency,description,created_by)
  values(r.cashbox_id,'donation','cash_receipts',r.id,r.amount,r.currency,'سند قبض '||r.voucher_no,auth.uid())
  on conflict do nothing;
  update public.cash_receipts set status='posted',posted_at=now() where id=p_id returning * into r;
  return r;
end $$;

-- Cash payment checks the actual cashbox balance and distributor balance. Zero/insufficient balance is rejected.
create or replace function public.post_cash_payment(p_id uuid)
returns public.cash_payments language plpgsql security definer set search_path=public as $$
declare p public.cash_payments; b public.beneficiaries; d public.delegates; v_box numeric; v_delegate_in numeric; v_delegate_out numeric; v_require boolean;
begin
  if not public.has_role(array['admin','supervisor','accountant','distributor']::public.app_role[]) then raise exception 'غير مصرح بترحيل سند الصرف'; end if;
  select * into p from public.cash_payments where id=p_id for update;
  if not found then raise exception 'سند الصرف غير موجود'; end if;
  if p.status='posted' then return p; end if;
  if p.status='cancelled' then raise exception 'السند ملغي'; end if;
  if public.current_user_role()='distributor' then p.delegate_id:=public.current_delegate_id(); update public.cash_payments set delegate_id=p.delegate_id where id=p.id; end if;
  if p.cashbox_id is null then raise exception 'يجب تحديد الصندوق'; end if;
  select * into b from public.beneficiaries where id=p.beneficiary_id;
  select * into d from public.delegates where id=p.delegate_id;
  if b.status<>'approved' then raise exception 'المستفيد غير معتمد'; end if;
  if d.id is null or not d.is_active then raise exception 'الموزع غير موجود أو موقوف'; end if;
  if public.current_user_role()='distributor' and b.delegate_id is distinct from p.delegate_id then raise exception 'المستفيد غير مربوط بهذا الموزع'; end if;
  select c.opening_balance+coalesce(sum(l.credit-l.debit),0) into v_box from public.cashboxes c left join public.cashbox_ledger l on l.cashbox_id=c.id where c.id=p.cashbox_id group by c.id;
  if coalesce(v_box,0)<=0 or p.amount>coalesce(v_box,0) then raise exception 'رصيد الصندوق صفر أو أقل من مبلغ الصرف'; end if;
  select coalesce(sum(amount),0) into v_delegate_in from public.delegate_advances where delegate_id=p.delegate_id and status in ('posted','active');
  select coalesce(sum(amount),0) into v_delegate_out from public.cash_payments where delegate_id=p.delegate_id and status='posted' and id<>p.id;
  if public.current_user_role()='distributor' and (v_delegate_in-v_delegate_out<=0 or p.amount>v_delegate_in-v_delegate_out) then raise exception 'رصيد الموزع صفر أو أقل من مبلغ الصرف'; end if;
  insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,currency,description,created_by)
  values(p.cashbox_id,'payment','cash_payments',p.id,p.amount,p.currency,'سند صرف '||p.voucher_no,auth.uid()) on conflict do nothing;
  update public.cash_payments set status='posted',posted_at=now() where id=p_id returning * into p;
  return p;
end $$;

-- Quick delivery: name + amount only. Everything else is resolved, approved and posted automatically.
create or replace function public.quick_deliver_cash(p_beneficiary_name text,p_amount numeric)
returns public.cash_payments language plpgsql security definer set search_path=public as $$
declare v_delegate uuid; v_beneficiary uuid; v_campaign uuid; v_cashbox uuid; v_payment uuid; v_balance numeric;
begin
  if nullif(trim(p_beneficiary_name),'') is null or p_amount<=0 then raise exception 'الاسم والمبلغ مطلوبان'; end if;
  v_delegate:=public.current_delegate_id();
  if v_delegate is null then raise exception 'لا يوجد موزع مرتبط بالحساب الحالي'; end if;
  select da.cashbox_id into v_cashbox from public.delegate_advances da where da.delegate_id=v_delegate and da.status in ('posted','active') order by da.advance_date desc,da.created_at desc limit 1;
  if v_cashbox is null then raise exception 'لا توجد عهدة نقدية نشطة للموزع'; end if;
  select c.opening_balance+coalesce(sum(l.credit-l.debit),0) into v_balance from public.cashboxes c left join public.cashbox_ledger l on l.cashbox_id=c.id where c.id=v_cashbox group by c.id;
  if coalesce(v_balance,0)<=0 or p_amount>coalesce(v_balance,0) then raise exception 'الرصيد صفر أو أقل من المبلغ المحدد'; end if;
  select id into v_campaign from public.campaigns where status='open' order by created_at desc limit 1;
  if v_campaign is null then raise exception 'لا توجد حملة مفتوحة للتسليم السريع'; end if;
  select id into v_beneficiary from public.beneficiaries where delegate_id=v_delegate and lower(trim(full_name))=lower(trim(p_beneficiary_name)) limit 1;
  if v_beneficiary is null then
    insert into public.beneficiaries(full_name,delegate_id,status,created_by) values(trim(p_beneficiary_name),v_delegate,'approved',auth.uid()) returning id into v_beneficiary;
  end if;
  insert into public.cash_payments(payment_date,delegate_id,beneficiary_id,campaign_id,cashbox_id,amount,currency,delivery_method,receipt_status,actual_recipient,status,created_by)
  values(current_date,v_delegate,v_beneficiary,v_campaign,v_cashbox,p_amount,'YER','cash','received',trim(p_beneficiary_name),'approved',auth.uid()) returning id into v_payment;
  perform public.post_cash_payment(v_payment);
  insert into public.distribution_assignments(beneficiary_id,delegate_id,amount,delivery_status,delivered_at,payment_id)
  values(v_beneficiary,v_delegate,p_amount,'received',now(),v_payment);
  return (select x from public.cash_payments x where x.id=v_payment);
end $$;
grant execute on function public.quick_deliver_cash(text,numeric) to authenticated;


-- V9 BUSINESS RULES
-- V9 business rules hotfix


-- Simplify receipt forms: campaign and receiving distributor are no longer required.
alter table public.cash_receipts alter column campaign_id drop not null;
alter table public.cash_receipts alter column delegate_id drop not null;
alter table public.in_kind_receipts alter column campaign_id drop not null;
alter table public.in_kind_receipts alter column delegate_id drop not null;
-- Cash payment is no longer tied to one funding receipt.
alter table public.cash_payments alter column cash_receipt_id drop not null;
alter table public.distribution_assignments add column if not exists payment_id uuid references public.cash_payments(id) on delete set null;

-- Auto-select the distributor linked to the current login for any distributor operation.
create or replace function public.current_delegate_id()
returns uuid language sql stable security definer set search_path=public as $$
  select d.id from public.delegates d
  where d.profile_id=auth.uid() and d.is_active=true
  order by d.created_at limit 1
$$;
grant execute on function public.current_delegate_id() to authenticated;

create or replace function public.autofill_operation_delegate()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role()='distributor' then
    new.delegate_id := public.current_delegate_id();
    if new.delegate_id is null then raise exception 'لا يوجد موزع نشط مرتبط بالحساب الحالي'; end if;
  end if;
  return new;
end $$;

drop trigger if exists cash_payments_autofill_delegate on public.cash_payments;
create trigger cash_payments_autofill_delegate before insert or update on public.cash_payments
for each row execute function public.autofill_operation_delegate();
drop trigger if exists in_kind_payments_autofill_delegate on public.in_kind_payments;
create trigger in_kind_payments_autofill_delegate before insert or update on public.in_kind_payments
for each row execute function public.autofill_operation_delegate();

-- A distributor sees only beneficiaries assigned to that distributor; management roles see all.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='beneficiaries'
  loop execute format('drop policy if exists %I on public.beneficiaries',pol.policyname); end loop;
end $$;
create policy beneficiaries_select_scoped on public.beneficiaries for select to authenticated using (
  public.current_user_role() in ('admin','supervisor','accountant','data_entry','auditor')
  or delegate_id=public.current_delegate_id()
);
create policy beneficiaries_manage_admin on public.beneficiaries for all to authenticated
using (public.current_user_role() in ('admin','supervisor','data_entry'))
with check (public.current_user_role() in ('admin','supervisor','data_entry'));
create policy beneficiaries_distributor_update on public.beneficiaries for update to authenticated
using (delegate_id=public.current_delegate_id()) with check (delegate_id=public.current_delegate_id());

-- Rebuild cash receipt posting without requiring campaign/distributor.
-- Compatibility: remove the previous signature before recreating with a possibly different return type.
drop function if exists public.post_cash_receipt(uuid);
create or replace function public.post_cash_receipt(p_id uuid)
returns public.cash_receipts language plpgsql security definer set search_path=public as $$
declare r public.cash_receipts;
begin
  if not public.has_role(array['admin','supervisor','accountant']::public.app_role[]) then raise exception 'غير مصرح بترحيل سند القبض'; end if;
  select * into r from public.cash_receipts where id=p_id for update;
  if not found then raise exception 'سند القبض غير موجود'; end if;
  if r.status='posted' then return r; end if;
  if r.status='cancelled' then raise exception 'السند ملغي'; end if;
  if r.cashbox_id is null then raise exception 'يجب تحديد الصندوق'; end if;
  insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,credit,currency,description,created_by)
  values(r.cashbox_id,'donation','cash_receipts',r.id,r.amount,r.currency,'سند قبض '||r.voucher_no,auth.uid())
  on conflict do nothing;
  update public.cash_receipts set status='posted',posted_at=now() where id=p_id returning * into r;
  return r;
end $$;

-- Cash payment checks the actual cashbox balance and distributor balance. Zero/insufficient balance is rejected.
create or replace function public.post_cash_payment(p_id uuid)
returns public.cash_payments language plpgsql security definer set search_path=public as $$
declare p public.cash_payments; b public.beneficiaries; d public.delegates; v_box numeric; v_delegate_in numeric; v_delegate_out numeric; v_require boolean;
begin
  if not public.has_role(array['admin','supervisor','accountant','distributor']::public.app_role[]) then raise exception 'غير مصرح بترحيل سند الصرف'; end if;
  select * into p from public.cash_payments where id=p_id for update;
  if not found then raise exception 'سند الصرف غير موجود'; end if;
  if p.status='posted' then return p; end if;
  if p.status='cancelled' then raise exception 'السند ملغي'; end if;
  if public.current_user_role()='distributor' then p.delegate_id:=public.current_delegate_id(); update public.cash_payments set delegate_id=p.delegate_id where id=p.id; end if;
  if p.cashbox_id is null then raise exception 'يجب تحديد الصندوق'; end if;
  select * into b from public.beneficiaries where id=p.beneficiary_id;
  select * into d from public.delegates where id=p.delegate_id;
  if b.status<>'approved' then raise exception 'المستفيد غير معتمد'; end if;
  if d.id is null or not d.is_active then raise exception 'الموزع غير موجود أو موقوف'; end if;
  if public.current_user_role()='distributor' and b.delegate_id is distinct from p.delegate_id then raise exception 'المستفيد غير مربوط بهذا الموزع'; end if;
  select c.opening_balance+coalesce(sum(l.credit-l.debit),0) into v_box from public.cashboxes c left join public.cashbox_ledger l on l.cashbox_id=c.id where c.id=p.cashbox_id group by c.id;
  if coalesce(v_box,0)<=0 or p.amount>coalesce(v_box,0) then raise exception 'رصيد الصندوق صفر أو أقل من مبلغ الصرف'; end if;
  select coalesce(sum(amount),0) into v_delegate_in from public.delegate_advances where delegate_id=p.delegate_id and status in ('posted','active');
  select coalesce(sum(amount),0) into v_delegate_out from public.cash_payments where delegate_id=p.delegate_id and status='posted' and id<>p.id;
  if public.current_user_role()='distributor' and (v_delegate_in-v_delegate_out<=0 or p.amount>v_delegate_in-v_delegate_out) then raise exception 'رصيد الموزع صفر أو أقل من مبلغ الصرف'; end if;
  insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,currency,description,created_by)
  values(p.cashbox_id,'payment','cash_payments',p.id,p.amount,p.currency,'سند صرف '||p.voucher_no,auth.uid()) on conflict do nothing;
  update public.cash_payments set status='posted',posted_at=now() where id=p_id returning * into p;
  return p;
end $$;

-- Quick delivery: name + amount only. Everything else is resolved, approved and posted automatically.
create or replace function public.quick_deliver_cash(p_beneficiary_name text,p_amount numeric)
returns public.cash_payments language plpgsql security definer set search_path=public as $$
declare v_delegate uuid; v_beneficiary uuid; v_campaign uuid; v_cashbox uuid; v_payment uuid; v_balance numeric; v_category uuid;
begin
  if nullif(trim(p_beneficiary_name),'') is null or p_amount<=0 then raise exception 'الاسم والمبلغ مطلوبان'; end if;
  v_delegate:=public.current_delegate_id();
  if v_delegate is null then raise exception 'لا يوجد موزع مرتبط بالحساب الحالي'; end if;
  select da.cashbox_id into v_cashbox from public.delegate_advances da where da.delegate_id=v_delegate and da.status in ('open','posted','active') order by da.advance_date desc,da.created_at desc limit 1;
  if v_cashbox is null then raise exception 'لا توجد عهدة نقدية نشطة للموزع'; end if;
  select c.opening_balance+coalesce(sum(l.credit-l.debit),0) into v_balance from public.cashboxes c left join public.cashbox_ledger l on l.cashbox_id=c.id where c.id=v_cashbox group by c.id;
  if coalesce(v_balance,0)<=0 or p_amount>coalesce(v_balance,0) then raise exception 'الرصيد صفر أو أقل من المبلغ المحدد'; end if;
  select id into v_campaign from public.campaigns where status='open' order by created_at desc limit 1;
  if v_campaign is null then raise exception 'لا توجد حملة مفتوحة للتسليم السريع'; end if;
  select id into v_beneficiary from public.beneficiaries where delegate_id=v_delegate and lower(trim(full_name))=lower(trim(p_beneficiary_name)) limit 1;
  if v_beneficiary is null then
    select id into v_category from public.beneficiary_categories where is_active=true order by priority,id limit 1;
    if v_category is null then insert into public.beneficiary_categories(name,description,priority,is_active) values('تسليم سريع','أنشئت تلقائياً للتسليم السريع',3,true) returning id into v_category; end if;
    insert into public.beneficiaries(full_name,category_id,delegate_id,status,approved_by,approved_at,created_by) values(trim(p_beneficiary_name),v_category,v_delegate,'approved',auth.uid(),now(),auth.uid()) returning id into v_beneficiary;
  end if;
  insert into public.cash_payments(payment_date,delegate_id,beneficiary_id,campaign_id,cashbox_id,amount,currency,delivery_method,receipt_status,actual_recipient,status,created_by)
  values(current_date,v_delegate,v_beneficiary,v_campaign,v_cashbox,p_amount,'YER','cash','received',trim(p_beneficiary_name),'approved',auth.uid()) returning id into v_payment;
  perform public.post_cash_payment(v_payment);
  insert into public.distribution_assignments(beneficiary_id,delegate_id,amount,delivery_status,delivered_at,payment_id)
  values(v_beneficiary,v_delegate,p_amount,'received',now(),v_payment);
  return (select x from public.cash_payments x where x.id=v_payment);
end $$;
grant execute on function public.quick_deliver_cash(text,numeric) to authenticated;



-- V9.2 receipt and quick delivery hotfix

-- Cash receipt is independent from campaigns and distributors.
drop function if exists public.post_cash_receipt(uuid);
create function public.post_cash_receipt(p_id uuid)
returns public.cash_receipts
language plpgsql security definer set search_path=public as $$
declare r public.cash_receipts;
begin
  if not public.has_role(array['admin','supervisor','accountant']::public.app_role[]) then
    raise exception 'غير مصرح بترحيل سند القبض';
  end if;
  select * into r from public.cash_receipts where id=p_id for update;
  if not found then raise exception 'سند القبض غير موجود'; end if;
  if r.status='posted' then return r; end if;
  if r.status='cancelled' then raise exception 'السند ملغي'; end if;
  if r.cashbox_id is null then raise exception 'يجب تحديد الصندوق'; end if;
  if not exists(select 1 from public.cashboxes c where c.id=r.cashbox_id and c.is_active=true) then
    raise exception 'الصندوق غير موجود أو موقوف';
  end if;
  insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,credit,currency,description,created_by)
  values(r.cashbox_id,'donation','cash_receipts',r.id,r.amount,r.currency,'سند قبض '||coalesce(r.voucher_no,''),auth.uid())
  on conflict do nothing;
  update public.cash_receipts set status='posted',posted_at=now() where id=p_id returning * into r;
  return r;
end $$;
grant execute on function public.post_cash_receipt(uuid) to authenticated;

-- Quick delivery supports scoped beneficiary selection:
-- distributor: only linked beneficiaries (RLS + validation)
-- management: any beneficiary, using that beneficiary's linked distributor.
drop function if exists public.quick_deliver_cash(text,numeric);
drop function if exists public.quick_deliver_cash(text,numeric,uuid);
create function public.quick_deliver_cash(
  p_beneficiary_name text,
  p_amount numeric,
  p_beneficiary_id uuid default null
)
returns public.cash_payments
language plpgsql security definer set search_path=public as $$
declare
  v_role public.app_role;
  v_delegate uuid;
  v_beneficiary uuid;
  v_campaign uuid;
  v_cashbox uuid;
  v_payment uuid;
  v_box_balance numeric;
  v_delegate_in numeric;
  v_delegate_out numeric;
  v_category uuid;
begin
  if nullif(trim(p_beneficiary_name),'') is null or p_amount<=0 then
    raise exception 'الاسم والمبلغ مطلوبان';
  end if;
  v_role:=public.current_user_role();
  if v_role not in ('admin','supervisor','accountant','distributor') then
    raise exception 'غير مصرح بالتسليم السريع';
  end if;

  if v_role='distributor' then
    v_delegate:=public.current_delegate_id();
    if v_delegate is null then raise exception 'لا يوجد موزع مرتبط بالحساب الحالي'; end if;
    if p_beneficiary_id is not null then
      select id into v_beneficiary from public.beneficiaries
      where id=p_beneficiary_id and delegate_id=v_delegate and status='approved';
      if v_beneficiary is null then raise exception 'المستفيد غير مربوط بهذا الموزع'; end if;
    else
      select id into v_beneficiary from public.beneficiaries
      where delegate_id=v_delegate and status='approved'
        and lower(trim(full_name))=lower(trim(p_beneficiary_name)) limit 1;
      if v_beneficiary is null then
        select id into v_category from public.beneficiary_categories where is_active=true order by priority,id limit 1;
        if v_category is null then
          insert into public.beneficiary_categories(name,description,priority,is_active)
          values('تسليم سريع','أنشئت تلقائياً للتسليم السريع',3,true) returning id into v_category;
        end if;
        insert into public.beneficiaries(full_name,category_id,delegate_id,status,approved_by,approved_at,created_by)
        values(trim(p_beneficiary_name),v_category,v_delegate,'approved',auth.uid(),now(),auth.uid())
        returning id into v_beneficiary;
      end if;
    end if;
  else
    if p_beneficiary_id is null then raise exception 'اختر المستفيد من القائمة'; end if;
    select id,delegate_id into v_beneficiary,v_delegate from public.beneficiaries
    where id=p_beneficiary_id and status='approved';
    if v_beneficiary is null then raise exception 'المستفيد غير موجود أو غير معتمد'; end if;
    if v_delegate is null then raise exception 'المستفيد غير مربوط بموزع'; end if;
  end if;

  select da.cashbox_id into v_cashbox
  from public.delegate_advances da
  where da.delegate_id=v_delegate and da.status in ('open','posted','active')
  order by da.advance_date desc,da.created_at desc limit 1;
  if v_cashbox is null then raise exception 'لا توجد عهدة نقدية نشطة للموزع'; end if;

  select c.opening_balance+coalesce(sum(l.credit-l.debit),0)
  into v_box_balance
  from public.cashboxes c left join public.cashbox_ledger l on l.cashbox_id=c.id
  where c.id=v_cashbox group by c.id;
  if coalesce(v_box_balance,0)<=0 or p_amount>coalesce(v_box_balance,0) then
    raise exception 'رصيد الصندوق صفر أو أقل من المبلغ المحدد';
  end if;

  select coalesce(sum(amount),0) into v_delegate_in
  from public.delegate_advances where delegate_id=v_delegate and status in ('open','posted','active');
  select coalesce(sum(amount),0) into v_delegate_out
  from public.cash_payments where delegate_id=v_delegate and status='posted';
  if v_delegate_in-v_delegate_out<=0 or p_amount>v_delegate_in-v_delegate_out then
    raise exception 'رصيد الموزع صفر أو أقل من المبلغ المحدد';
  end if;

  select id into v_campaign from public.campaigns where status='open' order by created_at desc limit 1;
  if v_campaign is null then raise exception 'لا توجد حملة مفتوحة للتسليم السريع'; end if;

  insert into public.cash_payments(payment_date,delegate_id,beneficiary_id,campaign_id,cashbox_id,amount,currency,delivery_method,receipt_status,actual_recipient,status,created_by)
  values(current_date,v_delegate,v_beneficiary,v_campaign,v_cashbox,p_amount,'YER','cash','received',trim(p_beneficiary_name),'approved',auth.uid())
  returning id into v_payment;
  perform public.post_cash_payment(v_payment);
  insert into public.distribution_assignments(beneficiary_id,delegate_id,campaign_id,amount,delivery_status,delivered_at,payment_id)
  values(v_beneficiary,v_delegate,v_campaign,p_amount,'received',now(),v_payment);
  return (select x from public.cash_payments x where x.id=v_payment);
end $$;
grant execute on function public.quick_deliver_cash(text,numeric,uuid) to authenticated;


-- V9.1: القبض العيني يدخل المخزن أولاً، ثم تمويل عيني مستقل يخصص الأصناف للحملة.
ALTER TABLE public.in_kind_receipts
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;
ALTER TABLE public.in_kind_receipts ALTER COLUMN campaign_id DROP NOT NULL;
ALTER TABLE public.in_kind_receipts ALTER COLUMN delegate_id DROP NOT NULL;

ALTER TABLE public.inventory_lots
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_lots ALTER COLUMN campaign_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.campaign_in_kind_funding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_no text NOT NULL UNIQUE DEFAULT ('IKF-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.inkind_payment_seq')::text,6,'0')),
  funding_date date NOT NULL DEFAULT current_date,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  notes text,
  status public.document_status NOT NULL DEFAULT 'draft',
  posted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_in_kind_funding_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_id uuid NOT NULL REFERENCES public.campaign_in_kind_funding(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(funding_id,item_id)
);

DROP TRIGGER IF EXISTS campaign_in_kind_funding_updated_at ON public.campaign_in_kind_funding;
CREATE TRIGGER campaign_in_kind_funding_updated_at BEFORE UPDATE ON public.campaign_in_kind_funding
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.post_in_kind_receipt(p_id uuid)
RETURNS public.in_kind_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r public.in_kind_receipts;
  det public.in_kind_receipt_details;
  v_lot uuid;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant','warehouse']::public.app_role[]) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  SELECT * INTO r FROM public.in_kind_receipts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF r.status='posted' THEN RETURN r; END IF;
  IF r.status='cancelled' THEN RAISE EXCEPTION 'السند ملغي'; END IF;
  IF r.warehouse_id IS NULL THEN RAISE EXCEPTION 'يجب اختيار المخزن المستلم'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses w WHERE w.id=r.warehouse_id AND w.is_active=true) THEN RAISE EXCEPTION 'المخزن غير موجود أو غير نشط'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.in_kind_receipt_details WHERE receipt_id=p_id) THEN RAISE EXCEPTION 'السند لا يحتوي أصنافاً'; END IF;
  FOR det IN SELECT * FROM public.in_kind_receipt_details WHERE receipt_id=p_id LOOP
    IF det.valid_qty <= 0 THEN RAISE EXCEPTION 'الكمية الصالحة يجب أن تكون أكبر من صفر'; END IF;
    IF det.expiry_date IS NOT NULL AND det.expiry_date <= current_date THEN RAISE EXCEPTION 'يوجد صنف منتهي الصلاحية'; END IF;
    INSERT INTO public.inventory_lots(item_id,warehouse_id,campaign_id,delegate_id,source_receipt_detail_id,lot_no,expiry_date,quantity_received,quantity_damaged,quantity_available)
    VALUES(det.item_id,r.warehouse_id,NULL,NULL,det.id,det.lot_no,det.expiry_date,det.quantity,det.damaged_qty,det.valid_qty)
    RETURNING id INTO v_lot;
    INSERT INTO public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
    VALUES(v_lot,det.item_id,'in',det.valid_qty,'in_kind_receipts',r.id,det.id);
  END LOOP;
  UPDATE public.in_kind_receipts SET status='posted',posted_at=now(),campaign_id=NULL,delegate_id=NULL WHERE id=p_id RETURNING * INTO r;
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.post_campaign_in_kind_funding(p_id uuid)
RETURNS public.campaign_in_kind_funding LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  f public.campaign_in_kind_funding;
  d public.campaign_in_kind_funding_details;
  src public.inventory_lots;
  v_available numeric(18,3);
  v_needed numeric(18,3);
  v_take numeric(18,3);
  v_target uuid;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse']::public.app_role[]) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  SELECT * INTO f FROM public.campaign_in_kind_funding WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تمويل الحملة العيني غير موجود'; END IF;
  IF f.status='posted' THEN RETURN f; END IF;
  IF f.status='cancelled' THEN RAISE EXCEPTION 'التمويل ملغي'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaigns c WHERE c.id=f.campaign_id AND c.status='open' AND c.campaign_type IN ('in_kind','mixed')) THEN
    RAISE EXCEPTION 'الحملة ليست مفتوحة أو ليست عينية/مختلطة';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaign_in_kind_funding_details WHERE funding_id=p_id) THEN RAISE EXCEPTION 'لم يتم اختيار أصناف للتمويل'; END IF;

  FOR d IN SELECT * FROM public.campaign_in_kind_funding_details WHERE funding_id=p_id LOOP
    SELECT COALESCE(SUM(quantity_available),0) INTO v_available
    FROM public.inventory_lots
    WHERE warehouse_id=f.warehouse_id AND campaign_id IS NULL AND item_id=d.item_id
      AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date);
    IF v_available < d.quantity THEN RAISE EXCEPTION 'رصيد المخزن غير كاف للصنف %، المتاح % والمطلوب %',d.item_id,v_available,d.quantity; END IF;
    v_needed := d.quantity;
    FOR src IN
      SELECT * FROM public.inventory_lots
      WHERE warehouse_id=f.warehouse_id AND campaign_id IS NULL AND item_id=d.item_id
        AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date)
      ORDER BY expiry_date NULLS LAST,created_at FOR UPDATE
    LOOP
      EXIT WHEN v_needed<=0;
      v_take := LEAST(v_needed,src.quantity_available);
      UPDATE public.inventory_lots SET quantity_available=quantity_available-v_take WHERE id=src.id;
      INSERT INTO public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
      VALUES(src.id,d.item_id,'out',v_take,'campaign_in_kind_funding',f.id,d.id);
      INSERT INTO public.inventory_lots(item_id,warehouse_id,campaign_id,delegate_id,lot_no,expiry_date,quantity_received,quantity_damaged,quantity_available)
      VALUES(d.item_id,f.warehouse_id,f.campaign_id,NULL,src.lot_no,src.expiry_date,v_take,0,v_take)
      RETURNING id INTO v_target;
      INSERT INTO public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
      VALUES(v_target,d.item_id,'in',v_take,'campaign_in_kind_funding',f.id,d.id);
      v_needed := v_needed-v_take;
    END LOOP;
  END LOOP;
  UPDATE public.campaign_in_kind_funding SET status='posted',posted_at=now() WHERE id=p_id RETURNING * INTO f;
  RETURN f;
END; $$;

DROP VIEW IF EXISTS public.v_in_kind_receipts CASCADE;
CREATE VIEW public.v_in_kind_receipts WITH (security_invoker=true) AS
SELECT r.*,d.name AS donor_name,w.name AS warehouse_name,
 count(rd.id) AS items_count,COALESCE(sum(rd.valid_qty),0) AS valid_total,
 lower(concat_ws(' ',r.voucher_no,d.name,w.name,r.status::text)) AS search_text
FROM public.in_kind_receipts r
JOIN public.donors d ON d.id=r.donor_id
LEFT JOIN public.warehouses w ON w.id=r.warehouse_id
LEFT JOIN public.in_kind_receipt_details rd ON rd.receipt_id=r.id
GROUP BY r.id,d.name,w.name;

DROP VIEW IF EXISTS public.v_inventory_lots CASCADE;
CREATE VIEW public.v_inventory_lots WITH (security_invoker=true) AS
SELECT l.*,i.name AS item_name,c.name AS campaign_name,w.name AS warehouse_name,d.full_name AS delegate_name,
 lower(concat_ws(' ',i.name,c.name,w.name,d.full_name,l.lot_no,l.expiry_date::text)) AS search_text
FROM public.inventory_lots l JOIN public.items i ON i.id=l.item_id
LEFT JOIN public.campaigns c ON c.id=l.campaign_id
LEFT JOIN public.warehouses w ON w.id=l.warehouse_id
LEFT JOIN public.delegates d ON d.id=l.delegate_id;

CREATE OR REPLACE VIEW public.v_campaign_in_kind_funding WITH (security_invoker=true) AS
SELECT f.*,c.name AS campaign_name,w.name AS warehouse_name,
 count(fd.id) AS items_count,COALESCE(sum(fd.quantity),0) AS total_quantity,
 lower(concat_ws(' ',f.funding_no,c.name,w.name,f.status::text,f.notes)) AS search_text
FROM public.campaign_in_kind_funding f
JOIN public.campaigns c ON c.id=f.campaign_id
JOIN public.warehouses w ON w.id=f.warehouse_id
LEFT JOIN public.campaign_in_kind_funding_details fd ON fd.funding_id=f.id
GROUP BY f.id,c.name,w.name;

ALTER TABLE public.campaign_in_kind_funding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_in_kind_funding_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_in_kind_funding_select ON public.campaign_in_kind_funding;
DROP POLICY IF EXISTS campaign_in_kind_funding_manage ON public.campaign_in_kind_funding;
CREATE POLICY campaign_in_kind_funding_select ON public.campaign_in_kind_funding FOR SELECT TO authenticated USING(true);
CREATE POLICY campaign_in_kind_funding_manage ON public.campaign_in_kind_funding FOR ALL TO authenticated USING(public.is_active_admin() OR public.has_role(ARRAY['supervisor','warehouse']::public.app_role[])) WITH CHECK(public.is_active_admin() OR public.has_role(ARRAY['supervisor','warehouse']::public.app_role[]));
DROP POLICY IF EXISTS campaign_in_kind_funding_details_select ON public.campaign_in_kind_funding_details;
DROP POLICY IF EXISTS campaign_in_kind_funding_details_manage ON public.campaign_in_kind_funding_details;
CREATE POLICY campaign_in_kind_funding_details_select ON public.campaign_in_kind_funding_details FOR SELECT TO authenticated USING(true);
CREATE POLICY campaign_in_kind_funding_details_manage ON public.campaign_in_kind_funding_details FOR ALL TO authenticated USING(public.is_active_admin() OR public.has_role(ARRAY['supervisor','warehouse']::public.app_role[])) WITH CHECK(public.is_active_admin() OR public.has_role(ARRAY['supervisor','warehouse']::public.app_role[]));

GRANT SELECT,INSERT,UPDATE,DELETE ON public.campaign_in_kind_funding,public.campaign_in_kind_funding_details TO authenticated;
GRANT SELECT ON public.v_campaign_in_kind_funding TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_campaign_in_kind_funding(uuid) TO authenticated;

UPDATE public.system_installation SET version='9.1.0',installed_at=now() WHERE id=1;


-- V9.3: quick delivery only for an existing approved beneficiary.
drop function if exists public.quick_deliver_cash(text,numeric);
drop function if exists public.quick_deliver_cash(text,numeric,uuid);
create function public.quick_deliver_cash(
  p_beneficiary_name text,
  p_amount numeric,
  p_beneficiary_id uuid
)
returns public.cash_payments
language plpgsql security definer set search_path=public as $$
declare
  v_role public.app_role;
  v_delegate uuid;
  v_beneficiary uuid;
  v_beneficiary_name text;
  v_campaign uuid;
  v_cashbox uuid;
  v_payment uuid;
  v_box_balance numeric;
  v_delegate_in numeric;
  v_delegate_out numeric;
begin
  if p_beneficiary_id is null then
    raise exception 'يجب اختيار مستفيد مسجل مسبقاً في دليل المستفيدين';
  end if;
  if p_amount is null or p_amount<=0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;

  v_role:=public.current_user_role();
  if v_role not in ('admin','supervisor','accountant','distributor') then
    raise exception 'غير مصرح بالتسليم السريع';
  end if;

  select b.id,b.delegate_id,b.full_name into v_beneficiary,v_delegate,v_beneficiary_name
  from public.beneficiaries b where b.id=p_beneficiary_id and b.status='approved';
  if v_beneficiary is null then raise exception 'المستفيد غير موجود في الدليل أو غير معتمد'; end if;
  if v_delegate is null then raise exception 'المستفيد غير مربوط بموزع'; end if;

  if v_role='distributor' then
    if public.current_delegate_id() is null then raise exception 'لا يوجد موزع مرتبط بالحساب الحالي'; end if;
    if v_delegate<>public.current_delegate_id() then raise exception 'المستفيد غير مرتبط بهذا الموزع'; end if;
  end if;

  select da.cashbox_id into v_cashbox
  from public.delegate_advances da
  where da.delegate_id=v_delegate and da.status in ('open','posted','active')
  order by da.advance_date desc,da.created_at desc limit 1;
  if v_cashbox is null then raise exception 'لا توجد عهدة نقدية نشطة للموزع'; end if;

  select c.opening_balance+coalesce(sum(l.credit-l.debit),0)
  into v_box_balance
  from public.cashboxes c left join public.cashbox_ledger l on l.cashbox_id=c.id
  where c.id=v_cashbox and c.is_active=true group by c.id;
  if coalesce(v_box_balance,0)<=0 or p_amount>coalesce(v_box_balance,0) then
    raise exception 'رصيد الصندوق صفر أو أقل من المبلغ المحدد';
  end if;

  select coalesce(sum(amount),0) into v_delegate_in
  from public.delegate_advances where delegate_id=v_delegate and status in ('open','posted','active');
  select coalesce(sum(amount),0) into v_delegate_out
  from public.cash_payments where delegate_id=v_delegate and status='posted';
  if v_delegate_in-v_delegate_out<=0 or p_amount>v_delegate_in-v_delegate_out then
    raise exception 'رصيد الموزع صفر أو أقل من المبلغ المحدد';
  end if;

  select cd.campaign_id into v_campaign
  from public.campaign_distributors cd join public.campaigns c on c.id=cd.campaign_id
  where cd.delegate_id=v_delegate and cd.status='active' and c.status='open'
  order by cd.assigned_at desc nulls last,cd.created_at desc limit 1;
  if v_campaign is null then
    select id into v_campaign from public.campaigns where status='open' order by created_at desc limit 1;
  end if;
  if v_campaign is null then raise exception 'لا توجد حملة مفتوحة للتسليم السريع'; end if;

  insert into public.cash_payments(payment_date,delegate_id,beneficiary_id,campaign_id,cashbox_id,amount,currency,delivery_method,receipt_status,actual_recipient,status,created_by)
  values(current_date,v_delegate,v_beneficiary,v_campaign,v_cashbox,p_amount,'YER','cash','received',v_beneficiary_name,'approved',auth.uid())
  returning id into v_payment;
  perform public.post_cash_payment(v_payment);
  insert into public.distribution_assignments(beneficiary_id,delegate_id,campaign_id,amount,delivery_status,delivered_at,payment_id)
  values(v_beneficiary,v_delegate,v_campaign,p_amount,'received',now(),v_payment);
  return (select x from public.cash_payments x where x.id=v_payment);
end $$;
grant execute on function public.quick_deliver_cash(text,numeric,uuid) to authenticated;

UPDATE public.system_installation SET version='9.3.0',installed_at=now() WHERE id=1;


-- V10: offline, automatic posting, devices and login attempts
alter table public.system_settings add column if not exists auto_post_all_operations boolean not null default false;

-- allow recording attempts before and after authentication
drop policy if exists login_attempts_anon_insert on public.login_attempts;
create policy login_attempts_anon_insert on public.login_attempts for insert to anon, authenticated with check (true);
grant insert on public.login_attempts to anon, authenticated;
grant usage, select on sequence public.login_attempts_id_seq to anon, authenticated;

-- authenticated users can register/update their own browser device; admins manage all devices
drop policy if exists authorized_devices_self_insert on public.authorized_devices;
create policy authorized_devices_self_insert on public.authorized_devices for insert to authenticated
with check (user_id = auth.uid());
drop policy if exists authorized_devices_self_update on public.authorized_devices;
create policy authorized_devices_self_update on public.authorized_devices for update to authenticated
using (user_id = auth.uid() or public.is_active_admin()) with check (user_id = auth.uid() or public.is_active_admin());
grant select, insert, update on public.authorized_devices to authenticated;



-- =============================================================
-- V11 RC5 FINAL COMPATIBILITY CONTRACT
-- Keeps authorized_devices.status and authorized_devices.is_active synchronized.
-- This block is intentionally idempotent and safe on existing installations.
-- =============================================================

alter table public.authorized_devices
  add column if not exists is_active boolean;

update public.authorized_devices
set is_active = (status = 'approved')
where is_active is null;

alter table public.authorized_devices
  alter column is_active set default false;

alter table public.authorized_devices
  alter column is_active set not null;

create or replace function public.sync_authorized_device_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is null then
      new.status := case when coalesce(new.is_active,false) then 'approved' else 'pending' end;
    end if;
    new.is_active := (new.status = 'approved');
    return new;
  end if;

  if new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'approved' else 'blocked' end;
  elsif new.status is distinct from old.status then
    new.is_active := (new.status = 'approved');
  end if;

  return new;
end;
$$;

drop trigger if exists authorized_devices_sync_state on public.authorized_devices;
create trigger authorized_devices_sync_state
before insert or update of status, is_active
on public.authorized_devices
for each row
execute function public.sync_authorized_device_state();

grant execute on function public.sync_authorized_device_state() to authenticated;

-- Rebuild the view after adding the compatibility column.
drop view if exists public.v_authorized_devices cascade;
create view public.v_authorized_devices with (security_invoker=true) as
select d.*, p.full_name user_name,
 lower(concat_ws(' ',d.device_name,p.full_name,d.platform,d.status,d.fingerprint)) search_text
from public.authorized_devices d
left join public.profiles p on p.id=d.user_id;

grant select on public.v_authorized_devices to authenticated;

update public.system_installation
set version='11.0.5', installed_at=now()
where id=1;

-- Ask PostgREST/Supabase to refresh its schema cache.
notify pgrst, 'reload schema';


-- =============================================================
-- V11 RC6 FINANCIAL CONSISTENCY PATCH
-- =============================================================

-- Numbers are generated by the database so the UI never has to supply them.
alter table public.delegate_advances
  alter column advance_no set default (
    'DA-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '-' || upper(substr(gen_random_uuid()::text,1,4))
  );

update public.delegate_advances
set advance_no = 'DA-' || to_char(coalesce(created_at,now()),'YYYYMMDDHH24MISSMS') || '-' || upper(substr(id::text,1,4))
where advance_no is null or btrim(advance_no)='';

alter table public.delegate_advances alter column advance_no set not null;

-- Receipt/payment views must not hide records when optional campaign/delegate/receipt links are null.
drop view if exists public.v_cash_receipts cascade;
create view public.v_cash_receipts with (security_invoker=true) as
select r.*, d.name donor_name, c.name campaign_name, g.full_name delegate_name, bx.name cashbox_name,
 (case when r.status='posted' then r.amount-coalesce((select sum(p.amount) from public.cash_payments p where p.cash_receipt_id=r.id and p.status='posted'),0) else 0 end)::numeric(18,2) available_balance,
 lower(concat_ws(' ',r.voucher_no,d.name,c.name,g.full_name,bx.name,r.reference_no,r.method,r.status::text)) search_text
from public.cash_receipts r
left join public.donors d on d.id=r.donor_id
left join public.campaigns c on c.id=r.campaign_id
left join public.delegates g on g.id=r.delegate_id
left join public.cashboxes bx on bx.id=r.cashbox_id;

drop view if exists public.v_cash_payments cascade;
create view public.v_cash_payments with (security_invoker=true) as
select p.*, b.full_name beneficiary_name, c.name campaign_name, d.full_name delegate_name, r.voucher_no receipt_no, bx.name cashbox_name,
 lower(concat_ws(' ',p.voucher_no,b.full_name,c.name,d.full_name,r.voucher_no,bx.name,p.transfer_no,p.status::text,p.receipt_status::text)) search_text
from public.cash_payments p
left join public.beneficiaries b on b.id=p.beneficiary_id
left join public.campaigns c on c.id=p.campaign_id
left join public.delegates d on d.id=p.delegate_id
left join public.cash_receipts r on r.id=p.cash_receipt_id
left join public.cashboxes bx on bx.id=p.cashbox_id;

grant select on public.v_cash_receipts, public.v_cash_payments to authenticated;

-- Post a distributor advance exactly once and reject insufficient cashbox balance.
drop function if exists public.post_delegate_advance(uuid);
create function public.post_delegate_advance(p_id uuid)
returns public.delegate_advances
language plpgsql security definer set search_path=public as $$
declare
  a public.delegate_advances;
  v_balance numeric(18,2);
begin
  if not public.has_role(array['admin','supervisor','accountant']::public.app_role[]) then
    raise exception 'غير مصرح بترحيل عهدة الموزع';
  end if;
  select * into a from public.delegate_advances where id=p_id for update;
  if not found then raise exception 'العهدة غير موجودة'; end if;
  if a.status in ('posted','active') then return a; end if;
  if a.status='cancelled' then raise exception 'العهدة ملغية'; end if;
  if a.amount is null or a.amount<=0 then raise exception 'مبلغ العهدة يجب أن يكون أكبر من صفر'; end if;
  if not exists(select 1 from public.delegates d where d.id=a.delegate_id and d.is_active=true) then
    raise exception 'الموزع غير موجود أو موقوف';
  end if;
  if not exists(select 1 from public.cashboxes c where c.id=a.cashbox_id and c.is_active=true) then
    raise exception 'الصندوق غير موجود أو موقوف';
  end if;
  select c.opening_balance+coalesce(sum(l.credit-l.debit),0)
    into v_balance
  from public.cashboxes c
  left join public.cashbox_ledger l on l.cashbox_id=c.id
  where c.id=a.cashbox_id
  group by c.id;
  if coalesce(v_balance,0)<a.amount then raise exception 'رصيد الصندوق غير كافٍ لتسليم العهدة'; end if;

  insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,currency,description,created_by)
  values(a.cashbox_id,'payment','delegate_advances',a.id,a.amount,'YER','عهدة موزع - '||a.advance_no,auth.uid())
  on conflict do nothing;

  update public.delegate_advances
  set status='posted'
  where id=a.id returning * into a;
  return a;
end $$;
grant execute on function public.post_delegate_advance(uuid) to authenticated;

-- Payment posting: never allows negative cashbox or delegate balance and never double-debits an advance.
drop function if exists public.post_cash_payment(uuid);
create function public.post_cash_payment(p_id uuid)
returns public.cash_payments
language plpgsql security definer set search_path=public as $$
declare
  p public.cash_payments;
  b public.beneficiaries;
  d public.delegates;
  v_box numeric(18,2);
  v_advance public.delegate_advances;
begin
  if not public.has_role(array['admin','supervisor','accountant','distributor']::public.app_role[]) then
    raise exception 'غير مصرح بترحيل سند الصرف';
  end if;
  select * into p from public.cash_payments where id=p_id for update;
  if not found then raise exception 'سند الصرف غير موجود'; end if;
  if p.status='posted' then return p; end if;
  if p.status='cancelled' then raise exception 'السند ملغي'; end if;
  if p.amount is null or p.amount<=0 then raise exception 'مبلغ الصرف يجب أن يكون أكبر من صفر'; end if;
  if public.current_user_role()='distributor' then
    p.delegate_id:=public.current_delegate_id();
    if p.delegate_id is null then raise exception 'لا يوجد موزع مرتبط بالحساب الحالي'; end if;
    update public.cash_payments set delegate_id=p.delegate_id where id=p.id;
  end if;
  if p.cashbox_id is null then raise exception 'يجب تحديد الصندوق'; end if;
  select * into b from public.beneficiaries where id=p.beneficiary_id;
  select * into d from public.delegates where id=p.delegate_id;
  if b.id is null or b.status<>'approved' then raise exception 'المستفيد غير موجود أو غير معتمد'; end if;
  if d.id is null or not d.is_active then raise exception 'الموزع غير موجود أو موقوف'; end if;
  if b.delegate_id is not null and b.delegate_id is distinct from p.delegate_id then
    raise exception 'المستفيد غير مربوط بالموزع المحدد';
  end if;

  -- Prefer an already-posted advance for this distributor and cashbox.
  select * into v_advance
  from public.delegate_advances a
  where a.delegate_id=p.delegate_id
    and a.cashbox_id=p.cashbox_id
    and a.status in ('posted','active')
    and (a.amount-a.spent_amount)>=p.amount
  order by a.advance_date,a.created_at
  limit 1 for update;

  if found then
    update public.delegate_advances
    set spent_amount=spent_amount+p.amount,
        status=case when spent_amount+p.amount>=amount then 'closed' else status end
    where id=v_advance.id;
  else
    if public.current_user_role()='distributor' then
      raise exception 'رصيد عهدة الموزع غير كافٍ';
    end if;
    select c.opening_balance+coalesce(sum(l.credit-l.debit),0)
      into v_box
    from public.cashboxes c
    left join public.cashbox_ledger l on l.cashbox_id=c.id
    where c.id=p.cashbox_id and c.is_active=true
    group by c.id;
    if coalesce(v_box,0)<p.amount then raise exception 'رصيد الصندوق غير كافٍ للصرف'; end if;
    insert into public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,currency,description,created_by)
    values(p.cashbox_id,'payment','cash_payments',p.id,p.amount,p.currency,'سند صرف '||coalesce(p.voucher_no,''),auth.uid())
    on conflict do nothing;
  end if;

  update public.cash_payments set status='posted',posted_at=coalesce(posted_at,now()) where id=p_id returning * into p;
  return p;
end $$;
grant execute on function public.post_cash_payment(uuid) to authenticated;

-- Settings are saved through one controlled RPC to avoid view/RLS/schema-cache mismatches.
drop function if exists public.save_system_settings(jsonb);
create function public.save_system_settings(p_settings jsonb)
returns public.system_settings
language plpgsql security definer set search_path=public as $$
declare r public.system_settings;
begin
  if public.current_user_role() <> 'admin' then raise exception 'إعدادات النظام متاحة للمدير فقط'; end if;
  update public.system_settings s set
    organization_name = case when p_settings ? 'organization_name' then nullif(p_settings->>'organization_name','') else s.organization_name end,
    system_name = case when p_settings ? 'system_name' then nullif(p_settings->>'system_name','') else s.system_name end,
    currency = case when p_settings ? 'currency' then (p_settings->>'currency')::char(3) else s.currency end,
    retention_years = case when p_settings ? 'retention_years' then (p_settings->>'retention_years')::integer else s.retention_years end,
    require_payment_approval = case when p_settings ? 'require_payment_approval' then (p_settings->>'require_payment_approval')::boolean else s.require_payment_approval end,
    auto_post_all_operations = case when p_settings ? 'auto_post_all_operations' then (p_settings->>'auto_post_all_operations')::boolean else s.auto_post_all_operations end,
    allow_offline_drafts = case when p_settings ? 'allow_offline_drafts' then (p_settings->>'allow_offline_drafts')::boolean else s.allow_offline_drafts end,
    allow_final_offline = case when p_settings ? 'allow_final_offline' then (p_settings->>'allow_final_offline')::boolean else s.allow_final_offline end,
    sync_mode = case when p_settings ? 'sync_mode' then p_settings->>'sync_mode' else s.sync_mode end,
    max_login_attempts = case when p_settings ? 'max_login_attempts' then (p_settings->>'max_login_attempts')::integer else s.max_login_attempts end,
    lockout_minutes = case when p_settings ? 'lockout_minutes' then (p_settings->>'lockout_minutes')::integer else s.lockout_minutes end,
    stock_alert_days = case when p_settings ? 'stock_alert_days' then (p_settings->>'stock_alert_days')::integer else s.stock_alert_days end,
    print_footer = case when p_settings ? 'print_footer' then p_settings->>'print_footer' else s.print_footer end,
    updated_by=auth.uid(), updated_at=now()
  where id=1 returning * into r;
  return r;
end $$;
grant execute on function public.save_system_settings(jsonb) to authenticated;

-- Rebuild settings view after adding auto-post columns in earlier versions.
drop view if exists public.v_system_settings cascade;
create view public.v_system_settings with (security_invoker=true) as
select s.*, lower(concat_ws(' ',s.organization_name,s.system_name,s.sync_mode,s.currency,s.print_footer)) search_text
from public.system_settings s;
grant select on public.v_system_settings to authenticated;

update public.system_installation set version='11.0.6', installed_at=now() where id=1;
notify pgrst, 'reload schema';

COMMIT;

-- =============================================================
-- V11 RC7: Campaign-owned balances (cash and in-kind)
-- Funding transfers assets from cashbox/warehouse into campaign.
-- Distribution spends only from the selected campaign balance.
-- =============================================================

-- Under the campaign-funding model, payment must not debit the cashbox again.
-- Remove legacy payment debits to prevent historical double deduction.
DELETE FROM public.cashbox_ledger
WHERE transaction_type = 'payment'
  AND reference_table = 'cash_payments';

-- Campaign cash balance is funded cash minus posted campaign payments.
DROP VIEW IF EXISTS public.campaign_balances CASCADE;
CREATE VIEW public.campaign_balances WITH (security_invoker=true) AS
SELECT
  c.id,
  c.name,
  c.currency,
  c.status,
  c.created_at,
  COALESCE(f.funded_total,0)::numeric(18,2) AS funded_total,
  COALESCE(a.allocated_total,0)::numeric(18,2) AS allocated_total,
  COALESCE(p.spent_total,0)::numeric(18,2) AS spent_total,
  COALESCE(a.returned_total,0)::numeric(18,2) AS returned_total,
  (COALESCE(f.funded_total,0)-COALESCE(a.allocated_total,0)+COALESCE(a.returned_total,0))::numeric(18,2) AS unallocated_balance,
  (COALESCE(f.funded_total,0)-COALESCE(p.spent_total,0))::numeric(18,2) AS operational_balance
FROM public.campaigns c
LEFT JOIN (
  SELECT campaign_id,SUM(amount) AS funded_total
  FROM public.campaign_funding
  WHERE status='posted'
  GROUP BY campaign_id
) f ON f.campaign_id=c.id
LEFT JOIN (
  SELECT campaign_id,SUM(allocated_amount) AS allocated_total,SUM(returned_amount) AS returned_total
  FROM public.campaign_distributors
  WHERE status <> 'suspended'
  GROUP BY campaign_id
) a ON a.campaign_id=c.id
LEFT JOIN (
  SELECT campaign_id,SUM(amount) AS spent_total
  FROM public.cash_payments
  WHERE status='posted'
  GROUP BY campaign_id
) p ON p.campaign_id=c.id;

-- Public campaign cash summary used by the main campaign screen.
DROP VIEW IF EXISTS public.v_campaign_cash_balances CASCADE;
CREATE VIEW public.v_campaign_cash_balances WITH (security_invoker=true) AS
SELECT
  c.id,
  COALESCE(cb.funded_total,0)::numeric(18,2) AS received_total,
  COALESCE(cb.spent_total,0)::numeric(18,2) AS spent_total,
  COALESCE(cb.operational_balance,0)::numeric(18,2) AS balance
FROM public.campaigns c
LEFT JOIN public.campaign_balances cb ON cb.id=c.id;

-- Rebuild campaign screen because v_campaign_cash_balances was recreated.
DROP VIEW IF EXISTS public.v_campaigns CASCADE;
CREATE VIEW public.v_campaigns WITH (security_invoker=true) AS
SELECT c.*,p.full_name AS responsible_name,
       cb.received_total,cb.spent_total,cb.balance,
       lower(concat_ws(' ',c.name,c.description,c.campaign_type::text,c.status::text,p.full_name)) AS search_text
FROM public.campaigns c
LEFT JOIN public.profiles p ON p.id=c.responsible_id
LEFT JOIN public.v_campaign_cash_balances cb ON cb.id=c.id;

-- Funding: transfer cashbox money into campaign exactly once.
DROP FUNCTION IF EXISTS public.post_campaign_funding(uuid);
CREATE FUNCTION public.post_campaign_funding(p_funding_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  f public.campaign_funding%ROWTYPE;
  v_box_balance numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بترحيل تمويل الحملة';
  END IF;

  SELECT * INTO f FROM public.campaign_funding WHERE id=p_funding_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تمويل الحملة غير موجود'; END IF;
  IF f.status='posted' THEN RETURN; END IF;
  IF f.status='cancelled' THEN RAISE EXCEPTION 'تمويل الحملة ملغي'; END IF;
  IF f.amount IS NULL OR f.amount<=0 THEN RAISE EXCEPTION 'مبلغ التمويل يجب أن يكون أكبر من صفر'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaigns c WHERE c.id=f.campaign_id AND c.status='open' AND c.campaign_type IN ('cash','mixed')) THEN
    RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تقبل تمويلاً نقدياً';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.cashboxes b WHERE b.id=f.cashbox_id AND b.is_active=true) THEN
    RAISE EXCEPTION 'الصندوق غير موجود أو موقوف';
  END IF;

  SELECT current_balance INTO v_box_balance FROM public.cashbox_balances WHERE id=f.cashbox_id;
  IF COALESCE(v_box_balance,0)<f.amount THEN
    RAISE EXCEPTION 'رصيد الصندوق غير كافٍ. المتاح % والمطلوب %',COALESCE(v_box_balance,0),f.amount;
  END IF;

  INSERT INTO public.cashbox_ledger(
    cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by
  ) VALUES(
    f.cashbox_id,'campaign_funding','campaign_funding',f.id,f.amount,0,f.currency,
    'تحويل نقدي إلى الحملة - '||COALESCE(f.funding_no,''),auth.uid()
  ) ON CONFLICT DO NOTHING;

  UPDATE public.campaign_funding
  SET status='posted',posted_at=now(),posted_by=auth.uid(),updated_at=now()
  WHERE id=f.id;
END; $$;

-- Cash distribution: spend from campaign, not from cashbox.
DROP FUNCTION IF EXISTS public.post_cash_payment(uuid);
CREATE FUNCTION public.post_cash_payment(p_id uuid)
RETURNS public.cash_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p public.cash_payments;
  b public.beneficiaries;
  d public.delegates;
  v_campaign_balance numeric(18,2);
  v_assignment public.campaign_distributors%ROWTYPE;
  v_assignment_remaining numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant','distributor']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بترحيل سند الصرف';
  END IF;

  SELECT * INTO p FROM public.cash_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف غير موجود'; END IF;
  IF p.status='posted' THEN RETURN p; END IF;
  IF p.status='cancelled' THEN RAISE EXCEPTION 'السند ملغي'; END IF;
  IF p.amount IS NULL OR p.amount<=0 THEN RAISE EXCEPTION 'مبلغ الصرف يجب أن يكون أكبر من صفر'; END IF;
  IF p.campaign_id IS NULL THEN RAISE EXCEPTION 'يجب تحديد الحملة التي سيتم الصرف من رصيدها'; END IF;

  IF public.current_user_role()='distributor' THEN
    p.delegate_id:=public.current_delegate_id();
    UPDATE public.cash_payments SET delegate_id=p.delegate_id WHERE id=p.id;
  END IF;

  SELECT * INTO b FROM public.beneficiaries WHERE id=p.beneficiary_id;
  SELECT * INTO d FROM public.delegates WHERE id=p.delegate_id;
  IF b.id IS NULL OR b.status<>'approved' THEN RAISE EXCEPTION 'المستفيد غير موجود أو غير معتمد'; END IF;
  IF d.id IS NULL OR NOT d.is_active THEN RAISE EXCEPTION 'الموزع غير موجود أو موقوف'; END IF;
  IF public.current_user_role()='distributor' AND b.delegate_id IS DISTINCT FROM p.delegate_id THEN
    RAISE EXCEPTION 'المستفيد غير مربوط بهذا الموزع';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaigns c WHERE c.id=p.campaign_id AND c.status='open' AND c.campaign_type IN ('cash','mixed')) THEN
    RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تسمح بالصرف النقدي';
  END IF;

  SELECT operational_balance INTO v_campaign_balance
  FROM public.campaign_balances WHERE id=p.campaign_id;
  IF COALESCE(v_campaign_balance,0)<p.amount THEN
    RAISE EXCEPTION 'رصيد الحملة النقدي غير كافٍ. المتاح % والمطلوب %',COALESCE(v_campaign_balance,0),p.amount;
  END IF;

  SELECT * INTO v_assignment
  FROM public.campaign_distributors
  WHERE campaign_id=p.campaign_id AND delegate_id=p.delegate_id AND status='active'
  FOR UPDATE;

  IF FOUND THEN
    v_assignment_remaining:=v_assignment.allocated_amount-v_assignment.spent_amount-v_assignment.returned_amount;
    IF v_assignment_remaining<p.amount THEN
      RAISE EXCEPTION 'رصيد الموزع المخصص من الحملة غير كافٍ. المتاح % والمطلوب %',v_assignment_remaining,p.amount;
    END IF;
    UPDATE public.campaign_distributors
    SET spent_amount=spent_amount+p.amount,
        status=CASE WHEN allocated_amount-(spent_amount+p.amount)-returned_amount<=0 THEN 'settled' ELSE status END
    WHERE id=v_assignment.id;
  ELSIF public.current_user_role()='distributor' THEN
    RAISE EXCEPTION 'الموزع غير مخصص لهذه الحملة';
  END IF;

  -- No cashbox ledger debit here: cash already left the cashbox during campaign funding.
  UPDATE public.cash_payments
  SET status='posted',posted_at=now()
  WHERE id=p_id
  RETURNING * INTO p;
  RETURN p;
END; $$;

-- Cancellation restores the campaign/distributor allocation balance.
DROP FUNCTION IF EXISTS public.cancel_cash_payment(uuid,text);
CREATE FUNCTION public.cancel_cash_payment(p_id uuid,p_reason text)
RETURNS public.cash_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p public.cash_payments;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء سند الصرف';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;

  SELECT * INTO p FROM public.cash_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف غير موجود'; END IF;
  IF p.status='cancelled' THEN RETURN p; END IF;
  IF p.status<>'posted' THEN RAISE EXCEPTION 'لا يمكن إلغاء سند غير مرحل'; END IF;

  UPDATE public.campaign_distributors
  SET spent_amount=GREATEST(spent_amount-p.amount,0),
      status=CASE WHEN status='settled' THEN 'active' ELSE status END
  WHERE campaign_id=p.campaign_id AND delegate_id=p.delegate_id;

  UPDATE public.cash_payments
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason)
  WHERE id=p_id
  RETURNING * INTO p;
  RETURN p;
END; $$;

-- In-kind distribution already consumes only lots assigned to the selected campaign.
-- Tighten validation and prevent warehouse/general-stock fallback.
DROP FUNCTION IF EXISTS public.post_in_kind_payment(uuid);
CREATE FUNCTION public.post_in_kind_payment(p_id uuid)
RETURNS public.in_kind_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p public.in_kind_payments;
  det public.in_kind_payment_details;
  lot public.inventory_lots;
  v_available numeric(18,3);
  v_needed numeric(18,3);
  v_take numeric(18,3);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse','distributor']::public.app_role[]) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  SELECT * INTO p FROM public.in_kind_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف العيني غير موجود'; END IF;
  IF p.status='posted' THEN RETURN p; END IF;
  IF p.status='cancelled' THEN RAISE EXCEPTION 'السند ملغي'; END IF;
  IF p.campaign_id IS NULL THEN RAISE EXCEPTION 'يجب تحديد الحملة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaigns c WHERE c.id=p.campaign_id AND c.status='open' AND c.campaign_type IN ('in_kind','mixed')) THEN
    RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تسمح بالصرف العيني';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.in_kind_payment_details WHERE payment_id=p.id) THEN RAISE EXCEPTION 'السند لا يحتوي أصنافاً'; END IF;

  FOR det IN SELECT * FROM public.in_kind_payment_details WHERE payment_id=p.id LOOP
    IF det.quantity<=0 THEN RAISE EXCEPTION 'كمية الصنف يجب أن تكون أكبر من صفر'; END IF;
    SELECT COALESCE(SUM(quantity_available),0) INTO v_available
    FROM public.inventory_lots
    WHERE item_id=det.item_id AND campaign_id=p.campaign_id
      AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date);
    IF v_available<det.quantity THEN
      RAISE EXCEPTION 'رصيد الحملة العيني غير كاف للصنف %. المتاح % والمطلوب %',det.item_id,v_available,det.quantity;
    END IF;

    v_needed:=det.quantity;
    FOR lot IN
      SELECT * FROM public.inventory_lots
      WHERE item_id=det.item_id AND campaign_id=p.campaign_id
        AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date)
      ORDER BY expiry_date NULLS LAST,created_at FOR UPDATE
    LOOP
      EXIT WHEN v_needed<=0;
      v_take:=LEAST(v_needed,lot.quantity_available);
      UPDATE public.inventory_lots SET quantity_available=quantity_available-v_take WHERE id=lot.id;
      INSERT INTO public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
      VALUES(lot.id,det.item_id,'out',v_take,'in_kind_payments',p.id,det.id);
      v_needed:=v_needed-v_take;
    END LOOP;
  END LOOP;

  UPDATE public.in_kind_payments SET status='posted',posted_at=now() WHERE id=p_id RETURNING * INTO p;
  RETURN p;
END; $$;

GRANT SELECT ON public.campaign_balances,public.v_campaign_cash_balances,public.v_campaigns TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_campaign_funding(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_cash_payment(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_in_kind_payment(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
