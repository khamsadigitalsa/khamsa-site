// إعدادات الموقع القابلة للتحرير من لوحة المالك (حسابات التواصل + الواتساب).
//   GET   عام  — يقرأه الفوتر في كل الصفحات
//   POST  للمالك فقط — يحفظ الروابط
// تُخزَّن في صف واحد داخل جدول settings تحت المفتاح "site".
const { isAuthed, sbFetch } = require("./_lib.js");

// المنصّات المدعومة — أي مفتاح خارج هذه القائمة يُتجاهل
const PLATFORMS = ["tiktok", "instagram", "snapchat", "x", "youtube", "facebook", "telegram"];

const DEFAULTS = {
  whatsapp: "966548133555",
  orderPage: "https://waslati.com/khamsa",
  social: {},
};

// نقبل https فقط: رابط http في الفوتر يُظهر تحذير «غير آمن» في المتصفح،
// و javascript: أو data: يفتح ثغرة XSS في صفحة يزورها كل عميل.
function cleanUrl(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (!/^https:\/\/[^\s"'<>]{3,180}$/i.test(s)) return "";
  return s;
}

function cleanWhatsapp(v) {
  const d = String(v || "").replace(/[^\d]/g, "");
  return d.length >= 9 && d.length <= 15 ? d : "";
}

async function read() {
  try {
    const r = await sbFetch("settings?key=eq.site&select=value");
    if (!r.ok) return DEFAULTS;
    const rows = await r.json();
    const v = (Array.isArray(rows) && rows[0] && rows[0].value) || {};
    return {
      whatsapp: v.whatsapp || DEFAULTS.whatsapp,
      orderPage: v.orderPage || DEFAULTS.orderPage,
      social: v.social || {},
    };
  } catch (e) {
    // الفوتر لا يجوز أن ينكسر بسبب عطل في القاعدة — نرجع الافتراضي
    return DEFAULTS;
  }
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const data = await read();
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    return res.status(200).json(data);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرّح" });

  const b = req.body || {};
  const social = {};
  PLATFORMS.forEach((p) => {
    const url = cleanUrl((b.social || {})[p]);
    if (url) social[p] = url;
  });

  const value = {
    whatsapp: cleanWhatsapp(b.whatsapp) || DEFAULTS.whatsapp,
    orderPage: cleanUrl(b.orderPage),
    social: social,
  };

  try {
    const r = await sbFetch("settings?on_conflict=key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: "site", value: value, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "تعذّر الحفظ: " + t.slice(0, 160) });
    }
    return res.status(200).json({ ok: true, message: "✅ تم حفظ الحسابات", saved: value });
  } catch (e) {
    return res.status(500).json({ error: "تعذّر الحفظ: " + String(e.message || e).slice(0, 160) });
  }
};

module.exports.PLATFORMS = PLATFORMS;
