-- =============================================================
-- نظام إدارة الزكاة والتبرعات V12.0.0
-- ملف قاعدة البيانات الكامل والوحيد
-- يشمل المخطط الأساسي، تحسينات ملاحظات الإدارة، والقواعد المالية النهائية.
-- ينتهي الملف بحذف الوحدة النقدية القديمة للموزع واعتماد تخصيصات الحملات فقط.
-- =============================================================

-- القسم 1: المخطط الأساسي
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

grant select on public.cashbox_balances,public.campaign_balances,public.v_cashboxes,public.v_cashbox_users,public.v_cash_transfers,public.v_authorized_devices,public.v_user_sessions,public.v_user_archives,public.v_warehouses,public.v_stock_balances,public.v_bulk_disbursements,public.v_disbursement_results,public.v_distribution_assignments,public.v_campaign_funding,public.v_campaign_distributors to authenticated;
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
    'branches','cashboxes','cashbox_users','cash_transfers',
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
      ('authorized_devices'),('user_sessions'),
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

/* V11.2 removes the obsolete distributor-advance payment model.
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
*/


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

/* V11.2 removes the duplicate obsolete distributor-advance payment model.
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
*/



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

/* V11.2 removes the obsolete advance-based quick-delivery implementation.
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
*/


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


/* V11.2 removes the last obsolete advance-based quick-delivery implementation.
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
*/


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

/* V11.2 removes the legacy distributor-advance table and its number generator.
-- Numbers are generated by the database so the UI never has to supply them.
alter table public.delegate_advances
  alter column advance_no set default (
    'DA-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '-' || upper(substr(gen_random_uuid()::text,1,4))
  );

update public.delegate_advances
set advance_no = 'DA-' || to_char(coalesce(created_at,now()),'YYYYMMDDHH24MISSMS') || '-' || upper(substr(id::text,1,4))
where advance_no is null or btrim(advance_no)='';

alter table public.delegate_advances alter column advance_no set not null;
*/

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

/* V11.2 removes the obsolete distributor-advance posting and payment functions.
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
*/

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

-- =============================================================
-- القسم 2: حقول ومراقبة ومتطلبات ملاحظات الإدارة
-- =============================================================
-- Zakat System V11.1.0 — Manager Notes upgrade
-- Run after supabase/database_complete.sql on existing or fresh installations.
-- The migration is transactional and can be re-run safely.

BEGIN;

-- Extended party and beneficiary data.
ALTER TABLE public.delegates DROP CONSTRAINT IF EXISTS delegates_phone_not_null;
ALTER TABLE public.delegates ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.delegates ADD COLUMN IF NOT EXISTS phone_secondary text;
ALTER TABLE public.delegates ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.delegates ADD COLUMN IF NOT EXISTS profile_image_url text;
ALTER TABLE public.delegates ADD COLUMN IF NOT EXISTS identity_image_url text;

ALTER TABLE public.donors ADD COLUMN IF NOT EXISTS phone_secondary text;
ALTER TABLE public.donors ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.donors ADD COLUMN IF NOT EXISTS representative_name text;
ALTER TABLE public.donors ADD COLUMN IF NOT EXISTS representative_phone text;

ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS phone_secondary text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS governorate text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS village text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS guardian_name text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS housing_status text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS monthly_income numeric(18,2) CHECK (monthly_income IS NULL OR monthly_income >= 0);
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS profile_image_url text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS identity_image_url text;

ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS require_device_authorization boolean NOT NULL DEFAULT true;
UPDATE public.system_settings SET require_device_authorization=true WHERE id=1;

ALTER TABLE public.campaign_funding ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.campaign_funding ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- Device identity is sent as a custom Data API header. Role helpers deny
-- privileged database operations until that exact local device is approved.
CREATE OR REPLACE FUNCTION public.raw_current_user_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT role FROM public.profiles
  WHERE id=auth.uid() AND is_active=true AND COALESCE(status,'active')='active'
    AND (expires_at IS NULL OR expires_at>=current_date)
$$;

CREATE OR REPLACE FUNCTION public.has_authorized_device()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.authorized_devices d
    WHERE d.user_id=auth.uid() AND d.status='approved' AND d.is_active=true
      AND d.fingerprint=(COALESCE(NULLIF(current_setting('request.headers',true),''),'{}')::jsonb->>'x-device-fingerprint')
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN public.has_authorized_device() THEN public.raw_current_user_role() ELSE NULL::public.app_role END
$$;

CREATE OR REPLACE FUNCTION public.has_role(allowed public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(public.current_user_role()=ANY(allowed),false)
$$;

CREATE OR REPLACE FUNCTION public.current_delegate_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT d.id FROM public.delegates d
  WHERE public.has_authorized_device() AND d.profile_id=auth.uid() AND d.is_active=true
  ORDER BY d.created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_authorized_device() AND public.raw_current_user_role()='admin'
$$;

CREATE OR REPLACE FUNCTION public.enforce_approved_device()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_path text:=trim(both '/' FROM COALESCE(current_setting('request.path',true),''));
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF v_path IN ('rpc/request_device_authorization','login_attempts') THEN RETURN; END IF;
  IF NOT public.has_authorized_device() THEN
    RAISE EXCEPTION 'هذا الجهاز غير معتمد لاستخدام النظام';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.fill_delegate_from_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
  IF NEW.profile_id IS NOT NULL THEN
    SELECT * INTO p FROM public.profiles WHERE id=NEW.profile_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'حساب المستخدم المرتبط غير موجود'; END IF;
    NEW.full_name:=COALESCE(NULLIF(NEW.full_name,''),p.full_name);
    NEW.phone:=COALESCE(NULLIF(NEW.phone,''),p.phone);
  END IF;
  IF NULLIF(trim(NEW.full_name),'') IS NULL THEN RAISE EXCEPTION 'اسم الموزع مطلوب'; END IF;
  IF NEW.profile_id IS NULL AND NULLIF(trim(NEW.phone),'') IS NULL THEN RAISE EXCEPTION 'الهاتف مطلوب عند عدم ربط حساب مستخدم'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fill_delegate_from_profile_trigger ON public.delegates;
CREATE TRIGGER fill_delegate_from_profile_trigger BEFORE INSERT OR UPDATE OF profile_id,full_name,phone ON public.delegates
FOR EACH ROW EXECUTE FUNCTION public.fill_delegate_from_profile();

-- Safe auth trigger: role never comes from editable raw_user_meta_data.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user();
CREATE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.profiles(id,full_name,username,email,phone,role,status)
  VALUES(
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name',''),split_part(COALESCE(NEW.email,'user'),'@',1)),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'username',''),split_part(COALESCE(NEW.email,NEW.id::text),'@',1)||'_'||substr(NEW.id::text,1,6)),
    NEW.email,NULLIF(NEW.raw_user_meta_data->>'phone',''),'data_entry'::public.app_role,'active'
  )
  ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,phone=COALESCE(excluded.phone,public.profiles.phone),email=excluded.email;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Device authorization. Authentication alone is not enough to enter the app.
DROP FUNCTION IF EXISTS public.request_device_authorization(text,text,text);
CREATE FUNCTION public.request_device_authorization(p_fingerprint text,p_device_name text,p_platform text)
RETURNS TABLE(device_id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.authorized_devices%ROWTYPE; v_required boolean; v_bootstrap_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF public.raw_current_user_role() IS NULL THEN RAISE EXCEPTION 'الحساب موقوف أو منتهي الصلاحية'; END IF;
  IF NULLIF(trim(p_fingerprint),'') IS NULL THEN RAISE EXCEPTION 'بصمة الجهاز مطلوبة'; END IF;
  SELECT * INTO d FROM public.authorized_devices WHERE fingerprint=p_fingerprint FOR UPDATE;
  IF FOUND AND d.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'بصمة الجهاز مرتبطة بمستخدم آخر'; END IF;
  SELECT COALESCE(require_device_authorization,true) INTO v_required FROM public.system_settings WHERE id=1;
  IF NOT FOUND THEN v_required:=true; END IF;
  IF d.id IS NULL THEN
    -- Avoid a deadlock on a fresh installation: the first active administrator
    -- device is approved automatically; every later device follows the policy.
    SELECT public.raw_current_user_role()='admin'
       AND NOT EXISTS(SELECT 1 FROM public.authorized_devices ad0)
      INTO v_bootstrap_admin;
    INSERT INTO public.authorized_devices(user_id,device_name,fingerprint,platform,status,is_active,last_seen_at)
    VALUES(
      auth.uid(),COALESCE(NULLIF(trim(p_device_name),''),'جهاز ويب'),p_fingerprint,p_platform,
      CASE WHEN v_bootstrap_admin OR NOT v_required THEN 'approved' ELSE 'pending' END,
      v_bootstrap_admin OR NOT v_required,now()
    )
    RETURNING * INTO d;
  ELSE
    UPDATE public.authorized_devices ad SET device_name=COALESCE(NULLIF(trim(p_device_name),''),ad.device_name),platform=COALESCE(p_platform,ad.platform),last_seen_at=now(),is_active=(ad.status='approved') WHERE ad.id=d.id RETURNING * INTO d;
  END IF;
  RETURN QUERY SELECT d.id,d.status;
END; $$;

DROP FUNCTION IF EXISTS public.open_user_session(text,text);
CREATE FUNCTION public.open_user_session(p_fingerprint text,p_device_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.authorized_devices%ROWTYPE; v_id uuid; v_branch uuid;
BEGIN
  SELECT * INTO d FROM public.authorized_devices WHERE fingerprint=p_fingerprint AND user_id=auth.uid() AND status='approved' AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجهاز غير معتمد'; END IF;
  SELECT branch_id INTO v_branch FROM public.profiles WHERE id=auth.uid();
  UPDATE public.user_sessions SET status='inactive',logout_at=COALESCE(logout_at,now()) WHERE user_id=auth.uid() AND status='active';
  INSERT INTO public.user_sessions(user_id,device_id,branch_id,login_at,last_activity_at,status)
  VALUES(auth.uid(),d.id,v_branch,now(),now(),'active') RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

DROP FUNCTION IF EXISTS public.close_user_session(uuid);
CREATE FUNCTION public.close_user_session(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.user_sessions SET status='inactive',logout_at=now(),last_activity_at=now() WHERE id=p_session_id AND user_id=auth.uid();
END; $$;

DROP FUNCTION IF EXISTS public.touch_user_session(uuid);
CREATE FUNCTION public.touch_user_session(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.user_sessions
  SET last_activity_at=now()
  WHERE id=p_session_id AND user_id=auth.uid() AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'جلسة المستخدم غير نشطة'; END IF;
END; $$;

-- Backdated vouchers require a privileged role. The UI displays a warning; this trigger enforces it.
CREATE OR REPLACE FUNCTION public.enforce_backdated_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_date date;
BEGIN
  v_date:=NULLIF(to_jsonb(NEW)->>TG_ARGV[0],'')::date;
  IF v_date < current_date AND NOT public.has_role(ARRAY['admin','supervisor']::public.app_role[]) THEN
    RAISE EXCEPTION 'التسجيل بتاريخ سابق متاح للمدير أو المشرف فقط';
  END IF;
  RETURN NEW;
END; $$;

DO $$ DECLARE x record;
BEGIN
  FOR x IN SELECT * FROM (VALUES
    ('cash_receipts','receipt_date'),('cash_payments','payment_date'),('cash_transfers','transfer_date'),
    ('campaign_funding','funding_date'),('in_kind_receipts','receipt_date'),
    ('campaign_in_kind_funding','funding_date'),('in_kind_payments','payment_date')
  ) AS t(table_name,date_column)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_backdate ON public.%I',x.table_name);
    EXECUTE format('CREATE TRIGGER enforce_backdate BEFORE INSERT OR UPDATE OF %I ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_backdated_document(%L)',x.date_column,x.table_name,x.date_column);
  END LOOP;
END $$;

-- Transfers now lock both boxes and return precise validation messages.
DROP FUNCTION IF EXISTS public.post_cash_transfer(uuid);
CREATE FUNCTION public.post_cash_transfer(p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.cash_transfers%ROWTYPE; v_from public.cashboxes%ROWTYPE; v_to public.cashboxes%ROWTYPE; v_balance numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN RAISE EXCEPTION 'غير مصرح بترحيل التحويل'; END IF;
  SELECT * INTO v FROM public.cash_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF v.status='posted' THEN RETURN; END IF;
  IF v.status<>'draft' THEN RAISE EXCEPTION 'لا يمكن ترحيل تحويل حالته %',v.status; END IF;
  IF v.amount IS NULL OR v.amount<=0 THEN RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون أكبر من صفر'; END IF;
  IF v.from_cashbox_id=v.to_cashbox_id THEN RAISE EXCEPTION 'لا يمكن التحويل إلى نفس الصندوق'; END IF;
  PERFORM id FROM public.cashboxes WHERE id IN(v.from_cashbox_id,v.to_cashbox_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_from FROM public.cashboxes WHERE id=v.from_cashbox_id;
  SELECT * INTO v_to FROM public.cashboxes WHERE id=v.to_cashbox_id;
  IF v_from.id IS NULL THEN RAISE EXCEPTION 'الصندوق المصدر غير موجود'; END IF;
  IF v_to.id IS NULL THEN RAISE EXCEPTION 'الصندوق الهدف غير موجود'; END IF;
  IF NOT v_from.is_active THEN RAISE EXCEPTION 'الصندوق المصدر موقوف'; END IF;
  IF NOT v_to.is_active THEN RAISE EXCEPTION 'الصندوق الهدف موقوف'; END IF;
  IF v_from.currency<>v_to.currency THEN RAISE EXCEPTION 'لا يمكن التحويل بين عملتين مختلفتين (% و%)',v_from.currency,v_to.currency; END IF;
  SELECT current_balance INTO v_balance FROM public.v_cashboxes WHERE id=v_from.id;
  IF COALESCE(v_balance,0)<v.amount THEN RAISE EXCEPTION 'رصيد الصندوق المصدر غير كافٍ. المتاح % والمطلوب %',COALESCE(v_balance,0),v.amount; END IF;
  UPDATE public.cash_transfers SET currency=v_from.currency WHERE id=v.id;
  INSERT INTO public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
  VALUES(v.from_cashbox_id,'transfer_out','cash_transfers',v.id,v.amount,0,v_from.currency,'تحويل صادر - '||v.transfer_no,auth.uid()) ON CONFLICT DO NOTHING;
  INSERT INTO public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
  VALUES(v.to_cashbox_id,'transfer_in','cash_transfers',v.id,0,v.amount,v_to.currency,'تحويل وارد - '||v.transfer_no,auth.uid()) ON CONFLICT DO NOTHING;
  UPDATE public.cash_transfers SET status='posted' WHERE id=v.id;
END; $$;

DROP FUNCTION IF EXISTS public.cancel_campaign_funding(uuid,text);
CREATE FUNCTION public.cancel_campaign_funding(p_id uuid,p_reason text)
RETURNS public.campaign_funding LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.campaign_funding; v_operational numeric(18,2); v_other_funding numeric(18,2); v_committed numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN RAISE EXCEPTION 'غير مصرح بإلغاء تمويل الحملة'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO f FROM public.campaign_funding WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تمويل الحملة غير موجود'; END IF;
  IF f.status='cancelled' THEN RETURN f; END IF;
  IF f.status='posted' THEN
    SELECT COALESCE(operational_balance,0) INTO v_operational FROM public.campaign_balances WHERE id=f.campaign_id;
    IF v_operational<f.amount THEN RAISE EXCEPTION 'لا يمكن الإلغاء لأن جزءاً من هذا التمويل صُرف بالفعل'; END IF;
    SELECT COALESCE(SUM(amount),0) INTO v_other_funding FROM public.campaign_funding WHERE campaign_id=f.campaign_id AND status='posted' AND id<>f.id;
    SELECT COALESCE(SUM(allocated_amount-returned_amount),0) INTO v_committed FROM public.campaign_distributors WHERE campaign_id=f.campaign_id;
    IF v_other_funding<v_committed THEN RAISE EXCEPTION 'لا يمكن الإلغاء قبل تخفيض أو تسوية تخصيصات الموزعين'; END IF;
    INSERT INTO public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
    VALUES(f.cashbox_id,'refund','campaign_funding',f.id,0,f.amount,f.currency,'عكس تمويل حملة - '||f.funding_no,auth.uid()) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.campaign_funding SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now() WHERE id=f.id RETURNING * INTO f;
  RETURN f;
END; $$;

-- Quick-delivery context used by autocomplete before posting.
DROP FUNCTION IF EXISTS public.get_quick_delivery_context(uuid);
CREATE FUNCTION public.get_quick_delivery_context(p_beneficiary_id uuid)
RETURNS TABLE(beneficiary_id uuid,delegate_id uuid,delegate_name text,campaign_id uuid,campaign_name text,cashbox_id uuid,cashbox_name text,currency text,available_amount numeric,assignment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_role public.app_role; v_delegate uuid;
BEGIN
  v_role:=public.current_user_role();
  IF v_role NOT IN ('admin','supervisor','accountant','distributor') THEN RAISE EXCEPTION 'غير مصرح بالتسليم السريع'; END IF;
  SELECT b.delegate_id INTO v_delegate FROM public.beneficiaries b WHERE b.id=p_beneficiary_id AND b.status='approved';
  IF v_delegate IS NULL THEN RAISE EXCEPTION 'المستفيد غير موجود أو غير معتمد أو غير مربوط بموزع'; END IF;
  IF v_role='distributor' AND v_delegate IS DISTINCT FROM public.current_delegate_id() THEN RAISE EXCEPTION 'المستفيد غير مرتبط بالموزع الحالي'; END IF;
  RETURN QUERY
  SELECT p_beneficiary_id,d.id,d.full_name,c.id,c.name,cb.id,cb.name,cb.currency::text,
         GREATEST(LEAST(cd.allocated_amount-cd.spent_amount-cd.returned_amount,COALESCE(bl.operational_balance,0)),0)::numeric,
         cd.id
  FROM public.campaign_distributors cd
  JOIN public.delegates d ON d.id=cd.delegate_id AND d.is_active=true
  JOIN public.campaigns c ON c.id=cd.campaign_id AND c.status='open' AND c.campaign_type IN ('cash','mixed')
  JOIN public.cashboxes cb ON cb.id=cd.cashbox_id AND cb.is_active=true
  LEFT JOIN public.campaign_balances bl ON bl.id=c.id
  WHERE cd.delegate_id=v_delegate AND cd.status='active'
    AND cd.allocated_amount-cd.spent_amount-cd.returned_amount>0 AND COALESCE(bl.operational_balance,0)>0
  ORDER BY cd.assigned_at DESC LIMIT 1;
END; $$;

DROP FUNCTION IF EXISTS public.quick_deliver_cash(text,numeric);
DROP FUNCTION IF EXISTS public.quick_deliver_cash(text,numeric,uuid);
DROP FUNCTION IF EXISTS public.quick_deliver_cash(uuid,numeric,uuid,uuid);
CREATE FUNCTION public.quick_deliver_cash(p_beneficiary_id uuid,p_amount numeric,p_campaign_id uuid,p_cashbox_id uuid)
RETURNS public.cash_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ctx record; v_payment uuid; result public.cash_payments;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  -- Serialise delivery for this beneficiary so two simultaneous requests
  -- cannot both pass the duplicate-payment check.
  PERFORM 1 FROM public.beneficiaries WHERE id=p_beneficiary_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المستفيد غير موجود'; END IF;
  SELECT * INTO ctx FROM public.get_quick_delivery_context(p_beneficiary_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد تخصيص صالح أو رصيد متاح لهذا المستفيد'; END IF;
  IF ctx.campaign_id IS DISTINCT FROM p_campaign_id OR ctx.cashbox_id IS DISTINCT FROM p_cashbox_id THEN RAISE EXCEPTION 'تغيّر تخصيص المستفيد؛ أعد اختياره'; END IF;
  IF p_amount>ctx.available_amount THEN RAISE EXCEPTION 'المبلغ يتجاوز المتاح. المتاح %',ctx.available_amount; END IF;
  IF EXISTS(SELECT 1 FROM public.cash_payments WHERE beneficiary_id=p_beneficiary_id AND campaign_id=p_campaign_id AND status='posted') THEN RAISE EXCEPTION 'المستفيد استلم سابقاً من هذه الحملة'; END IF;
  INSERT INTO public.cash_payments(payment_date,delegate_id,beneficiary_id,campaign_id,cashbox_id,amount,currency,delivery_method,receipt_status,actual_recipient,status,created_by,notes)
  SELECT current_date,ctx.delegate_id,b.id,ctx.campaign_id,ctx.cashbox_id,p_amount,ctx.currency,'cash','received',b.full_name,'draft',auth.uid(),'تسليم سريع'
  FROM public.beneficiaries b WHERE b.id=p_beneficiary_id RETURNING id INTO v_payment;
  result:=public.post_cash_payment(v_payment);
  INSERT INTO public.distribution_assignments(beneficiary_id,delegate_id,campaign_id,amount,delivery_status,delivered_at,payment_id)
  VALUES(p_beneficiary_id,ctx.delegate_id,ctx.campaign_id,p_amount,'received',now(),v_payment);
  RETURN result;
END; $$;

-- Basket payments automatically expand the basket into detail rows.
DROP FUNCTION IF EXISTS public.post_in_kind_payment(uuid);
CREATE FUNCTION public.post_in_kind_payment(p_id uuid)
RETURNS public.in_kind_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.in_kind_payments; det public.in_kind_payment_details; lot public.inventory_lots; v_available numeric(18,3); v_needed numeric(18,3); v_take numeric(18,3);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse','distributor']::public.app_role[]) THEN RAISE EXCEPTION 'غير مصرح بترحيل الصرف العيني'; END IF;
  SELECT * INTO p FROM public.in_kind_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف العيني غير موجود'; END IF;
  IF p.status='posted' THEN RETURN p; END IF;
  IF p.status='cancelled' THEN RAISE EXCEPTION 'السند ملغي'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.beneficiaries b WHERE b.id=p.beneficiary_id AND b.status='approved') THEN RAISE EXCEPTION 'المستفيد غير معتمد'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaigns c WHERE c.id=p.campaign_id AND c.status='open' AND c.campaign_type IN ('in_kind','mixed')) THEN RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تسمح بالصرف العيني'; END IF;
  IF public.current_user_role()='distributor' THEN
    IF p.delegate_id IS DISTINCT FROM public.current_delegate_id() THEN RAISE EXCEPTION 'السند غير مرتبط بالموزع الحالي'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.in_kind_payments x WHERE x.id<>p.id AND x.beneficiary_id=p.beneficiary_id AND x.campaign_id=p.campaign_id AND x.status='posted' AND (p.basket_id IS NULL OR x.basket_id=p.basket_id)) AND NULLIF(trim(p.override_reason),'') IS NULL THEN RAISE EXCEPTION 'المستفيد استلم هذه المساعدة سابقاً'; END IF;
  IF p.distribution_type='basket' AND p.basket_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.in_kind_payment_details WHERE payment_id=p.id) THEN
    IF NOT EXISTS(SELECT 1 FROM public.baskets b WHERE b.id=p.basket_id AND b.campaign_id=p.campaign_id AND b.is_active=true) THEN RAISE EXCEPTION 'السلة غير نشطة أو لا تتبع الحملة'; END IF;
    INSERT INTO public.in_kind_payment_details(payment_id,item_id,quantity)
    SELECT p.id,bi.item_id,bi.quantity FROM public.basket_items bi WHERE bi.basket_id=p.basket_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.in_kind_payment_details WHERE payment_id=p.id) THEN RAISE EXCEPTION 'السند لا يحتوي أصنافاً'; END IF;
  FOR det IN SELECT * FROM public.in_kind_payment_details WHERE payment_id=p.id LOOP
    SELECT COALESCE(SUM(quantity_available),0) INTO v_available FROM public.inventory_lots WHERE item_id=det.item_id AND campaign_id=p.campaign_id AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date);
    IF v_available<det.quantity THEN RAISE EXCEPTION 'رصيد الحملة العيني غير كاف للصنف %. المتاح % والمطلوب %',det.item_id,v_available,det.quantity; END IF;
    v_needed:=det.quantity;
    FOR lot IN SELECT * FROM public.inventory_lots WHERE item_id=det.item_id AND campaign_id=p.campaign_id AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date) ORDER BY expiry_date NULLS LAST,created_at FOR UPDATE LOOP
      EXIT WHEN v_needed<=0; v_take:=LEAST(v_needed,lot.quantity_available);
      UPDATE public.inventory_lots SET quantity_available=quantity_available-v_take WHERE id=lot.id;
      INSERT INTO public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id) VALUES(lot.id,det.item_id,'out',v_take,'in_kind_payments',p.id,det.id);
      v_needed:=v_needed-v_take;
    END LOOP;
  END LOOP;
  UPDATE public.in_kind_payments SET status='posted',posted_at=now() WHERE id=p_id RETURNING * INTO p;
  RETURN p;
END; $$;

-- Cancelling a posted receipt creates a debit refund, restoring the cashbox balance.
DROP FUNCTION IF EXISTS public.cancel_cash_receipt(uuid,text);
CREATE FUNCTION public.cancel_cash_receipt(p_id uuid,p_reason text)
RETURNS public.cash_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.cash_receipts;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN RAISE EXCEPTION 'غير مصرح بإلغاء سند القبض'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO r FROM public.cash_receipts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند القبض غير موجود'; END IF;
  IF r.status='cancelled' THEN RETURN r; END IF;
  IF EXISTS(SELECT 1 FROM public.cash_payments p WHERE p.cash_receipt_id=r.id AND p.status='posted') THEN RAISE EXCEPTION 'لا يمكن إلغاء سند قبض مرتبط بصرف مرحل'; END IF;
  IF r.status='posted' THEN
    INSERT INTO public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
    VALUES(r.cashbox_id,'refund','cash_receipts',r.id,r.amount,0,r.currency,'عكس سند قبض - '||r.voucher_no,auth.uid()) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.cash_receipts SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now() WHERE id=p_id RETURNING * INTO r;
  RETURN r;
END; $$;

-- Views regenerated after schema expansion.
DROP VIEW IF EXISTS public.v_delegates CASCADE;
CREATE VIEW public.v_delegates WITH (security_invoker=true) AS
SELECT d.*,COALESCE(cb.cash_balance,0) cash_balance,COALESCE((SELECT SUM(l.quantity_available) FROM public.inventory_lots l WHERE l.delegate_id=d.id),0) inventory_count,
 lower(concat_ws(' ',d.full_name,d.phone,d.phone_secondary,d.national_id,d.address,d.delegate_type::text)) search_text
FROM public.delegates d LEFT JOIN public.v_delegate_cash_balances cb ON cb.id=d.id;

DROP VIEW IF EXISTS public.v_donors CASCADE;
CREATE VIEW public.v_donors WITH (security_invoker=true) AS
SELECT d.*,COALESCE((SELECT SUM(r.amount) FROM public.cash_receipts r WHERE r.donor_id=d.id AND r.status='posted'),0)::numeric(18,2) cash_total,
 (SELECT COUNT(*) FROM public.in_kind_receipts ir WHERE ir.donor_id=d.id AND ir.status='posted') in_kind_total,
 lower(concat_ws(' ',d.name,d.phone,d.phone_secondary,d.identity_no,d.email,d.address,d.representative_name,d.representative_phone,d.donor_type::text)) search_text
FROM public.donors d;

DROP VIEW IF EXISTS public.v_beneficiaries CASCADE;
CREATE VIEW public.v_beneficiaries WITH (security_invoker=true) AS
SELECT b.*,c.name category_name,h.name health_condition_name,d.full_name delegate_name,
 lower(concat_ws(' ',b.file_no,b.full_name,b.national_id,b.phone,b.phone_secondary,b.governorate,b.district,b.village,b.address,b.guardian_name,c.name,h.name,d.full_name,b.status::text)) search_text
FROM public.beneficiaries b JOIN public.beneficiary_categories c ON c.id=b.category_id LEFT JOIN public.health_conditions h ON h.id=b.health_condition_id LEFT JOIN public.delegates d ON d.id=b.delegate_id;

DROP VIEW IF EXISTS public.v_campaign_in_kind_funding CASCADE;
CREATE VIEW public.v_campaign_in_kind_funding WITH (security_invoker=true) AS
SELECT f.*,c.name campaign_name,w.name warehouse_name,COUNT(fd.id) items_count,COALESCE(SUM(fd.quantity),0) total_quantity,
 COALESCE(string_agg(i.name||' × '||trim(to_char(fd.quantity,'FM999999990.###')),'، ' ORDER BY i.name),'') items_summary,
 lower(concat_ws(' ',f.funding_no,c.name,w.name,f.status::text,f.notes,string_agg(i.name,' '))) search_text
FROM public.campaign_in_kind_funding f JOIN public.campaigns c ON c.id=f.campaign_id JOIN public.warehouses w ON w.id=f.warehouse_id
LEFT JOIN public.campaign_in_kind_funding_details fd ON fd.funding_id=f.id LEFT JOIN public.items i ON i.id=fd.item_id
GROUP BY f.id,c.name,w.name;

DROP VIEW IF EXISTS public.v_stock_balances CASCADE;
CREATE VIEW public.v_stock_balances WITH (security_invoker=true) AS
SELECT min(l.id::text)::uuid id,l.warehouse_id,l.item_id,w.name warehouse_name,i.name item_name,i.code item_code,i.unit unit_name,
 COALESCE(SUM(l.quantity_available),0)::numeric(18,3) available_qty,0::numeric(18,3) reserved_qty,COALESCE(SUM(l.quantity_damaged),0)::numeric(18,3) damaged_qty,
 COALESCE(i.min_stock,0)::numeric min_stock,CASE WHEN COALESCE(SUM(l.quantity_available),0)<=COALESCE(i.min_stock,0) THEN 'review' ELSE 'active' END status,
 max(l.updated_at) updated_at,lower(concat_ws(' ',w.name,i.name,i.code,i.unit)) search_text
FROM public.inventory_lots l JOIN public.warehouses w ON w.id=l.warehouse_id JOIN public.items i ON i.id=l.item_id
WHERE l.warehouse_id IS NOT NULL AND l.campaign_id IS NULL GROUP BY l.warehouse_id,l.item_id,w.name,i.name,i.code,i.unit,i.min_stock;

DROP VIEW IF EXISTS public.v_user_archives CASCADE;
CREATE VIEW public.v_user_archives WITH (security_invoker=true) AS
SELECT a.id,a.user_id,a.archive_type,a.title,a.description,a.reference_no,a.payload,a.created_at,p.full_name user_name,
 lower(concat_ws(' ',p.full_name,a.archive_type,a.title,a.description,a.reference_no)) search_text
FROM public.user_archives a LEFT JOIN public.profiles p ON p.id=a.user_id
UNION ALL
SELECT l.id,l.user_id,l.action,l.action||' — '||l.table_name,l.table_name,l.record_id::text,jsonb_build_object('old',l.old_data,'new',l.new_data),l.created_at,p.full_name,
 lower(concat_ws(' ',p.full_name,l.action,l.table_name,l.record_id::text))
FROM public.audit_logs l LEFT JOIN public.profiles p ON p.id=l.user_id;

DROP VIEW IF EXISTS public.v_import_jobs CASCADE;
CREATE VIEW public.v_import_jobs WITH (security_invoker=true) AS
SELECT j.*,p.full_name created_by_name,
 CASE j.target_table
   WHEN 'beneficiaries' THEN 'المستفيدون' WHEN 'delegates' THEN 'الموزعون' WHEN 'donors' THEN 'المتبرعون'
   WHEN 'beneficiary_categories' THEN 'فئات المستفيدين' WHEN 'health_conditions' THEN 'الحالات الصحية'
   WHEN 'items' THEN 'الأصناف' WHEN 'units' THEN 'الوحدات' WHEN 'branches' THEN 'الفروع'
   WHEN 'cashboxes' THEN 'الصناديق' WHEN 'warehouses' THEN 'المخازن' ELSE j.target_table
 END target_name,
 lower(concat_ws(' ',j.target_table,j.file_name,j.status,p.full_name)) search_text
FROM public.import_jobs j LEFT JOIN public.profiles p ON p.id=j.created_by;

-- Expand automatic auditing to all manager-facing operational directories.
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','cashboxes','cash_transfers','authorized_devices','user_sessions','beneficiary_categories','health_conditions','warehouses','units','campaign_funding','campaign_distributors','campaign_in_kind_funding','inventory_lots','import_jobs']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',t,t);
  END LOOP;
