// طلب مجاني بالكامل — لخصم 100% فقط، حيث لا توجد عملية دفع تُتحقَّق منها.
//
// هذا المسار يسلّم ملفات بلا دفع، فهو الأخطر في الموقع. الضمانات:
//   1. النسبة تُقرأ من قاعدة البيانات، لا مما يرسله المتصفح
//   2. الاستهلاك ذرّي (redeem_discount) فلا يُستعمل كودٌ محدود أكثر من حدّه
//   3. لا يُقبل إلا إذا كانت النسبة 100% فعلاً
//   4. يُسجَّل الطلب باسم الكود لتتبّع من استفاد
//   5. عند فشل التسليم يُعاد الاستخدام للكود حتى لا يضيع على العميل
const { sbFetch } = require("./_lib.js");
const { PRODUCTS, deliverProduct, addSubscriber } = require("./_delivery.js");
const { redeem, refund, finalPrice } = require("./_discounts.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const productKey = String(body.productKey || "").trim();
  const email = String(body.email || "").toLowerCase().trim();
  const product = PRODUCTS[productKey];

  if (!product) return res.status(400).json({ error: "منتج غير معروف" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "إيميل غير صحيح" });
  }

  let claimed = null;
  try {
    // الاستهلاك أولاً — ذرّي، ويمنع السباق على كود محدود الاستخدام
    const d = await redeem(body.code, productKey);
    if (!d.ok) return res.status(400).json({ error: d.reason || "الكود غير صالح" });
    claimed = d.code;

    // لا يُسمح بهذا المسار إلا لخصم كامل — أي نسبة أقل تمر عبر بوابة الدفع
    if (finalPrice(product.price, d.percent) !== 0) {
      await refund(claimed);
      return res.status(400).json({
        error: "هذا الكود خصم جزئي — أكمل عبر صفحة الدفع",
        percent: d.percent,
      });
    }

    const orderId = "FREE-" + claimed + "-" + Buffer.from(email).toString("base64url").slice(0, 20);

    await sbFetch("orders?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        id: orderId, email: email, product: productKey, amount: 0,
        discount_code: claimed, discount_percent: d.percent,
      }),
    });

    const out = await deliverProduct(email, productKey, orderId);
    await addSubscriber(email, "");
    await sbFetch("orders?id=eq." + encodeURIComponent(orderId), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ delivered: true }),
    }).catch(() => {});

    return res.status(200).json({
      ok: true, free: true, name: product.name,
      links: out.links, emailed: true, email: email, orderRef: orderId,
    });
  } catch (e) {
    console.error("FREE ORDER FAILED", e);
    if (claimed) await refund(claimed);   // لا نحرق استخدام العميل بسبب خطأ عندنا
    return res.status(500).json({
      error: "تعذّر تجهيز الملفات: " + String(e.message || e).slice(0, 180),
    });
  }
};
