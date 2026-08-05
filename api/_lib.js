// أدوات مشتركة — هذا الملف لا يُنشر كنقطة API (يبدأ بشرطة سفلية)
const crypto = require("crypto");

function adminToken() {
  return crypto.createHash("sha256")
    .update("khamsa-admin:" + (process.env.ADMIN_PASSWORD || ""))
    .digest("hex");
}

function isAuthed(req) {
  const cookies = req.cookies || {};
  return process.env.ADMIN_PASSWORD && cookies.admin_token === adminToken();
}

// عنوان الموقع — يُستخدم في روابط الإيميل التي لا يوجد فيها طلب HTTP نقرأ منه المضيف
function siteUrl() {
  return String(process.env.SITE_URL || "https://khamsa-site.vercel.app").trim().replace(/\/+$/, "");
}

// توقيع رابط التقييم: بدونه يستطيع أي أحد تخمين رقم طلب وكتابة تقييم
// باسم مشترٍ لم يشترِ. التوقيع يُشتق من مفتاح سري لا يغادر السيرفر.
function reviewToken(orderId) {
  const secret = process.env.REVIEW_SECRET
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.ADMIN_PASSWORD
    || "";
  return crypto.createHmac("sha256", secret)
    .update("review:" + String(orderId))
    .digest("base64url").slice(0, 32);
}

function checkReviewToken(orderId, token) {
  const want = Buffer.from(reviewToken(orderId));
  const got = Buffer.from(String(token || ""));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function reviewLink(orderId) {
  return siteUrl() + "/review?o=" + encodeURIComponent(orderId)
    + "&t=" + reviewToken(orderId);
}

async function sbFetch(path, options) {
  const url = process.env.SUPABASE_URL + "/rest/v1/" + path;
  const headers = Object.assign({
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
  }, (options && options.headers) || {});
  return fetch(url, Object.assign({}, options, { headers }));
}

// يرسل عبر Gmail (الافتراضي) أو Brevo إذا كان مفتاحه موجوداً
async function sendMail(opts) {
  if (process.env.BREVO_API_KEY && process.env.SENDER_EMAIL) return brevoSend(opts);
  return gmailSend(opts);
}

async function gmailSend({ toEmail, toName, subject, html, attachmentUrl, attachmentName }) {
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
  const mail = {
    from: { name: process.env.SENDER_NAME || "خمسة ديجيتال", address: process.env.GMAIL_USER },
    to: toName ? { name: toName, address: toEmail } : toEmail,
    subject: subject,
    html: html,
  };
  if (attachmentUrl) {
    mail.attachments = [{ filename: attachmentName || "file.pdf", path: attachmentUrl }];
  }
  await transport.sendMail(mail);
}

async function brevoSend({ toEmail, toName, subject, html, attachmentUrl, attachmentName }) {
  const payload = {
    sender: {
      name: process.env.SENDER_NAME || "خمسة ديجيتال",
      email: process.env.SENDER_EMAIL,
    },
    to: [{ email: toEmail, name: toName || undefined }],
    subject: subject,
    htmlContent: html,
  };
  if (attachmentUrl) {
    payload.attachment = [{ url: attachmentUrl, name: attachmentName || "file.pdf" }];
  }
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("Brevo " + r.status + ": " + t);
  }
  return r.json();
}

function brandWrap(bodyHtml) {
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><body style="margin:0;background:#FAF7F0;font-family:Tahoma,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#14504E;border-radius:16px 16px 0 0;padding:22px;text-align:center">
      <div style="color:#fff;font-size:24px;font-weight:bold">خمسة <span style="color:#C9A227">ديجيتال</span></div>
      <div style="color:#B9D2CF;font-size:13px;margin-top:4px">منتجات رقمية عربية أصيلة</div>
    </div>
    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:26px;color:#22312F;font-size:15px;line-height:1.9">
      ${bodyHtml}
    </div>
    <div style="text-align:center;color:#9FB3AF;font-size:12px;padding:16px">© خمسة ديجيتال — وصلك هذا الإيميل لأنك مسجل في قائمتنا البريدية</div>
  </div></body></html>`;
}

module.exports = {
  adminToken, isAuthed, sbFetch, sendMail, brevoSend, gmailSend, brandWrap,
  siteUrl, reviewToken, checkReviewToken, reviewLink,
};
