// التقييمات — نقطة واحدة تخدم كل العمليات (حد Vercel: 12 دالة).
//
//   GET  ?op=summary                 متوسط وعدد التقييمات لكل المنتجات (عام)
//   GET  ?op=list&product=<key>      تقييمات منتج معتمدة (عام)
//   GET  ?op=check&o=..&t=..         التحقق من رابط التقييم قبل عرض النموذج (عام)
//   POST ?op=submit                  إرسال تقييم — يتطلب طلباً حقيقياً وتوقيعاً صحيحاً
//   GET  ?op=pending                 كل التقييمات للمراجعة (المالك)
//   POST ?op=moderate                اعتماد/رفض/حذف (المالك)
//
// قاعدة لا تُكسر: لا يُنشأ تقييم إلا لطلب موجود فعلاً في جدول orders،
// ولا يُعرض إلا بعد موافقة المالك. هذا ما يجعل النجوم في نتائج قوقل صادقة.
const { isAuthed, sbFetch, checkReviewToken } = require("./_lib.js");
const { PRODUCTS } = require("./_delivery.js");

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

function aggregate(rows) {
  const by = {};
  rows.forEach((r) => {
    const k = r.product;
    if (!by[k]) by[k] = { count: 0, sum: 0 };
    by[k].count += 1;
    by[k].sum += Number(r.rating) || 0;
  });
  const out = {};
  Object.keys(by).forEach((k) => {
    out[k] = {
      count: by[k].count,
      // منزلة عشرية واحدة — ما يُعرض للعميل هو نفسه ما يُرسل لقوقل
      average: Math.round((by[k].sum / by[k].count) * 10) / 10,
    };
  });
  return out;
}

