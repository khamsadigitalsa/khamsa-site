"""تحقق من منطق الخصم دون الحاجة لتشغيل الموقع.

يختبر أمرين تنكسر فيهما الأمور عادةً:
  1. تحليل رقم الطلب — مفاتيح المنتجات تحتوي شرطات (bundle-tasees) وقد تلتبس
     مع فواصل رقم الطلب.
  2. حساب السعر بعد الخصم — خصوصاً 100% الذي يجب أن يعطي صفراً بالضبط.

    python tools/discount_check.py
"""
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# نفس التعبيرين الموجودين في api/verify-pay.js
PAT_NEW = re.compile(r"^KH-D(\d{1,3})C([A-Z0-9]*)-(.+)-([A-Za-z0-9_-]+)-\d*$")
PAT_OLD = re.compile(r"^KH-(.+)-([A-Za-z0-9_-]+)-\d*$")

import math


def js_round(x):
    """يحاكي Math.round في جافاسكربت: النصف يُقرَّب لأعلى دائماً.

    round() في بايثون تقرّب النصف للزوجي (74.5 → 74) بينما جافاسكربت تعطي 75،
    فمحاكاتها بـ round() تنتج فرقاً وهمياً في الفحص.
    """
    return math.floor(x + 0.5)


# نفس الحساب الموجود في api/_discounts.js
def final_price(price, percent):
    p = max(0, min(100, percent))
    return max(0, js_round(price * (100 - p) / 100))


def main():
    bad = 0
    print("\n  ── تحليل رقم الطلب ──")
    cases = [
        (100, "FREE100", "bundle-everything", "c2FhZEBnbWFpbC5jb20", 0),
        (0, "", "letters", "YWJjQGQuY29t", 12),
        (25, "EID25", "bundle-tasees", "eF95LXpAYS5jb20", 7),
        (50, "A1", "cv", "dGVzdEB0LmNvbQ", 3),
        (5, "RAMADAN2026", "bundle-library", "bG9uZy1lbWFpbF9uYW1l", 99),
    ]
    for pct, code, product, eb, n in cases:
        s = f"KH-D{pct}C{code}-{product}-{eb}-{n}"
        m = PAT_NEW.match(s)
        ok = bool(m) and int(m.group(1)) == pct and m.group(2) == code \
            and m.group(3) == product and m.group(4) == eb
        print(f"    {'OK  ' if ok else 'خطأ '} {s}")
        if not ok:
            print(f"          حُلّل إلى {m.groups() if m else None}")
            bad += 1

    legacy = "KH-bundle-tasees-YWJj-4"
    m = PAT_OLD.match(legacy)
    ok = bool(m) and m.group(1) == "bundle-tasees"
    print(f"    {'OK  ' if ok else 'خطأ '} صيغة قديمة: {legacy}")
    bad += not ok

    print("\n  ── السعر بعد الخصم ──")
    price_cases = [
        (19, 0, 19), (19, 100, 0), (149, 50, 75), (99, 25, 74),
        (29, 10, 26), (19, 99, 0), (79, 33, 53), (49, 100, 0),
    ]
    for price, pct, want in price_cases:
        got = final_price(price, pct)
        ok = got == want
        print(f"    {'OK  ' if ok else 'خطأ '} {price} ر.س − {pct}% = {got}"
              + ("" if ok else f"  (متوقّع {want})"))
        bad += not ok

    print("\n  ── قواعد الأمان ──")
    rules = [
        ("خصم 100% يعطي صفراً فيمتنع مسار الدفع", final_price(19, 100) == 0),
        ("خصم 99% يبقى فوق الصفر فلا يمر مجاناً", final_price(1000, 99) > 0),
        ("النسبة تُقصّ عند 100 مهما أُرسل", final_price(19, 250) == 0),
        ("النسبة السالبة لا ترفع السعر", final_price(19, -50) == 19),
    ]
    for label, ok in rules:
        print(f"    {'OK  ' if ok else 'خطأ '} {label}")
        bad += not ok

    print(f"\n  {'كل الفحوص نجحت ✓' if not bad else f'{bad} فحص فشل ✗'}\n")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
