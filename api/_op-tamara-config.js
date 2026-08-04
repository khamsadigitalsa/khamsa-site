// هل تمارا متاحة لهذا المبلغ؟ — نقطة عامة تستدعيها صفحة الدفع قبل عرض الزر.
// لا تكشف أي مفتاح: ترجع فقط الحدود ووسيلة الدفع المناسبة.
// السبب: أغلب منتجاتنا 19 ر.س وقد تكون تحت الحد الأدنى لتمارا،
// وإظهار زر يفشل عند الضغط أسوأ من عدم إظهاره.
const T = require("./_tamara.js");

// ذاكرة مؤقتة داخل نفس النسخة الحيّة — الحدود تتغيّر نادراً جداً
let cache = { at: 0, methods: null };
const TTL = 10 * 60 * 1000;

async function methods() {
  const now = Date.now();
  if (cache.methods && now - cache.at < TTL) return cache.methods;
  const m = await T.paymentMethods();
  cache = { at: now, methods: m };
  return m;
}

module.exports = async (req, res) => {
  if (!T.enabled()) return res.status(200).json({ enabled: false });

  const amount = Number(
    (req.query && (req.query.amount || req.query.a)) || 0
  );

  try {
    const list = await methods();
    if (!list.length) return res.status(200).json({ enabled: false });

    const min = Math.min.apply(null, list.map((m) => m.min || 0));
    const max = Math.max.apply(null, list.map((m) => m.max || 0));
    const pick = amount > 0 ? T.pickMethod(list, amount) : null;

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    return res.status(200).json({
      enabled: true,
      min: min,
      max: max,
      // القائمة كاملة حتى تحسب الصفحة الرئيسية التقسيط لكل منتج بنداء واحد
      methods: list,
      available: amount > 0 ? Boolean(pick) : null,
      method: pick ? pick.type : null,
      instalments: pick ? pick.instalments : null,
    });
  } catch (e) {
    console.error("tamara-config", e.message);
    // لا نُسقِط صفحة الدفع بسبب تمارا — نخفيها فقط
    return res.status(200).json({ enabled: false, error: "تعذّر الاتصال بتمارا" });
  }
};
