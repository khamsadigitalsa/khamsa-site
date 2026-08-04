// إنشاء جلسة دفع في تمارا وإرجاع رابط صفحتها (قسّمها على 4 / ادفع لاحقاً)
const { PRODUCTS, buildOrderNumber } = require("./_delivery.js");
const { peek, finalPrice } = require("./_discounts.js");
const T = require("./_tamara.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!T.enabled()) return res.status(503).json({ error: "تمارا غير مفعّلة بعد" });

  const body = req.body || {};
  const productKey = String(body.productKey || "").trim();
  const email = String(body.email || "").toLowerCase().trim();
  const name = String(body.name || "").trim().slice(0, 60);
  const phone = T.normalizePhone(body.phone);
  const product = PRODUCTS[productKey];

  if (!product) return res.status(400).json({ error: "منتج غير معروف" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "إيميل غير صحيح" });
  if (!phone) return res.status(400).json({ error: "تمارا تحتاج رقم جوال سعودي — مثال: 0512345678" });

  // الخصم يُقرأ من قاعدة البيانات لا من المتصفح. نكتفي بالمعاينة هنا،
  // ويُستهلك الكود فعلياً بعد نجاح الدفع فقط.
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
  if (amount <= 0) return res.status(400).json({ error: "خصم كامل — استخدم الطلب المجاني", free: true });

  try {
    const list = await T.paymentMethods();
    const pick = T.pickMethod(list, amount);
    if (!pick) {
      const min = Math.min.apply(null, list.map((m) => m.min || 0));
      const max = Math.max.apply(null, list.map((m) => m.max || 0));
      return res.status(400).json({
        error: "تمارا متاحة للطلبات من " + min + " إلى " + max + " ر.س — استخدم البطاقة أو واتساب",
      });
    }

    const orderNumber = buildOrderNumber(percent, code, productKey, email);
    const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
    const first = (name.split(/\s+/)[0] || email.split("@")[0]).slice(0, 30);
    const last = (name.split(/\s+/).slice(1).join(" ") || "-").slice(0, 30);

    // منتجاتنا رقمية بالكامل — لا شحن ولا ضريبة مضافة على الفاتورة،
    // لكن تمارا تلزم بحقول العنوان فنملؤها بعنوان التسليم الرقمي.
    const addr = {
      first_name: first, last_name: last,
      line1: "تسليم رقمي — تصل الملفات على البريد الإلكتروني",
      city: "Riyadh", country_code: "SA", phone_number: phone,
    };

    const session = await T.createCheckout({
      order_reference_id: orderNumber,
      order_number: orderNumber,
      total_amount: T.money(amount),
      shipping_amount: T.money(0),
      tax_amount: T.money(0),
      items: [{
        reference_id: productKey,
        type: "Digital",
        name: product.name,
        sku: productKey,
        quantity: 1,
        unit_price: T.money(amount),
        discount_amount: T.money(0),
        tax_amount: T.money(0),
        total_amount: T.money(amount),
      }],
      consumer: {
        first_name: first, last_name: last,
        phone_number: phone, email: email,
      },
      country_code: "SA",
      description: "خمسة ديجيتال — " + product.name + (percent ? " (خصم " + percent + "%)" : ""),
      merchant_url: {
        success: origin + "/thanks",
        failure: origin + "/thanks",
        cancel: origin + "/thanks",
        notification: origin + "/api/tamara-webhook",
      },
      payment_type: pick.type,
      instalments: pick.instalments || undefined,
      billing_address: addr,
      shipping_address: addr,
      platform: "khamsa-site",
      is_mobile: Boolean(body.isMobile),
      locale: "ar_SA",
    });

    if (!session.checkout_url) {
      console.error("tamara checkout: no url", JSON.stringify(session).slice(0, 300));
      return res.status(502).json({ error: "تعذّر فتح صفحة تمارا — جرب مرة ثانية" });
    }

    return res.status(200).json({
      ok: true,
      url: session.checkout_url,
      orderId: session.order_id,
      amount: amount,
      instalments: pick.instalments || null,
    });
  } catch (e) {
    console.error("tamara-start", e.message);
    return res.status(502).json({ error: "تعذّر الاتصال بتمارا حالياً — جرب البطاقة أو واتساب" });
  }
};