END $$;

-- Tighten policies that were previously unrestricted.
DO $$ DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='authorized_devices'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.authorized_devices',p.policyname); END LOOP;
END $$;
CREATE POLICY authorized_devices_read_own_or_admin ON public.authorized_devices FOR SELECT TO authenticated
USING(user_id=auth.uid() OR public.is_active_admin());
CREATE POLICY authorized_devices_admin_manage ON public.authorized_devices FOR ALL TO authenticated
USING(public.is_active_admin()) WITH CHECK(public.is_active_admin());

DROP POLICY IF EXISTS authenticated_manage_campaign_funding ON public.campaign_funding;
CREATE POLICY authenticated_manage_campaign_funding ON public.campaign_funding FOR ALL TO authenticated
USING(public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[])) WITH CHECK(public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]));
DROP POLICY IF EXISTS authenticated_manage_campaign_distributors ON public.campaign_distributors;
CREATE POLICY authenticated_manage_campaign_distributors ON public.campaign_distributors FOR ALL TO authenticated
USING(public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[])) WITH CHECK(public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]));

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_username(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_approved_device() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role(),public.has_role(public.app_role[]),public.current_delegate_id(),public.is_active_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_device_authorization(text,text,text),public.open_user_session(text,text),public.close_user_session(uuid),public.touch_user_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_transfer(uuid),public.cancel_campaign_funding(uuid,text),public.quick_deliver_cash(uuid,numeric,uuid,uuid),public.get_quick_delivery_context(uuid),public.post_in_kind_payment(uuid),public.cancel_cash_receipt(uuid,text) TO authenticated;
GRANT SELECT ON public.v_delegates,public.v_donors,public.v_beneficiaries,public.v_campaign_in_kind_funding,public.v_stock_balances,public.v_user_archives,public.v_import_jobs TO authenticated;

UPDATE public.system_installation SET version='11.1.0',installed_at=now() WHERE id=1;
NOTIFY pgrst,'reload schema';
ALTER ROLE authenticator SET pgrst.db_pre_request='public.enforce_approved_device';
NOTIFY pgrst,'reload config';

COMMIT;

-- =============================================================
-- القسم 3: القواعد المالية والصلاحيات النهائية V11.2
-- =============================================================
-- =============================================================
-- Zakat Management System V11.2.0 — final verified rules
-- This patch is merged into database_complete.sql for delivery.
-- =============================================================

BEGIN;

-- The former distributor-advance module is intentionally removed. Campaign
-- distributor allocations are the single source of distributor cash limits.
DROP VIEW IF EXISTS public.v_delegate_advances CASCADE;
DROP FUNCTION IF EXISTS public.post_delegate_advance(uuid);
DROP TABLE IF EXISTS public.delegate_advances CASCADE;

-- Complete document lifecycle fields.
ALTER TABLE public.cash_transfers ADD COLUMN IF NOT EXISTS posted_at timestamptz;
ALTER TABLE public.cash_transfers ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.cash_transfers ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.cash_transfers ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.campaign_funding ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.campaign_in_kind_funding ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.baskets ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.campaign_distributors ALTER COLUMN cashbox_id SET NOT NULL;
ALTER TABLE public.campaign_distributors DROP CONSTRAINT IF EXISTS campaign_distributors_amounts_check;
ALTER TABLE public.campaign_distributors
  ADD CONSTRAINT campaign_distributors_amounts_check
  CHECK (spent_amount + returned_amount <= allocated_amount);

CREATE INDEX IF NOT EXISTS campaign_distributors_context_idx
  ON public.campaign_distributors(campaign_id,delegate_id,status,assigned_at DESC);
CREATE INDEX IF NOT EXISTS campaign_funding_posted_idx
  ON public.campaign_funding(campaign_id,status) INCLUDE(amount,cashbox_id);
CREATE INDEX IF NOT EXISTS cash_payments_duplicate_idx
  ON public.cash_payments(beneficiary_id,campaign_id)
  WHERE status='posted';
CREATE INDEX IF NOT EXISTS inventory_lots_campaign_item_fefo_idx
  ON public.inventory_lots(campaign_id,item_id,expiry_date,created_at)
  WHERE quantity_available>0;
CREATE INDEX IF NOT EXISTS inventory_lots_warehouse_item_fefo_idx
  ON public.inventory_lots(warehouse_id,item_id,expiry_date,created_at)
  WHERE campaign_id IS NULL AND quantity_available>0;
CREATE UNIQUE INDEX IF NOT EXISTS cash_transfers_idempotency_uq ON public.cash_transfers(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_funding_idempotency_uq ON public.campaign_funding(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_in_kind_funding_idempotency_uq ON public.campaign_in_kind_funding(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS baskets_idempotency_uq ON public.baskets(idempotency_key);

-- Stable automatic codes for setup directories. A user may still enter a
-- unique code; leaving it blank generates one safely under concurrency.
CREATE SEQUENCE IF NOT EXISTS public.branch_code_seq;
CREATE SEQUENCE IF NOT EXISTS public.cashbox_code_seq;
CREATE SEQUENCE IF NOT EXISTS public.warehouse_code_seq;
CREATE OR REPLACE FUNCTION public.assign_reference_code()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_candidate text; v_exists boolean;
BEGIN
  IF NULLIF(trim(NEW.code),'') IS NOT NULL THEN
    NEW.code:=upper(trim(NEW.code));
    RETURN NEW;
  END IF;
  LOOP
    v_candidate:=TG_ARGV[0]||lpad(nextval(TG_ARGV[1]::regclass)::text,6,'0');
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE code=$1)',TG_TABLE_SCHEMA,TG_TABLE_NAME)
      INTO v_exists USING v_candidate;
    EXIT WHEN NOT v_exists;
  END LOOP;
  NEW.code:=v_candidate;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS assign_branch_code ON public.branches;
CREATE TRIGGER assign_branch_code BEFORE INSERT OR UPDATE OF code ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.assign_reference_code('BR','public.branch_code_seq');
DROP TRIGGER IF EXISTS assign_cashbox_code ON public.cashboxes;
CREATE TRIGGER assign_cashbox_code BEFORE INSERT OR UPDATE OF code ON public.cashboxes
FOR EACH ROW EXECUTE FUNCTION public.assign_reference_code('BOX','public.cashbox_code_seq');
DROP TRIGGER IF EXISTS assign_warehouse_code ON public.warehouses;
CREATE TRIGGER assign_warehouse_code BEFORE INSERT OR UPDATE OF code ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.assign_reference_code('WH','public.warehouse_code_seq');

-- Campaign balances are based only on posted funding and posted payments.
DROP VIEW IF EXISTS public.campaign_balances CASCADE;
CREATE VIEW public.campaign_balances WITH (security_invoker=true) AS
SELECT
  c.id,c.name,c.currency,c.status,c.created_at,
  COALESCE(f.funded_total,0)::numeric(18,2) funded_total,
  COALESCE(a.allocated_total,0)::numeric(18,2) allocated_total,
  COALESCE(p.spent_total,0)::numeric(18,2) spent_total,
  COALESCE(a.returned_total,0)::numeric(18,2) returned_total,
  (COALESCE(f.funded_total,0)-COALESCE(a.allocated_total,0)+COALESCE(a.returned_total,0))::numeric(18,2) unallocated_balance,
  (COALESCE(f.funded_total,0)-COALESCE(p.spent_total,0))::numeric(18,2) operational_balance
FROM public.campaigns c
LEFT JOIN (
  SELECT campaign_id,SUM(amount) funded_total
  FROM public.campaign_funding WHERE status='posted' GROUP BY campaign_id
) f ON f.campaign_id=c.id
LEFT JOIN (
  SELECT campaign_id,SUM(allocated_amount) allocated_total,SUM(returned_amount) returned_total
  FROM public.campaign_distributors GROUP BY campaign_id
) a ON a.campaign_id=c.id
LEFT JOIN (
  SELECT campaign_id,SUM(amount) spent_total
  FROM public.cash_payments WHERE status='posted' GROUP BY campaign_id
) p ON p.campaign_id=c.id;

DROP VIEW IF EXISTS public.v_campaign_cash_balances CASCADE;
CREATE VIEW public.v_campaign_cash_balances WITH (security_invoker=true) AS
SELECT c.id,
  COALESCE(b.funded_total,0)::numeric(18,2) received_total,
  COALESCE(b.spent_total,0)::numeric(18,2) spent_total,
  COALESCE(b.operational_balance,0)::numeric(18,2) balance
FROM public.campaigns c LEFT JOIN public.campaign_balances b ON b.id=c.id;

DROP VIEW IF EXISTS public.v_campaigns CASCADE;
CREATE VIEW public.v_campaigns WITH (security_invoker=true) AS
SELECT c.*,p.full_name responsible_name,b.received_total,b.spent_total,b.balance,
  lower(concat_ws(' ',c.name,c.description,c.campaign_type::text,c.status::text,p.full_name)) search_text
FROM public.campaigns c
LEFT JOIN public.profiles p ON p.id=c.responsible_id
LEFT JOIN public.v_campaign_cash_balances b ON b.id=c.id;

DROP VIEW IF EXISTS public.v_delegate_cash_balances CASCADE;
CREATE VIEW public.v_delegate_cash_balances WITH (security_invoker=true) AS
SELECT d.id,
  COALESCE(SUM(cd.allocated_amount-cd.spent_amount-cd.returned_amount),0)::numeric(18,2) cash_balance
FROM public.delegates d
LEFT JOIN public.campaign_distributors cd ON cd.delegate_id=d.id
GROUP BY d.id;

DROP VIEW IF EXISTS public.v_delegates CASCADE;
CREATE VIEW public.v_delegates WITH (security_invoker=true) AS
SELECT d.*,COALESCE(cb.cash_balance,0) cash_balance,
  COALESCE((SELECT SUM(l.quantity_available) FROM public.inventory_lots l WHERE l.delegate_id=d.id),0) inventory_count,
  lower(concat_ws(' ',d.full_name,d.phone,d.phone_secondary,d.national_id,d.address,d.delegate_type::text)) search_text
FROM public.delegates d LEFT JOIN public.v_delegate_cash_balances cb ON cb.id=d.id;

DROP VIEW IF EXISTS public.v_campaign_distributors CASCADE;
CREATE VIEW public.v_campaign_distributors WITH (security_invoker=true) AS
SELECT cd.*,c.name campaign_name,d.full_name delegate_name,b.name cashbox_name,b.currency,
  lower(concat_ws(' ',c.name,d.full_name,b.name,cd.area_name,cd.status,cd.notes)) search_text
FROM public.campaign_distributors cd
JOIN public.campaigns c ON c.id=cd.campaign_id
JOIN public.delegates d ON d.id=cd.delegate_id
JOIN public.cashboxes b ON b.id=cd.cashbox_id;

-- Direct API writes cannot forge spent/returned totals. Allocation creation and
-- edits lock the campaign row so two simultaneous requests cannot over-allocate.
CREATE OR REPLACE FUNCTION public.guard_campaign_distributor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_funded numeric(18,2);
  v_committed numeric(18,2);
  v_campaign public.campaigns%ROWTYPE;
  v_box public.cashboxes%ROWTYPE;
  v_internal boolean:=COALESCE(current_setting('zakat.internal_financial_update',true),'')='on';
BEGIN
  IF v_internal THEN RETURN NEW; END IF;
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل تخصيصات الموزعين';
  END IF;
  IF TG_OP='INSERT' AND (NEW.spent_amount<>0 OR NEW.returned_amount<>0) THEN
    RAISE EXCEPTION 'يبدأ التخصيص دون مصروف أو مرتجع';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.spent_amount IS DISTINCT FROM OLD.spent_amount OR NEW.returned_amount IS DISTINCT FROM OLD.returned_amount) THEN
    RAISE EXCEPTION 'المصروف والمرتجع يعدلان من عمليات الترحيل والتسوية فقط';
  END IF;
  IF TG_OP='UPDATE' AND OLD.spent_amount>0
     AND (NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.delegate_id IS DISTINCT FROM OLD.delegate_id) THEN
    RAISE EXCEPTION 'لا يمكن تغيير الحملة أو الموزع بعد وجود صرف مرحل';
  END IF;
  SELECT * INTO v_campaign FROM public.campaigns WHERE id=NEW.campaign_id FOR UPDATE;
  IF NOT FOUND OR v_campaign.status<>'open' OR v_campaign.campaign_type NOT IN ('cash','mixed') THEN
    RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تقبل الصرف النقدي';
  END IF;
  SELECT * INTO v_box FROM public.cashboxes WHERE id=NEW.cashbox_id;
  IF NOT FOUND OR NOT v_box.is_active THEN RAISE EXCEPTION 'الصندوق غير موجود أو موقوف'; END IF;
  IF v_box.currency<>v_campaign.currency THEN RAISE EXCEPTION 'عملة الصندوق لا تطابق عملة الحملة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.delegates d WHERE d.id=NEW.delegate_id AND d.is_active=true) THEN
    RAISE EXCEPTION 'الموزع غير موجود أو موقوف';
  END IF;
  IF NEW.allocated_amount<NEW.spent_amount+NEW.returned_amount THEN
    RAISE EXCEPTION 'المبلغ المخصص أقل من المصروف والمرتجع';
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_funded
  FROM public.campaign_funding WHERE campaign_id=NEW.campaign_id AND status='posted';
  SELECT COALESCE(SUM(allocated_amount-returned_amount),0) INTO v_committed
  FROM public.campaign_distributors
  WHERE campaign_id=NEW.campaign_id AND (TG_OP='INSERT' OR id<>NEW.id);
  IF v_committed+NEW.allocated_amount-NEW.returned_amount>v_funded THEN
    RAISE EXCEPTION 'المبلغ المخصص يتجاوز رصيد الحملة غير الموزع. التمويل المرحل % والملتزم %',v_funded,v_committed;
  END IF;
  IF NEW.status='settled' AND NEW.allocated_amount-NEW.spent_amount-NEW.returned_amount>0 THEN
    RAISE EXCEPTION 'لا يمكن إقفال التخصيص قبل صرف أو إرجاع كامل المتبقي';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_campaign_distributor_trigger ON public.campaign_distributors;
CREATE TRIGGER guard_campaign_distributor_trigger
BEFORE INSERT OR UPDATE ON public.campaign_distributors
FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_distributor();

-- One context function is shared by the ordinary payment voucher and quick
-- delivery. Only the administrator may override the beneficiary distributor.
DROP FUNCTION IF EXISTS public.get_quick_delivery_context(uuid);
DROP FUNCTION IF EXISTS public.get_cash_payment_context(uuid,uuid,uuid);
CREATE FUNCTION public.get_cash_payment_context(
  p_beneficiary_id uuid,
  p_campaign_id uuid DEFAULT NULL,
  p_delegate_id uuid DEFAULT NULL
)
RETURNS TABLE(
  beneficiary_id uuid,delegate_id uuid,delegate_name text,
  campaign_id uuid,campaign_name text,cashbox_id uuid,cashbox_name text,
  currency text,available_amount numeric,assignment_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_role public.app_role;
  v_beneficiary_delegate uuid;
  v_delegate uuid;
BEGIN
  v_role:=public.current_user_role();
  IF v_role NOT IN ('admin','supervisor','accountant','distributor') THEN
    RAISE EXCEPTION 'غير مصرح بالصرف النقدي';
  END IF;
  SELECT b.delegate_id INTO v_beneficiary_delegate
  FROM public.beneficiaries b
  WHERE b.id=p_beneficiary_id AND b.status='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'المستفيد غير موجود أو غير معتمد'; END IF;
  IF v_role='admin' THEN
    v_delegate:=COALESCE(p_delegate_id,v_beneficiary_delegate);
  ELSE
    IF p_delegate_id IS NOT NULL AND p_delegate_id IS DISTINCT FROM v_beneficiary_delegate THEN
      RAISE EXCEPTION 'لا يستطيع تغيير موزع المستفيد إلا مدير النظام';
    END IF;
    v_delegate:=v_beneficiary_delegate;
  END IF;
  IF v_delegate IS NULL THEN RAISE EXCEPTION 'المستفيد غير مربوط بموزع نشط'; END IF;
  IF v_role='distributor' AND v_delegate IS DISTINCT FROM public.current_delegate_id() THEN
    RAISE EXCEPTION 'المستفيد غير مرتبط بحساب الموزع الحالي';
  END IF;

  RETURN QUERY
  SELECT p_beneficiary_id,d.id,d.full_name,c.id,c.name,box.id,box.name,box.currency::text,
    GREATEST(LEAST(
      cd.allocated_amount-cd.spent_amount-cd.returned_amount,
      COALESCE(balance.operational_balance,0)
    ),0)::numeric,
    cd.id
  FROM public.campaign_distributors cd
  JOIN public.delegates d ON d.id=cd.delegate_id AND d.is_active=true
  JOIN public.campaigns c ON c.id=cd.campaign_id
    AND c.status='open' AND c.campaign_type IN ('cash','mixed')
  JOIN public.cashboxes box ON box.id=cd.cashbox_id AND box.is_active=true
    AND box.currency=c.currency
  LEFT JOIN public.campaign_balances balance ON balance.id=c.id
  WHERE cd.delegate_id=v_delegate AND cd.status='active'
    AND (p_campaign_id IS NULL OR cd.campaign_id=p_campaign_id)
    AND cd.allocated_amount-cd.spent_amount-cd.returned_amount>0
    AND COALESCE(balance.operational_balance,0)>0
  ORDER BY cd.assigned_at DESC,cd.id
  LIMIT 1;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_cash_payment_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  ctx record;
  v_internal boolean:=COALESCE(current_setting('zakat.internal_financial_update',true),'')='on';
BEGIN
  IF v_internal THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('posted','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل سند صرف مرحل أو ملغي';
  END IF;
  IF NULLIF(trim(NEW.override_reason),'') IS NOT NULL AND public.current_user_role()<>'admin' THEN
    RAISE EXCEPTION 'الاستثناء من منع التكرار متاح لمدير النظام فقط';
  END IF;
  SELECT * INTO ctx
  FROM public.get_cash_payment_context(NEW.beneficiary_id,NEW.campaign_id,NEW.delegate_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد تخصيص نشط ورصيد صالح لهذا الصرف'; END IF;
  NEW.delegate_id:=ctx.delegate_id;
  NEW.cashbox_id:=ctx.cashbox_id;
  NEW.currency:=ctx.currency;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_cash_payment_context_trigger ON public.cash_payments;
CREATE TRIGGER enforce_cash_payment_context_trigger
BEFORE INSERT OR UPDATE ON public.cash_payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_payment_context();

-- Cash receipt posting and reversal lock the cashbox before reading its balance.
DROP FUNCTION IF EXISTS public.post_cash_receipt(uuid);
CREATE FUNCTION public.post_cash_receipt(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.cash_receipts%ROWTYPE; box public.cashboxes%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بترحيل سند القبض';
  END IF;
  SELECT * INTO r FROM public.cash_receipts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند القبض غير موجود'; END IF;
  IF r.status='posted' THEN RETURN; END IF;
  IF r.status='cancelled' THEN RAISE EXCEPTION 'سند القبض ملغي'; END IF;
  IF r.amount<=0 OR r.cashbox_id IS NULL THEN RAISE EXCEPTION 'الصندوق والمبلغ الصحيح مطلوبان'; END IF;
  SELECT * INTO box FROM public.cashboxes WHERE id=r.cashbox_id FOR UPDATE;
  IF NOT FOUND OR NOT box.is_active THEN RAISE EXCEPTION 'الصندوق غير موجود أو موقوف'; END IF;
  IF box.currency<>r.currency THEN RAISE EXCEPTION 'عملة السند لا تطابق عملة الصندوق'; END IF;
  INSERT INTO public.cashbox_ledger(
    cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by
  ) VALUES(
    r.cashbox_id,'donation','cash_receipts',r.id,0,r.amount,r.currency,'سند قبض - '||r.voucher_no,auth.uid()
  ) ON CONFLICT DO NOTHING;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.cash_receipts SET status='posted',posted_at=COALESCE(posted_at,now()),updated_at=now() WHERE id=r.id;
END; $$;

DROP FUNCTION IF EXISTS public.cancel_cash_receipt(uuid,text);
CREATE FUNCTION public.cancel_cash_receipt(p_id uuid,p_reason text)
RETURNS public.cash_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.cash_receipts%ROWTYPE; v_balance numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء سند القبض';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO r FROM public.cash_receipts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند القبض غير موجود'; END IF;
  IF r.status='cancelled' THEN RETURN r; END IF;
  IF r.status='posted' THEN
    PERFORM 1 FROM public.cashboxes WHERE id=r.cashbox_id FOR UPDATE;
    SELECT current_balance INTO v_balance FROM public.cashbox_balances WHERE id=r.cashbox_id;
    IF COALESCE(v_balance,0)<r.amount THEN
      RAISE EXCEPTION 'لا يمكن عكس سند القبض لأن الرصيد الحالي أقل من قيمته. المتاح % والمطلوب %',COALESCE(v_balance,0),r.amount;
    END IF;
    INSERT INTO public.cashbox_ledger(
      cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by
    ) VALUES(
      r.cashbox_id,'refund','cash_receipts',r.id,r.amount,0,r.currency,'عكس سند قبض - '||r.voucher_no,auth.uid()
    ) ON CONFLICT DO NOTHING;
  END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.cash_receipts
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
  WHERE id=r.id RETURNING * INTO r;
  RETURN r;
END; $$;

-- Campaign funding moves cash out of the cashbox exactly once. Campaign and
-- cashbox locks make simultaneous funding/transfer attempts deterministic.
DROP FUNCTION IF EXISTS public.post_campaign_funding(uuid);
CREATE FUNCTION public.post_campaign_funding(p_funding_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  f public.campaign_funding%ROWTYPE;
  campaign public.campaigns%ROWTYPE;
  box public.cashboxes%ROWTYPE;
  v_balance numeric(18,2);
  v_funded numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بترحيل تمويل الحملة';
  END IF;
  SELECT * INTO f FROM public.campaign_funding WHERE id=p_funding_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تمويل الحملة غير موجود'; END IF;
  IF f.status='posted' THEN RETURN; END IF;
  IF f.status='cancelled' THEN RAISE EXCEPTION 'تمويل الحملة ملغي'; END IF;
  IF f.amount<=0 THEN RAISE EXCEPTION 'مبلغ التمويل يجب أن يكون أكبر من صفر'; END IF;
  SELECT * INTO campaign FROM public.campaigns WHERE id=f.campaign_id FOR UPDATE;
  IF NOT FOUND OR campaign.status<>'open' OR campaign.campaign_type NOT IN ('cash','mixed') THEN
    RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تقبل تمويلاً نقدياً';
  END IF;
  SELECT * INTO box FROM public.cashboxes WHERE id=f.cashbox_id FOR UPDATE;
  IF NOT FOUND OR NOT box.is_active THEN RAISE EXCEPTION 'الصندوق غير موجود أو موقوف'; END IF;
  IF box.currency<>campaign.currency OR f.currency<>campaign.currency THEN
    RAISE EXCEPTION 'عملة التمويل والصندوق يجب أن تطابق عملة الحملة';
  END IF;
  SELECT current_balance INTO v_balance FROM public.cashbox_balances WHERE id=box.id;
  IF COALESCE(v_balance,0)<f.amount THEN
    RAISE EXCEPTION 'رصيد الصندوق غير كافٍ. المتاح % والمطلوب %',COALESCE(v_balance,0),f.amount;
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_funded
  FROM public.campaign_funding WHERE campaign_id=f.campaign_id AND status='posted';
  IF campaign.ceiling>0 AND v_funded+f.amount>campaign.ceiling THEN
    RAISE EXCEPTION 'التمويل يتجاوز سقف الحملة. السقف % والممول بعد العملية %',campaign.ceiling,v_funded+f.amount;
  END IF;
  INSERT INTO public.cashbox_ledger(
    cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by
  ) VALUES(
    f.cashbox_id,'campaign_funding','campaign_funding',f.id,f.amount,0,f.currency,
    'تمويل حملة - '||f.funding_no,auth.uid()
  ) ON CONFLICT DO NOTHING;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_funding
  SET status='posted',posted_at=COALESCE(posted_at,now()),posted_by=auth.uid(),updated_at=now()
  WHERE id=f.id;
END; $$;

DROP FUNCTION IF EXISTS public.cancel_campaign_funding(uuid,text);
CREATE FUNCTION public.cancel_campaign_funding(p_id uuid,p_reason text)
RETURNS public.campaign_funding LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  f public.campaign_funding%ROWTYPE;
  v_operational numeric(18,2);
  v_other_funding numeric(18,2);
  v_committed numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء تمويل الحملة';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO f FROM public.campaign_funding WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تمويل الحملة غير موجود'; END IF;
  IF f.status='cancelled' THEN RETURN f; END IF;
  IF f.status='posted' THEN
    PERFORM 1 FROM public.campaigns WHERE id=f.campaign_id FOR UPDATE;
    SELECT COALESCE(operational_balance,0) INTO v_operational
    FROM public.campaign_balances WHERE id=f.campaign_id;
    IF v_operational<f.amount THEN
      RAISE EXCEPTION 'لا يمكن الإلغاء لأن جزءاً من هذا التمويل صُرف بالفعل';
    END IF;
    SELECT COALESCE(SUM(amount),0) INTO v_other_funding
    FROM public.campaign_funding
    WHERE campaign_id=f.campaign_id AND status='posted' AND id<>f.id;
    SELECT COALESCE(SUM(allocated_amount-returned_amount),0) INTO v_committed
    FROM public.campaign_distributors WHERE campaign_id=f.campaign_id;
    IF v_other_funding<v_committed THEN
      RAISE EXCEPTION 'لا يمكن الإلغاء قبل تخفيض أو تسوية تخصيصات الموزعين';
    END IF;
    PERFORM 1 FROM public.cashboxes WHERE id=f.cashbox_id FOR UPDATE;
    INSERT INTO public.cashbox_ledger(
      cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by
    ) VALUES(
      f.cashbox_id,'refund','campaign_funding',f.id,0,f.amount,f.currency,
      'عكس تمويل حملة - '||f.funding_no,auth.uid()
    ) ON CONFLICT DO NOTHING;
  END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_funding
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
  WHERE id=f.id RETURNING * INTO f;
  RETURN f;
END; $$;

-- Transfers lock both boxes in UUID order to avoid deadlocks.
DROP FUNCTION IF EXISTS public.post_cash_transfer(uuid);
CREATE FUNCTION public.post_cash_transfer(p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  t public.cash_transfers%ROWTYPE;
  from_box public.cashboxes%ROWTYPE;
  to_box public.cashboxes%ROWTYPE;
  v_balance numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بترحيل التحويل';
  END IF;
  SELECT * INTO t FROM public.cash_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF t.status='posted' THEN RETURN; END IF;
  IF t.status='cancelled' THEN RAISE EXCEPTION 'التحويل ملغي'; END IF;
  IF t.amount<=0 THEN RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون أكبر من صفر'; END IF;
  IF t.from_cashbox_id=t.to_cashbox_id THEN RAISE EXCEPTION 'لا يمكن التحويل إلى نفس الصندوق'; END IF;
  PERFORM id FROM public.cashboxes
  WHERE id IN(t.from_cashbox_id,t.to_cashbox_id) ORDER BY id FOR UPDATE;
  SELECT * INTO from_box FROM public.cashboxes WHERE id=t.from_cashbox_id;
  SELECT * INTO to_box FROM public.cashboxes WHERE id=t.to_cashbox_id;
  IF from_box.id IS NULL OR to_box.id IS NULL THEN RAISE EXCEPTION 'أحد الصندوقين غير موجود'; END IF;
  IF NOT from_box.is_active OR NOT to_box.is_active THEN RAISE EXCEPTION 'لا يمكن التحويل من أو إلى صندوق موقوف'; END IF;
  IF from_box.currency<>to_box.currency THEN
    RAISE EXCEPTION 'لا يمكن التحويل بين عملتين مختلفتين (% و%)',from_box.currency,to_box.currency;
  END IF;
  SELECT current_balance INTO v_balance FROM public.cashbox_balances WHERE id=from_box.id;
  IF COALESCE(v_balance,0)<t.amount THEN
    RAISE EXCEPTION 'رصيد الصندوق المصدر غير كافٍ. المتاح % والمطلوب %',COALESCE(v_balance,0),t.amount;
  END IF;
  INSERT INTO public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
  VALUES(t.from_cashbox_id,'transfer_out','cash_transfers',t.id,t.amount,0,from_box.currency,'تحويل صادر - '||t.transfer_no,auth.uid())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
  VALUES(t.to_cashbox_id,'transfer_in','cash_transfers',t.id,0,t.amount,to_box.currency,'تحويل وارد - '||t.transfer_no,auth.uid())
  ON CONFLICT DO NOTHING;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.cash_transfers SET status='posted',currency=from_box.currency,posted_at=COALESCE(posted_at,now()) WHERE id=t.id;
END; $$;

DROP FUNCTION IF EXISTS public.cancel_cash_transfer(uuid,text);
CREATE FUNCTION public.cancel_cash_transfer(p_id uuid,p_reason text)
RETURNS public.cash_transfers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.cash_transfers%ROWTYPE; v_target_balance numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء التحويل';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO t FROM public.cash_transfers WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF t.status='cancelled' THEN RETURN t; END IF;
  IF t.status='posted' THEN
    PERFORM id FROM public.cashboxes
    WHERE id IN(t.from_cashbox_id,t.to_cashbox_id) ORDER BY id FOR UPDATE;
    SELECT current_balance INTO v_target_balance FROM public.cashbox_balances WHERE id=t.to_cashbox_id;
    IF COALESCE(v_target_balance,0)<t.amount THEN
      RAISE EXCEPTION 'لا يمكن عكس التحويل لأن رصيد الصندوق الهدف أقل من المبلغ. المتاح % والمطلوب %',COALESCE(v_target_balance,0),t.amount;
    END IF;
    INSERT INTO public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
    VALUES(t.to_cashbox_id,'refund','cash_transfers',t.id,t.amount,0,t.currency,'عكس تحويل وارد - '||t.transfer_no,auth.uid()) ON CONFLICT DO NOTHING;
    INSERT INTO public.cashbox_ledger(cashbox_id,transaction_type,reference_table,reference_id,debit,credit,currency,description,created_by)
    VALUES(t.from_cashbox_id,'refund','cash_transfers',t.id,0,t.amount,t.currency,'عكس تحويل صادر - '||t.transfer_no,auth.uid()) ON CONFLICT DO NOTHING;
  END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.cash_transfers
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason)
  WHERE id=t.id RETURNING * INTO t;
  RETURN t;
END; $$;

DROP FUNCTION IF EXISTS public.post_cash_payment(uuid);
CREATE FUNCTION public.post_cash_payment(p_id uuid)
RETURNS public.cash_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  payment public.cash_payments%ROWTYPE;
  beneficiary public.beneficiaries%ROWTYPE;
  ctx record;
  assignment public.campaign_distributors%ROWTYPE;
  v_require_approval boolean;
  v_role public.app_role;
  v_remaining numeric(18,2);
BEGIN
  v_role:=public.current_user_role();
  IF v_role NOT IN ('admin','supervisor','accountant','distributor') THEN
    RAISE EXCEPTION 'غير مصرح بترحيل سند الصرف';
  END IF;
  SELECT * INTO payment FROM public.cash_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف غير موجود'; END IF;
  IF payment.status='posted' THEN RETURN payment; END IF;
  IF payment.status='cancelled' THEN RAISE EXCEPTION 'سند الصرف ملغي'; END IF;
  IF payment.amount<=0 THEN RAISE EXCEPTION 'مبلغ الصرف يجب أن يكون أكبر من صفر'; END IF;

  -- Serialise duplicates for the same beneficiary before locking the campaign.
  SELECT * INTO beneficiary FROM public.beneficiaries
  WHERE id=payment.beneficiary_id FOR UPDATE;
  IF NOT FOUND OR beneficiary.status<>'approved' THEN RAISE EXCEPTION 'المستفيد غير موجود أو غير معتمد'; END IF;
  PERFORM 1 FROM public.campaigns WHERE id=payment.campaign_id FOR UPDATE;

  SELECT COALESCE(require_payment_approval,true) INTO v_require_approval
  FROM public.system_settings WHERE id=1;
  IF v_role='distributor' AND v_require_approval AND payment.status<>'approved' THEN
    RAISE EXCEPTION 'سند الموزع يحتاج اعتماد المشرف قبل الترحيل';
  END IF;
  IF NULLIF(trim(payment.override_reason),'') IS NOT NULL AND v_role<>'admin' THEN
    RAISE EXCEPTION 'الاستثناء من منع التكرار متاح لمدير النظام فقط';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.cash_payments other
    WHERE other.id<>payment.id AND other.beneficiary_id=payment.beneficiary_id
      AND other.campaign_id=payment.campaign_id AND other.status='posted'
  ) AND NULLIF(trim(payment.override_reason),'') IS NULL THEN
    RAISE EXCEPTION 'المستفيد استلم سابقاً من هذه الحملة';
  END IF;

  SELECT * INTO ctx FROM public.get_cash_payment_context(
    payment.beneficiary_id,payment.campaign_id,payment.delegate_id
  );
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد تخصيص نشط أو رصيد متاح لهذا السند'; END IF;
  IF payment.amount>ctx.available_amount THEN
    RAISE EXCEPTION 'الرصيد المخصص غير كافٍ. المتاح % والمطلوب %',ctx.available_amount,payment.amount;
  END IF;
  SELECT * INTO assignment FROM public.campaign_distributors WHERE id=ctx.assignment_id FOR UPDATE;
  IF NOT FOUND OR assignment.status<>'active' THEN RAISE EXCEPTION 'تخصيص الموزع غير نشط'; END IF;
  v_remaining:=assignment.allocated_amount-assignment.spent_amount-assignment.returned_amount;
  IF v_remaining<payment.amount THEN
    RAISE EXCEPTION 'رصيد الموزع المخصص غير كافٍ. المتاح % والمطلوب %',v_remaining,payment.amount;
  END IF;

  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_distributors
  SET spent_amount=spent_amount+payment.amount,
      status=CASE
        WHEN allocated_amount-(spent_amount+payment.amount)-returned_amount<=0 THEN 'settled'
        ELSE status
      END
  WHERE id=assignment.id;
  UPDATE public.cash_payments
  SET delegate_id=ctx.delegate_id,cashbox_id=ctx.cashbox_id,currency=ctx.currency,
      status='posted',posted_at=COALESCE(posted_at,now()),updated_at=now()
  WHERE id=payment.id RETURNING * INTO payment;
  RETURN payment;
END; $$;

DROP FUNCTION IF EXISTS public.cancel_cash_payment(uuid,text);
CREATE FUNCTION public.cancel_cash_payment(p_id uuid,p_reason text)
RETURNS public.cash_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payment public.cash_payments%ROWTYPE; assignment public.campaign_distributors%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء سند الصرف';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO payment FROM public.cash_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف غير موجود'; END IF;
  IF payment.status='cancelled' THEN RETURN payment; END IF;
  IF payment.status<>'posted' THEN
    PERFORM set_config('zakat.internal_financial_update','on',true);
    UPDATE public.cash_payments
    SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
    WHERE id=payment.id RETURNING * INTO payment;
    RETURN payment;
  END IF;
  PERFORM 1 FROM public.campaigns WHERE id=payment.campaign_id FOR UPDATE;
  SELECT * INTO assignment FROM public.campaign_distributors
  WHERE campaign_id=payment.campaign_id AND delegate_id=payment.delegate_id FOR UPDATE;
  IF NOT FOUND OR assignment.spent_amount<payment.amount THEN
    RAISE EXCEPTION 'تعذر عكس الصرف بسبب عدم تطابق إجمالي مصروف الموزع';
  END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_distributors
  SET spent_amount=spent_amount-payment.amount,
      status=CASE WHEN status='settled' THEN 'active' ELSE status END
  WHERE id=assignment.id;
  UPDATE public.cash_payments
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
  WHERE id=payment.id RETURNING * INTO payment;
  UPDATE public.distribution_assignments
  SET delivery_status='cancelled',delivered_at=NULL
  WHERE payment_id=payment.id;
  RETURN payment;
END; $$;

DROP FUNCTION IF EXISTS public.settle_campaign_distributor(uuid,text);
CREATE FUNCTION public.settle_campaign_distributor(p_id uuid,p_reason text DEFAULT NULL)
RETURNS public.campaign_distributors LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE assignment public.campaign_distributors%ROWTYPE; v_remaining numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بتسوية تخصيص الموزع';
  END IF;
  SELECT * INTO assignment FROM public.campaign_distributors WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تخصيص الموزع غير موجود'; END IF;
  PERFORM 1 FROM public.campaigns WHERE id=assignment.campaign_id FOR UPDATE;
  v_remaining:=assignment.allocated_amount-assignment.spent_amount-assignment.returned_amount;
  IF v_remaining<0 THEN RAISE EXCEPTION 'بيانات التخصيص غير متوازنة'; END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_distributors
  SET returned_amount=returned_amount+v_remaining,status='settled',
      notes=concat_ws(E'\n',notes,
        CASE WHEN NULLIF(trim(p_reason),'') IS NULL THEN 'تمت تسوية كامل المتبقي'
             ELSE 'سبب التسوية: '||trim(p_reason) END)
  WHERE id=assignment.id RETURNING * INTO assignment;
  RETURN assignment;
END; $$;

DROP FUNCTION IF EXISTS public.quick_deliver_cash(text,numeric);
DROP FUNCTION IF EXISTS public.quick_deliver_cash(text,numeric,uuid);
DROP FUNCTION IF EXISTS public.quick_deliver_cash(uuid,numeric,uuid,uuid);
DROP FUNCTION IF EXISTS public.quick_deliver_cash(uuid,numeric,uuid,uuid,uuid);
CREATE FUNCTION public.quick_deliver_cash(
  p_beneficiary_id uuid,
  p_amount numeric,
  p_campaign_id uuid,
  p_cashbox_id uuid,
  p_delegate_id uuid DEFAULT NULL
)
RETURNS public.cash_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ctx record; v_payment uuid; result public.cash_payments; v_name text;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  SELECT * INTO ctx FROM public.get_cash_payment_context(p_beneficiary_id,p_campaign_id,p_delegate_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد تخصيص صالح أو رصيد متاح لهذا المستفيد'; END IF;
  IF ctx.campaign_id IS DISTINCT FROM p_campaign_id OR ctx.cashbox_id IS DISTINCT FROM p_cashbox_id THEN
    RAISE EXCEPTION 'تغيّر تخصيص المستفيد؛ أعد اختياره';
  END IF;
  IF p_amount>ctx.available_amount THEN
    RAISE EXCEPTION 'المبلغ يتجاوز المتاح. المتاح %',ctx.available_amount;
  END IF;
  SELECT full_name INTO v_name FROM public.beneficiaries WHERE id=p_beneficiary_id;
  INSERT INTO public.cash_payments(
    payment_date,delegate_id,beneficiary_id,campaign_id,cashbox_id,amount,currency,
    delivery_method,receipt_status,actual_recipient,status,created_by,notes
  ) VALUES(
    current_date,ctx.delegate_id,p_beneficiary_id,ctx.campaign_id,ctx.cashbox_id,p_amount,ctx.currency,
    'cash','received',v_name,'approved',auth.uid(),'تسليم سريع مع تحقق فوري من التخصيص والرصيد'
  ) RETURNING id INTO v_payment;
  result:=public.post_cash_payment(v_payment);
  INSERT INTO public.distribution_assignments(
    beneficiary_id,delegate_id,campaign_id,amount,delivery_status,delivered_at,payment_id
  ) VALUES(
    p_beneficiary_id,ctx.delegate_id,ctx.campaign_id,p_amount,'received',now(),v_payment
  );
  RETURN result;
END; $$;

DROP FUNCTION IF EXISTS public.confirm_cash_payment_receipt(uuid);
CREATE FUNCTION public.confirm_cash_payment_receipt(p_id uuid)
RETURNS public.cash_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payment public.cash_payments%ROWTYPE;
BEGIN
  SELECT * INTO payment FROM public.cash_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف غير موجود'; END IF;
  IF NOT (public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[])
      OR payment.delegate_id=public.current_delegate_id()) THEN
    RAISE EXCEPTION 'غير مصرح بتأكيد الاستلام';
  END IF;
  IF payment.status<>'posted' THEN RAISE EXCEPTION 'يجب ترحيل السند قبل تأكيد الاستلام'; END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.cash_payments SET receipt_status='received',updated_at=now()
  WHERE id=payment.id RETURNING * INTO payment;
  RETURN payment;
END; $$;

-- In-kind receipts always enter a warehouse. Campaign funding is the separate,
-- auditable operation that moves quantities from the warehouse to a campaign.
DROP FUNCTION IF EXISTS public.post_in_kind_receipt(uuid);
CREATE FUNCTION public.post_in_kind_receipt(p_id uuid)
RETURNS public.in_kind_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE receipt public.in_kind_receipts%ROWTYPE; detail public.in_kind_receipt_details%ROWTYPE; v_lot uuid;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant','warehouse']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بترحيل سند القبض العيني';
  END IF;
  SELECT * INTO receipt FROM public.in_kind_receipts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند القبض العيني غير موجود'; END IF;
  IF receipt.status='posted' THEN RETURN receipt; END IF;
  IF receipt.status='cancelled' THEN RAISE EXCEPTION 'السند ملغي'; END IF;
  IF receipt.warehouse_id IS NULL THEN RAISE EXCEPTION 'يجب اختيار المخزن المستلم'; END IF;
  PERFORM 1 FROM public.warehouses WHERE id=receipt.warehouse_id AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المخزن غير موجود أو موقوف'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.in_kind_receipt_details WHERE receipt_id=receipt.id) THEN
    RAISE EXCEPTION 'السند لا يحتوي أصنافاً';
  END IF;
  FOR detail IN SELECT * FROM public.in_kind_receipt_details WHERE receipt_id=receipt.id ORDER BY id LOOP
    IF detail.quantity<=0 OR detail.valid_qty<0 OR detail.damaged_qty<0
       OR detail.valid_qty+detail.damaged_qty<>detail.quantity THEN
      RAISE EXCEPTION 'تفصيل الصنف غير متوازن: الكلية يجب أن تساوي الصالحة مع التالفة';
    END IF;
    IF detail.valid_qty<=0 THEN RAISE EXCEPTION 'الكمية الصالحة يجب أن تكون أكبر من صفر'; END IF;
    IF detail.expiry_date IS NOT NULL AND detail.expiry_date<=current_date THEN
      RAISE EXCEPTION 'لا يمكن ترحيل صنف منتهي الصلاحية';
    END IF;
    INSERT INTO public.inventory_lots(
      item_id,warehouse_id,campaign_id,delegate_id,source_receipt_detail_id,
      lot_no,expiry_date,quantity_received,quantity_damaged,quantity_available
    ) VALUES(
      detail.item_id,receipt.warehouse_id,NULL,NULL,detail.id,
      detail.lot_no,detail.expiry_date,detail.quantity,detail.damaged_qty,detail.valid_qty
    ) RETURNING id INTO v_lot;
    INSERT INTO public.inventory_movements(
      lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id
    ) VALUES(v_lot,detail.item_id,'in',detail.valid_qty,'in_kind_receipts',receipt.id,detail.id);
  END LOOP;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.in_kind_receipts
  SET status='posted',posted_at=COALESCE(posted_at,now()),campaign_id=NULL,delegate_id=NULL,updated_at=now()
  WHERE id=receipt.id RETURNING * INTO receipt;
  RETURN receipt;
END; $$;

DROP FUNCTION IF EXISTS public.cancel_in_kind_receipt(uuid,text);
CREATE FUNCTION public.cancel_in_kind_receipt(p_id uuid,p_reason text)
RETURNS public.in_kind_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE receipt public.in_kind_receipts%ROWTYPE; lot public.inventory_lots%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء سند القبض العيني';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO receipt FROM public.in_kind_receipts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند القبض العيني غير موجود'; END IF;
  IF receipt.status='cancelled' THEN RETURN receipt; END IF;
  IF receipt.status='posted' THEN
    PERFORM 1 FROM public.warehouses WHERE id=receipt.warehouse_id FOR UPDATE;
    FOR lot IN
      SELECT l.* FROM public.inventory_lots l
      JOIN public.in_kind_receipt_details d ON d.id=l.source_receipt_detail_id
      WHERE d.receipt_id=receipt.id ORDER BY l.id FOR UPDATE OF l
    LOOP
      IF lot.quantity_available<>lot.quantity_received-lot.quantity_damaged THEN
        RAISE EXCEPTION 'لا يمكن إلغاء السند لأن جزءاً من مخزون الصنف % نُقل أو صُرف',lot.item_id;
      END IF;
    END LOOP;
    UPDATE public.inventory_lots l SET quantity_available=0
    FROM public.in_kind_receipt_details d
    WHERE d.id=l.source_receipt_detail_id AND d.receipt_id=receipt.id;
    UPDATE public.inventory_movements SET reversed_at=now()
    WHERE source_table='in_kind_receipts' AND source_id=receipt.id AND reversed_at IS NULL;
  END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.in_kind_receipts
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
  WHERE id=receipt.id RETURNING * INTO receipt;
  RETURN receipt;
END; $$;

DROP FUNCTION IF EXISTS public.post_campaign_in_kind_funding(uuid);
CREATE FUNCTION public.post_campaign_in_kind_funding(p_id uuid)
RETURNS public.campaign_in_kind_funding LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  funding public.campaign_in_kind_funding%ROWTYPE;
  detail public.campaign_in_kind_funding_details%ROWTYPE;
  source_lot public.inventory_lots%ROWTYPE;
  v_available numeric(18,3);
  v_needed numeric(18,3);
  v_take numeric(18,3);
  v_target uuid;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بترحيل تمويل الحملة العيني';
  END IF;
  SELECT * INTO funding FROM public.campaign_in_kind_funding WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تمويل الحملة العيني غير موجود'; END IF;
  IF funding.status='posted' THEN RETURN funding; END IF;
  IF funding.status='cancelled' THEN RAISE EXCEPTION 'تمويل الحملة العيني ملغي'; END IF;
  PERFORM 1 FROM public.campaigns
  WHERE id=funding.campaign_id AND status='open' AND campaign_type IN ('in_kind','mixed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تقبل تمويلاً عينياً'; END IF;
  PERFORM 1 FROM public.warehouses WHERE id=funding.warehouse_id AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المخزن غير موجود أو موقوف'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaign_in_kind_funding_details WHERE funding_id=funding.id) THEN
    RAISE EXCEPTION 'لم يتم اختيار أصناف للتمويل';
  END IF;

  FOR detail IN
    SELECT * FROM public.campaign_in_kind_funding_details WHERE funding_id=funding.id ORDER BY item_id
  LOOP
    PERFORM id FROM public.inventory_lots
    WHERE warehouse_id=funding.warehouse_id AND campaign_id IS NULL AND item_id=detail.item_id
      AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date)
    ORDER BY expiry_date NULLS LAST,created_at,id FOR UPDATE;
    SELECT COALESCE(SUM(quantity_available),0) INTO v_available
    FROM public.inventory_lots
    WHERE warehouse_id=funding.warehouse_id AND campaign_id IS NULL AND item_id=detail.item_id
      AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date);
    IF v_available<detail.quantity THEN
      RAISE EXCEPTION 'رصيد المخزن غير كاف للصنف %. المتاح % والمطلوب %',detail.item_id,v_available,detail.quantity;
    END IF;
    v_needed:=detail.quantity;
    FOR source_lot IN
      SELECT * FROM public.inventory_lots
      WHERE warehouse_id=funding.warehouse_id AND campaign_id IS NULL AND item_id=detail.item_id
        AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date)
      ORDER BY expiry_date NULLS LAST,created_at,id FOR UPDATE
    LOOP
      EXIT WHEN v_needed<=0;
      v_take:=LEAST(v_needed,source_lot.quantity_available);
      UPDATE public.inventory_lots SET quantity_available=quantity_available-v_take WHERE id=source_lot.id;
      INSERT INTO public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
      VALUES(source_lot.id,detail.item_id,'out',v_take,'campaign_in_kind_funding',funding.id,detail.id);
      INSERT INTO public.inventory_lots(
        item_id,warehouse_id,campaign_id,delegate_id,lot_no,expiry_date,
        quantity_received,quantity_damaged,quantity_available
      ) VALUES(
        detail.item_id,funding.warehouse_id,funding.campaign_id,NULL,source_lot.lot_no,source_lot.expiry_date,
        v_take,0,v_take
      ) RETURNING id INTO v_target;
      INSERT INTO public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
      VALUES(v_target,detail.item_id,'in',v_take,'campaign_in_kind_funding',funding.id,detail.id);
      v_needed:=v_needed-v_take;
    END LOOP;
    IF v_needed>0 THEN RAISE EXCEPTION 'تعذر إكمال نقل الصنف %؛ المتبقي %',detail.item_id,v_needed; END IF;
  END LOOP;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_in_kind_funding
  SET status='posted',posted_at=COALESCE(posted_at,now()),updated_at=now()
  WHERE id=funding.id RETURNING * INTO funding;
  RETURN funding;
END; $$;

DROP FUNCTION IF EXISTS public.cancel_campaign_in_kind_funding(uuid,text);
CREATE FUNCTION public.cancel_campaign_in_kind_funding(p_id uuid,p_reason text)
RETURNS public.campaign_in_kind_funding LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE funding public.campaign_in_kind_funding%ROWTYPE; movement public.inventory_movements%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء تمويل الحملة العيني';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO funding FROM public.campaign_in_kind_funding WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تمويل الحملة العيني غير موجود'; END IF;
  IF funding.status='cancelled' THEN RETURN funding; END IF;
  IF funding.status='posted' THEN
    PERFORM 1 FROM public.campaigns WHERE id=funding.campaign_id FOR UPDATE;
    PERFORM 1 FROM public.warehouses WHERE id=funding.warehouse_id FOR UPDATE;
    FOR movement IN
      SELECT * FROM public.inventory_movements
      WHERE source_table='campaign_in_kind_funding' AND source_id=funding.id
        AND movement_type='in' AND reversed_at IS NULL
      ORDER BY id FOR UPDATE
    LOOP
      IF (SELECT quantity_available FROM public.inventory_lots WHERE id=movement.lot_id FOR UPDATE)<movement.quantity THEN
        RAISE EXCEPTION 'لا يمكن إلغاء التمويل لأن جزءاً من الصنف % صُرف من الحملة',movement.item_id;
      END IF;
    END LOOP;
    FOR movement IN
      SELECT * FROM public.inventory_movements
      WHERE source_table='campaign_in_kind_funding' AND source_id=funding.id
        AND reversed_at IS NULL ORDER BY movement_type,id FOR UPDATE
    LOOP
      IF movement.movement_type='in' THEN
        UPDATE public.inventory_lots SET quantity_available=quantity_available-movement.quantity WHERE id=movement.lot_id;
      ELSIF movement.movement_type='out' THEN
        UPDATE public.inventory_lots SET quantity_available=quantity_available+movement.quantity WHERE id=movement.lot_id;
      END IF;
      UPDATE public.inventory_movements SET reversed_at=now() WHERE id=movement.id;
    END LOOP;
  END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_in_kind_funding
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
  WHERE id=funding.id RETURNING * INTO funding;
  RETURN funding;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_in_kind_payment_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_role public.app_role;
  v_beneficiary_delegate uuid;
  v_internal boolean:=COALESCE(current_setting('zakat.internal_financial_update',true),'')='on';
BEGIN
  IF v_internal THEN RETURN NEW; END IF;
  v_role:=public.current_user_role();
  IF v_role NOT IN ('admin','supervisor','warehouse','distributor') THEN
    RAISE EXCEPTION 'غير مصرح بإنشاء سند صرف عيني';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('posted','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل سند صرف عيني مرحل أو ملغي';
  END IF;
  SELECT delegate_id INTO v_beneficiary_delegate
  FROM public.beneficiaries WHERE id=NEW.beneficiary_id AND status='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'المستفيد غير موجود أو غير معتمد'; END IF;
  IF v_role='admin' THEN
    NEW.delegate_id:=COALESCE(NEW.delegate_id,v_beneficiary_delegate);
  ELSE
    IF NEW.delegate_id IS NOT NULL AND NEW.delegate_id IS DISTINCT FROM v_beneficiary_delegate THEN
      RAISE EXCEPTION 'لا يستطيع تغيير موزع المستفيد إلا مدير النظام';
    END IF;
    NEW.delegate_id:=v_beneficiary_delegate;
  END IF;
  IF NEW.delegate_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.delegates d WHERE d.id=NEW.delegate_id AND d.is_active=true
  ) THEN RAISE EXCEPTION 'المستفيد غير مربوط بموزع نشط'; END IF;
  IF v_role='distributor' AND NEW.delegate_id IS DISTINCT FROM public.current_delegate_id() THEN
    RAISE EXCEPTION 'المستفيد غير مرتبط بحساب الموزع الحالي';
  END IF;
  IF NULLIF(trim(NEW.override_reason),'') IS NOT NULL AND v_role<>'admin' THEN
    RAISE EXCEPTION 'الاستثناء من منع التكرار متاح لمدير النظام فقط';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.campaigns c
    WHERE c.id=NEW.campaign_id AND c.status='open' AND c.campaign_type IN ('in_kind','mixed')
  ) THEN RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تسمح بالصرف العيني'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_in_kind_payment_context_trigger ON public.in_kind_payments;
CREATE TRIGGER enforce_in_kind_payment_context_trigger
BEFORE INSERT OR UPDATE ON public.in_kind_payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_in_kind_payment_context();

DROP FUNCTION IF EXISTS public.post_in_kind_payment(uuid);
CREATE FUNCTION public.post_in_kind_payment(p_id uuid)
RETURNS public.in_kind_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  payment public.in_kind_payments%ROWTYPE;
  detail public.in_kind_payment_details%ROWTYPE;
  lot public.inventory_lots%ROWTYPE;
  v_available numeric(18,3);
  v_needed numeric(18,3);
  v_take numeric(18,3);
  v_require_approval boolean;
  v_role public.app_role;
BEGIN
  v_role:=public.current_user_role();
  IF v_role NOT IN ('admin','supervisor','warehouse','distributor') THEN
    RAISE EXCEPTION 'غير مصرح بترحيل الصرف العيني';
  END IF;
  SELECT * INTO payment FROM public.in_kind_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف العيني غير موجود'; END IF;
  IF payment.status='posted' THEN RETURN payment; END IF;
  IF payment.status='cancelled' THEN RAISE EXCEPTION 'السند ملغي'; END IF;
  PERFORM 1 FROM public.beneficiaries WHERE id=payment.beneficiary_id AND status='approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المستفيد غير موجود أو غير معتمد'; END IF;
  PERFORM 1 FROM public.campaigns
  WHERE id=payment.campaign_id AND status='open' AND campaign_type IN ('in_kind','mixed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحملة غير مفتوحة أو لا تسمح بالصرف العيني'; END IF;
  IF v_role='distributor' AND payment.delegate_id IS DISTINCT FROM public.current_delegate_id() THEN
    RAISE EXCEPTION 'السند غير مرتبط بحساب الموزع الحالي';
  END IF;
  SELECT COALESCE(require_payment_approval,true) INTO v_require_approval FROM public.system_settings WHERE id=1;
  IF v_role='distributor' AND v_require_approval AND payment.status<>'approved' THEN
    RAISE EXCEPTION 'سند الموزع يحتاج اعتماد المشرف قبل الترحيل';
  END IF;
  IF NULLIF(trim(payment.override_reason),'') IS NOT NULL AND v_role<>'admin' THEN
    RAISE EXCEPTION 'الاستثناء من منع التكرار متاح لمدير النظام فقط';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.in_kind_payments other
    WHERE other.id<>payment.id AND other.beneficiary_id=payment.beneficiary_id
      AND other.campaign_id=payment.campaign_id AND other.status='posted'
      AND (payment.basket_id IS NULL OR other.basket_id=payment.basket_id)
  ) AND NULLIF(trim(payment.override_reason),'') IS NULL THEN
    RAISE EXCEPTION 'المستفيد استلم هذه المساعدة سابقاً';
  END IF;
  IF payment.distribution_type='basket' THEN
    IF payment.basket_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.baskets b
      WHERE b.id=payment.basket_id AND b.campaign_id=payment.campaign_id AND b.is_active=true
    ) THEN RAISE EXCEPTION 'السلة غير نشطة أو لا تتبع الحملة'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.in_kind_payment_details WHERE payment_id=payment.id) THEN
      INSERT INTO public.in_kind_payment_details(payment_id,item_id,quantity)
      SELECT payment.id,bi.item_id,bi.quantity FROM public.basket_items bi WHERE bi.basket_id=payment.basket_id;
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.in_kind_payment_details WHERE payment_id=payment.id) THEN
    RAISE EXCEPTION 'السند لا يحتوي أصنافاً';
  END IF;

  FOR detail IN
    SELECT * FROM public.in_kind_payment_details WHERE payment_id=payment.id ORDER BY item_id
  LOOP
    SELECT COALESCE(SUM(quantity_available),0) INTO v_available
    FROM public.inventory_lots
    WHERE item_id=detail.item_id AND campaign_id=payment.campaign_id
      AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date);
    IF v_available<detail.quantity THEN
      RAISE EXCEPTION 'رصيد الحملة العيني غير كاف للصنف %. المتاح % والمطلوب %',detail.item_id,v_available,detail.quantity;
    END IF;
    v_needed:=detail.quantity;
    FOR lot IN
      SELECT * FROM public.inventory_lots
      WHERE item_id=detail.item_id AND campaign_id=payment.campaign_id
        AND quantity_available>0 AND (expiry_date IS NULL OR expiry_date>current_date)
      ORDER BY expiry_date NULLS LAST,created_at,id FOR UPDATE
    LOOP
      EXIT WHEN v_needed<=0;
      v_take:=LEAST(v_needed,lot.quantity_available);
      UPDATE public.inventory_lots SET quantity_available=quantity_available-v_take WHERE id=lot.id;
      INSERT INTO public.inventory_movements(lot_id,item_id,movement_type,quantity,source_table,source_id,source_detail_id)
      VALUES(lot.id,detail.item_id,'out',v_take,'in_kind_payments',payment.id,detail.id);
      v_needed:=v_needed-v_take;
    END LOOP;
    IF v_needed>0 THEN RAISE EXCEPTION 'تعذر إكمال صرف الصنف %؛ المتبقي %',detail.item_id,v_needed; END IF;
  END LOOP;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.in_kind_payments
  SET status='posted',posted_at=COALESCE(posted_at,now()),updated_at=now()
  WHERE id=payment.id RETURNING * INTO payment;
  RETURN payment;
