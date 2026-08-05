"""خادم تطوير محلي لموقع خمسة ديجيتال.

يحاكي سلوك Vercel المهم للاختبار:
  • cleanUrls — ‎/checkout يفتح checkout.html بلا امتداد
  • ‎/api/* — يرد بخطأ مفهوم بدل التعليق، لأن دوال Node لا تعمل هنا

الغرض منه فحص الواجهة والتنقّل فقط (أزرار الطلب، صفحة الدفع، خانة الخصم).
الدفع والتسليم الحقيقيان يحتاجان النشر على Vercel.

    python tools/devserver.py            # http://127.0.0.1:8090
"""
import argparse
import json
import pathlib
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        print("  " + fmt % args)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_stub(self):
        self._json(503, {
            "error": "الـ API لا يعمل محلياً (يحتاج Node على Vercel) — "
                     "هذا الخادم للواجهة فقط",
        })

    # نقطتان تقرأهما كل صفحة عند فتحها (الفوتر وشارة تمارا).
    # نردّ عليهما ببيانات وهمية حتى تظهر الواجهة محلياً كما ستظهر بعد النشر.
    def _api_mock(self, path):
        if path.startswith("/api/settings"):
            return {
                "whatsapp": "966548133555",
                "orderPage": "https://waslati.com/khamsa",
                "social": {
                    "tiktok": "https://tiktok.com/@khamsadigital",
                    "instagram": "https://instagram.com/khamsadigital",
                    "snapchat": "https://snapchat.com/add/khamsadigital",
                    "x": "https://x.com/khamsadigital",
                    "youtube": "https://youtube.com/@khamsadigital",
                },
                # للفحص المحلي: letters تاخذ الأوتوماتيكي، interactive مخفية بـ"-"،
                # story يدوي — يغطي الفروع الثلاثة لمنطق badgeFor
                "badges": {
                    "mode": "auto",
                    "manual": {"story": "وصل حديثاً 🌟", "interactive": "-"},
                    "auto": {"letters": "الأكثر مبيعاً 🔥", "budget": "الأكثر طلباً"},
                },
                "tracking": {},
            }
        if path.startswith("/api/tamara-config") or "op=config" in path:
            methods = [
                {"type": "PAY_BY_INSTALMENTS", "instalments": 4, "min": 100, "max": 5000},
                {"type": "PAY_BY_LATER", "instalments": None, "min": 100, "max": 2500},
            ]
            amount = 0.0
            if "?" in path:
                for part in path.split("?", 1)[1].split("&"):
                    k, _, v = part.partition("=")
                    if k in ("amount", "a"):
                        try:
                            amount = float(v)
                        except ValueError:
                            amount = 0.0
            fit = [m for m in methods
                   if amount >= m["min"] and (not m["max"] or amount <= m["max"])]
            pick = fit[0] if fit else None
            return {
                "enabled": True, "min": 100, "max": 5000, "methods": methods,
                "available": bool(pick) if amount > 0 else None,
                "method": pick["type"] if pick else None,
                "instalments": pick["instalments"] if pick else None,
            }
        # تقييمات وهمية لفحص الواجهة محلياً فقط — الخادم الحقيقي
        # لا يرجّع شيئاً إلا من تقييمات معتمدة في قاعدة البيانات
        if path.startswith("/api/reviews"):
            if "op=summary" in path:
                return {"products": {"letters": {"count": 3, "average": 4.7},
                                     "bundle-everything": {"count": 1, "average": 5}}}
            if "op=list" in path:
                if "product=letters" not in path:
                    return {"reviews": [], "count": 0, "average": 0}
                return {"count": 3, "average": 4.7, "reviews": [
                    {"name": "أم سارة", "rating": 5, "verified": True,
                     "body": "بنتي أحبتها وصارت تطلبها كل يوم. الخط واضح والورق ينطبع زين.",
                     "created_at": "2026-08-01T10:00:00Z"},
                    {"name": "خالد", "rating": 5, "verified": True, "body": "وصلني فوراً بعد الدفع.",
                     "created_at": "2026-07-28T10:00:00Z"},
                    {"name": "نورة", "rating": 4, "verified": False,
                     "body": "حلوة، بس ودي لو فيها صفحات أكثر.",
                     "created_at": "2026-07-20T10:00:00Z"},
                ]}
            if "op=check" in path:
                return {"ok": True, "productKey": "letters",
                        "productName": "كراسة الحروف والأرقام", "already": False, "status": None}
            if "op=pending" in path:
                return {"reviews": [
                    {"id": "1", "product": "letters", "productName": "كراسة الحروف والأرقام",
                     "email": "um.sara@example.com", "name": "أم سارة", "rating": 5,
                     "body": "بنتي أحبتها وصارت تطلبها كل يوم.", "verified": True,
                     "status": "pending", "created_at": "2026-08-04T10:00:00Z"},
                    {"id": "2", "product": "budget", "productName": "ميزانيتي الذكية (إكسل)",
                     "email": "free@example.com", "name": "", "rating": 3, "body": "",
                     "verified": False, "status": "approved", "created_at": "2026-08-02T10:00:00Z"},
                ]}
        return None

    def do_POST(self):
        if self.path.startswith("/api/"):
            if self.path.startswith("/api/settings"):
                return self._json(200, {"ok": True, "message": "✅ تم الحفظ (محاكاة محلية)"})
            if self.path.startswith("/api/reviews") and "op=submit" in self.path:
                return self._json(200, {"ok": True,
                                        "message": "وصلنا تقييمك — يظهر بعد مراجعته. شكراً لك 💚"})
            if self.path.startswith("/api/reviews") and "op=moderate" in self.path:
                return self._json(200, {"ok": True, "message": "✅ اعتُمد ويظهر الآن في صفحة المنتج"})
            return self._api_stub()
        self.send_error(405)

    def do_GET(self):
        if self.path.startswith("/api/"):
            mock = self._api_mock(self.path)
            if mock is not None:
                return self._json(200, mock)
            return self._api_stub()
        # cleanUrls: أضف .html إذا كان الملف موجوداً بهذا الاسم
        path = self.path.split("?")[0].strip("/")
        if path and not pathlib.Path(path).suffix:
            candidate = ROOT / (path + ".html")
            if candidate.is_file():
                self.path = "/" + path + ".html" + (
                    "?" + self.path.split("?", 1)[1] if "?" in self.path else "")
        return super().do_GET()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8090)
    args = ap.parse_args()
    print(f"\n  خمسة ديجيتال (واجهة فقط)  →  http://127.0.0.1:{args.port}\n")
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as s:
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            print("\n  توقّف")


if __name__ == "__main__":
    main()
