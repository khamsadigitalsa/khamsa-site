const { isAuthed, sendMail, brandWrap } = require("./_lib.js");

// أسماء الملفات كما هي مرفوعة في Supabase Storage → bucket اسمه: files
const FILES = {
  "f01-interactive-planner.pdf": "البلانر العربي التفاعلي (GoodNotes)",
  "f02-budget.xlsx": "ميزانيتي الذكية (إكسل)",
  "f03-daily-planner.pdf": "بلانر الإنجاز اليومي (طباعة)",
  "f04-cv-arabic.docx": "قالب السيرة الذاتية — عربي",
  "f05-cv-english.docx": "قالب السيرة الذاتية — إنجليزي",
  "f06-letters-numbers.pdf": "كراسة الحروف والأرقام",
  "f07-numbers-1-20.pdf": "كراسة الأرقام من ١ إلى ٢٠",
  "f08-first-words.pdf": "كراسة كلماتي الأولى",
  "f09-shapes-colors.pdf": "كراسة الأشكال والألوان",
  "f10-animals-coloring.pdf": "كراسة تلوين الحيوانات",
  "f11-arnoub-story.pdf": "قصة أرنوب والحروف الضائعة",
  "f12-mazes.pdf": "كراسة المتاهات",
  "f13-letter-hunt.pdf": "لعبة البحث عن الحرف",
  "f14-flashcards.pdf": "بطاقات الحروف والأرقام",
  "f15-star-chart.pdf": "لوحة نجوم المهام",
  "f16-ramadan-kids.pdf": "حقيبة رمضان للأطفال",
};

const KIDS_ALL = ["f06-letters-numbers.pdf","f07-numbers-1-20.pdf","f08-first-words.pdf",
  "f09-shapes-colors.pdf","f10-animals-coloring.pdf","f11-arnoub-story.pdf","f12-mazes.pdf",
  "f13-letter-hunt.pdf","f14-flashcards.pdf","f15-star-chart.pdf","f16-ramadan-kids.pdf"];

const PRODUCTS = {
  "interactive":  { name: "البلانر العربي التفاعلي (GoodNotes)", files: ["f01-interactive-planner.pdf"] },
  "budget":       { name: "ميزانيتي الذكية (إكسل)", files: ["f02-budget.xlsx"] },
  "daily":        { name: "بلانر الإنجاز اليومي", files: ["f03-daily-planner.pdf"] },
  "cv":           { name: "حقيبة السيرة الذاتية (عربي + إنجليزي)", files: ["f04-cv-arabic.docx", "f05-cv-english.docx"] },
  "letters":      { name: "كراسة الحروف والأرقام", files: ["f06-letters-numbers.pdf"] },
  "numbers20":    { name: "كراسة الأرقام من ١ إلى ٢٠", files: ["f07-numbers-1-20.pdf"] },
  "words":        { name: "كراسة كلماتي الأولى", files: ["f08-first-words.pdf"] },
  "shapes":       { name: "كراسة الأشكال والألوان", files: ["f09-shapes-colors.pdf"] },
  "animals":      { name: "كراسة تلوين الحيوانات", files: ["f10-animals-coloring.pdf"] },
  "story":        { name: "قصة أرنوب والحروف الضائعة", files: ["f11-arnoub-story.pdf"] },
  "mazes":        { name: "كراسة المتاهات", files: ["f12-mazes.pdf"] },
  "hunt":         { name: "لعبة البحث عن الحرف", files: ["f13-letter-hunt.pdf"] },
  "cards":        { name: "بطاقات الحروف والأرقام", files: ["f14-flashcards.pdf"] },
  "stars":        { name: "لوحة نجوم المهام", files: ["f15-star-chart.pdf"] },
  "ramadan":      { name: "حقيبة رمضان للأطفال", files: ["f16-ramadan-kids.pdf"] },
  "bundle-tasees":     { name: "حقيبة التأسيس", files: ["f06-letters-numbers.pdf","f07-numbers-1-20.pdf","f08-first-words.pdf","f09-shapes-colors.pdf"] },
  "bundle-tasliya":    { name: "حقيبة التسلية", files: ["f12-mazes.pdf","f13-letter-hunt.pdf","f10-animals-coloring.pdf","f11-arnoub-story.pdf"] },
  "bundle-library":    { name: "مكتبة طفلي الكاملة", files: KIDS_ALL },
  "bundle-adults":     { name: "حقيبة التنظيم للكبار", files: ["f01-interactive-planner.pdf","f02-budget.xlsx","f03-daily-planner.pdf"] },
  "bundle-everything": { name: "باقة كل شيء (المتجر كاملاً)", files: Object.keys(FILES) },
};

const EXPIRES = 7 * 24 * 60 * 60; // روابط صالحة 7 أيام

async function signUrl(path) {
  const r = await fetch(process.env.SUPABASE_URL + "/storage/v1/object/sign/files/" + path, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: EXPIRES }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("sign failed for " + path + ": " + r.status + " " + t);
  }
  const d = await r.json();
  return process.env.SUPABASE_URL + "/storage/v1" + d.signedURL;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرح" });

  const body = req.body || {};
  const email = String(body.email || "").toLowerCase().trim();
  const productKey = String(body.productKey || "").trim();
  const product = PRODUCTS[productKey];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "إيميل غير صحيح" });
  if (!product) return res.status(400).json({ error: "اختر المنتج" });

  try {
    const links = [];
    for (const f of product.files) {
      const url = await signUrl(f);
      links.push({ label: FILES[f] || f, url });
    }

    const buttons = links.map(l =>
      `<table role="presentation" style="margin:10px 0;width:100%"><tr>
        <td style="background:#F2F7F6;border-radius:10px;padding:12px 16px">
          <div style="font-weight:bold;margin-bottom:8px">📄 ${l.label}</div>
          <a href="${l.url}" style="background:#1F6E6B;color:#fff;padding:10px 24px;border-radius:99px;text-decoration:none;font-weight:bold;display:inline-block">⬇️ تحميل الملف</a>
        </td></tr></table>`
    ).join("");

    await sendMail({
      toEmail: email,
      subject: "🎉 شكراً لطلبك — ملفاتك جاهزة للتحميل | خمسة ديجيتال",
      html: brandWrap(
        `<p>أهلاً 👋</p>
         <p>شكراً لثقتك بخمسة ديجيتال! طلبك: <b>${product.name}</b></p>
         <p>ملفاتك جاهزة — اضغط زر التحميل واحفظ الملفات في جهازك:</p>
         ${buttons}
         <p style="color:#8a6d14;background:#F5EBD3;border-radius:8px;padding:10px 14px;font-size:13px">
         ⏳ روابط التحميل صالحة لمدة 7 أيام — حمّل ملفاتك الآن واحفظها.
         إذا انتهت الصلاحية أو واجهت أي مشكلة، كلمنا واتساب وبنرسلها لك فوراً.</p>
         <p>أي تحديث مستقبلي لهذه المنتجات بيوصلك <b>مجاناً</b> على هذا الإيميل 💚</p>`
      ),
    });

    return res.status(200).json({ ok: true, message: "تم التسليم ✅ — وصله إيميل فيه " + links.length + " ملفاً" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "فشل التسليم: " + e.message.slice(0, 200) });
  }
};
