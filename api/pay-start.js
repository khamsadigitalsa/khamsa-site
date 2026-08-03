// إنشاء فاتورة دفع في Paylink وإرجاع رابط صفحة الدفع (مدى + Apple Pay)
const { PRODUCTS } = require("./_delivery.js");

function base() {
  return process.env.PAYLINK_MODE === "live"
    ? "https://restapi.paylink.sa"
    : "https://restpilot.paylink.sa";
}

async function token() {
  const r = await fetch(base() + "/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "*/*" },
    body: JSON.stringify({
      apiId: process.env.PAYLINK_API_ID,
      secretKey: process.env.PAYLINK_SECRET_KEY,
      persistToken: "false",
    }),
  });
  if (!r.ok) throw new Error("auth failed: " + r.status + " " + (await r.text()).slice(0, 200));
  const d = await r.json();
  if (!d.id_token) throw new Error("no token returned");
  return d.id_token;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.PAYLINK_API_ID || !process.env.PAYLINK_SECRET_KEY) {
    return res.status(503).json({ error: "الدفع الآلي غير مفعّل بعد" });
  }

  const body = req.body || {};
  const productKey = String(body.productKey || "").trim();
  const email = String(body.email || "").toLowerCase().trim();
  const product = PRODUCTS[productKey];

  if (!product) return res.status(400).json({ error: "منتج غير معروف" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "إيميل غير صحيح" });

  try {
    const jwt = await token();
    // رقم طلب فريد — المنتج والإيميل مضمّنان فيه لاسترجاعهما وقت التحقق
    const orderNumber = "KH-" + productKey + "-" + Buffer.from(email).toString("base64url").slice(0, 24)
      + "-" + Math.floor(Number(String(req.headers["x-request-id"] || "").replace(/\D/g, "").slice(0, 8)) || 0);

    const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
    const r = await fetch(base() + "/api/addInvoice", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "*/*", Authorization: "Bearer " + jwt },
      body: JSON.stringify({
        amount: product.price,
        currency: "SAR",
        clientEmail: email,
        clientName: email.split("@")[0],
        clientMobile: "0500000000",
        orderNumber: orderNumber,
        callBackUrl: origin + "/thanks",
        note: "خمسة ديجيتال — " + product.name,
        products: [{ title: product.name, price: product.price, qty: 1, isDigital: true }],
      }),
    });

    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) {
      console.error("addInvoice failed", r.status, JSON.stringify(d).slice(0, 400));
      return res.status(502).json({ error: "تعذر فتح صفحة الدفع — جرب مرة ثانية أو اطلب واتساب" });
    }

    return res.status(200).json({ ok: true, url: d.url, transactionNo: d.transactionNo });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "خطأ: " + e.message.slice(0, 160) });
  }
};