END; $$;

DROP FUNCTION IF EXISTS public.cancel_in_kind_payment(uuid,text);
CREATE FUNCTION public.cancel_in_kind_payment(p_id uuid,p_reason text)
RETURNS public.in_kind_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payment public.in_kind_payments%ROWTYPE; movement public.inventory_movements%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء الصرف العيني';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO payment FROM public.in_kind_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف العيني غير موجود'; END IF;
  IF payment.status='cancelled' THEN RETURN payment; END IF;
  IF payment.status<>'posted' THEN
    PERFORM set_config('zakat.internal_financial_update','on',true);
    UPDATE public.in_kind_payments
    SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
    WHERE id=payment.id RETURNING * INTO payment;
    RETURN payment;
  END IF;
  PERFORM 1 FROM public.campaigns WHERE id=payment.campaign_id FOR UPDATE;
  FOR movement IN
    SELECT * FROM public.inventory_movements
    WHERE source_table='in_kind_payments' AND source_id=payment.id
      AND movement_type='out' AND reversed_at IS NULL ORDER BY id FOR UPDATE
  LOOP
    UPDATE public.inventory_lots SET quantity_available=quantity_available+movement.quantity WHERE id=movement.lot_id;
    UPDATE public.inventory_movements SET reversed_at=now() WHERE id=movement.id;
  END LOOP;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.in_kind_payments
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
  WHERE id=payment.id RETURNING * INTO payment;
  RETURN payment;
