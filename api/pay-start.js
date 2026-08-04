// إنشاء فاتورة دفع في Paylink وإرجاع رابط صفحة الدفع (مدى + Apple Pay)
const { PRODUCTS, buildOrderNumber } = require("./_delivery.js");
const { peek, finalPrice } = require("./_discounts.js");

// ملاحظة: سيرفر التجربة restpilot.paylink.sa تظهر عليه شهادة أمان لدومين آخر (خلل من Paylink)
// فيفشل الاتصال به. استخدم PAYLINK_MODE=live مع مفاتيحك الحقيقية.
function base() {
  return process.env.PAYLINK_MODE === "test"
    ? "https://restpilot.paylink.sa"
    : "https://restapi.paylink.sa";
}

function friendly(e) {
  const m = String(e && e.message || "");
  if (/fetch failed|certificate|ENOTFOUND|ECONN/i.test(m)) {
    return process.env.PAYLINK_MODE === "test"
      ? "تعذر الاتصال بسيرفر التجربة لدى Paylink (خلل لديهم) — استخدم الوضع الحقيقي live"
      : "تعذر الاتصال ببوابة الدفع حالياً";
  }
  return m.slice(0, 160);
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

  // الخصم يُقرأ من قاعدة البيانات — لا يُؤخذ من المتصفح إطلاقاً.
  // نكتفي هنا بالمعاينة (peek)، ويُستهلك الكود فعلياً بعد نجاح الدفع فقط،
  // حتى لا تُحرق استخدامات الكود على طلبات مهجورة.
  let percent = 0, code = "";
  if (body.code) {
    try {
      const d = await peek(body.code, productKey);
      if (!d.ok) return res.status(400).json({ error: d.reason || "الكود غير صالح" });
      percent = d.percent;
      code = d.code;
    } catch (e) {
      console.error("discount peek failed", e);
      return res.status(500).json({ error: "تعذّر التحقق من كود الخصم" });
    }
  }

  const amount = finalPrice(product.price, percent);
  if (amount <= 0) {
    // بوابة الدفع لا تقبل فاتورة بصفر — هذا المسار له نقطة مستقلة
    return res.status(400).json({ error: "خصم كامل — استخدم الطلب المجاني", free: true });
  }

  try {
    const jwt = await token();
    // رقم طلب فريد — صيغته مشتركة مع تمارا في _delivery.js
    const orderNumber = buildOrderNumber(percent, code, productKey, email);

    const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
    const r = await fetch(base() + "/api/addInvoice", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "*/*", Authorization: "Bearer " + jwt },
      body: JSON.stringify({
        amount: amount,
        currency: "SAR",
        clientEmail: email,
        clientName: email.split("@")[0],
        clientMobile: "0500000000",
        orderNumber: orderNumber,
        callBackUrl: origin + "/thanks",
        note: "خمسة ديجيتال — " + product.name + (percent ? " (خصم " + percent + "%)" : ""),
        products: [{ title: product.name, price: amount, qty: 1, isDigital: true }],
      }),
    });

    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) {
      console.error("addInvoice failed", r.status, JSON.stringify(d).slice(0, 400));
      return res.status(502).json({ error: "تعذر فتح صفحة الدفع — جرب مرة ثانية أو اطلب واتساب" });
    }

    return res.status(200).json({
      ok: true, url: d.url, transactionNo: d.transactionNo,
      amount: amount, percent: percent, code: code,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: friendly(e) });
  }
};
