// التسجيل في القائمة البريدية + تسليم الهدية المجانية تلقائياً.
// الهدية ملف حقيقي (نموذج من كراسة الحروف) موقَّع من مخزن Supabase:
//   - يظهر رابط التحميل فوراً في الصفحة (إشباع لحظي = تسجيلات أكثر)
//   - ويصل نفسه في إيميل الترحيب (يعوّد المشترك يفتح إيميلاتنا)
const { sbFetch, sendMail, brandWrap, siteUrl } = require("./_lib.js");

const GIFT_FILE = "f00-free-letters-sample.pdf";
const GIFT_NAME = "نموذج مجاني — كراسة الحروف والأرقام (3 صفحات تدريب)";

async function signGift() {
  try {
    const r = await fetch(process.env.SUPABASE_URL + "/storage/v1/object/sign/files/" + GIFT_FILE, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 7 * 24 * 60 * 60 }),
    });
    if (!r.ok) return null;   // الملف غير مرفوع بعد — التسجيل يكمل بلا هدية
    const d = await r.json();
    return process.env.SUPABASE_URL + "/storage/v1" + d.signedURL;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const email = String(body.email || "").toLowerCase().trim();
  const name = String(body.name || "").trim().slice(0, 60);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "اكتب إيميلاً صحيحاً" });
  }

  try {
    const r = await sbFetch("subscribers", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ email, name }),
    });

    // المسجَّل سابقاً ياخذ الهدية برضه — منع التكرار للصفوف لا لللطف
    const duplicate = r.status === 409;
    if (!r.ok && !duplicate) {
      const t = await r.text();
      console.error("supabase insert failed:", r.status, t);
      return res.status(500).json({ error: "تعذر الحفظ — جرب بعد قليل" });
    }

    const gift = await signGift();

    // إيميل الترحيب — فشله لا يفشل التسجيل
    try {
      const giftBlock = gift
        ? `<table role="presentation" style="margin:16px 0;width:100%"><tr>
             <td style="background:#F2F7F6;border-radius:12px;padding:16px;text-align:center">
               <div style="font-weight:bold;margin-bottom:4px">🎁 هديتك جاهزة</div>
               <div style="font-size:13px;color:#5E6E6B;margin-bottom:12px">${GIFT_NAME}</div>
               <a href="${gift}" style="background:#C9A227;color:#3a2c00;padding:12px 28px;border-radius:99px;text-decoration:none;font-weight:bold;display:inline-block">⬇️ حمّل هديتك الآن</a>
               <div style="font-size:12px;color:#8a8a8a;margin-top:10px">الرابط صالح 7 أيام — حمّلها واحفظها</div>
             </td></tr></table>
           <p>عجبتك الصفحات؟ الكراسة الكاملة فيها <b>28 حرفاً بالتتبع + الأرقام + شهادة إنجاز</b> بـ19 ريالاً فقط:</p>
           <p style="text-align:center"><a href="${siteUrl()}/p/letters" style="background:#1F6E6B;color:#fff;padding:12px 26px;border-radius:99px;text-decoration:none;font-weight:bold;display:inline-block">🛍️ شوف الكراسة الكاملة</a></p>`
        : `<p><b>🎁 هديتك الترحيبية:</b> رد على هذا الإيميل بكلمة «هديتي» وبنرسلها لك فوراً.</p>`;

      await sendMail({
        toEmail: email,
        toName: name,
        subject: "🎁 هديتك وصلت — نموذج مجاني من كراسة الحروف | خمسة ديجيتال",
        html: brandWrap(
          `<p>مرحباً ${name || "فيك"} 👋</p>
           <p>سعيدين إنك انضممت لنا! هذي هديتك الترحيبية، ومن الحين بتوصلك منتجاتنا الجديدة وعروض المواسم أول بأول.</p>
           ${giftBlock}`
        ),
      });
    } catch (e) {
      console.error("welcome email failed:", e.message);
    }

    return res.status(200).json({
      ok: true,
      gift: gift,
      giftName: gift ? GIFT_NAME : null,
      message: duplicate
        ? (gift ? "أنت مسجل من قبل 💚 وهذي هديتك مرة ثانية" : "أنت مسجل معنا من قبل 💚")
        : (gift ? "تم! هديتك تحتك وأرسلنا نسخة لإيميلك 🎁" : "تم التسجيل! تفقد إيميلك 🎁"),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "خطأ غير متوقع — جرب مرة ثانية" });
  }
};
