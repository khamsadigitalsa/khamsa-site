const { isAuthed } = require("./_lib.js");
const { PRODUCTS, deliverProduct } = require("./_delivery.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرح" });

  const body = req.body || {};
  const email = String(body.email || "").toLowerCase().trim();
  const productKey = String(body.productKey || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "إيميل غير صحيح" });
  if (!PRODUCTS[productKey]) return res.status(400).json({ error: "اختر المنتج" });

  try {
    const result = await deliverProduct(email, productKey);
    return res.status(200).json({ ok: true, message: "تم التسليم ✅ — وصله إيميل فيه " + result.links.length + " ملفاً" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "فشل التسليم: " + e.message.slice(0, 200) });
  }
};
