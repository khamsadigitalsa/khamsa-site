// التحقق الآلي من الدفع وتسليم الملفات فوراً — يدعم Paylink وتمارا وميسر
// نقطة عامة: آمنة لأن التحقق يتم من سيرفر البوابة مباشرة بالمفتاح السري
const { PRODUCTS, parseOrderNumber } = require("./_delivery.js");
const { finalPrice } = require("./_discounts.js");
const { fulfil } = require("./_fulfil.js");
const T = require("./_tamara.js");

function paylinkBase() {
  return process.env.PAYLINK_MODE === "test"
    ? "https://restpilot.paylink.sa"
    : "https://restapi.paylink.sa";
}

// صيغة رقم الطلب وتحليله يعيشان في _delivery.js — مصدر واحد لكل البوابات
const parseOrder = parseOrderNumber;

async function verifyPaylink(transactionNo) {
  const auth = await fetch(paylinkBase() + "/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "*/*" },
    body: JSON.stringify({
      apiId: process.env.PAYLINK_API_ID,
      secretKey: process.env.PAYLINK_SECRET_KEY,
      persistToken: "false",
    }),
  });
  if (!auth.ok) throw new Error("auth failed");
  const { id_token } = await auth.json();

  const r = await fetch(paylinkBase() + "/api/getInvoice/" + encodeURIComponent(transactionNo), {
    headers: { accept: "*/*", Authorization: "Bearer " + id_token },
  });
  if (!r.ok) return null;
  const inv = await r.json();

  const status = String(inv.orderStatus || "").toLowerCase();
  if (status !== "paid") return { unpaid: true, status: inv.orderStatus };

  const parsed = parseOrder(inv.orderNumber);
  return {
    paymentId: "PL-" + transactionNo,
    productKey: parsed.productKey,
    email: (inv.clientEmail || parsed.email || "").toLowerCase().trim(),
    amount: Number(inv.amount),   // بالريال
    percent: parsed.percent || 0,
    code: parsed.code || "",
  };
}

// تمارا: الموافقة وحدها لا تعني أن المبلغ وصلنا.
// لا بد من اعتماد الطلب (authorise) ثم تحصيله (capture) — وهذا ما يفعله settle.
// لذلك لا نسلّم الملفات إلا بعد أن تصبح الحالة fully_captured.
async function verifyTamara(orderId) {
  const order = await T.getOrder(orderId);
  const status = String(order.status || "").toLowerCase();

  const bad = { declined: "رفضت تمارا الطلب", expired: "انتهت صلاحية طلب تمارا",
                canceled: "أُلغي طلب تمارا", cancelled: "أُلغي طلب تمارا" };
  if (bad[status]) return { unpaid: true, status: status, message: bad[status] };
  if (status === "new") return { unpaid: true, status: status, message: "لم تكتمل الموافقة في تمارا" };

  let settled = status;
  if (status !== "fully_captured") {
    try {
      settled = await T.settle(order);
    } catch (e) {
      console.error("tamara settle failed", orderId, e.message);
      return { unpaid: true, status: status, message: "تعذّر تأكيد الطلب لدى تمارا — تواصل معنا" };
    }
  }
  if (settled !== "fully_captured") {
    return { unpaid: true, status: settled, message: "لم يكتمل تحصيل المبلغ من تمارا" };
  }

  const parsed = parseOrder(order.order_reference_id || order.order_number);
  return {
    paymentId: "TM-" + orderId,
    productKey: parsed.productKey,
    email: String((order.consumer && order.consumer.email) || parsed.email || "").toLowerCase().trim(),
    amount: Number((order.total_amount || {}).amount),
    percent: parsed.percent || 0,
    code: parsed.code || "",
  };
}

async function verifyMoyasar(id) {
  const auth = "Basic " + Buffer.from(process.env.MOYASAR_SECRET_KEY + ":").toString("base64");
  const r = await fetch("https://api.moyasar.com/v1/payments/" + encodeURIComponent(id), {
    headers: { Authorization: auth },
  });
  if (!r.ok) return null;
  const pay = await r.json();
  if (pay.status !== "paid") return { unpaid: true, status: pay.status, message: pay.source && pay.source.message };
  const meta = pay.metadata || {};
  return {
    paymentId: "MY-" + pay.id,
    productKey: String(meta.product || "").trim(),
    email: String(meta.customer_email || "").toLowerCase().trim(),
    amount: Number(pay.amount) / 100,   // من الهللات للريال
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const transactionNo = String(body.transactionNo || "").trim();
  const tamaraOrderId = String(body.tamaraOrderId || "").trim();
  const moyasarId = String(body.id || "").trim();

  try {
    let result = null;
    if (transactionNo && process.env.PAYLINK_API_ID) result = await verifyPaylink(transactionNo);
    else if (tamaraOrderId && T.enabled()) result = await verifyTamara(tamaraOrderId);
    else if (moyasarId && process.env.MOYASAR_SECRET_KEY) result = await verifyMoyasar(moyasarId);
    else return res.status(400).json({ error: "لا يمكن التحقق من الدفعة" });

    if (!result) return res.status(400).json({ error: "الدفعة غير موجودة" });
    if (result.unpaid) return res.status(400).json({ error: "الدفع غير مكتمل", status: result.status, message: result.message });

    const product = PRODUCTS[result.productKey];
    if (!product) return res.status(400).json({ error: "منتج غير معروف في بيانات الدفعة" });

    // المبلغ المتوقّع = السعر بعد الخصم المسجَّل في رقم الطلب.
    // رقم الطلب أنشأه سيرفرنا وعاد من البوابة، فلا يمكن للمتصفح تزويره.
    const expected = finalPrice(product.price, result.percent);
    if (Math.round(result.amount) !== expected) {
      return res.status(400).json({
        error: "مبلغ الدفعة لا يطابق سعر المنتج — تواصل معنا",
      });
    }

    const { links, emailed, deliveryError } = await fulfil(result);

    // الدفع تم بنجاح في كل الحالات التي تصل هنا — نقولها صراحةً للعميل
    return res.status(200).json({
      ok: !deliveryError,
      paid: true,
      name: product.name,
      links: links,
      emailed,
      email: result.email,
      orderRef: result.paymentId,
      deliveryError: deliveryError ? deliveryError.slice(0, 200) : null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "خطأ أثناء التحقق: " + e.message.slice(0, 200) });
  }
};
