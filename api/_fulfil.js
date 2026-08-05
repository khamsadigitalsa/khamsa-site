// تنفيذ الطلب بعد تأكّد الدفع: تسجيله ثم تسليم ملفاته مرة واحدة فقط.
// مشترك بين صفحة الشكر (verify-pay) وويبهوك تمارا — فلو أغلق العميل المتصفح
// قبل رجوعه للموقع، الويبهوك يكمل التسليم بنفس المنطق تماماً.
const { sbFetch } = require("./_lib.js");
const { signLinks, deliverProduct, addSubscriber } = require("./_delivery.js");
const { redeem } = require("./_discounts.js");

// result: { paymentId, email, productKey, amount, percent, code }
async function fulfil(result) {
  // يُسجَّل الطلب أولاً حتى لو تعثّر التسليم — الدفعة حصلت ولا يجوز ضياع أثرها
  await sbFetch("orders?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      id: result.paymentId, email: result.email,
      product: result.productKey, amount: Math.round(result.amount * 100),
      discount_percent: result.percent || 0,
      discount_code: result.code || null,
    }),
  });

  // هل سُلّم هذا الطلب من قبل؟ العمود delivered يمنع تكرار الإيميل،
  // ويسمح بإعادة المحاولة لو فشل التسليم في المرة الأولى
  let alreadyDelivered = false;
  try {
    const q = await sbFetch("orders?id=eq." + encodeURIComponent(result.paymentId) + "&select=delivered");
    if (q.ok) {
      const rows = await q.json();
      alreadyDelivered = Array.isArray(rows) && rows[0] && rows[0].delivered === true;
    }
  } catch (e) { /* العمود قد لا يكون موجوداً بعد — نعامله كغير مُسلَّم */ }

  // التسليم منفصل عن التحقق: فشله لا يعني أن الدفع فشل
  let links = null, emailed = false, deliveryError = null;
  try {
    if (!alreadyDelivered && result.email) {
      // يُستهلك الكود مرة واحدة فقط، وعند نجاح الدفع لا عند فتح صفحة الدفع
      if (result.code) await redeem(result.code, result.productKey).catch(() => {});
      const out = await deliverProduct(result.email, result.productKey, result.paymentId);
      links = out.links;
      emailed = true;
      await addSubscriber(result.email, "");
      await sbFetch("orders?id=eq." + encodeURIComponent(result.paymentId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ delivered: true }),
      }).catch(() => {});
    } else {
      links = await signLinks(result.productKey);
    }
  } catch (e) {
    console.error("DELIVERY FAILED for paid order", result.paymentId, e);
    deliveryError = e.message || String(e);
  }

  return { links: links || [], emailed, deliveryError, alreadyDelivered };
}

module.exports = { fulfil };
