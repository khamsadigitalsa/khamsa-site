const { isAuthed, sbFetch } = require("./_lib.js");

module.exports = async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرح" });

  try {
    const r = await sbFetch("subscribers?select=email,name,created_at&order=created_at.desc");
    if (!r.ok) {
      const t = await r.text();
      console.error("supabase select failed:", r.status, t);
      return res.status(500).json({ error: "تعذر جلب القائمة" });
    }
    const subscribers = await r.json();
    return res.status(200).json({ subscribers });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "خطأ غير متوقع" });
  }
};
