// معاينة كود الخصم في صفحة الدفع — لا يستهلك استخداماً ولا يكشف تفاصيل الأكواد.
const { PRODUCTS } = require("./_delivery.js");
const { peek, finalPrice } = require("./_discounts.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const productKey = String(body.productKey || "").trim();
  const product = PRODUCTS[productKey];
  if (!product) return res.status(400).json({ error: "منتج غير معروف" });

  try {
    const d = await peek(body.code, productKey);
    if (!d.ok) return res.status(200).json({ ok: false, reason: d.reason || "الكود غير صحيح" });

    const price = finalPrice(product.price, d.percent);
    return res.status(200).json({
      ok: true,
      code: d.code,
      percent: d.percent,
      original: product.price,
      price: price,
      free: price === 0,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "تعذّر التحقق من الكود" });
  }
};
