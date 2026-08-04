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

-- جدول الطلبات المدفوعة (للدفع الآلي — يمنع تكرار التسليم)
create table if not exists public.orders (
  id text primary key,
  email text,
  product text,
  amount int,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.orders enable row level security;

-- ترقية للمتاجر المنشورة سابقاً: يفصل «تم الدفع» عن «تم التسليم».
-- بدونه، أي طلب فشل تسليمه يظل مسجّلاً ولا يُعاد إرسال ملفاته أبداً.
alter table public.orders add column if not exists delivered boolean not null default false;

-- الطلبات القديمة التي سُلّمت فعلاً قبل إضافة العمود
update public.orders set delivered = true where created_at < now() - interval '1 hour';
