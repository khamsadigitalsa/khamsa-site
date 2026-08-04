// منطق أكواد الخصم — مشترك بين المعاينة والدفع والطلب المجاني.
// قاعدة ثابتة: النسبة تُقرأ من قاعدة البيانات دائماً، ولا يُوثق أبداً بما يرسله المتصفح.
const { sbFetch } = require("./_lib.js");

const REASONS = {
  not_found: "الكود غير صحيح",
  inactive: "هذا الكود متوقّف",
  expired: "انتهت صلاحية الكود",
  exhausted: "انتهى عدد استخدامات هذا الكود",
  wrong_product: "الكود لا ينطبق على هذا المنتج",
};

// الأكواد مقيّدة بحروف إنجليزية كبيرة وأرقام فقط.
// السبب ليس تجميلياً: الكود يُضمَّن داخل رقم الطلب المرسل للبوابة، وأي شرطة
// فيه تجعل تحليل رقم الطلب ملتبساً مع مفتاح المنتج.
function normalize(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);
}

const CODE_RE = /^[A-Z0-9]{2,24}$/;

// السعر بعد الخصم — بالريال، مقرّب لأقرب ريال (البوابة لا تقبل كسوراً هنا)
function finalPrice(price, percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return Math.max(0, Math.round(price * (100 - p) / 100));
}

async function rpc(fn, args) {
  const r = await sbFetch("rpc/" + fn, {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(fn + " failed: " + r.status + " " + (await r.text()).slice(0, 160));
  return r.json();
}

// معاينة فقط — لا تستهلك استخداماً
async function peek(code, productKey) {
  const c = normalize(code);
  if (!c) return { ok: false, percent: 0, reason: "" };
  const out = await rpc("peek_discount", { p_code: c, p_product: productKey });
  const row = Array.isArray(out) ? out[0] : out;
  const status = (row && row.status) || "not_found";
  return {
    ok: status === "ok",
    percent: status === "ok" ? Number(row.percent) : 0,
    reason: status === "ok" ? "" : (REASONS[status] || "الكود غير صالح"),
    code: c,
  };
}

// الاستهلاك الفعلي — ذرّي، يزيد العدّاد ولا ينجح مرتين لكود منتهٍ
async function redeem(code, productKey) {
  const c = normalize(code);
  if (!c) return { ok: false, percent: 0, reason: "", code: "" };
  const out = await rpc("redeem_discount", { p_code: c, p_product: productKey });
  const row = Array.isArray(out) ? out[0] : out;
  if (row && row.percent != null) {
    return { ok: true, percent: Number(row.percent), reason: "", code: c };
  }
  // فشل الاستهلاك — نقرأ السبب لرسالة مفهومة
  const why = await peek(c, productKey);
  return { ok: false, percent: 0, reason: why.reason || "الكود غير صالح", code: c };
}

async function refund(code) {
  const c = normalize(code);
  if (!c) return;
  try { await rpc("refund_discount", { p_code: c }); } catch (e) { /* غير حرج */ }
}

module.exports = { normalize, finalPrice, peek, redeem, refund, REASONS, CODE_RE };
