// إدارة أكواد الخصم — للمالك فقط.
// GET                      عرض كل الأكواد
// POST {action:"create"}   إنشاء كود
// POST {action:"update"}   تعديل (نسبة / حد / انتهاء / تفعيل / منتج)
// POST {action:"delete"}   حذف
const { isAuthed, sbFetch } = require("./_lib.js");
const { PRODUCTS } = require("./_delivery.js");
const { normalize, CODE_RE } = require("./_discounts.js");

function cleanPercent(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : null;
}

function cleanExpiry(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function cleanProduct(v) {
  const s = String(v || "").trim();
  return s && PRODUCTS[s] ? s : null;   // null = يشمل كل المنتجات
}

module.exports = async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: "غير مصرّح" });

  try {
    if (req.method === "GET") {
      const r = await sbFetch("discounts?select=*&order=created_at.desc");
      if (!r.ok) return res.status(502).json({ error: "تعذّرت القراءة: " + (await r.text()).slice(0, 160) });
      return res.status(200).json({ discounts: await r.json() });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const b = req.body || {};
    const action = String(b.action || "").trim();
    const code = normalize(b.code);

    if (!CODE_RE.test(code)) {
      return res.status(400).json({ error: "الكود يجب أن يكون حروفاً إنجليزية كبيرة وأرقاماً فقط (2–24 خانة)" });
    }

    if (action === "delete") {
      const r = await sbFetch("discounts?code=eq." + encodeURIComponent(code), {
        method: "DELETE", headers: { Prefer: "return=minimal" },
      });
      if (!r.ok) return res.status(502).json({ error: "تعذّر الحذف" });
      return res.status(200).json({ ok: true, deleted: code });
    }

    if (action === "create") {
      const percent = cleanPercent(b.percent);
      if (percent === null) return res.status(400).json({ error: "النسبة يجب أن تكون بين 1 و100" });

      const row = {
        code: code,
        percent: percent,
        max_uses: b.max_uses === "" || b.max_uses == null ? null : Math.max(1, Math.round(Number(b.max_uses) || 1)),
        expires_at: cleanExpiry(b.expires_at),
        product: cleanProduct(b.product),
        active: b.active === false ? false : true,
        note: String(b.note || "").slice(0, 200),
      };
      const r = await sbFetch("discounts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      if (r.status === 409) return res.status(409).json({ error: "هذا الكود موجود مسبقاً" });
      if (!r.ok) return res.status(502).json({ error: "تعذّر الإنشاء: " + (await r.text()).slice(0, 160) });
      const created = await r.json();
      return res.status(201).json({ ok: true, discount: created[0] });
    }

    if (action === "update") {
      const patch = {};
      if (b.percent != null && b.percent !== "") {
        const p = cleanPercent(b.percent);
        if (p === null) return res.status(400).json({ error: "النسبة يجب أن تكون بين 1 و100" });
        patch.percent = p;
      }
      if ("max_uses" in b) {
        patch.max_uses = b.max_uses === "" || b.max_uses == null
          ? null : Math.max(1, Math.round(Number(b.max_uses) || 1));
      }
      if ("expires_at" in b) patch.expires_at = cleanExpiry(b.expires_at);
      if ("product" in b) patch.product = cleanProduct(b.product);
      if ("active" in b) patch.active = Boolean(b.active);
      if ("note" in b) patch.note = String(b.note || "").slice(0, 200);
      // إعادة ضبط العدّاد عند الطلب صراحةً
      if (b.reset_uses === true) patch.used_count = 0;

      if (!Object.keys(patch).length) return res.status(400).json({ error: "لا يوجد ما يُحدَّث" });

      const r = await sbFetch("discounts?code=eq." + encodeURIComponent(code), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) return res.status(502).json({ error: "تعذّر التحديث: " + (await r.text()).slice(0, 160) });
      const rowsOut = await r.json();
      if (!rowsOut.length) return res.status(404).json({ error: "الكود غير موجود" });
      return res.status(200).json({ ok: true, discount: rowsOut[0] });
    }

    return res.status(400).json({ error: "إجراء غير معروف" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
