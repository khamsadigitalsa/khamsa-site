// التحقق الآلي من الدفع وتسليم الملفات فوراً — يدعم Paylink وميسر
// نقطة عامة: آمنة لأن التحقق يتم من سيرفر البوابة مباشرة بالمفتاح السري
const { sbFetch } = require("./_lib.js");
const { PRODUCTS, signLinks, deliverProduct, addSubscriber } = require("./_delivery.js");
const { finalPrice, redeem } = require("./_discounts.js");

function paylinkBase() {
  return process.env.PAYLINK_MODE === "test"
    ? "https://restpilot.paylink.sa"
    : "https://restapi.paylink.sa";
}

// يستخرج نسبة الخصم والمنتج والإيميل من رقم الطلب.
// الصيغة الحالية: KH-D<pct>-<productKey>-<emailBase64url>-<n>
// والقديمة (بلا خصم): KH-<productKey>-<emailBase64url>-<n>
function parseOrder(orderNumber) {
  const s = String(orderNumber || "");
  const decode = (b) => { try { return Buffer.from(b, "base64url").toString("utf8"); } catch (e) { return ""; } };

  // الكود مقيّد بـ [A-Z0-9] فلا يحتوي شرطة، وبذلك يبقى الفصل واضحاً
  let m = s.match(/^KH-D(\d{1,3})C([A-Z0-9]*)-(.+)-([A-Za-z0-9_-]+)-\d*$/);
  if (m) {
    return { percent: Math.min(100, Number(m[1])), code: m[2] || "",
             productKey: m[3], email: decode(m[4]) };
  }

  m = s.match(/^KH-(.+)-([A-Za-z0-9_-]+)-\d*$/);
  if (m) return { percent: 0, code: "", productKey: m[1], email: decode(m[2]) };

  return {};
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

    // المبلغ المتوقّع = السعر بعد الخصم المسجَّل في رقم الطلب.
    // رقم الطلب أنشأه سيرفرنا وعاد من البوابة، فلا يمكن للمتصفح تزويره.
    const expected = finalPrice(product.price, result.percent);
    if (Math.round(result.amount) !== expected) {
      return res.status(400).json({
        error: "مبلغ الدفعة لا يطابق سعر المنتج — تواصل معنا",
      });
    }

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
        const rowsFound = await q.json();
        alreadyDelivered = Array.isArray(rowsFound) && rowsFound[0] && rowsFound[0].delivered === true;
      }
    } catch (e) { /* العمود قد لا يكون موجوداً بعد — نعامله كغير مُسلَّم */ }

    // التسليم منفصل عن التحقق: فشله لا يعني أن الدفع فشل
    let links = null, emailed = false, deliveryError = null;
    try {
      if (!alreadyDelivered && result.email) {
        // يُستهلك الكود مرة واحدة فقط، وعند نجاح الدفع لا عند فتح صفحة الدفع
        if (result.code) {
          await redeem(result.code, result.productKey).catch(() => {});
        }
        const out = await deliverProduct(result.email, result.productKey);
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

    // الدفع تم بنجاح في كل الحالات التي تصل هنا — نقولها صراحةً للعميل
    return res.status(200).json({
      ok: !deliveryError,
      paid: true,
      name: product.name,
      links: links || [],
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
