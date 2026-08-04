// تكامل تمارا (قسّمها على 4 / ادفع لاحقاً) — أدوات مشتركة.
// هذا الملف لا يُنشر كنقطة API لأنه يبدأ بشرطة سفلية.
//
// دورة حياة الطلب في تمارا:
//   1) /checkout            ننشئ جلسة دفع ونحوّل العميل لرابطها
//   2) العميل يوافق         → حالة الطلب تصبح approved
//   3) /orders/{id}/authorise  نعتمد الطلب (إلزامي — بدونه لا يُحصَّل شيء)
//   4) /payments/capture    نحصّل المبلغ فعلياً → fully_captured
// الخطوتان 3 و4 مسؤوليتنا نحن، وتتمّان من verify-pay أو من الويبهوك.
const crypto = require("crypto");

function base() {
  return mode() === "sandbox"
    ? "https://api-sandbox.tamara.co"
    : "https://api.tamara.co";
}

// خانة القيمة في Vercel صندوق نص متعدد الأسطر، فاللصق يجرّ معه غالباً سطراً
// جديداً أو مسافة. بدون التنظيف تصير الترويسة "Bearer <مفتاح>\n" وترد تمارا
// بـ 401 Invalid credentials رغم أن المفتاح نفسه صحيح تماماً.
const clean = (v) => String(v == null ? "" : v).trim();

function token() { return clean(process.env.TAMARA_API_TOKEN); }
function mode() { return clean(process.env.TAMARA_MODE).toLowerCase(); }
function notificationKey() { return clean(process.env.TAMARA_NOTIFICATION_KEY); }

function enabled() {
  return Boolean(token());
}

const CURRENCY = "SAR";
const money = (n) => ({ amount: Number(Number(n).toFixed(2)), currency: CURRENCY });

async function tamara(path, options) {
  const opts = options || {};
  const r = await fetch(base() + path, {
    method: opts.method || "GET",
    headers: {
      Authorization: "Bearer " + token(),
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text.slice(0, 300) }; }
  if (!r.ok) {
    const err = new Error(
      "tamara " + path + " " + r.status + ": " +
      (data.message || JSON.stringify(data.errors || data).slice(0, 240))
    );
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

// وسائل الدفع المتاحة وحدودها — تختلف من تاجر لآخر، فنقرأها من تمارا لا نفترضها.
// أغلب منتجاتنا 19 ر.س وقد تكون تحت الحد الأدنى، فالواجهة تحتاج هذه الأرقام
// لتخفي زر تمارا بدل أن تُظهره ثم يفشل عند الضغط.
// صيغة الاستعلام تختلف بين إصدارات تمارا: بعضها يرفض currency وبعضها يطلب
// order_value. نجرّب الصيغ بالترتيب بدل أن نراهن على واحدة ونعطّل التقسيط كله.
const TYPE_QUERIES = [
  "?country=SA&currency=" + CURRENCY,
  "?country=SA",
  "?country=SA&order_value=100&currency=" + CURRENCY,
];

async function paymentMethods() {
  let list = null, lastErr = null;
  for (const q of TYPE_QUERIES) {
    try {
      list = await tamara("/checkout/payment-types" + q);
      break;
    } catch (e) {
      lastErr = e;
      // 4xx = الصيغة مرفوضة، جرّب التالية. أي خطأ آخر (شبكة/مصادقة) لا تُصلحه الصيغة
      if (!e.status || e.status < 400 || e.status >= 500) throw e;
      if (e.status === 401 || e.status === 403) throw e;
    }
  }
  if (!list) throw lastErr || new Error("tamara payment-types: no response");

  const arr = Array.isArray(list) ? list : (list.data || []);
  const out = [];
  arr.forEach((m) => {
    const name = String(m.name || "").toUpperCase();
    const min = Number((m.min_limit || {}).amount);
    const max = Number((m.max_limit || {}).amount);
    const sub = Array.isArray(m.supported_instalments) ? m.supported_instalments : [];
    if (sub.length) {
      sub.forEach((s) => out.push({
        type: name,
        instalments: Number(s.instalments) || null,
        min: Number((s.min_limit || {}).amount) || min || 0,
        max: Number((s.max_limit || {}).amount) || max || 0,
      }));
    } else {
      out.push({ type: name, instalments: null, min: min || 0, max: max || 0 });
    }
  });
  return out;
}

// أنسب وسيلة لمبلغ معيّن: نفضّل التقسيط على أكبر عدد دفعات ممكن
function pickMethod(methods, amount) {
  const fit = methods.filter((m) => amount >= (m.min || 0) && (!m.max || amount <= m.max));
  if (!fit.length) return null;
  const inst = fit.filter((m) => m.type === "PAY_BY_INSTALMENTS" && m.instalments > 1);
  if (inst.length) return inst.sort((a, b) => b.instalments - a.instalments)[0];
  return fit[0];
}

function createCheckout(payload) {
  return tamara("/checkout", { method: "POST", body: payload });
}

function getOrder(orderId) {
  return tamara("/merchants/orders/" + encodeURIComponent(orderId));
}

function authorise(orderId) {
  return tamara("/orders/" + encodeURIComponent(orderId) + "/authorise", { method: "POST" });
}

function capture(orderId, amount) {
  return tamara("/payments/capture", {
    method: "POST",
    body: {
      order_id: orderId,
      total_amount: money(amount),
      shipping_amount: money(0),
      tax_amount: money(0),
      discount_amount: money(0),
    },
  });
}

// يقود الطلب من approved إلى fully_captured. آمن للتكرار: أي خطوة تمّت
// من قبل ترجع خطأ من تمارا فنتجاوزها بدل أن نُفشل العملية كلها.
async function settle(order) {
  const orderId = order.order_id;
  let status = String(order.status || "").toLowerCase();

  if (status === "approved") {
    try {
      const a = await authorise(orderId);
      status = String(a.status || "authorised").toLowerCase();
    } catch (e) {
      if (!/already|invalid.*status|conflict/i.test(e.message)) throw e;
      status = "authorised";
    }
  }

  if (status === "authorised" || status === "partially_captured") {
    const amount = Number((order.total_amount || {}).amount);
    try {
      await capture(orderId, amount);
      status = "fully_captured";
    } catch (e) {
      if (!/already|captur|invalid.*status|conflict/i.test(e.message)) throw e;
      status = "fully_captured";
    }
  }

  return status;
}

// تمارا توقّع الويبهوك بـ JWT (HS256) بمفتاح الإشعارات، في ترويسة tamaraToken.
// بدون التحقق منه يستطيع أي أحد استدعاء نقطتنا ويطلب تسليم ملفات مجاناً.
function verifyWebhook(jwt) {
  const secret = notificationKey();
  if (!secret) return null;
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac("sha256", secret)
    .update(parts[0] + "." + parts[1]).digest("base64url");
  const got = Buffer.from(parts[2]);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
}

// تمارا تطلب جوالاً سعودياً — نقبل 05x / 5x / +9665x ونوحّدها إلى 05xxxxxxxx
function normalizePhone(v) {
  const d = String(v || "").replace(/[^\d]/g, "");
  let m = d.match(/^(?:00966|966)?0?(5\d{8})$/);
  return m ? "0" + m[1] : "";
}

module.exports = {
  base, mode, token, notificationKey, enabled, money, tamara, paymentMethods, pickMethod,
  createCheckout, getOrder, authorise, capture, settle,
  verifyWebhook, normalizePhone, CURRENCY,
};
