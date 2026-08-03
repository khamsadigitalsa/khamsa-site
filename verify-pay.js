// التحقق الآلي من الدفع وتسليم الملفات فوراً — يدعم Paylink وميسر
// نقطة عامة: آمنة لأن التحقق يتم من سيرفر البوابة مباشرة بالمفتاح السري
const { sbFetch } = require("./_lib.js");
const { PRODUCTS, signLinks, deliverProduct, addSubscriber } = require("./_delivery.js");

function paylinkBase() {
  return process.env.PAYLINK_MODE === "test"
    ? "https://restpilot.paylink.sa"
    : "https://restapi.paylink.sa";
}

// يستخرج المنتج والإيميل من رقم الطلب: KH-<productKey>-<emailBase64url>-<n>
function parseOrder(orderNumber) {
  const m = String(orderNumber || "").match(/^KH-(.+)-([A-Za-z0-9_-]+)-\d*$/);
  if (!m) return {};
  let email = "";
  try { email = Buffer.from(m[2], "base64url").toString("utf8"); } catch (e) {}
  return { productKey: m[1], email };
}

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
  const moyasarId = String(body.id || "").trim();

  try {
    let result = null;
    if (transactionNo && process.env.PAYLINK_API_ID) result = await verifyPaylink(transactionNo);
    else if (moyasarId && process.env.MOYASAR_SECRET_KEY) result = await verifyMoyasar(moyasarId);
    else return res.status(400).json({ error: "لا يمكن التحقق من الدفعة" });

    if (!result) return res.status(400).json({ error: "الدفعة غير موجودة" });
    if (result.unpaid) return res.status(400).json({ error: "الدفع غير مكتمل", status: result.status, message: result.message });

    const product = PRODUCTS[result.productKey];
    if (!product) return res.status(400).json({ error: "منتج غير معروف في بيانات الدفعة" });
    if (Math.round(result.amount) !== product.price) {
      return res.status(400).json({ error: "مبلغ الدفعة لا يطابق سعر المنتج — تواصل معنا" });
    }

    // منع التكرار: يُسجَّل الطلب مرة واحدة فقط
    const ins = await sbFetch("orders?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        id: result.paymentId, email: result.email,
        product: result.productKey, amount: Math.round(result.amount * 100),
      }),
    });
    const inserted = ins.ok ? await ins.json() : [];
    const isNewOrder = Array.isArray(inserted) && inserted.length > 0;

    let links, emailed = false;
    if (isNewOrder && result.email) {
      const out = await deliverProduct(result.email, result.productKey);
      links = out.links;
      emailed = true;
      await addSubscriber(result.email, "");
    } else {
      links = await signLinks(result.productKey);
    }

    return res.status(200).json({ ok: true, name: product.name, links, emailed, email: result.email });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "خطأ أثناء التحقق: " + e.message.slice(0, 200) });
  }
};
