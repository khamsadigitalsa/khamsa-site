"""رفع ملفات المنتجات إلى Supabase Storage — وفحص الناقص منها.

سبب وجود هذا الملف: صفحة التسليم تفشل برسالة
    sign failed for f06-letters-numbers.pdf: 400 ... "code":"NoSuchKey"
ومعناها أن الملف غير موجود أصلاً في مخزن Supabase، فلا يمكن توقيع رابط له.

يستخدم مكتبات بايثون القياسية فقط — لا يحتاج تثبيت أي شيء.

    # فحص فقط: يعرض الموجود والناقص دون رفع
    python tools/upload_files.py --check

    # رفع الناقص
    python tools/upload_files.py

    # إعادة رفع الكل (استبدال)
    python tools/upload_files.py --force

يقرأ المفاتيح من متغيّرات البيئة أو من وسائط سطر الأوامر:
    SUPABASE_URL          رابط المشروع، مثل https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY  مفتاح service_role  (السري — لا تشاركه)
"""
import argparse
import json
import mimetypes
import os
import pathlib
import sys
import urllib.error
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

BUCKET = "files"

# أسماء الملفات كما ينتظرها api/_delivery.js — أي اختلاف بحرف واحد يكسر التسليم
EXPECTED = [
    "f00-free-letters-sample.pdf",   # الهدية المجانية — يولّدها tools/make_free_sample.py
    "f01-interactive-planner.pdf", "f02-budget.xlsx", "f03-daily-planner.pdf",
    "f04-cv-arabic.docx", "f05-cv-english.docx", "f06-letters-numbers.pdf",
    "f07-numbers-1-20.pdf", "f08-first-words.pdf", "f09-shapes-colors.pdf",
    "f10-animals-coloring.pdf", "f11-arnoub-story.pdf", "f12-mazes.pdf",
    "f13-letter-hunt.pdf", "f14-flashcards.pdf", "f15-star-chart.pdf",
    "f16-ramadan-kids.pdf",
]

DEFAULT_SRC = (pathlib.Path(__file__).resolve().parent.parent.parent
               / "khamsa-files-upload")


def req(url, key, method="GET", data=None, ctype=None, extra=None):
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("apikey", key)
    r.add_header("Authorization", "Bearer " + key)
    if ctype:
        r.add_header("Content-Type", ctype)
    for k, v in (extra or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        return 0, str(e).encode()


def ensure_bucket(base, key):
    status, body = req(f"{base}/storage/v1/bucket/{BUCKET}", key)
    if status == 200:
        info = json.loads(body or b"{}")
        return "exists", info.get("public", False)
    status, body = req(
        f"{base}/storage/v1/bucket", key, "POST",
        json.dumps({"name": BUCKET, "id": BUCKET, "public": False}).encode(),
        "application/json")
    if status in (200, 201):
        return "created", False
    return f"error {status}: {body[:200].decode('utf-8', 'replace')}", None


def listing(base, key):
    """أسماء الملفات الموجودة فعلاً في المخزن."""
    status, body = req(
        f"{base}/storage/v1/object/list/{BUCKET}", key, "POST",
        json.dumps({"prefix": "", "limit": 500,
                    "sortBy": {"column": "name", "order": "asc"}}).encode(),
        "application/json")
    if status != 200:
        return None, f"{status}: {body[:200].decode('utf-8', 'replace')}"
    return {o["name"] for o in json.loads(body)}, None


def upload(base, key, path, name):
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    status, body = req(f"{base}/storage/v1/object/{BUCKET}/{name}", key, "POST",
                       path.read_bytes(), ctype, {"x-upsert": "true"})
    if status in (200, 201):
        return True, ""
    return False, f"{status}: {body[:160].decode('utf-8', 'replace')}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("SUPABASE_URL", ""))
    ap.add_argument("--key", default=os.environ.get("SUPABASE_SERVICE_KEY", ""))
    ap.add_argument("--src", default=str(DEFAULT_SRC))
    ap.add_argument("--check", action="store_true", help="فحص بدون رفع")
    ap.add_argument("--force", action="store_true", help="إعادة رفع الموجود أيضاً")
    a = ap.parse_args()

    base = a.url.rstrip("/")
    if not base or not a.key:
        print("\n  ✗ ناقص SUPABASE_URL أو SUPABASE_SERVICE_KEY.\n")
        print("    خذهما من Supabase → Settings → API، ثم:\n")
        print('      set SUPABASE_URL=https://xxxx.supabase.co')
        print('      set SUPABASE_SERVICE_KEY=eyJ...')
        print("      python tools/upload_files.py\n")
        return 2

    src = pathlib.Path(a.src)
    print(f"\n  المشروع : {base}")
    print(f"  المصدر  : {src}")

    state, is_public = ensure_bucket(base, a.key)
    print(f"  المخزن  : {BUCKET} — {state}")
    if is_public:
        print("  ⚠ المخزن عام: أي شخص يخمّن الرابط يحمّل الملف بلا دفع."
              " اجعله Private من لوحة Supabase.")
    if state.startswith("error"):
        return 1

    have, err = listing(base, a.key)
    if err:
        print(f"  ✗ تعذّرت قراءة المخزن: {err}")
        return 1

    missing = [n for n in EXPECTED if n not in have]
    present = [n for n in EXPECTED if n in have]
    extra = sorted(have - set(EXPECTED))

    print(f"\n  موجود في المخزن : {len(present)}/{len(EXPECTED)}")
    if missing:
        print(f"  ناقص            : {len(missing)}")
        for n in missing:
            local = "موجود محلياً" if (src / n).is_file() else "✗ غير موجود محلياً"
            print(f"      - {n}   ({local})")
    if extra:
        print(f"  ملفات زائدة لا يستخدمها الموقع: {', '.join(extra)}")

    if a.check:
        print()
        return 0 if not missing else 1

    todo = EXPECTED if a.force else missing
    if not todo:
        print("\n  ✓ كل الملفات موجودة — لا شيء للرفع.\n")
        return 0

    print(f"\n  رفع {len(todo)} ملف…")
    failed = []
    for n in todo:
        p = src / n
        if not p.is_file():
            print(f"      ✗ {n} — غير موجود في {src}")
            failed.append(n)
            continue
        ok, msg = upload(base, a.key, p, n)
        size = p.stat().st_size / 1024
        print(f"      {'✓' if ok else '✗'} {n}  ({size:.0f} KB){'' if ok else '  ' + msg}")
        if not ok:
            failed.append(n)

    after, _ = listing(base, a.key)
    still = [n for n in EXPECTED if after and n not in after]
    print(f"\n  النتيجة: {len(EXPECTED) - len(still)}/{len(EXPECTED)} جاهزة في المخزن")
    if still:
        print(f"  ما زال ناقصاً: {', '.join(still)}")
        return 1
    print("  ✓ التسليم صار يشتغل — جرّب زر «تسليم الطلب الآن» في لوحة الإدارة.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
