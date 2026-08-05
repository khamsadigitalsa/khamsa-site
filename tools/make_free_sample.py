"""يقصّ الهدية المجانية من كراسة الحروف الأصلية.

الهدية ليست ملفاً منفصلاً يُصمَّم مرتين — هي أول صفحات المنتج الحقيقي نفسه،
فتعطي المشترك طعم الجودة الفعلية وتقوده لشراء الكراسة كاملة.

    python tools/make_free_sample.py

يكتب الناتج في مجلد الرفع نفسه، ثم يرفعه سكربت الرفع المعتاد:
    python tools/upload_files.py
"""
import pathlib
import sys

from pypdf import PdfReader, PdfWriter

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "khamsa-files-upload" / "f06-letters-numbers.pdf"
OUT = ROOT.parent / "khamsa-files-upload" / "f00-free-letters-sample.pdf"

# الغلاف + أول 3 صفحات تدريب — كافية ليجرّبها الطفل فعلاً، وقليلة
# بما يكفي ليبقى للكراسة الكاملة (28 حرفاً) سببُ شراء واضح
PAGES = [0, 1, 2, 3]


def main():
    if not SRC.exists():
        raise SystemExit(f"الملف المصدر غير موجود: {SRC}")
    reader = PdfReader(str(SRC))
    writer = PdfWriter()
    for i in PAGES:
        writer.add_page(reader.pages[i])
    with open(OUT, "wb") as f:
        writer.write(f)
    kb = OUT.stat().st_size // 1024
    print(f"  {OUT.name}: {len(PAGES)} صفحات من أصل {len(reader.pages)} — {kb} KB")
    print("  الخطوة التالية: python tools/upload_files.py")


if __name__ == "__main__":
    main()
