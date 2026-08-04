const { isAuthed, sbFetch, sendMail, brandWrap } = require("./_lib.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرح" });

  const body = req.body || {};
  const to = String(body.to || "").trim();
  const subject = String(body.subject || "").trim();
  const message = String(body.message || "").trim();
  const attachmentUrl = String(body.attachmentUrl || "").trim();
  const attachmentName = String(body.attachmentName || "").trim();

  if (!to || !subject || !message) {
    return res.status(400).json({ error: "عبّئ المستلم والعنوان والرسالة" });
  }

  try {
    let recipients;
    if (to === "all") {
      const r = await sbFetch("subscribers?select=email,name");
      if (!r.ok) return res.status(500).json({ error: "تعذر جلب المسجلين" });
      recipients = await r.json();
    } else {
      recipients = [{ email: to, name: "" }];
    }
    if (!recipients.length) return res.status(400).json({ error: "لا يوجد مسجلون بعد" });

    const html = brandWrap(
      "<p>" + message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "</p><p>") + "</p>"
    );

    let sent = 0;
    const failures = [];
    for (const rcpt of recipients) {
      try {
        await sendMail({
          toEmail: rcpt.email,
          toName: rcpt.name,
          subject,
          html,
          attachmentUrl: attachmentUrl || undefined,
          attachmentName: attachmentName || undefined,
        });
        sent++;
      } catch (e) {
        console.error("send failed for", rcpt.email, e.message);
        failures.push(rcpt.email);
      }
    }

    const msg = "تم الإرسال إلى " + sent + " مستلماً" +
      (failures.length ? " — فشل: " + failures.join(", ") : " ✅");
    return res.status(200).json({ ok: true, message: msg, sent, failures });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "خطأ غير متوقع أثناء الإرسال" });
  }
};