async function getOrder(orderId) {
  const r = await sbFetch("orders?id=eq." + encodeURIComponent(orderId)
    + "&select=id,product,email,amount,delivered");
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function existingReview(orderId) {
  const r = await sbFetch("reviews?order_id=eq." + encodeURIComponent(orderId)
    + "&select=id,rating,status");
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const op = clean(q.op, 20);

  try {
    /* ───────── عام: ملخّص التقييمات لكل المنتجات ───────── */
    if (op === "summary") {
      const r = await sbFetch("reviews?status=eq.approved&select=product,rating&limit=5000");
      if (!r.ok) return res.status(200).json({ products: {} });
      res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
      return res.status(200).json({ products: aggregate(await r.json()) });
    }

    /* ───────── عام: تقييمات منتج ───────── */
    if (op === "list") {
      const product = clean(q.product, 40);
      if (!PRODUCTS[product]) return res.status(400).json({ error: "منتج غير معروف" });
      const r = await sbFetch("reviews?status=eq.approved&product=eq."
        + encodeURIComponent(product)
        + "&select=name,rating,body,verified,created_at&order=created_at.desc&limit=50");
      if (!r.ok) return res.status(200).json({ reviews: [], count: 0, average: 0 });
      const rows = await r.json();
      const agg = aggregate(rows.map((x) => ({ product: product, rating: x.rating })))[product]
        || { count: 0, average: 0 };
      res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
      return res.status(200).json({
        reviews: rows, count: agg.count, average: agg.average,
      });
    }

    /* ───────── عام: هل رابط التقييم صالح؟ ───────── */
    if (op === "check") {
      const orderId = clean(q.o, 120);
      if (!orderId || !checkReviewToken(orderId, q.t)) {
        return res.status(403).json({ error: "رابط التقييم غير صالح" });
      }
      const order = await getOrder(orderId);
      if (!order) return res.status(404).json({ error: "ما لقينا هذا الطلب" });
      const product = PRODUCTS[order.product];
      if (!product) return res.status(404).json({ error: "منتج غير معروف" });
      const prev = await existingReview(orderId);
      return res.status(200).json({
        ok: true,
        productKey: order.product,
        productName: product.name,
        already: Boolean(prev),
        status: prev ? prev.status : null,
      });
    }

    /* ───────── عام: إرسال تقييم ───────── */
    if (op === "submit") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};
      const orderId = clean(b.orderId, 120);

      // ثلاث بوابات: توقيع صحيح، طلب موجود، ولم يُقيَّم من قبل
      if (!orderId || !checkReviewToken(orderId, b.token)) {
        return res.status(403).json({ error: "رابط التقييم غير صالح" });
      }
      const order = await getOrder(orderId);
      if (!order) return res.status(404).json({ error: "ما لقينا هذا الطلب" });
      if (await existingReview(orderId)) {
        return res.status(409).json({ error: "سبق أن قيّمت هذا الطلب — شكراً لك 💚" });
      }

      const rating = Math.round(Number(b.rating));
      if (!(rating >= 1 && rating <= 5)) {
        return res.status(400).json({ error: "اختر تقييماً من نجمة إلى خمس" });
      }

      const r = await sbFetch("reviews", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          order_id: orderId,
          product: order.product,
          email: order.email || "",
          name: clean(b.name, 40),
          rating: rating,
          body: clean(b.body, 600),
          // «شراء موثّق» يعني دفع فعلي — طلبات كود الخصم 100% مبلغها صفر
          verified: Number(order.amount) > 0,
          status: "pending",
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        if (/duplicate|unique/i.test(t)) {
          return res.status(409).json({ error: "سبق أن قيّمت هذا الطلب — شكراً لك 💚" });
        }
        return res.status(502).json({ error: "تعذّر حفظ التقييم: " + t.slice(0, 140) });
      }
      return res.status(200).json({
        ok: true,
        message: "وصلنا تقييمك — يظهر في صفحة المنتج بعد مراجعته. شكراً لك 💚",
      });
    }

    /* ───────── المالك: قائمة المراجعة ───────── */
    if (op === "pending") {
      if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرّح" });
      const r = await sbFetch("reviews?select=*&order=created_at.desc&limit=200");
      if (!r.ok) return res.status(502).json({ error: "تعذّرت القراءة: " + (await r.text()).slice(0, 140) });
      const rows = await r.json();
      return res.status(200).json({
        reviews: rows.map((x) => Object.assign({}, x, {
          productName: (PRODUCTS[x.product] || {}).name || x.product,
        })),
      });
    }

    /* ───────── المالك: اعتماد / رفض / حذف ───────── */
    if (op === "moderate") {
      if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرّح" });
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};
      const id = clean(b.id, 60);
      const action = clean(b.action, 20);
      if (!id) return res.status(400).json({ error: "معرّف ناقص" });

      if (action === "delete") {
        const r = await sbFetch("reviews?id=eq." + encodeURIComponent(id), {
          method: "DELETE", headers: { Prefer: "return=minimal" },
        });
        if (!r.ok) return res.status(502).json({ error: "تعذّر الحذف" });
        return res.status(200).json({ ok: true, message: "تم الحذف" });
      }

      if (action !== "approved" && action !== "rejected" && action !== "pending") {
        return res.status(400).json({ error: "إجراء غير معروف" });
      }
      const r = await sbFetch("reviews?id=eq." + encodeURIComponent(id), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: action }),
      });
      if (!r.ok) return res.status(502).json({ error: "تعذّر التحديث" });
      return res.status(200).json({
        ok: true,
        message: action === "approved" ? "✅ اعتُمد ويظهر الآن في صفحة المنتج" : "تم التحديث",
      });
    }

    return res.status(400).json({
      error: "عملية غير معروفة: " + (op || "(فارغة)"),
      operations: ["summary", "list", "check", "submit", "pending", "moderate"],
    });
  } catch (e) {
    console.error("reviews", e);
    return res.status(500).json({ error: "خطأ: " + String(e.message || e).slice(0, 160) });
  }
};
