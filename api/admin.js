// موزّع نقاط لوحة المالك — كلها خلف ملف واحد.
//
// السبب: خطة Vercel المجانية تسمح بـ 12 دالة فقط لكل نشر، وكل ملف في api/
// يُحسب دالة مستقلة. الملفات التي تبدأ بشرطة سفلية لا تُحسب، فجعلنا كل
// معالج وحدة داخلية ووزّعنا عليها من هنا بـ ?op=
//
//   /api/admin?op=login        دخول المالك
//   /api/admin?op=subscribers  قائمة المسجلين
//   /api/admin?op=deliver      تسليم طلب يدوياً
//   /api/admin?op=send-email   إرسال إيميل
//   /api/admin?op=check-files  فحص جاهزية الملفات
//   /api/admin?op=health       فحص الإعدادات
//   /api/admin?op=discounts    إدارة أكواد الخصم
//
// كل معالج يتحقق من الصلاحية بنفسه (isAuthed) كما كان تماماً — الدمج
// غيّر المسار فقط ولم يغيّر الحماية.
const OPS = {
  "login":       require("./_op-login.js"),
  "subscribers": require("./_op-subscribers.js"),
  "deliver":     require("./_op-deliver.js"),
  "send-email":  require("./_op-send-email.js"),
  "check-files": require("./_op-check-files.js"),
  "health":      require("./_op-health.js"),
  "discounts":   require("./_op-discounts.js"),
};

module.exports = async (req, res) => {
  const op = String((req.query && req.query.op) || "").trim();
  const handler = OPS[op];
  if (!handler) {
    return res.status(400).json({
      error: "عملية غير معروفة: " + (op || "(فارغة)"),
      operations: Object.keys(OPS),
    });
  }
  return handler(req, res);
};
