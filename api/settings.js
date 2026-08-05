// إعدادات الموقع القابلة للتحرير من لوحة المالك.
//   GET   عام  — يقرأه الفوتر والشارات والتتبع في كل الصفحات
//   POST  للمالك فقط — يحفظ. الحفظ «دمج»: لا يُكتب إلا ما أُرسل فعلاً،
//         فحفظ لوحة الشارات لا يمسح حسابات التواصل والعكس صحيح.
// تُخزَّن كلها في صف واحد داخل جدول settings تحت المفتاح "site".
const { isAuthed, sbFetch } = require("./_lib.js");
const { PRODUCTS } = require("./_delivery.js");

// المنصّات المدعومة — أي مفتاح خارج هذه القائمة يُتجاهل
const PLATFORMS = ["tiktok", "instagram", "snapchat", "x", "youtube", "facebook", "telegram"];

const DEFAULTS = {
  whatsapp: "966548133555",
  orderPage: "https://waslati.com/khamsa",
};

// نقبل https فقط: رابط http يُظهر تحذير «غير آمن»، و javascript: يفتح XSS
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

// الشارة نص قصير يُعرض على البطاقة. "-" قيمة خاصة تعني «أخفِ الشارة».
function cleanBadge(v) {
  return String(v || "").replace(/[<>]/g, "").trim().slice(0, 30);
}

function cleanTrackId(v, re) {
  const s = String(v || "").trim();
  return re.test(s) ? s : "";
}

async function readRaw() {
  try {
    const r = await sbFetch("settings?key=eq.site&select=value");
    if (!r.ok) return {};
    const rows = await r.json();
    return (Array.isArray(rows) && rows[0] && rows[0].value) || {};
  } catch (e) {
    return {};
  }
}

// «الأكثر مبيعاً» تُحسب من الطلبات الحقيقية في جدول orders — لا تُكتب باليد.
// عتبة 3 طلبات حتى لا تُمنح الشارة على طلب يتيم فتصير ادعاءً أجوف.
async function autoBadges() {
  try {
    const r = await sbFetch("orders?select=product&limit=10000");
    if (!r.ok) return {};
    const counts = {};
    (await r.json()).forEach((x) => {
      counts[x.product] = (counts[x.product] || 0) + 1;
    });
    const sorted = Object.keys(counts)
      .filter((k) => PRODUCTS[k])
      .sort((a, b) => counts[b] - counts[a]);
    const out = {};
    if (sorted[0] && counts[sorted[0]] >= 3) out[sorted[0]] = "الأكثر مبيعاً 🔥";
    if (sorted[1] && counts[sorted[1]] >= 3) out[sorted[1]] = "الأكثر طلباً";
    return out;
  } catch (e) {
    return {};
  }
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const v = await readRaw();
    const badgesCfg = v.badges || {};
    const mode = badgesCfg.mode === "manual" ? "manual" : "auto";
    const auto = mode === "auto" ? await autoBadges() : {};
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    return res.status(200).json({
      whatsapp: v.whatsapp || DEFAULTS.whatsapp,
      orderPage: v.orderPage || DEFAULTS.orderPage,
      social: v.social || {},
      badges: { mode: mode, manual: badgesCfg.manual || {}, auto: auto },
      tracking: v.tracking || {},
      announce: v.announce || { text: "", on: false },
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرّح" });

  const b = req.body || {};
  const value = await readRaw();   // أساس الدمج — نحدّث ما أُرسل فقط

  if ("whatsapp" in b) value.whatsapp = cleanWhatsapp(b.whatsapp) || DEFAULTS.whatsapp;
  if ("orderPage" in b) value.orderPage = cleanUrl(b.orderPage);

  if ("social" in b) {
    const social = {};
    PLATFORMS.forEach((p) => {
      const url = cleanUrl((b.social || {})[p]);
      if (url) social[p] = url;
    });
    value.social = social;
  }

  if ("badges" in b) {
    const src = b.badges || {};
    const manual = {};
    Object.keys(PRODUCTS).forEach((k) => {
      const t = cleanBadge((src.manual || {})[k]);
      if (t) manual[k] = t;   // "-" تُحفظ كما هي = إخفاء
    });
    value.badges = { mode: src.mode === "manual" ? "manual" : "auto", manual: manual };
  }

  if ("announce" in b) {
    const a = b.announce || {};
    value.announce = {
      text: String(a.text || "").replace(/[<>]/g, "").trim().slice(0, 90),
      on: Boolean(a.on),
    };
  }

  if ("tracking" in b) {
    const t = b.tracking || {};
    value.tracking = {
      gadsId: cleanTrackId(t.gadsId, /^AW-\w{6,15}$/),
      gadsLabel: cleanTrackId(t.gadsLabel, /^[\w-]{4,40}$/),
      ga4Id: cleanTrackId(t.ga4Id, /^G-[A-Z0-9]{4,15}$/i),
    };
  }

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
    return res.status(200).json({ ok: true, message: "✅ تم الحفظ", saved: value });
  } catch (e) {
    return res.status(500).json({ error: "تعذّر الحفظ: " + String(e.message || e).slice(0, 160) });
  }
};

module.exports.PLATFORMS = PLATFORMS;