END; $$;

DROP FUNCTION IF EXISTS public.confirm_in_kind_payment_receipt(uuid);
CREATE FUNCTION public.confirm_in_kind_payment_receipt(p_id uuid)
RETURNS public.in_kind_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payment public.in_kind_payments%ROWTYPE;
BEGIN
  SELECT * INTO payment FROM public.in_kind_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف العيني غير موجود'; END IF;
  IF NOT (public.has_role(ARRAY['admin','supervisor','warehouse']::public.app_role[])
      OR payment.delegate_id=public.current_delegate_id()) THEN
    RAISE EXCEPTION 'غير مصرح بتأكيد الاستلام';
  END IF;
  IF payment.status<>'posted' THEN RAISE EXCEPTION 'يجب ترحيل السند قبل تأكيد الاستلام'; END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.in_kind_payments SET receipt_status='received',updated_at=now()
  WHERE id=payment.id RETURNING * INTO payment;
  RETURN payment;
END; $$;

-- Atomic draft writers keep parent rows and their detail rows in one database
-- transaction. A detail validation error cannot leave an orphan parent draft.
DROP FUNCTION IF EXISTS public.save_in_kind_receipt_draft(jsonb,jsonb,uuid);
CREATE FUNCTION public.save_in_kind_receipt_draft(p_record jsonb,p_details jsonb,p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_key uuid; v_status public.document_status; current_row public.in_kind_receipts%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant','warehouse']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بحفظ سند القبض العيني';
  END IF;
  v_status:=COALESCE(NULLIF(p_record->>'status',''),'draft')::public.document_status;
  IF v_status IN ('posted','cancelled') THEN RAISE EXCEPTION 'الحفظ متاح للمسودة أو المراجعة أو الاعتماد فقط'; END IF;
  IF jsonb_array_length(COALESCE(p_details,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل'; END IF;
  IF p_id IS NULL THEN
    v_key:=COALESCE(NULLIF(p_record->>'idempotency_key','')::uuid,gen_random_uuid());
    SELECT id INTO v_id FROM public.in_kind_receipts WHERE idempotency_key=v_key;
    IF FOUND THEN RETURN v_id; END IF;
    INSERT INTO public.in_kind_receipts(
      receipt_date,donor_id,warehouse_id,campaign_id,delegate_id,notes,status,idempotency_key,created_by
    ) VALUES(
      COALESCE(NULLIF(p_record->>'receipt_date','')::date,current_date),
      (p_record->>'donor_id')::uuid,(p_record->>'warehouse_id')::uuid,NULL,NULL,
      NULLIF(p_record->>'notes',''),v_status,v_key,auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO current_row FROM public.in_kind_receipts WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'سند القبض العيني غير موجود'; END IF;
    IF current_row.status IN ('posted','cancelled') THEN RAISE EXCEPTION 'لا يمكن تعديل سند مرحل أو ملغي'; END IF;
    UPDATE public.in_kind_receipts SET
      receipt_date=COALESCE(NULLIF(p_record->>'receipt_date','')::date,receipt_date),
      donor_id=COALESCE(NULLIF(p_record->>'donor_id','')::uuid,donor_id),
      warehouse_id=COALESCE(NULLIF(p_record->>'warehouse_id','')::uuid,warehouse_id),
      campaign_id=NULL,delegate_id=NULL,notes=NULLIF(p_record->>'notes',''),status=v_status,updated_at=now()
    WHERE id=p_id;
    v_id:=p_id;
    DELETE FROM public.in_kind_receipt_details WHERE receipt_id=v_id;
  END IF;
  INSERT INTO public.in_kind_receipt_details(
    receipt_id,item_id,quantity,valid_qty,damaged_qty,lot_no,expiry_date
  )
  SELECT v_id,x.item_id,x.quantity,x.valid_qty,COALESCE(x.damaged_qty,0),x.lot_no,x.expiry_date
  FROM jsonb_to_recordset(COALESCE(p_details,'[]'::jsonb)) AS x(
    item_id uuid,quantity numeric,valid_qty numeric,damaged_qty numeric,lot_no text,expiry_date date
  );
  RETURN v_id;
END; $$;

DROP FUNCTION IF EXISTS public.save_campaign_in_kind_funding_draft(jsonb,jsonb,uuid);
CREATE FUNCTION public.save_campaign_in_kind_funding_draft(p_record jsonb,p_details jsonb,p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_key uuid; v_status public.document_status; current_row public.campaign_in_kind_funding%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بحفظ تمويل الحملة العيني';
  END IF;
  v_status:=COALESCE(NULLIF(p_record->>'status',''),'draft')::public.document_status;
  IF v_status IN ('posted','cancelled') THEN RAISE EXCEPTION 'الحفظ متاح للمسودة أو المراجعة أو الاعتماد فقط'; END IF;
  IF jsonb_array_length(COALESCE(p_details,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل'; END IF;
  IF p_id IS NULL THEN
    v_key:=COALESCE(NULLIF(p_record->>'idempotency_key','')::uuid,gen_random_uuid());
    SELECT id INTO v_id FROM public.campaign_in_kind_funding WHERE idempotency_key=v_key;
    IF FOUND THEN RETURN v_id; END IF;
    INSERT INTO public.campaign_in_kind_funding(
      funding_date,campaign_id,warehouse_id,notes,status,idempotency_key,created_by
    ) VALUES(
      COALESCE(NULLIF(p_record->>'funding_date','')::date,current_date),
      (p_record->>'campaign_id')::uuid,(p_record->>'warehouse_id')::uuid,
      NULLIF(p_record->>'notes',''),v_status,v_key,auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO current_row FROM public.campaign_in_kind_funding WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'تمويل الحملة العيني غير موجود'; END IF;
    IF current_row.status IN ('posted','cancelled') THEN RAISE EXCEPTION 'لا يمكن تعديل تمويل مرحل أو ملغي'; END IF;
    UPDATE public.campaign_in_kind_funding SET
      funding_date=COALESCE(NULLIF(p_record->>'funding_date','')::date,funding_date),
      campaign_id=COALESCE(NULLIF(p_record->>'campaign_id','')::uuid,campaign_id),
      warehouse_id=COALESCE(NULLIF(p_record->>'warehouse_id','')::uuid,warehouse_id),
      notes=NULLIF(p_record->>'notes',''),status=v_status,updated_at=now()
    WHERE id=p_id;
    v_id:=p_id;
    DELETE FROM public.campaign_in_kind_funding_details WHERE funding_id=v_id;
  END IF;
  INSERT INTO public.campaign_in_kind_funding_details(funding_id,item_id,quantity)
  SELECT v_id,x.item_id,x.quantity
  FROM jsonb_to_recordset(COALESCE(p_details,'[]'::jsonb)) AS x(item_id uuid,quantity numeric);
  RETURN v_id;
END; $$;

DROP FUNCTION IF EXISTS public.save_in_kind_payment_draft(jsonb,jsonb,uuid);
CREATE FUNCTION public.save_in_kind_payment_draft(p_record jsonb,p_details jsonb,p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_key uuid; v_status public.document_status; v_type public.distribution_type; current_row public.in_kind_payments%ROWTYPE;
BEGIN
  IF public.current_user_role() NOT IN ('admin','supervisor','warehouse','distributor') THEN
    RAISE EXCEPTION 'غير مصرح بحفظ سند الصرف العيني';
  END IF;
  v_status:=COALESCE(NULLIF(p_record->>'status',''),'draft')::public.document_status;
  v_type:=COALESCE(NULLIF(p_record->>'distribution_type',''),'basket')::public.distribution_type;
  IF v_status IN ('posted','cancelled') THEN RAISE EXCEPTION 'الحفظ متاح للمسودة أو المراجعة أو الاعتماد فقط'; END IF;
  IF v_type='manual' AND jsonb_array_length(COALESCE(p_details,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'أضف صنفاً واحداً على الأقل للصرف اليدوي';
  END IF;
  IF p_id IS NULL THEN
    v_key:=COALESCE(NULLIF(p_record->>'idempotency_key','')::uuid,gen_random_uuid());
    SELECT id INTO v_id FROM public.in_kind_payments WHERE idempotency_key=v_key;
    IF FOUND THEN RETURN v_id; END IF;
    INSERT INTO public.in_kind_payments(
      payment_date,beneficiary_id,campaign_id,delegate_id,distribution_type,basket_id,
      receipt_status,actual_recipient,proof_url,override_reason,notes,status,idempotency_key,created_by
    ) VALUES(
      COALESCE(NULLIF(p_record->>'payment_date','')::date,current_date),
      (p_record->>'beneficiary_id')::uuid,(p_record->>'campaign_id')::uuid,
      NULLIF(p_record->>'delegate_id','')::uuid,v_type,NULLIF(p_record->>'basket_id','')::uuid,
      COALESCE(NULLIF(p_record->>'receipt_status',''),'pending')::public.receipt_status,
      NULLIF(p_record->>'actual_recipient',''),NULLIF(p_record->>'proof_url',''),
      NULLIF(p_record->>'override_reason',''),NULLIF(p_record->>'notes',''),v_status,v_key,auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO current_row FROM public.in_kind_payments WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف العيني غير موجود'; END IF;
    IF current_row.status IN ('posted','cancelled') THEN RAISE EXCEPTION 'لا يمكن تعديل سند مرحل أو ملغي'; END IF;
    UPDATE public.in_kind_payments SET
      payment_date=COALESCE(NULLIF(p_record->>'payment_date','')::date,payment_date),
      beneficiary_id=COALESCE(NULLIF(p_record->>'beneficiary_id','')::uuid,beneficiary_id),
      campaign_id=COALESCE(NULLIF(p_record->>'campaign_id','')::uuid,campaign_id),
      delegate_id=NULLIF(p_record->>'delegate_id','')::uuid,distribution_type=v_type,
      basket_id=NULLIF(p_record->>'basket_id','')::uuid,
      receipt_status=COALESCE(NULLIF(p_record->>'receipt_status',''),'pending')::public.receipt_status,
      actual_recipient=NULLIF(p_record->>'actual_recipient',''),proof_url=NULLIF(p_record->>'proof_url',''),
      override_reason=NULLIF(p_record->>'override_reason',''),notes=NULLIF(p_record->>'notes',''),
      status=v_status,updated_at=now()
    WHERE id=p_id;
    v_id:=p_id;
    DELETE FROM public.in_kind_payment_details WHERE payment_id=v_id;
  END IF;
  INSERT INTO public.in_kind_payment_details(payment_id,item_id,quantity)
  SELECT v_id,x.item_id,x.quantity
  FROM jsonb_to_recordset(COALESCE(p_details,'[]'::jsonb)) AS x(item_id uuid,quantity numeric);
  RETURN v_id;
END; $$;

DROP FUNCTION IF EXISTS public.save_basket_with_items(jsonb,jsonb,uuid);
CREATE FUNCTION public.save_basket_with_items(p_record jsonb,p_details jsonb,p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_key uuid; current_row public.baskets%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','warehouse']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بحفظ السلة';
  END IF;
  IF jsonb_array_length(COALESCE(p_details,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'أضف مكوناً واحداً على الأقل للسلة'; END IF;
  IF p_id IS NULL THEN
    v_key:=COALESCE(NULLIF(p_record->>'idempotency_key','')::uuid,gen_random_uuid());
    SELECT id INTO v_id FROM public.baskets WHERE idempotency_key=v_key;
    IF FOUND THEN RETURN v_id; END IF;
    INSERT INTO public.baskets(name,campaign_id,description,is_active,idempotency_key,created_by)
    VALUES(
      trim(p_record->>'name'),(p_record->>'campaign_id')::uuid,NULLIF(p_record->>'description',''),
      COALESCE((p_record->>'is_active')::boolean,true),v_key,auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO current_row FROM public.baskets WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'السلة غير موجودة'; END IF;
    UPDATE public.baskets SET
      name=COALESCE(NULLIF(trim(p_record->>'name'),''),name),
      campaign_id=COALESCE(NULLIF(p_record->>'campaign_id','')::uuid,campaign_id),
      description=NULLIF(p_record->>'description',''),
      is_active=COALESCE((p_record->>'is_active')::boolean,is_active),updated_at=now()
    WHERE id=p_id;
    v_id:=p_id;
    DELETE FROM public.basket_items WHERE basket_id=v_id;
  END IF;
  INSERT INTO public.basket_items(basket_id,item_id,quantity,required)
  SELECT v_id,x.item_id,x.quantity,COALESCE(x.required,true)
  FROM jsonb_to_recordset(COALESCE(p_details,'[]'::jsonb)) AS x(item_id uuid,quantity numeric,required boolean);
  RETURN v_id;
END; $$;


-- Closing uses the current campaign-owned model: posted campaign funding minus
-- posted payments, plus zero remaining campaign stock for a full close.
CREATE OR REPLACE FUNCTION public.prepare_account_closing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_funded numeric(18,2);
  v_spent numeric(18,2);
  v_pending integer;
  v_stock numeric(18,3);
  v_allocations numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإقفال الحسابات';
  END IF;
  PERFORM 1 FROM public.campaigns WHERE id=NEW.campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحملة غير موجودة'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_funded
  FROM public.campaign_funding WHERE campaign_id=NEW.campaign_id AND status='posted';
  SELECT COALESCE(SUM(amount),0) INTO v_spent
  FROM public.cash_payments WHERE campaign_id=NEW.campaign_id AND status='posted';
  SELECT
    (SELECT COUNT(*) FROM public.campaign_funding WHERE campaign_id=NEW.campaign_id AND status NOT IN ('posted','cancelled'))+
    (SELECT COUNT(*) FROM public.cash_payments WHERE campaign_id=NEW.campaign_id AND status NOT IN ('posted','cancelled'))+
    (SELECT COUNT(*) FROM public.campaign_in_kind_funding WHERE campaign_id=NEW.campaign_id AND status NOT IN ('posted','cancelled'))+
    (SELECT COUNT(*) FROM public.in_kind_payments WHERE campaign_id=NEW.campaign_id AND status NOT IN ('posted','cancelled'))
  INTO v_pending;
  IF v_pending>0 THEN RAISE EXCEPTION 'توجد سندات مسودة أو معلقة تخص الحملة'; END IF;
  SELECT COALESCE(SUM(quantity_available),0) INTO v_stock
  FROM public.inventory_lots WHERE campaign_id=NEW.campaign_id;
  SELECT COALESCE(SUM(allocated_amount-spent_amount-returned_amount),0) INTO v_allocations
  FROM public.campaign_distributors WHERE campaign_id=NEW.campaign_id;
  NEW.total_received:=v_funded;
  NEW.total_spent:=v_spent;
  NEW.balance:=v_funded-v_spent;
  NEW.closed_by:=auth.uid();
  NEW.closed_at:=now();
  NEW.status:='closed';
  IF NEW.closing_type='full' THEN
    IF abs(NEW.balance)>0.009 OR abs(COALESCE(NEW.difference,0))>0.009 THEN
      RAISE EXCEPTION 'لا يمكن الإقفال الكامل مع رصيد أو فرق نقدي. الرصيد % والفرق %',NEW.balance,COALESCE(NEW.difference,0);
    END IF;
    IF v_allocations>0.009 THEN
      RAISE EXCEPTION 'لا يمكن الإقفال الكامل قبل تسوية تخصيصات الموزعين. المتبقي %',v_allocations;
    END IF;
    IF v_stock>0.0005 THEN
      RAISE EXCEPTION 'لا يمكن الإقفال الكامل قبل تصريف أو إرجاع مخزون الحملة. المتبقي %',v_stock;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS prepare_account_closing_before ON public.account_closings;
CREATE TRIGGER prepare_account_closing_before
BEFORE INSERT ON public.account_closings
FOR EACH ROW EXECUTE FUNCTION public.prepare_account_closing();

CREATE OR REPLACE FUNCTION public.finish_account_closing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.closing_type='full' THEN UPDATE public.campaigns SET status='closed' WHERE id=NEW.campaign_id; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS finish_account_closing_after ON public.account_closings;
CREATE TRIGGER finish_account_closing_after
AFTER INSERT ON public.account_closings
FOR EACH ROW EXECUTE FUNCTION public.finish_account_closing();

DROP FUNCTION IF EXISTS public.reopen_account_closing(uuid,text);
CREATE FUNCTION public.reopen_account_closing(p_id uuid,p_reason text DEFAULT NULL)
RETURNS public.account_closings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE closing public.account_closings%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإعادة فتح الإقفال';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب إعادة الفتح مطلوب'; END IF;
  SELECT * INTO closing FROM public.account_closings WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سجل الإقفال غير موجود'; END IF;
  IF closing.status='reopened' THEN RETURN closing; END IF;
  PERFORM 1 FROM public.campaigns WHERE id=closing.campaign_id FOR UPDATE;
  UPDATE public.account_closings
  SET status='reopened',notes=concat_ws(E'\n',notes,'سبب إعادة الفتح: '||trim(p_reason))
  WHERE id=closing.id RETURNING * INTO closing;
  UPDATE public.campaigns SET status='open' WHERE id=closing.campaign_id;
  RETURN closing;
END; $$;

-- Rebuild date controls without the deleted distributor-advance table.
DO $$ DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('cash_receipts','receipt_date'),('cash_payments','payment_date'),
    ('cash_transfers','transfer_date'),('campaign_funding','funding_date'),
    ('in_kind_receipts','receipt_date'),('campaign_in_kind_funding','funding_date'),
    ('in_kind_payments','payment_date')
  ) AS list(table_name,date_column)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_backdate ON public.%I',item.table_name);
    EXECUTE format(
      'CREATE TRIGGER enforce_backdate BEFORE INSERT OR UPDATE OF %I ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_backdated_document(%L)',
      item.date_column,item.table_name,item.date_column
    );
  END LOOP;
END $$;

-- SQL-editor-only helper used by the first-admin step documented in README.
-- It promotes an existing Auth user; it never creates or stores a password.
DROP FUNCTION IF EXISTS public.bootstrap_first_admin(text,text,text);
CREATE FUNCTION public.bootstrap_first_admin(
  p_phone text,
  p_full_name text DEFAULT NULL,
  p_fingerprint text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  v_digits text;
  v_email text;
  v_user_id uuid;
  v_existing_device_user uuid;
BEGIN
  v_digits:=regexp_replace(COALESCE(p_phone,''),'[^0-9]','','g');
  IF left(v_digits,3)='967' THEN v_digits:=substr(v_digits,4); END IF;
  v_digits:=regexp_replace(v_digits,'^0+','');
  IF v_digits !~ '^7[0-9]{8}$' THEN
    RAISE EXCEPTION 'رقم أول مدير يجب أن يكون يمنياً من 9 أرقام ويبدأ بـ 7';
  END IF;
  v_email:='u'||v_digits||'@zakat.local';
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email)=lower(v_email);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أنشئ مستخدم Auth أولاً بالبريد الداخلي % ثم أعد تشغيل الملف',v_email;
  END IF;
  INSERT INTO public.profiles(id,full_name,username,email,phone,role,status,is_active,expires_at)
  VALUES(
    v_user_id,COALESCE(NULLIF(trim(p_full_name),''),'مدير النظام الأول'),
    'admin_'||right(v_digits,4),v_email,'+967'||v_digits,'admin','active',true,NULL
  )
  ON CONFLICT(id) DO UPDATE SET
    full_name=COALESCE(NULLIF(trim(p_full_name),''),public.profiles.full_name),
    email=v_email,phone='+967'||v_digits,role='admin',status='active',is_active=true,expires_at=NULL,updated_at=now();
  UPDATE auth.users
  SET raw_app_meta_data=COALESCE(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('role','admin')
  WHERE id=v_user_id;
  IF NULLIF(trim(p_fingerprint),'') IS NOT NULL THEN
    SELECT user_id INTO v_existing_device_user
    FROM public.authorized_devices WHERE fingerprint=trim(p_fingerprint) FOR UPDATE;
    IF FOUND AND v_existing_device_user IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'بصمة الجهاز مرتبطة بمستخدم آخر';
    END IF;
    INSERT INTO public.authorized_devices(
      user_id,device_name,fingerprint,platform,status,is_active,last_seen_at,notes
    ) VALUES(
      v_user_id,'جهاز أول مدير',trim(p_fingerprint),'Web','approved',true,now(),'اعتماد من ملف أول مدير'
    )
    ON CONFLICT(fingerprint) DO UPDATE SET
      user_id=excluded.user_id,status='approved',is_active=true,last_seen_at=now(),notes=excluded.notes;
  END IF;
  RETURN v_user_id;
END; $$;

-- Login attempts are written through a narrow RPC. Anonymous callers may log
-- only a failed authentication; device-related outcomes are verified against
-- the authenticated user's actual device row.
DROP FUNCTION IF EXISTS public.record_login_attempt(text,text,text,text);
CREATE FUNCTION public.record_login_attempt(
  p_phone text,
  p_fingerprint text,
  p_device_name text,
  p_result text
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_id bigint;
  v_headers jsonb:=COALESCE(NULLIF(current_setting('request.headers',true),''),'{}')::jsonb;
  v_ip_text text;
  v_ip inet;
  v_device_status text;
BEGIN
  IF p_result NOT IN ('failed','pending_device','blocked','success') THEN
    RAISE EXCEPTION 'نتيجة محاولة الدخول غير صالحة';
  END IF;
  IF p_result<>'failed' THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب المصادقة قبل تسجيل حالة الجهاز'; END IF;
    SELECT status INTO v_device_status
    FROM public.authorized_devices
    WHERE user_id=auth.uid() AND fingerprint=left(COALESCE(p_fingerprint,''),200);
    IF NOT FOUND THEN RAISE EXCEPTION 'طلب الجهاز غير موجود'; END IF;
    IF (p_result='pending_device' AND v_device_status<>'pending')
      OR (p_result='blocked' AND v_device_status<>'blocked')
      OR (p_result='success' AND v_device_status<>'approved') THEN
      RAISE EXCEPTION 'نتيجة محاولة الدخول لا تطابق حالة الجهاز';
    END IF;
  END IF;
  v_ip_text:=split_part(COALESCE(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),',',1);
  BEGIN v_ip:=NULLIF(trim(v_ip_text),'')::inet; EXCEPTION WHEN others THEN v_ip:=NULL; END;
  INSERT INTO public.login_attempts(phone,device_fingerprint,device_name,ip_address,result)
  VALUES(
    left(regexp_replace(COALESCE(p_phone,''),'[^0-9+]','','g'),32),
    left(COALESCE(p_fingerprint,''),200),left(COALESCE(p_device_name,'جهاز غير معروف'),200),v_ip,p_result
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_approved_device()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_path text:=trim(both '/' FROM COALESCE(current_setting('request.path',true),''));
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF v_path IN ('rpc/request_device_authorization','rpc/record_login_attempt') THEN RETURN; END IF;
  IF NOT public.has_authorized_device() THEN
    RAISE EXCEPTION 'هذا الجهاز غير معتمد لاستخدام النظام';
  END IF;
END; $$;

DROP POLICY IF EXISTS login_attempts_anon_insert ON public.login_attempts;
REVOKE INSERT ON TABLE public.login_attempts FROM anon,authenticated;
REVOKE USAGE,SELECT ON SEQUENCE public.login_attempts_id_seq FROM anon,authenticated;

-- Monitoring data is not readable merely because a user is authenticated.
-- Session owners may see their own session; monitoring roles see the whole log.
DO $$
DECLARE v_table text; v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['login_attempts','user_sessions','user_archives'] LOOP
    FOR v_policy IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=v_table
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',v_policy.policyname,v_table);
    END LOOP;
  END LOOP;
END $$;
CREATE POLICY login_attempts_monitor_read ON public.login_attempts FOR SELECT TO authenticated
USING(public.has_role(ARRAY['admin','supervisor','auditor']::public.app_role[]));
CREATE POLICY user_sessions_owner_or_monitor_read ON public.user_sessions FOR SELECT TO authenticated
USING(user_id=auth.uid() OR public.has_role(ARRAY['admin','supervisor','auditor']::public.app_role[]));
CREATE POLICY user_archives_owner_or_monitor_read ON public.user_archives FOR SELECT TO authenticated
USING(user_id=auth.uid() OR public.has_role(ARRAY['admin','supervisor','auditor']::public.app_role[]));

-- Final RLS policy for allocation management.
DROP POLICY IF EXISTS authenticated_manage_campaign_distributors ON public.campaign_distributors;
CREATE POLICY authenticated_manage_campaign_distributors
ON public.campaign_distributors FOR ALL TO authenticated
USING(public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]))
WITH CHECK(public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]));

-- Functions are not protected by RLS, so every new SECURITY DEFINER function is
-- closed to PUBLIC and prior role grants are cleared before the exact
-- application entry points are granted.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_approved_device() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(text,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role(),public.has_role(public.app_role[]),
  public.current_delegate_id(),public.is_active_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_device_authorization(text,text,text),
  public.open_user_session(text,text),public.close_user_session(uuid),public.touch_user_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_payment_context(uuid,uuid,uuid),
  public.quick_deliver_cash(uuid,numeric,uuid,uuid,uuid),
  public.post_cash_receipt(uuid),public.cancel_cash_receipt(uuid,text),
  public.post_campaign_funding(uuid),public.cancel_campaign_funding(uuid,text),
  public.post_cash_transfer(uuid),public.cancel_cash_transfer(uuid,text),
  public.post_cash_payment(uuid),public.cancel_cash_payment(uuid,text),
  public.settle_campaign_distributor(uuid,text),public.confirm_cash_payment_receipt(uuid),
  public.post_in_kind_receipt(uuid),public.cancel_in_kind_receipt(uuid,text),
  public.post_campaign_in_kind_funding(uuid),public.cancel_campaign_in_kind_funding(uuid,text),
  public.post_in_kind_payment(uuid),public.cancel_in_kind_payment(uuid,text),
  public.confirm_in_kind_payment_receipt(uuid),public.reopen_account_closing(uuid,text),
  public.save_in_kind_receipt_draft(jsonb,jsonb,uuid),
  public.save_campaign_in_kind_funding_draft(jsonb,jsonb,uuid),
  public.save_in_kind_payment_draft(jsonb,jsonb,uuid),
  public.save_basket_with_items(jsonb,jsonb,uuid),
  public.save_system_settings(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(text,text,text) FROM PUBLIC,anon,authenticated;

GRANT SELECT ON public.campaign_balances,public.v_campaign_cash_balances,public.v_campaigns,
  public.v_delegate_cash_balances,public.v_delegates,public.v_campaign_distributors TO authenticated;

-- Supabase projects created with automatic Data API exposure disabled do not
-- grant new objects to service_role. Edge Functions use that role, so grant it
-- explicitly after every application object has been created.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Keep future privileged functions closed by default while preserving the
-- server-side role used by trusted Edge Functions.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO service_role;

UPDATE public.system_installation SET version='11.2.0',installed_at=now() WHERE id=1;
NOTIFY pgrst,'reload schema';
NOTIFY pgrst,'reload config';

COMMIT;

-- ============================================================================
-- V12.0.0 — single-database reliability, scoped distributors, live backup,
-- financial integrity checks and the audited Gemini assistant data layer.
-- This section is intentionally idempotent and is part of the one install file.
-- EXISTING V11 DATABASE: first clone/backup the complete Supabase project, then
-- execute from this V12 marker through end-of-file on the clone. A clean project
-- must execute the whole file from line 1.
-- ============================================================================
BEGIN;

-- A final financial posting can never be trusted offline because balance,
-- duplicate and inventory checks must run against current locked rows.
UPDATE public.system_settings SET allow_final_offline=false WHERE allow_final_offline IS DISTINCT FROM false;
CREATE OR REPLACE FUNCTION public.enforce_no_final_offline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.allow_final_offline:=false;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_no_final_offline_trigger ON public.system_settings;
CREATE TRIGGER enforce_no_final_offline_trigger
BEFORE INSERT OR UPDATE OF allow_final_offline ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.enforce_no_final_offline();

-- Distributor capability: the administrator decides whether a linked
-- distributor may submit new beneficiary files. Submitted files always start
-- under review and can never be self-approved by the distributor.
ALTER TABLE public.delegates
  ADD COLUMN IF NOT EXISTS can_create_beneficiaries boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.get_my_capabilities();
CREATE FUNCTION public.get_my_capabilities()
RETURNS TABLE(delegate_id uuid,can_create_beneficiaries boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT d.id,COALESCE(d.can_create_beneficiaries,false)
  FROM public.delegates d
  WHERE d.profile_id=auth.uid() AND d.is_active=true
  ORDER BY d.created_at,d.id
  LIMIT 1
$$;

DROP FUNCTION IF EXISTS public.current_delegate_can_create_beneficiaries();
CREATE FUNCTION public.current_delegate_can_create_beneficiaries()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE((
    SELECT d.can_create_beneficiaries
    FROM public.delegates d
    WHERE d.profile_id=auth.uid() AND d.is_active=true
    ORDER BY d.created_at,d.id LIMIT 1
  ),false)
$$;

CREATE OR REPLACE FUNCTION public.enforce_distributor_beneficiary_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_delegate uuid;
BEGIN
  IF public.current_user_role()='distributor' THEN
    SELECT d.id INTO v_delegate
    FROM public.delegates d
    WHERE d.profile_id=auth.uid() AND d.is_active=true AND d.can_create_beneficiaries=true
    ORDER BY d.created_at,d.id LIMIT 1;
    IF v_delegate IS NULL THEN
      RAISE EXCEPTION 'لم يمنح مدير النظام هذا الموزع صلاحية إضافة مستفيدين';
    END IF;
    NEW.delegate_id:=v_delegate;
    NEW.status:='under_review';
    NEW.approved_by:=NULL;
    NEW.approved_at:=NULL;
    NEW.created_by:=auth.uid();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_distributor_beneficiary_submission_trigger ON public.beneficiaries;
CREATE TRIGGER enforce_distributor_beneficiary_submission_trigger
BEFORE INSERT ON public.beneficiaries
FOR EACH ROW EXECUTE FUNCTION public.enforce_distributor_beneficiary_submission();

-- Remove historical overlapping beneficiary policies and install one explicit
-- policy set. UPDATE also has SELECT coverage, as required by PostgREST/RLS.
DO $$ DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='beneficiaries'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.beneficiaries',p.policyname);
  END LOOP;
END $$;
CREATE POLICY beneficiaries_read_scoped_v12 ON public.beneficiaries
FOR SELECT TO authenticated USING(
  public.has_role(ARRAY['admin','supervisor','accountant','data_entry','warehouse','auditor']::public.app_role[])
  OR (public.current_user_role()='distributor' AND delegate_id=public.current_delegate_id())
);
CREATE POLICY beneficiaries_insert_management_v12 ON public.beneficiaries
FOR INSERT TO authenticated WITH CHECK(
  public.has_role(ARRAY['admin','supervisor','data_entry']::public.app_role[])
  OR (
    public.current_user_role()='distributor'
    AND public.current_delegate_can_create_beneficiaries()
    AND delegate_id=public.current_delegate_id()
    AND status='under_review'
    AND approved_by IS NULL AND approved_at IS NULL
    AND created_by=auth.uid()
  )
);
CREATE POLICY beneficiaries_update_management_v12 ON public.beneficiaries
FOR UPDATE TO authenticated
USING(public.has_role(ARRAY['admin','supervisor','data_entry']::public.app_role[]))
WITH CHECK(public.has_role(ARRAY['admin','supervisor','data_entry']::public.app_role[]));
CREATE POLICY beneficiaries_delete_admin_v12 ON public.beneficiaries
FOR DELETE TO authenticated USING(public.current_user_role()='admin');

-- The historical compatibility policy allowed only administrators to write
-- transfers, although the UI and posting RPC correctly allow supervisors and
-- accountants. Replace it with the same explicit financial-role contract and
-- keep ordinary Data API edits limited to drafts.
DO $$ DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='cash_transfers'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.cash_transfers',p.policyname);
  END LOOP;
END $$;
CREATE POLICY cash_transfers_read_finance_v12 ON public.cash_transfers
FOR SELECT TO authenticated USING(
  public.has_role(ARRAY['admin','supervisor','accountant','auditor']::public.app_role[])
);
CREATE POLICY cash_transfers_insert_finance_v12 ON public.cash_transfers
FOR INSERT TO authenticated WITH CHECK(
  public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[])
  AND status='draft'
);
CREATE POLICY cash_transfers_update_draft_v12 ON public.cash_transfers
FOR UPDATE TO authenticated
USING(
  public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[])
  AND status='draft'
)
WITH CHECK(
  public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[])
  AND status='draft'
);
CREATE POLICY cash_transfers_delete_draft_admin_v12 ON public.cash_transfers
FOR DELETE TO authenticated USING(public.current_user_role()='admin' AND status='draft');

DROP POLICY IF EXISTS campaign_distributors_read_own_v12 ON public.campaign_distributors;
CREATE POLICY campaign_distributors_read_own_v12 ON public.campaign_distributors
FOR SELECT TO authenticated USING(
  public.current_user_role()='distributor'
  AND delegate_id=public.current_delegate_id()
);

-- Ledger lines contain organization-wide financial detail. Financial and
-- audit roles may inspect all lines; a distributor may inspect only the box
-- used by one of that distributor's campaign assignments.
DO $$ DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='cashbox_ledger'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.cashbox_ledger',p.policyname);
  END LOOP;
END $$;
CREATE POLICY cashbox_ledger_read_scoped_v12 ON public.cashbox_ledger
FOR SELECT TO authenticated USING(
  public.has_role(ARRAY['admin','supervisor','accountant','auditor']::public.app_role[])
  OR (
    public.current_user_role()='distributor'
    AND EXISTS(
      SELECT 1 FROM public.campaign_distributors cd
      WHERE cd.cashbox_id=cashbox_ledger.cashbox_id
        AND cd.delegate_id=public.current_delegate_id()
    )
  )
);

-- A transfer reference is generated in the database, not the browser. This is
-- concurrency safe and fixes NULL transfer_no failures from the original UI.
CREATE SEQUENCE IF NOT EXISTS public.cash_transfer_seq;
ALTER TABLE public.cash_transfers ALTER COLUMN transfer_date SET DEFAULT current_date;
ALTER TABLE public.cash_transfers ALTER COLUMN transfer_no SET DEFAULT
  ('CT-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.cash_transfer_seq')::text,6,'0'));
-- Existing installations may already contain manually numbered transfers.
-- Move the sequence beyond their greatest numeric suffix before filling NULLs
-- or serving concurrent inserts, otherwise the first V12 number could collide.
DO $$ DECLARE v_max bigint;
BEGIN
  SELECT COALESCE(MAX((regexp_match(transfer_no,'([0-9]+)$'))[1]::bigint),0)
  INTO v_max FROM public.cash_transfers WHERE NULLIF(trim(transfer_no),'') IS NOT NULL;
  PERFORM setval('public.cash_transfer_seq',GREATEST(v_max,1),v_max>0);
END $$;
UPDATE public.cash_transfers
SET transfer_no='CT-'||to_char(COALESCE(transfer_date,current_date),'YYYY')||'-'||lpad(nextval('public.cash_transfer_seq')::text,6,'0')
WHERE transfer_no IS NULL OR trim(transfer_no)='';

-- Settlement provenance makes reopening reversible without touching manual
-- returns or returns belonging to another operation.
ALTER TABLE public.campaign_distributors
  ADD COLUMN IF NOT EXISTS settled_return_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_reason text;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='campaign_distributors_settled_return_check') THEN
    ALTER TABLE public.campaign_distributors ADD CONSTRAINT campaign_distributors_settled_return_check
      CHECK(settled_return_amount>=0 AND settled_return_amount<=returned_amount);
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.settle_campaign_distributor(uuid,text);
CREATE FUNCTION public.settle_campaign_distributor(p_id uuid,p_reason text DEFAULT NULL)
RETURNS public.campaign_distributors LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE assignment public.campaign_distributors%ROWTYPE; v_remaining numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بتسوية تخصيص الموزع';
  END IF;
  SELECT * INTO assignment FROM public.campaign_distributors WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تخصيص الموزع غير موجود'; END IF;
  IF assignment.status='settled' AND assignment.settled_at IS NOT NULL THEN RETURN assignment; END IF;
  IF assignment.status<>'active' THEN RAISE EXCEPTION 'يمكن تسوية التخصيص النشط فقط'; END IF;
  PERFORM 1 FROM public.campaigns WHERE id=assignment.campaign_id FOR UPDATE;
  v_remaining:=assignment.allocated_amount-assignment.spent_amount-assignment.returned_amount;
  IF v_remaining<0 THEN RAISE EXCEPTION 'بيانات التخصيص غير متوازنة'; END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_distributors
  SET returned_amount=returned_amount+v_remaining,
      settled_return_amount=v_remaining,
      settled_at=now(),settled_by=auth.uid(),settlement_reason=NULLIF(trim(p_reason),''),
      status='settled',
      notes=concat_ws(E'\n',notes,CASE WHEN NULLIF(trim(p_reason),'') IS NULL
        THEN 'تمت تسوية كامل المتبقي' ELSE 'سبب التسوية: '||trim(p_reason) END)
  WHERE id=assignment.id RETURNING * INTO assignment;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data,session_info)
  VALUES(auth.uid(),'settle_campaign_distributor','campaign_distributors',assignment.id,
    jsonb_build_object('settled_return_amount',v_remaining,'reason',p_reason),jsonb_build_object('source','rpc'));
  RETURN assignment;
END; $$;

DROP FUNCTION IF EXISTS public.reopen_campaign_distributor(uuid,text);
CREATE FUNCTION public.reopen_campaign_distributor(p_id uuid,p_reason text DEFAULT NULL)
RETURNS public.campaign_distributors LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  assignment public.campaign_distributors%ROWTYPE;
  v_auto_return numeric(18,2);
  v_unallocated numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإعادة فتح تخصيص الموزع';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب إعادة الفتح مطلوب'; END IF;
  SELECT * INTO assignment FROM public.campaign_distributors WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تخصيص الموزع غير موجود'; END IF;
  IF assignment.status='active' AND assignment.settled_at IS NULL THEN RETURN assignment; END IF;
  IF assignment.status<>'settled' OR assignment.settled_at IS NULL THEN
    RAISE EXCEPTION 'هذا التخصيص لم يقفل بدالة التسوية ولا يمكن إعادة فتحه';
  END IF;
  PERFORM 1 FROM public.campaigns WHERE id=assignment.campaign_id AND status='open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'يجب أن تكون الحملة مفتوحة قبل إعادة تخصيص الرصيد'; END IF;
  v_auto_return:=assignment.settled_return_amount;
  IF v_auto_return<0 OR v_auto_return>assignment.returned_amount THEN
    RAISE EXCEPTION 'قيمة المرتجع الناتج عن التسوية غير متوازنة';
  END IF;
  -- Settlement releases this amount for another allocation. Reopening is safe
  -- only while the campaign still owns enough unallocated money to take it
  -- back. The campaign row lock serialises this check with allocation edits.
  SELECT COALESCE(unallocated_balance,0) INTO v_unallocated
  FROM public.campaign_balances WHERE id=assignment.campaign_id;
  IF COALESCE(v_unallocated,0)+0.009<v_auto_return THEN
    RAISE EXCEPTION 'لا يمكن إعادة الفتح لأن مبلغ التسوية أُعيد تخصيصه. المتاح غير المخصص % والمطلوب %',COALESCE(v_unallocated,0),v_auto_return;
  END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_distributors
  SET returned_amount=returned_amount-v_auto_return,
      settled_return_amount=0,settled_at=NULL,settled_by=NULL,settlement_reason=NULL,
      status='active',notes=concat_ws(E'\n',notes,'سبب إعادة الفتح: '||trim(p_reason))
  WHERE id=assignment.id RETURNING * INTO assignment;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_data,new_data,session_info)
  VALUES(auth.uid(),'reopen_campaign_distributor','campaign_distributors',assignment.id,
    jsonb_build_object('settled_return_amount',v_auto_return),jsonb_build_object('restored_amount',v_auto_return,'reason',p_reason),jsonb_build_object('source','rpc'));
  RETURN assignment;
END; $$;

-- Cancelling a payment after a manual settlement keeps that allocation
-- settled and adds the cancelled amount to the same reversible settlement
-- marker. Otherwise the old automatic return would become orphaned and a
-- later reopen could restore the wrong balance.
DROP FUNCTION IF EXISTS public.cancel_cash_payment(uuid,text);
CREATE FUNCTION public.cancel_cash_payment(p_id uuid,p_reason text)
RETURNS public.cash_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  payment public.cash_payments%ROWTYPE;
  assignment public.campaign_distributors%ROWTYPE;
  v_manually_settled boolean;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء سند الصرف';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO payment FROM public.cash_payments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند الصرف غير موجود'; END IF;
  IF payment.status='cancelled' THEN RETURN payment; END IF;
  IF payment.status<>'posted' THEN
    PERFORM set_config('zakat.internal_financial_update','on',true);
    UPDATE public.cash_payments
    SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
    WHERE id=payment.id RETURNING * INTO payment;
    RETURN payment;
  END IF;

  PERFORM 1 FROM public.campaigns WHERE id=payment.campaign_id FOR UPDATE;
  SELECT * INTO assignment FROM public.campaign_distributors
  WHERE campaign_id=payment.campaign_id AND delegate_id=payment.delegate_id FOR UPDATE;
  IF NOT FOUND OR assignment.spent_amount<payment.amount THEN
    RAISE EXCEPTION 'تعذر عكس الصرف بسبب عدم تطابق إجمالي مصروف الموزع';
  END IF;
  v_manually_settled:=assignment.status='settled' AND assignment.settled_at IS NOT NULL;
  IF v_manually_settled
     AND abs(assignment.allocated_amount-assignment.spent_amount-assignment.returned_amount)>0.009 THEN
    RAISE EXCEPTION 'تعذر عكس الصرف لأن بيانات التسوية غير متوازنة';
  END IF;

  PERFORM set_config('zakat.internal_financial_update','on',true);
  IF v_manually_settled THEN
    UPDATE public.campaign_distributors
    SET spent_amount=spent_amount-payment.amount,
        returned_amount=returned_amount+payment.amount,
        settled_return_amount=settled_return_amount+payment.amount,
        status='settled'
    WHERE id=assignment.id;
  ELSE
    UPDATE public.campaign_distributors
    SET spent_amount=spent_amount-payment.amount,
        status=CASE WHEN status='settled' AND settled_at IS NULL THEN 'active' ELSE status END
    WHERE id=assignment.id;
  END IF;
  UPDATE public.cash_payments
  SET status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
  WHERE id=payment.id RETURNING * INTO payment;
  UPDATE public.distribution_assignments
  SET delivery_status='cancelled',delivered_at=NULL
  WHERE payment_id=payment.id;
  RETURN payment;
END; $$;

DROP FUNCTION IF EXISTS public.set_campaign_distributor_status(uuid,text);
CREATE FUNCTION public.set_campaign_distributor_status(p_id uuid,p_status text)
RETURNS public.campaign_distributors LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE assignment public.campaign_distributors%ROWTYPE;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN RAISE EXCEPTION 'غير مصرح بتغيير حالة التخصيص'; END IF;
  IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'حالة التخصيص غير صالحة'; END IF;
  SELECT * INTO assignment FROM public.campaign_distributors WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تخصيص الموزع غير موجود'; END IF;
  IF assignment.status='settled' THEN RAISE EXCEPTION 'استخدم إعادة الفتح للتخصيص الذي تمت تسويته'; END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_distributors SET status=p_status WHERE id=p_id RETURNING * INTO assignment;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
  VALUES(auth.uid(),'set_campaign_distributor_status','campaign_distributors',p_id,jsonb_build_object('status',p_status));
  RETURN assignment;
END; $$;

DROP FUNCTION IF EXISTS public.set_authorized_device_status(uuid,text);
CREATE FUNCTION public.set_authorized_device_status(p_id uuid,p_status text)
RETURNS public.authorized_devices LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE device public.authorized_devices%ROWTYPE;
BEGIN
  IF public.current_user_role()<>'admin' THEN RAISE EXCEPTION 'إدارة الأجهزة متاحة لمدير النظام فقط'; END IF;
  IF p_status NOT IN ('approved','blocked') THEN RAISE EXCEPTION 'حالة الجهاز غير صالحة'; END IF;
  SELECT * INTO device FROM public.authorized_devices WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجهاز غير موجود'; END IF;
  IF device.user_id=auth.uid() AND p_status='blocked' THEN RAISE EXCEPTION 'لا يمكن حظر الجهاز الذي تستخدمه حالياً'; END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.authorized_devices SET status=p_status,is_active=(p_status='approved'),last_seen_at=now()
  WHERE id=p_id RETURNING * INTO device;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
  VALUES(auth.uid(),'set_authorized_device_status','authorized_devices',p_id,jsonb_build_object('status',p_status));
  RETURN device;
END; $$;

-- State transitions that affect balances or access are never accepted as an
-- ordinary Data API update. The controlled RPCs above set a transaction-local
-- flag, while SQL-editor/service-role maintenance remains possible.
UPDATE public.authorized_devices SET is_active=(status='approved')
WHERE is_active IS DISTINCT FROM (status='approved');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='authorized_devices_status_active_check' AND conrelid='public.authorized_devices'::regclass) THEN
    ALTER TABLE public.authorized_devices ADD CONSTRAINT authorized_devices_status_active_check
      CHECK(is_active=(status='approved'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.protect_controlled_state_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_internal boolean:=COALESCE(current_setting('zakat.internal_financial_update',true),'')='on';
BEGIN
  IF v_internal OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='campaign_distributors' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'غيّر حالة تخصيص الموزع من أزرار الإيقاف أو التسوية أو إعادة الفتح';
  END IF;
  IF TG_TABLE_NAME='authorized_devices' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'غيّر ترخيص الجهاز من زر التشغيل أو الإيقاف';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NEW.is_active IS DISTINCT FROM (NEW.status='approved') THEN
      RAISE EXCEPTION 'حالة تشغيل الجهاز لا تطابق حالة الترخيص';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS protect_campaign_distributor_state_trigger ON public.campaign_distributors;
CREATE TRIGGER protect_campaign_distributor_state_trigger
BEFORE UPDATE OF status ON public.campaign_distributors
FOR EACH ROW EXECUTE FUNCTION public.protect_controlled_state_change();

DROP TRIGGER IF EXISTS protect_authorized_device_state_trigger ON public.authorized_devices;
CREATE TRIGGER protect_authorized_device_state_trigger
BEFORE UPDATE OF status,is_active ON public.authorized_devices
FOR EACH ROW EXECUTE FUNCTION public.protect_controlled_state_change();

DROP FUNCTION IF EXISTS public.retry_failed_operation(text,uuid);
CREATE FUNCTION public.retry_failed_operation(p_table text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row jsonb;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بإعادة المحاولة';
  END IF;
  IF p_table='disbursement_results' THEN
    UPDATE public.disbursement_results r
    SET result='pending',error_message=NULL,provider_reference=NULL,processed_at=NULL
    WHERE r.id=p_id AND r.result='failed'
    RETURNING jsonb_build_object('id',r.id,'result',r.result,'batch_id',r.batch_id) INTO v_row;
  ELSIF p_table='messages' THEN
    UPDATE public.messages m
    SET status='queued',provider_reference=NULL,sent_at=NULL
    WHERE m.id=p_id AND m.status='failed'
    RETURNING jsonb_build_object('id',m.id,'status',m.status,'phone',m.phone) INTO v_row;
  ELSE
    RAISE EXCEPTION 'نوع سجل إعادة المحاولة غير مسموح';
  END IF;
  IF v_row IS NULL THEN RAISE EXCEPTION 'السجل غير موجود أو لم يعد فاشلاً'; END IF;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data,session_info)
  VALUES(auth.uid(),'retry_failed_operation',p_table,p_id,v_row,jsonb_build_object('source','rpc'));
  RETURN v_row;
END; $$;

-- Direct Data API writes cannot forge a posted/cancelled financial document or
-- mutate/delete one. Only the audited RPCs set the transaction-local flag.
CREATE OR REPLACE FUNCTION public.protect_financial_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_internal boolean:=COALESCE(current_setting('zakat.internal_financial_update',true),'')='on';
BEGIN
  IF v_internal THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.status::text IN ('posted','cancelled') THEN
    RAISE EXCEPTION 'يجب ترحيل أو إلغاء المستند المالي من الإجراء المخصص';
  ELSIF TG_OP='UPDATE' AND OLD.status::text IN ('posted','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل مستند مالي مرحل أو ملغي';
  ELSIF TG_OP='UPDATE' AND NEW.status::text IN ('posted','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'يجب تغيير الحالة المالية من الإجراء المخصص';
  ELSIF TG_OP='DELETE' AND OLD.status::text IN ('posted','cancelled') THEN
    RAISE EXCEPTION 'لا يمكن حذف مستند مالي مرحل أو ملغي';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

DO $$ DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'cash_receipts','cash_payments','cash_transfers','campaign_funding',
    'in_kind_receipts','campaign_in_kind_funding','in_kind_payments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS protect_financial_document_trigger ON public.%I',v_table);
    EXECUTE format('CREATE TRIGGER protect_financial_document_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_financial_document()',v_table);
  END LOOP;
END $$;

-- A compact diagnostic report used after restore and by administrators. Every
-- check is computed from posted documents and append-only ledgers.
DROP FUNCTION IF EXISTS public.financial_integrity_report();
CREATE FUNCTION public.financial_integrity_report()
RETURNS TABLE(check_name text,ok boolean,details text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count bigint;
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant','auditor']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بعرض تقرير التكامل المالي';
  END IF;
  SELECT count(*) INTO v_count FROM public.cashbox_balances WHERE current_balance < -0.009;
  RETURN QUERY SELECT 'cashbox_non_negative',v_count=0,format('%s صندوق برصيد سالب',v_count);

  SELECT count(*) INTO v_count FROM public.campaign_balances WHERE operational_balance < -0.009 OR unallocated_balance < -0.009;
  RETURN QUERY SELECT 'campaign_non_negative',v_count=0,format('%s حملة برصيد غير متوازن',v_count);

  SELECT count(*) INTO v_count FROM public.campaign_distributors
  WHERE allocated_amount+0.009 < spent_amount+returned_amount OR settled_return_amount>returned_amount+0.009;
  RETURN QUERY SELECT 'allocation_bounds',v_count=0,format('%s تخصيص يتجاوز حدوده',v_count);

  SELECT count(*) INTO v_count FROM public.campaign_distributors cd
  LEFT JOIN (
    SELECT campaign_id,delegate_id,SUM(amount) amount FROM public.cash_payments
    WHERE status='posted' GROUP BY campaign_id,delegate_id
  ) p ON p.campaign_id=cd.campaign_id AND p.delegate_id=cd.delegate_id
  WHERE abs(cd.spent_amount-COALESCE(p.amount,0))>0.009;
  RETURN QUERY SELECT 'allocation_spend_matches_posted',v_count=0,format('%s تخصيص لا يطابق سندات الصرف المرحلة',v_count);

  SELECT count(*) INTO v_count FROM public.cash_transfers t
  WHERE t.status='posted' AND (
    COALESCE((SELECT SUM(l.debit) FROM public.cashbox_ledger l WHERE l.reference_table='cash_transfers' AND l.reference_id=t.id AND l.cashbox_id=t.from_cashbox_id AND l.transaction_type='transfer_out'),0)<>t.amount
    OR COALESCE((SELECT SUM(l.credit) FROM public.cashbox_ledger l WHERE l.reference_table='cash_transfers' AND l.reference_id=t.id AND l.cashbox_id=t.to_cashbox_id AND l.transaction_type='transfer_in'),0)<>t.amount
  );
  RETURN QUERY SELECT 'transfer_double_entry',v_count=0,format('%s تحويل مرحل بقيد ناقص أو زائد',v_count);

  SELECT count(*) INTO v_count FROM public.cash_receipts r
  WHERE r.status='posted' AND COALESCE((
    SELECT SUM(l.credit) FROM public.cashbox_ledger l
    WHERE l.reference_table='cash_receipts' AND l.reference_id=r.id
      AND l.cashbox_id=r.cashbox_id AND l.transaction_type='donation'
  ),0)<>r.amount;
  RETURN QUERY SELECT 'posted_receipt_ledger',v_count=0,format('%s سند قبض مرحل لا يطابق قيده',v_count);

  SELECT count(*) INTO v_count FROM public.campaign_funding f
  WHERE f.status='posted' AND COALESCE((
    SELECT SUM(l.debit) FROM public.cashbox_ledger l
    WHERE l.reference_table='campaign_funding' AND l.reference_id=f.id
      AND l.cashbox_id=f.cashbox_id AND l.transaction_type='campaign_funding'
  ),0)<>f.amount;
  RETURN QUERY SELECT 'posted_campaign_funding_ledger',v_count=0,format('%s تمويل حملة مرحل لا يطابق قيده',v_count);

  SELECT count(*) INTO v_count FROM public.cash_receipts r
  WHERE r.status='cancelled' AND r.posted_at IS NOT NULL AND (
    COALESCE((SELECT SUM(l.credit) FROM public.cashbox_ledger l WHERE l.reference_table='cash_receipts' AND l.reference_id=r.id AND l.cashbox_id=r.cashbox_id AND l.transaction_type='donation'),0)<>r.amount
    OR COALESCE((SELECT SUM(l.debit) FROM public.cashbox_ledger l WHERE l.reference_table='cash_receipts' AND l.reference_id=r.id AND l.cashbox_id=r.cashbox_id AND l.transaction_type='refund'),0)<>r.amount
  );
  RETURN QUERY SELECT 'cancelled_receipt_net_zero',v_count=0,format('%s سند قبض ملغي لم يُعكس كاملاً',v_count);

  SELECT count(*) INTO v_count FROM public.campaign_funding f
  WHERE f.status='cancelled' AND f.posted_at IS NOT NULL AND (
    COALESCE((SELECT SUM(l.debit) FROM public.cashbox_ledger l WHERE l.reference_table='campaign_funding' AND l.reference_id=f.id AND l.cashbox_id=f.cashbox_id AND l.transaction_type='campaign_funding'),0)<>f.amount
    OR COALESCE((SELECT SUM(l.credit) FROM public.cashbox_ledger l WHERE l.reference_table='campaign_funding' AND l.reference_id=f.id AND l.cashbox_id=f.cashbox_id AND l.transaction_type='refund'),0)<>f.amount
  );
  RETURN QUERY SELECT 'cancelled_campaign_funding_net_zero',v_count=0,format('%s تمويل حملة ملغي لم يُعكس كاملاً',v_count);

  SELECT count(*) INTO v_count FROM public.cash_transfers t
  WHERE t.status='cancelled' AND t.posted_at IS NOT NULL AND (
    COALESCE((SELECT SUM(l.debit) FROM public.cashbox_ledger l WHERE l.reference_table='cash_transfers' AND l.reference_id=t.id AND l.cashbox_id=t.from_cashbox_id AND l.transaction_type='transfer_out'),0)<>t.amount
    OR COALESCE((SELECT SUM(l.credit) FROM public.cashbox_ledger l WHERE l.reference_table='cash_transfers' AND l.reference_id=t.id AND l.cashbox_id=t.from_cashbox_id AND l.transaction_type='refund'),0)<>t.amount
    OR COALESCE((SELECT SUM(l.credit) FROM public.cashbox_ledger l WHERE l.reference_table='cash_transfers' AND l.reference_id=t.id AND l.cashbox_id=t.to_cashbox_id AND l.transaction_type='transfer_in'),0)<>t.amount
    OR COALESCE((SELECT SUM(l.debit) FROM public.cashbox_ledger l WHERE l.reference_table='cash_transfers' AND l.reference_id=t.id AND l.cashbox_id=t.to_cashbox_id AND l.transaction_type='refund'),0)<>t.amount
  );
  RETURN QUERY SELECT 'cancelled_transfer_net_zero',v_count=0,format('%s تحويل ملغي لم يُعكس بقيدين كاملين',v_count);

  SELECT count(*) INTO v_count FROM public.cashbox_ledger
  WHERE debit<0 OR credit<0 OR (debit>0 AND credit>0) OR (debit=0 AND credit=0);
  RETURN QUERY SELECT 'ledger_sides',v_count=0,format('%s قيد غير صالح',v_count);

  SELECT count(*) INTO v_count FROM public.cashbox_ledger l
  JOIN public.cashboxes b ON b.id=l.cashbox_id
  WHERE l.currency<>b.currency;
  RETURN QUERY SELECT 'ledger_currency_matches_cashbox',v_count=0,format('%s قيد بعملة لا تطابق الصندوق',v_count);

  SELECT count(*) INTO v_count
  FROM public.cash_payments p JOIN public.campaigns c ON c.id=p.campaign_id
  WHERE p.status='posted' AND p.currency<>c.currency;
  RETURN QUERY SELECT 'posted_payment_currency_matches_campaign',v_count=0,format('%s سند صرف بعملة لا تطابق الحملة',v_count);

  SELECT count(*) INTO v_count FROM public.inventory_lots
  WHERE quantity_available < -0.0005 OR quantity_damaged < -0.0005 OR quantity_received < -0.0005
    OR quantity_available+quantity_damaged > quantity_received+0.0005;
  RETURN QUERY SELECT 'inventory_non_negative',v_count=0,format('%s تشغيلة مخزون غير متوازنة',v_count);
END; $$;

DROP FUNCTION IF EXISTS public.assert_financial_integrity();
CREATE FUNCTION public.assert_financial_integrity()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE failed record;
BEGIN
  FOR failed IN SELECT * FROM public.financial_integrity_report() WHERE NOT ok LOOP
    RAISE EXCEPTION 'فشل فحص التكامل المالي [%]: %',failed.check_name,failed.details;
  END LOOP;
END; $$;

-- Application-level business backup. It complements (and does not pretend to
-- replace) Supabase project backups for Auth, Storage and Edge configuration.
DROP FUNCTION IF EXISTS public.create_application_backup();
CREATE FUNCTION public.create_application_backup()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_table text; v_rows jsonb; v_tables jsonb:='{}'::jsonb; v_counts jsonb:='{}'::jsonb;
  v_payload jsonb; v_checksum text;
  v_allowlist constant text[]:=ARRAY[
    'branches','profiles','delegates','donors','beneficiary_categories','health_conditions','beneficiaries',
    'campaigns','cashboxes','cashbox_users','cash_receipts','campaign_funding','campaign_distributors',
    'cash_transfers','cash_payments','cashbox_ledger','units','items','warehouses','in_kind_receipts','in_kind_receipt_details',
    'campaign_in_kind_funding','campaign_in_kind_funding_details','inventory_lots','inventory_movements',
    'baskets','basket_items','in_kind_payments','in_kind_payment_details','stock_balances',
    'wallet_providers','bulk_disbursements','disbursement_results','messages','message_templates',
    'distribution_assignments','account_closings','system_settings'
  ];
BEGIN
  IF public.current_user_role()<>'admin' THEN RAISE EXCEPTION 'إنشاء النسخة الاحتياطية متاح لمدير النظام فقط'; END IF;
  PERFORM public.enforce_approved_device();
  FOREACH v_table IN ARRAY v_allowlist LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),''[]''::jsonb) FROM public.%I t',v_table) INTO v_rows;
    v_tables:=v_tables||jsonb_build_object(v_table,v_rows);
    v_counts:=v_counts||jsonb_build_object(v_table,jsonb_array_length(v_rows));
  END LOOP;
  v_payload:=jsonb_build_object(
    'format','zakat-backup-v2','version','12.0.0','exported_at',now(),
    'exported_by',auth.uid(),'mode','same-project-atomic-merge','tables',v_tables,'counts',v_counts
  );
  v_checksum:=encode(digest((v_payload->'tables')::text,'sha256'),'hex');
  INSERT INTO public.audit_logs(user_id,action,table_name,new_data,session_info)
  VALUES(auth.uid(),'create_application_backup','system_settings',jsonb_build_object('checksum',v_checksum,'counts',v_counts),jsonb_build_object('source','rpc'));
  RETURN v_payload||jsonb_build_object('checksum',v_checksum);
END; $$;

DROP FUNCTION IF EXISTS public.restore_backup_table(regclass,jsonb);
CREATE FUNCTION public.restore_backup_table(p_table regclass,p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_columns text; v_updates text; v_sql text; v_count integer:=0;
BEGIN
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)=0 THEN RETURN 0; END IF;
  IF NOT ((p_rows->0) ? 'id') THEN RAISE EXCEPTION 'صفوف الاستعادة لا تحتوي المعرف id: %',p_table; END IF;
  -- Select only keys present in the backup. Columns introduced by a newer
  -- release are deliberately omitted so their database defaults apply. This
  -- is what makes a signed/approved V11 application backup importable in V12.
  SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum),
         string_agg(format('%1$I=EXCLUDED.%1$I',a.attname),',' ORDER BY a.attnum) FILTER(WHERE a.attname<>'id')
  INTO v_columns,v_updates
  FROM pg_attribute a
  WHERE a.attrelid=p_table AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
    AND (p_rows->0) ? a.attname;
  IF v_columns IS NULL OR v_updates IS NULL THEN RAISE EXCEPTION 'جدول الاستعادة غير صالح: %',p_table; END IF;
  v_sql:=format('INSERT INTO %s(%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s,$1) r ON CONFLICT(id) DO UPDATE SET %s',
    p_table,v_columns,v_columns,p_table,v_updates);
  EXECUTE v_sql USING p_rows;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END; $$;

DROP FUNCTION IF EXISTS public.sync_reference_sequences();
CREATE FUNCTION public.sync_reference_sequences()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_max bigint;
BEGIN
  SELECT COALESCE(MAX((regexp_match(file_no,'([0-9]+)$'))[1]::bigint),0) INTO v_max FROM public.beneficiaries;
  PERFORM setval('public.beneficiary_file_seq',GREATEST(v_max,1),v_max>0);
  SELECT COALESCE(MAX((regexp_match(voucher_no,'([0-9]+)$'))[1]::bigint),0) INTO v_max FROM public.cash_receipts;
  PERFORM setval('public.cash_receipt_seq',GREATEST(v_max,1),v_max>0);
  SELECT COALESCE(MAX((regexp_match(voucher_no,'([0-9]+)$'))[1]::bigint),0) INTO v_max FROM public.cash_payments;
  PERFORM setval('public.cash_payment_seq',GREATEST(v_max,1),v_max>0);
  SELECT COALESCE(MAX((regexp_match(transfer_no,'([0-9]+)$'))[1]::bigint),0) INTO v_max FROM public.cash_transfers;
  PERFORM setval('public.cash_transfer_seq',GREATEST(v_max,1),v_max>0);
  SELECT COALESCE(MAX((regexp_match(voucher_no,'([0-9]+)$'))[1]::bigint),0) INTO v_max FROM public.in_kind_receipts;
  PERFORM setval('public.inkind_receipt_seq',GREATEST(v_max,1),v_max>0);
  SELECT COALESCE(MAX((regexp_match(voucher_no,'([0-9]+)$'))[1]::bigint),0) INTO v_max FROM public.in_kind_payments;
  PERFORM setval('public.inkind_payment_seq',GREATEST(v_max,1),v_max>0);
  SELECT COALESCE(MAX((regexp_match(closing_no,'([0-9]+)$'))[1]::bigint),0) INTO v_max FROM public.account_closings;
  PERFORM setval('public.closing_seq',GREATEST(v_max,1),v_max>0);
END; $$;

DROP FUNCTION IF EXISTS public.restore_application_backup(jsonb,text);
CREATE FUNCTION public.restore_application_backup(p_backup jsonb,p_confirmation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_table text; v_restored integer; v_total integer:=0; v_counts jsonb:='{}'::jsonb;
  v_checksum text; v_before jsonb;
  v_allowlist constant text[]:=ARRAY[
    'branches','profiles','beneficiary_categories','health_conditions','donors','units','items','delegates',
    'warehouses','cashboxes','campaigns','beneficiaries','cashbox_users','wallet_providers','message_templates',
    'cash_receipts','campaign_funding','campaign_distributors','cash_transfers','cash_payments','cashbox_ledger',
    'in_kind_receipts','in_kind_receipt_details','campaign_in_kind_funding','campaign_in_kind_funding_details',
    'inventory_lots','inventory_movements','baskets','basket_items','in_kind_payments','in_kind_payment_details',
    'stock_balances','bulk_disbursements','disbursement_results','messages','distribution_assignments',
    'account_closings','system_settings'
  ];
BEGIN
  IF public.current_user_role()<>'admin' THEN RAISE EXCEPTION 'استعادة النسخة متاحة لمدير النظام فقط'; END IF;
  PERFORM public.enforce_approved_device();
  IF p_backup->>'format' NOT IN ('zakat-backup-v1','zakat-backup-v2') OR jsonb_typeof(p_backup->'tables')<>'object' THEN RAISE EXCEPTION 'صيغة النسخة غير صالحة'; END IF;
  v_checksum:=encode(digest((p_backup->'tables')::text,'sha256'),'hex');
  IF p_backup->>'format'='zakat-backup-v2' THEN
    IF v_checksum IS DISTINCT FROM p_backup->>'checksum' THEN RAISE EXCEPTION 'بصمة النسخة لا تطابق محتواها'; END IF;
    IF p_confirmation IS DISTINCT FROM left(v_checksum,12) THEN RAISE EXCEPTION 'رمز تأكيد الاستعادة غير صحيح'; END IF;
  ELSIF p_confirmation IS DISTINCT FROM 'LEGACY-V1-RESTORE' THEN
    RAISE EXCEPTION 'تأكيد استعادة النسخة القديمة غير صحيح';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('zakat-application-backup-restore',0));
  v_before:=jsonb_build_object('checksum',v_checksum,'source_format',p_backup->>'format','started_at',now());
  PERFORM set_config('zakat.internal_financial_update','on',true);
  FOREACH v_table IN ARRAY v_allowlist LOOP
    IF p_backup->'tables' ? v_table THEN
      v_restored:=public.restore_backup_table(('public.'||quote_ident(v_table))::regclass,p_backup->'tables'->v_table);
      v_counts:=v_counts||jsonb_build_object(v_table,v_restored);
      v_total:=v_total+v_restored;
    END IF;
  END LOOP;
  PERFORM public.sync_reference_sequences();
  PERFORM public.assert_financial_integrity();
  INSERT INTO public.audit_logs(user_id,action,table_name,old_data,new_data,session_info)
  VALUES(auth.uid(),'restore_application_backup','system_settings',v_before,
    jsonb_build_object('restored_rows',v_total,'counts',v_counts),jsonb_build_object('source','rpc','atomic',true));
  RETURN jsonb_build_object('success',true,'restored_rows',v_total,'counts',v_counts,'checksum',v_checksum);
END; $$;

-- Gemini assistant persistence. Writes are server-side only; users can read
-- only their own conversations and proposed actions.
CREATE TABLE IF NOT EXISTS public.ai_conversations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_action_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','executing','completed','failed','cancelled')),
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes'),
  confirmed_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conversations_user_updated_idx ON public.ai_conversations(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx ON public.ai_messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS ai_action_requests_user_status_idx ON public.ai_action_requests(requested_by,status,created_at DESC);
DROP TRIGGER IF EXISTS ai_conversations_updated_at ON public.ai_conversations;
CREATE TRIGGER ai_conversations_updated_at BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS ai_action_requests_updated_at ON public.ai_action_requests;
CREATE TRIGGER ai_action_requests_updated_at BEFORE UPDATE ON public.ai_action_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_conversations_owner_read ON public.ai_conversations;
CREATE POLICY ai_conversations_owner_read ON public.ai_conversations FOR SELECT TO authenticated USING(user_id=auth.uid());
DROP POLICY IF EXISTS ai_messages_owner_read ON public.ai_messages;
CREATE POLICY ai_messages_owner_read ON public.ai_messages FOR SELECT TO authenticated
USING(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.ai_conversations c WHERE c.id=conversation_id AND c.user_id=auth.uid()));
DROP POLICY IF EXISTS ai_actions_owner_read ON public.ai_action_requests;
CREATE POLICY ai_actions_owner_read ON public.ai_action_requests FOR SELECT TO authenticated USING(requested_by=auth.uid());

GRANT SELECT ON public.ai_conversations,public.ai_messages,public.ai_action_requests TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.cash_transfer_seq TO authenticated,service_role;

-- Close every SECURITY DEFINER entry point again, then grant only the intended
-- public application RPCs. Helper/restore internals remain unreachable.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role(),public.has_role(public.app_role[]),
  public.current_delegate_id(),public.is_active_admin(),public.get_my_capabilities(),
  public.current_delegate_can_create_beneficiaries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_campaign_distributor(uuid,text),public.reopen_campaign_distributor(uuid,text),
  public.set_campaign_distributor_status(uuid,text),public.set_authorized_device_status(uuid,text),
  public.retry_failed_operation(text,uuid),
  public.financial_integrity_report(),public.create_application_backup(),
  public.restore_application_backup(jsonb,text) TO authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

UPDATE public.system_installation SET version='12.0.0',installed_at=now() WHERE id=1;
NOTIFY pgrst,'reload schema';
NOTIFY pgrst,'reload config';

-- V12 finalization must remain the last section because the consolidated file
-- contains historical function replacements above it. It deliberately stays
-- inside the V12 transaction so a failure in final grants rolls back the whole
-- upgrade instead of leaving a partially installed release.

DROP FUNCTION IF EXISTS public.settle_campaign_distributor(uuid,text);
CREATE FUNCTION public.settle_campaign_distributor(p_id uuid,p_reason text DEFAULT NULL)
RETURNS public.campaign_distributors LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE assignment public.campaign_distributors%ROWTYPE; v_remaining numeric(18,2);
BEGIN
  IF NOT public.has_role(ARRAY['admin','supervisor','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'غير مصرح بتسوية تخصيص الموزع';
  END IF;
  SELECT * INTO assignment FROM public.campaign_distributors WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تخصيص الموزع غير موجود'; END IF;
  IF assignment.status='settled' AND assignment.settled_at IS NOT NULL THEN RETURN assignment; END IF;
  IF assignment.status<>'active' THEN RAISE EXCEPTION 'يمكن تسوية التخصيص النشط فقط'; END IF;
  PERFORM 1 FROM public.campaigns WHERE id=assignment.campaign_id FOR UPDATE;
  v_remaining:=assignment.allocated_amount-assignment.spent_amount-assignment.returned_amount;
  IF v_remaining<0 THEN RAISE EXCEPTION 'بيانات التخصيص غير متوازنة'; END IF;
  PERFORM set_config('zakat.internal_financial_update','on',true);
  UPDATE public.campaign_distributors
  SET returned_amount=returned_amount+v_remaining,
      settled_return_amount=v_remaining,settled_at=now(),settled_by=auth.uid(),
      settlement_reason=NULLIF(trim(p_reason),''),status='settled',
      notes=concat_ws(E'\n',notes,CASE WHEN NULLIF(trim(p_reason),'') IS NULL
        THEN 'تمت تسوية كامل المتبقي' ELSE 'سبب التسوية: '||trim(p_reason) END)
  WHERE id=assignment.id RETURNING * INTO assignment;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data,session_info)
  VALUES(auth.uid(),'settle_campaign_distributor','campaign_distributors',assignment.id,
    jsonb_build_object('settled_return_amount',v_remaining,'reason',p_reason),jsonb_build_object('source','rpc'));
  RETURN assignment;
END; $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_approved_device() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(text,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role(),public.has_role(public.app_role[]),
  public.current_delegate_id(),public.is_active_admin(),public.get_my_capabilities(),
  public.current_delegate_can_create_beneficiaries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_device_authorization(text,text,text),
  public.open_user_session(text,text),public.close_user_session(uuid),public.touch_user_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_payment_context(uuid,uuid,uuid),
  public.quick_deliver_cash(uuid,numeric,uuid,uuid,uuid),
  public.post_cash_receipt(uuid),public.cancel_cash_receipt(uuid,text),
  public.post_campaign_funding(uuid),public.cancel_campaign_funding(uuid,text),
  public.post_cash_transfer(uuid),public.cancel_cash_transfer(uuid,text),
  public.post_cash_payment(uuid),public.cancel_cash_payment(uuid,text),
  public.settle_campaign_distributor(uuid,text),public.reopen_campaign_distributor(uuid,text),
  public.set_campaign_distributor_status(uuid,text),public.set_authorized_device_status(uuid,text),
  public.retry_failed_operation(text,uuid),
  public.confirm_cash_payment_receipt(uuid),
  public.post_in_kind_receipt(uuid),public.cancel_in_kind_receipt(uuid,text),
  public.post_campaign_in_kind_funding(uuid),public.cancel_campaign_in_kind_funding(uuid,text),
  public.post_in_kind_payment(uuid),public.cancel_in_kind_payment(uuid,text),
  public.confirm_in_kind_payment_receipt(uuid),public.reopen_account_closing(uuid,text),
  public.save_in_kind_receipt_draft(jsonb,jsonb,uuid),
  public.save_campaign_in_kind_funding_draft(jsonb,jsonb,uuid),
  public.save_in_kind_payment_draft(jsonb,jsonb,uuid),
  public.save_basket_with_items(jsonb,jsonb,uuid),public.save_system_settings(jsonb),
  public.financial_integrity_report(),public.create_application_backup(),
  public.restore_application_backup(jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
UPDATE public.system_installation SET version='12.0.0',installed_at=now() WHERE id=1;
NOTIFY pgrst,'reload schema';
NOTIFY pgrst,'reload config';
COMMIT;
