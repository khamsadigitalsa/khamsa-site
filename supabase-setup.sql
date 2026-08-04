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

-- عمودان لتتبّع الخصم على كل طلب
alter table public.orders add column if not exists discount_code text;
alter table public.orders add column if not exists discount_percent int not null default 0;


-- ═══════════════════════════════════════════════════════════
--  أكواد الخصم
-- ═══════════════════════════════════════════════════════════
create table if not exists public.discounts (
  code          text primary key,                    -- يُخزَّن بحروف كبيرة دائماً
  percent       int  not null check (percent between 1 and 100),
  max_uses      int,                                 -- null = بلا حد
  used_count    int  not null default 0,
  expires_at    timestamptz,                         -- null = بلا انتهاء
  product       text,                                -- null = يشمل كل المنتجات
  active        boolean not null default true,
  note          text default '',
  created_at    timestamptz not null default now()
);
alter table public.discounts enable row level security;

-- قراءة فقط للعرض في صفحة الدفع — لا تزيد العدّاد
create or replace function public.peek_discount(p_code text, p_product text)
returns table(status text, percent int)
language sql
stable
as $$
  select
    case
      when d.code is null                                   then 'not_found'
      when not d.active                                     then 'inactive'
      when d.expires_at is not null and d.expires_at <= now() then 'expired'
      when d.max_uses is not null and d.used_count >= d.max_uses then 'exhausted'
      when d.product is not null and d.product <> p_product  then 'wrong_product'
      else 'ok'
    end,
    coalesce(d.percent, 0)
  from (select 1) x
  left join public.discounts d on d.code = upper(btrim(p_code));
$$;

-- الاستهلاك الفعلي: جملة UPDATE واحدة، فالتحقق والزيادة ذرّيان معاً.
-- بدون هذا، كودٌ باستخدام واحد يمكن استهلاكه عدة مرات عند الضغط المتزامن.
create or replace function public.redeem_discount(p_code text, p_product text)
returns table(percent int)
language sql
volatile
as $$
  update public.discounts d
     set used_count = d.used_count + 1
   where d.code = upper(btrim(p_code))
     and d.active
     and (d.expires_at is null or d.expires_at > now())
     and (d.max_uses  is null or d.used_count < d.max_uses)
     and (d.product   is null or d.product = p_product)
  returning d.percent;
$$;

-- إرجاع استخدام عند فشل التسليم، حتى لا يضيع على العميل
create or replace function public.refund_discount(p_code text)
returns void
language sql
volatile
as $$
  update public.discounts
     set used_count = greatest(used_count - 1, 0)
   where code = upper(btrim(p_code));
$$;
