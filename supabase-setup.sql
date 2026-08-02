-- شغّل هذا الكود مرة واحدة في Supabase → SQL Editor → New query → الصق → Run
create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text default '',
  created_at timestamptz not null default now()
);

-- تفعيل حماية الصفوف: لا أحد يقرأ الجدول من المتصفح مباشرة
-- (الموقع يتعامل معه من السيرفر فقط عبر مفتاح service_role)
alter table public.subscribers enable row level security;
