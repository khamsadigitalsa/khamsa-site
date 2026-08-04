// موزّع نقاط تمارا — ملف واحد بدل ثلاثة (حد الـ12 دالة في خطة Vercel المجانية).
//
//   GET  /api/tamara?op=config          حدود التقسيط المتاحة
//   POST /api/tamara?op=start           إنشاء جلسة دفع
//   POST /api/tamara?op=webhook         إشعار من تمارا (موقّع بمفتاح الإشعارات)
//
// الويبهوك يُسجَّل في لوحة تمارا كـ /api/tamara-webhook، ويحوّله vercel.json
// إلى هنا — حتى يبقى الرابط الذي وضعه التاجر صالحاً بلا تعديل.
const OPS = {
  "config":  require("./_op-tamara-config.js"),
  "start":   require("./_op-tamara-start.js"),
  "webhook": require("./_op-tamara-webhook.js"),
};

module.exports = async (req, res) => {
  const q = req.query || {};
  let op = String(q.op || "").trim();

  // احتياط: لو وصل نداء تمارا بلا ?op (تحويل لم يُطبَّق مثلاً)، نتعرّف عليه
  // من ترويسة التوقيع بدل أن نضيّع إشعار دفعٍ حقيقي
  if (!op) {
    const h = req.headers || {};
    if (h.tamaratoken || h.tamaraToken || h["tamara-token"]) op = "webhook";
    else if (req.method === "GET") op = "config";
  }

  const handler = OPS[op];
  if (!handler) {
    return res.status(400).json({
      error: "عملية غير معروفة: " + (op || "(فارغة)"),
      operations: Object.keys(OPS),
    });
  }
  return handler(req, res);
};
