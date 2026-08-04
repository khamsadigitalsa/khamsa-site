const { sbFetch, sendMail, brandWrap } = require("./_lib.js");

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

    if (r.status === 409) {
      return res.status(200).json({ ok: true, message: "أنت مسجل معنا من قبل 💚" });
    }
    if (!r.ok) {
      const t = await r.text();
      console.error("supabase insert failed:", r.status, t);
      return res.status(500).json({ error: "تعذر الحفظ — جرب بعد قليل" });
    }

    // إيميل الترحيب — فشله لا يفشل التسجيل
    try {
      await sendMail({
        toEmail: email,
        toName: name,
        subject: "أهلاً بك في خمسة ديجيتال 🎁",
        html: brandWrap(
          `<p>مرحباً ${name || "فيك"} 👋</p>
           <p>سعيدين إنك انضممت لنا! من الحين بتوصلك منتجاتنا الجديدة وعروض المواسم أول بأول.</p>
           <p><b>🎁 هديتك الترحيبية:</b> رد على هذا الإيميل بكلمة «هديتي» وبنرسلها لك فوراً — أو كلمنا واتساب.</p>
           <p style="margin-top:18px"><a href="https://waslati.com/khamsa" style="background:#1F6E6B;color:#fff;padding:12px 26px;border-radius:99px;text-decoration:none;font-weight:bold">🛍️ تصفح منتجاتنا</a></p>`
        ),
      });
    } catch (e) {
      console.error("welcome email failed:", e.message);
    }

    return res.status(200).json({ ok: true, message: "تم التسجيل! تفقد إيميلك 🎁" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "خطأ غير متوقع — جرب مرة ثانية" });
  }
};
