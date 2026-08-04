// ويبهوك تمارا — شبكة الأمان للتسليم.
// لو أغلق العميل المتصفح بعد الموافقة ولم يعد لصفحة الشكر، هذه النقطة
// تعتمد الطلب وتحصّله وترسل الملفات تلقائياً بنفس منطق صفحة الشكر.
//
// إعدادها: لوحة تمارا → General settings → Webhooks
//   الرابط:  https://<موقعك>/api/tamara-webhook
//   ثم ضع مفتاح الإشعارات (Notification key) في متغيّر TAMARA_NOTIFICATION_KEY
const { PRODUCTS, parseOrderNumber } = require("./_delivery.js");
const { finalPrice } = require("./_discounts.js");
const { fulfil } = require("./_fulfil.js");
const T = require("./_tamara.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!T.enabled()) return res.status(200).json({ ignored: "tamara off" });

  // بدون مفتاح إشعارات لا نثق بأي نداء — أي أحد يعرف الرابط يستطيع طلب تسليم مجاني
  if (!T.notificationKey()) {
    console.error("tamara webhook: TAMARA_NOTIFICATION_KEY غير مضبوط — رُفض النداء");
    return res.status(503).json({ error: "webhook not configured" });
  }
  const h = req.headers || {};
  const claims = T.verifyWebhook(h.tamaratoken || h.tamaraToken || h["tamara-token"]);
  if (!claims) return res.status(401).json({ error: "توقيع غير صحيح" });

  const body = req.body || {};
  const event = String(body.event_type || claims.event_type || "").toLowerCase();
  const orderId = String(body.order_id || claims.order_id || "").trim();
  if (!orderId) return res.status(400).json({ error: "no order_id" });

  // الأحداث الأخرى (رفض/إلغاء/انتهاء) لا تستدعي تسليماً — نردّ 200 حتى لا تعيد تمارا المحاولة
  if (event && !/approved|authoris|captur/i.test(event)) {
    return res.status(200).json({ ok: true, ignored: event });
  }

  try {
    // لا نثق بمحتوى الويبهوك: نقرأ حالة الطلب من تمارا نفسها
    const order = await T.getOrder(orderId);
    const settled = await T.settle(order);
    if (settled !== "fully_captured") {
      return res.status(200).json({ ok: true, status: settled, delivered: false });
    }

    const parsed = parseOrderNumber(order.order_reference_id || order.order_number);
    const product = PRODUCTS[parsed.productKey];
    if (!product) {
      console.error("tamara webhook: منتج غير معروف", order.order_reference_id);
      return res.status(200).json({ ok: true, delivered: false, reason: "unknown product" });
    }

    const amount = Number((order.total_amount || {}).amount);
    if (Math.round(amount) !== finalPrice(product.price, parsed.percent)) {
      console.error("tamara webhook: المبلغ لا يطابق السعر", orderId, amount);
      return res.status(200).json({ ok: true, delivered: false, reason: "amount mismatch" });
    }

    const out = await fulfil({
      paymentId: "TM-" + orderId,
      email: String((order.consumer && order.consumer.email) || parsed.email || "").toLowerCase().trim(),
      productKey: parsed.productKey,
      amount: amount,
      percent: parsed.percent || 0,
      code: parsed.code || "",
    });

    return res.status(200).json({ ok: !out.deliveryError, delivered: out.emailed });
  } catch (e) {
    console.error("tamara-webhook", e.message);
    // 500 يجعل تمارا تعيد المحاولة لاحقاً — وهو المطلوب عند عطل مؤقت
    return res.status(500).json({ error: "فشل معالجة الحدث" });
  }
};
