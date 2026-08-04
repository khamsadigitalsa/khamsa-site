// فحص جاهزية التسليم — يقارن الملفات المطلوبة بما هو موجود فعلاً في مخزن Supabase.
// للمالك فقط. يُستخدم من لوحة الإدارة قبل تشغيل الحملات الإعلانية.
const { isAuthed } = require("./_lib.js");
const { FILES, PRODUCTS } = require("./_delivery.js");

module.exports = async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرّح" });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: "SUPABASE_URL أو SUPABASE_SERVICE_KEY غير مضبوط في Vercel" });
  }

  try {
    const r = await fetch(url + "/storage/v1/object/list/files", {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: "", limit: 500, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "تعذّرت قراءة المخزن: " + r.status + " " + t.slice(0, 200) });
    }

    const have = new Set((await r.json()).map(o => o.name));
    const expected = Object.keys(FILES);
    const missing = expected.filter(n => !have.has(n));
    const present = expected.filter(n => have.has(n));

    // أي منتج لا يمكن تسليمه الآن — هذا ما يهم فعلاً
    const brokenProducts = Object.entries(PRODUCTS)
      .filter(([, p]) => p.files.some(f => !have.has(f)))
      .map(([k, p]) => ({ key: k, name: p.name, missing: p.files.filter(f => !have.has(f)) }));

    return res.status(200).json({
      ok: missing.length === 0,
      total: expected.length,
      present: present.length,
      missing,
      brokenProducts,
      hint: missing.length
        ? "ارفع الملفات الناقصة: python tools/upload_files.py — أو من Supabase → Storage → files"
        : "كل الملفات جاهزة — التسليم يعمل",
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
