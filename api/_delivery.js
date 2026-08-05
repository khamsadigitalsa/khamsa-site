// محرك التسليم المشترك — يستخدمه التسليم اليدوي (deliver.js) والدفع الآلي (verify-pay.js)
const crypto = require("crypto");
const { sbFetch, sendMail, brandWrap, reviewLink } = require("./_lib.js");

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

// السعر بالريال — يُستخدم للتحقق من مبلغ الدفع، فلا تغيّره هنا دون تغييره في checkout.html وindex.html
const PRODUCTS = {
  "interactive":  { name: "البلانر العربي التفاعلي (GoodNotes)", price: 79, files: ["f01-interactive-planner.pdf"] },
  "budget":       { name: "ميزانيتي الذكية (إكسل)", price: 49, files: ["f02-budget.xlsx"] },
  "daily":        { name: "بلانر الإنجاز اليومي", price: 39, files: ["f03-daily-planner.pdf"] },
  "cv":           { name: "حقيبة السيرة الذاتية (عربي + إنجليزي)", price: 29, files: ["f04-cv-arabic.docx", "f05-cv-english.docx"] },
  "letters":      { name: "كراسة الحروف والأرقام", price: 19, files: ["f06-letters-numbers.pdf"] },
  "numbers20":    { name: "كراسة الأرقام من ١ إلى ٢٠", price: 19, files: ["f07-numbers-1-20.pdf"] },
  "words":        { name: "كراسة كلماتي الأولى", price: 19, files: ["f08-first-words.pdf"] },
  "shapes":       { name: "كراسة الأشكال والألوان", price: 19, files: ["f09-shapes-colors.pdf"] },
  "animals":      { name: "كراسة تلوين الحيوانات", price: 19, files: ["f10-animals-coloring.pdf"] },
  "story":        { name: "قصة أرنوب والحروف الضائعة", price: 29, files: ["f11-arnoub-story.pdf"] },
  "mazes":        { name: "كراسة المتاهات", price: 19, files: ["f12-mazes.pdf"] },
  "hunt":         { name: "لعبة البحث عن الحرف", price: 19, files: ["f13-letter-hunt.pdf"] },
  "cards":        { name: "بطاقات الحروف والأرقام", price: 29, files: ["f14-flashcards.pdf"] },
  "stars":        { name: "لوحة نجوم المهام", price: 29, files: ["f15-star-chart.pdf"] },
  "ramadan":      { name: "حقيبة رمضان للأطفال", price: 29, files: ["f16-ramadan-kids.pdf"] },
  "bundle-tasees":     { name: "حقيبة التأسيس", price: 49, files: ["f06-letters-numbers.pdf","f07-numbers-1-20.pdf","f08-first-words.pdf","f09-shapes-colors.pdf"] },
  "bundle-tasliya":    { name: "حقيبة التسلية", price: 49, files: ["f12-mazes.pdf","f13-letter-hunt.pdf","f10-animals-coloring.pdf","f11-arnoub-story.pdf"] },
  "bundle-library":    { name: "مكتبة طفلي الكاملة", price: 99, files: KIDS_ALL },
  "bundle-adults":     { name: "حقيبة التنظيم للكبار", price: 99, files: ["f01-interactive-planner.pdf","f02-budget.xlsx","f03-daily-planner.pdf"] },
  "bundle-everything": { name: "باقة كل شيء (المتجر كاملاً)", price: 149, files: Object.keys(FILES) },
};

/* ═════════ رقم الطلب ═════════
   يحمل معه: نسبة الخصم + الكود + مفتاح المنتج + الإيميل.
   يُنشأ في السيرفر ويعود إلينا من البوابة، فلا يستطيع المتصفح تزويره،
   وبه نتحقق من أن المبلغ المدفوع يطابق السعر المفترض بعد الخصم.
   الصيغة: KH-D<pct>C<code>-<productKey>-<emailBase64url>-<n>
   مصدر واحد للصيغة يخدم Paylink وتمارا معاً — أي اختلاف بينهما
   يعني طلبات مدفوعة لا نستطيع قراءتها. */
function buildOrderNumber(percent, code, productKey, email) {
  const n = crypto.randomBytes(4).readUInt32BE(0) % 100000000;
  return "KH-D" + (Number(percent) || 0) + "C" + (code || "") + "-" + productKey + "-"
    + Buffer.from(String(email)).toString("base64url").slice(0, 24) + "-" + n;
}

