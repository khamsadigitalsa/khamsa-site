// فحص الإعدادات — يخبرك أي متغيّر ناقص ولماذا يتعثّر الدفع أو التسليم.
// للمالك فقط، ولا يكشف قيمة أي مفتاح — فقط هل هو مضبوط أم لا.
const { isAuthed } = require("./_lib.js");

const has = (v) => Boolean(v && String(v).trim());

module.exports = async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرّح" });

  const env = process.env;
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix });

  // ── الدفع ─────────────────────────────────────────────
  const payId = has(env.PAYLINK_API_ID);
  const paySecret = has(env.PAYLINK_SECRET_KEY);
  const mode = (env.PAYLINK_MODE || "live").trim();

  add("مفاتيح Paylink", payId && paySecret,
      payId && paySecret ? "مضبوطة" : "ناقصة — لهذا يظهر زر واتساب بدل صفحة الدفع",
      "Vercel → Settings → Environment Variables: PAYLINK_API_ID و PAYLINK_SECRET_KEY");

  add("وضع Paylink", mode !== "test",
      mode === "test"
        ? "test — سيرفر التجربة لدى Paylink شهادته معطوبة والاتصال يفشل دائماً"
        : "live",
      mode === "test" ? "احذف PAYLINK_MODE أو اجعله live مع مفاتيحك الحقيقية" : "");

  // اتصال حقيقي بالبوابة — أدقّ من مجرّد وجود المفاتيح
  if (payId && paySecret) {
    const base = mode === "test" ? "https://restpilot.paylink.sa" : "https://restapi.paylink.sa";
    try {
      const r = await fetch(base + "/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "*/*" },
        body: JSON.stringify({
          apiId: env.PAYLINK_API_ID,
          secretKey: env.PAYLINK_SECRET_KEY,
          persistToken: "false",
        }),
      });
      const d = await r.json().catch(() => ({}));
      add("الاتصال بالبوابة", r.ok && Boolean(d.id_token),
          r.ok && d.id_token ? "نجح تسجيل الدخول للبوابة"
                             : "البوابة رفضت المفاتيح (" + r.status + ")",
          r.ok ? "" : "تأكد أن المفاتيح تخص نفس الوضع (live/test)");
    } catch (e) {
      add("الاتصال بالبوابة", false,
          "تعذّر الوصول: " + String(e.message || e).slice(0, 120),
          mode === "test" ? "جرّب الوضع live — سيرفر التجربة معطوب لديهم" : "");
    }
  }

  // ── التخزين والتسليم ──────────────────────────────────
  const sbUrl = has(env.SUPABASE_URL), sbKey = has(env.SUPABASE_SERVICE_KEY);
  add("مفاتيح Supabase", sbUrl && sbKey, sbUrl && sbKey ? "مضبوطة" : "ناقصة",
      "SUPABASE_URL و SUPABASE_SERVICE_KEY");

  if (sbUrl && sbKey) {
    try {
      const r = await fetch(env.SUPABASE_URL + "/storage/v1/object/list/files", {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefix: "", limit: 500 }),
      });
      if (r.ok) {
        const n = (await r.json()).length;
        add("ملفات المنتجات", n >= 16, n + " ملف في المخزن",
            n >= 16 ? "" : "ارفع الناقص: python tools/upload_files.py");
      } else {
        add("ملفات المنتجات", false, "تعذّرت قراءة المخزن (" + r.status + ")",
            "تأكد من وجود bucket اسمه files");
      }
    } catch (e) {
      add("ملفات المنتجات", false, String(e.message || e).slice(0, 120), "");
    }

    // جدول الخصومات — يفشل الخصم بلا رسالة واضحة إن لم يُنشأ
    try {
      const r = await fetch(env.SUPABASE_URL + "/rest/v1/discounts?select=code&limit=1", {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
        },
      });
      add("جدول أكواد الخصم", r.ok,
          r.ok ? "موجود" : "غير موجود (" + r.status + ")",
          r.ok ? "" : "شغّل supabase-setup.sql مرة أخرى في SQL Editor");
    } catch (e) {
      add("جدول أكواد الخصم", false, String(e.message || e).slice(0, 120), "");
    }
  }

  // ── الإيميل ───────────────────────────────────────────
  const gmail = has(env.GMAIL_USER) && has(env.GMAIL_APP_PASSWORD);
  const brevo = has(env.BREVO_API_KEY) && has(env.SENDER_EMAIL);
  add("إرسال الإيميل", gmail || brevo,
      brevo ? "Brevo" : gmail ? "Gmail" : "غير مضبوط — لن تصل ملفات للعميل بالإيميل",
      "GMAIL_USER + GMAIL_APP_PASSWORD (أو BREVO_API_KEY + SENDER_EMAIL)");

  add("كلمة سر اللوحة", has(env.ADMIN_PASSWORD), has(env.ADMIN_PASSWORD) ? "مضبوطة" : "ناقصة",
      "ADMIN_PASSWORD");

  const failing = checks.filter(c => !c.ok);
  return res.status(200).json({
    ok: failing.length === 0,
    summary: failing.length
      ? failing.length + " مشكلة تمنع اكتمال الطلب"
      : "كل الإعدادات سليمة",
    checks,
  });
};
