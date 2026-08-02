const { adminToken } = require("./_lib.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const password = String((req.body || {}).password || "");
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "كلمة السر غير صحيحة" });
  }

  res.setHeader("Set-Cookie",
    "admin_token=" + adminToken() + "; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax; Secure");
  return res.status(200).json({ ok: true });
};