function parseOrderNumber(orderNumber) {
  const s = String(orderNumber || "");
  const decode = (b) => { try { return Buffer.from(b, "base64url").toString("utf8"); } catch (e) { return ""; } };

  // الكود مقيّد بـ [A-Z0-9] فلا يحتوي شرطة، وبذلك يبقى الفصل واضحاً
  let m = s.match(/^KH-D(\d{1,3})C([A-Z0-9]*)-(.+)-([A-Za-z0-9_-]+)-\d*$/);
  if (m) {
    return { percent: Math.min(100, Number(m[1])), code: m[2] || "",
             productKey: m[3], email: decode(m[4]) };
  }

  // الصيغة القديمة (بلا خصم) — طلبات أُنشئت قبل إضافة الأكواد
  m = s.match(/^KH-(.+)-([A-Za-z0-9_-]+)-\d*$/);
  if (m) return { percent: 0, code: "", productKey: m[1], email: decode(m[2]) };

  return {};
}

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
    // أشيع سبب: الملف لم يُرفع أصلاً إلى مخزن Supabase، فالتوقيع يفشل بـ NoSuchKey.
    // نوضّح السبب والحل بدل ترك رسالة البوابة الخام.
    if (/NoSuchKey|not_found/i.test(t)) {
      throw new Error(
        "الملف «" + path + "» غير موجود في مخزن Supabase (bucket: files). " +
        "ارفعه أولاً: python tools/upload_files.py — أو من لوحة Supabase → Storage → files."
      );
    }
    if (r.status === 400 && /Invalid JWT|invalid signature/i.test(t)) {
      throw new Error("مفتاح SUPABASE_SERVICE_KEY غير صحيح أو منتهي — حدّثه في متغيّرات Vercel.");
    }
    throw new Error("تعذّر توقيع رابط «" + path + "»: " + r.status + " " + t.slice(0, 160));
  }
  const d = await r.json();
  return process.env.SUPABASE_URL + "/storage/v1" + d.signedURL;
}

async function signLinks(productKey) {
  const product = PRODUCTS[productKey];
  if (!product) throw new Error("unknown product: " + productKey);
  const links = [];
  for (const f of product.files) {
    links.push({ label: FILES[f] || f, url: await signUrl(f) });
  }
  return links;
}

// orderId اختياري: إن وُجد أضفنا دعوة تقييم موقّعة خاصة بهذا الطلب.
// التسليم اليدوي من لوحة المالك لا يمرّره، وهذا مقصود — لا نريد
// طريقاً يستطيع المالك عبره توليد دعوات تقييم بلا شراء حقيقي.
async function deliverProduct(email, productKey, orderId) {
  const product = PRODUCTS[productKey];
  const links = await signLinks(productKey);

  const reviewCta = orderId ? `
       <table role="presentation" style="margin:22px 0 6px;width:100%"><tr>
         <td style="background:#F2F7F6;border-radius:12px;padding:16px;text-align:center">
           <div style="font-weight:bold;margin-bottom:6px">وش رأيك بالمنتج؟ ⭐</div>
           <div style="font-size:13px;color:#5E6E6B;margin-bottom:12px">
             تقييمك يساعد أهالٍ غيرك يقررون — وما ياخذ منك دقيقة.</div>
           <a href="${reviewLink(orderId)}" style="background:#C9A227;color:#3a2c00;padding:11px 26px;border-radius:99px;text-decoration:none;font-weight:bold;display:inline-block">قيّم المنتج</a>
         </td></tr></table>` : "";

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
       <p>أي تحديث مستقبلي لهذه المنتجات بيوصلك <b>مجاناً</b> على هذا الإيميل 💚</p>
       ${reviewCta}`
    ),
  });

  return { name: product.name, links };
}

async function addSubscriber(email, name) {
  try {
    await sbFetch("subscribers?on_conflict=email", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ email, name: name || "" }),
    });
  } catch (e) { /* غير حرج */ }
}

module.exports = {
  FILES, PRODUCTS, signLinks, deliverProduct, addSubscriber,
  buildOrderNumber, parseOrderNumber,
};
