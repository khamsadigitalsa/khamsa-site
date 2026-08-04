"""مولّد صفحات المنتجات وخريطة الموقع.

لماذا مولّد ولا صفحات مكتوبة باليد؟ لأن بيانات المنتجات تعيش في مكانين
أصلاً (index.html للعرض، api/_delivery.js للتسليم)، وكتابة نسخة ثالثة
يدوياً يعني أن أي تغيير سعر سيُنسى في مكان ما. هنا نقرأ من المصدرين
مباشرة، فلا توجد نسخة ثالثة تتقادم.

    python tools/build_seo.py

يُنتج:
    p/<key>.html   صفحة مستقلة لكل منتج (محتوى فريد + Product JSON-LD)
    sitemap.xml    خريطة الموقع لكل الصفحات القابلة للفهرسة

شغّله بعد أي تعديل على المنتجات أو الأسعار، ثم ارفع الناتج.
"""
import datetime
import html
import pathlib
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://khamsa-site.vercel.app"   # غيّره لو ربطت نطاقاً خاصاً
BRAND = "خمسة ديجيتال"

E = lambda s: html.escape(str(s), quote=True)


# ───────────────────────── قراءة المصادر ─────────────────────────

def read_products():
    """يقرأ مصفوفة PRODUCTS من index.html.

    نستخرج كل حقل بتعبير نمطي مستقل بدل محاولة تحويل الكائن إلى JSON،
    لأن مفاتيحه غير مقتبسة (key: بدل "key":) فلا يقبلها json.loads.
    """
    src = (ROOT / "index.html").read_text(encoding="utf-8")
    m = re.search(r"const PRODUCTS = \[(.*?)\n\];", src, re.S)
    if not m:
        raise SystemExit("لم أجد مصفوفة PRODUCTS في index.html")

    out = []
    for block in re.findall(r"\{(.*?)\},?\s*(?=\n|$)", m.group(1), re.S):
        def txt(field):
            mm = re.search(field + r':\s*"([^"]*)"', block)
            return mm.group(1) if mm else ""

        def num(field):
            mm = re.search(field + r":\s*(\d+)", block)
            return int(mm.group(1)) if mm else None

        key = txt("key")
        if not key:
            continue
        out.append({
            "key": key, "img": txt("img"), "name": txt("name"), "desc": txt("desc"),
            "cat": txt("cat"), "tag": txt("tag"),
            "price": num("price"), "old": num("old"),
        })
    return out


def read_files_map():
    """يقرأ من api/_delivery.js: أسماء الملفات ومسمياتها، وملفات كل منتج.

    قيمة files قد تكون مصفوفة حرفية أو اختصاراً (KIDS_ALL / Object.keys(FILES))،
    فنفكّ الاختصارين يدوياً — وهما الوحيدان المستخدمان في الملف.
    """
    src = (ROOT / "api" / "_delivery.js").read_text(encoding="utf-8")

    labels = dict(re.findall(r'"([^"]+\.\w+)":\s*"([^"]+)"', src))

    kids_all = []
    m = re.search(r"const KIDS_ALL = \[(.*?)\];", src, re.S)
    if m:
        kids_all = re.findall(r'"([^"]+)"', m.group(1))

    per_product = {}
    m = re.search(r"const PRODUCTS = \{(.*?)\n\};", src, re.S)
    if m:
        # الترتيب مقصود: Object.keys(FILES) قبل \w+ وإلا التقط \w+ كلمة
        # "Object" وحدها وضاع الفرع الصحيح (بدائل re مرتّبة لا أطول تطابقاً)
        for key, expr in re.findall(r'"([\w-]+)":\s*\{[^}]*?files:\s*(\[[^\]]*\]|Object\.keys\(FILES\)|\w+)',
                                    m.group(1), re.S):
            expr = expr.strip()
            if expr.startswith("["):
                per_product[key] = re.findall(r'"([^"]+)"', expr)
            elif expr == "KIDS_ALL":
                per_product[key] = list(kids_all)
            elif expr.startswith("Object.keys"):
                per_product[key] = list(labels.keys())
    return labels, per_product


# ───────────────────────── محتوى الصفحة ─────────────────────────

CAT_INTRO = {
    "kids": "كراسة تعليمية عربية للأطفال — جاهزة للطباعة في البيت أو الروضة، "
            "بخط عربي واضح وتصميم من اليمين لليسار من الصفر، مو ترجمة لملف أجنبي.",
    "adult": "ملف تنظيم وإنتاجية بالعربي — تستخدمه على جهازك مباشرة أو تطبعه، "
             "مصمم لاحتياج المستخدم الخليجي لا مترجماً عن قوالب جاهزة.",
    "bundle": "حزمة توفير: تجمع عدة منتجات بسعر أقل من شرائها منفصلة، "
              "وتوصلك كلها دفعة واحدة على بريدك بعد الدفع مباشرة.",
}

CAT_WORD = {"kids": "كراسات الأطفال", "adult": "ملفات الإنتاجية", "bundle": "الحزم"}

FAQ = [
    ("كيف يوصلني الملف بعد الدفع؟",
     "تلقائياً خلال ثوانٍ: تظهر لك روابط التحميل في الصفحة مباشرة، "
     "وتصلك نسخة منها على بريدك الإلكتروني. الروابط صالحة 7 أيام — حمّلها واحفظها في جهازك."),
    ("هل الملف عربي أصلاً أم مترجم؟",
     "عربي أصيل. صُمّم من اليمين لليسار من البداية بخطوط عربية، "
     "وليس قالباً أجنبياً مترجماً بحروف مقلوبة."),
    ("هل أدفع مرة واحدة فقط؟",
     "نعم. الدفع مرة واحدة، والملف لك للأبد. وأي تحديث مستقبلي لنفس المنتج يوصلك مجاناً على بريدك."),
    ("ما طرق الدفع المتاحة؟",
     "مدى، آبل باي، فيزا وماستركارد عبر بوابة دفع مرخصة من البنك المركزي السعودي. "
     "وتقدر تطلب عبر واتساب إذا كان أريح لك."),
    ("هل يمكن استرجاع المنتج الرقمي؟",
     "المنتجات الرقمية غير قابلة للاسترجاع بعد التحميل بطبيعتها، "
     "لكن إذا واجهت أي مشكلة تقنية في الملف تواصل معنا خلال 7 أيام ونحلها أو نرجّع مبلغك."),
]


def head(title, description, canonical, image, extra_ld=""):
    return f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{E(title)}</title>
<meta name="description" content="{E(description)}">
<link rel="canonical" href="{E(canonical)}">
<meta name="theme-color" content="#14504E">
<meta property="og:type" content="product">
<meta property="og:site_name" content="{E(BRAND)}">
<meta property="og:locale" content="ar_SA">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(description)}">
<meta property="og:url" content="{E(canonical)}">
<meta property="og:image" content="{E(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{E(title)}">
<meta name="twitter:description" content="{E(description)}">
<meta name="twitter:image" content="{E(image)}">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
{extra_ld}
</head>
<body>
<nav class="nav">
  <div class="wrap nav-inner">
    <a href="/" class="brand"><img src="/logo.png" alt="{E(BRAND)}"><span>خمسة <b>ديجيتال</b></span></a>
    <div class="nav-links">
      <a href="/#products">المنتجات</a>
      <a href="/#why">ليش نحن؟</a>
      <a href="/policies">الشروط</a>
    </div>
    <a class="btn btn-wa" href="/#products">تصفح المتجر</a>
  </div>
</nav>
"""


FOOT = f"""
<footer class="footer">
  <div class="wrap foot-inner">
    <img src="/logo.png" alt="{E(BRAND)}" class="foot-logo">
    <div class="foot-links">
      <a href="/#products">🛍️ كل المنتجات</a>
      <a href="/policies">📄 الشروط والسياسات</a>
      <a href="/#subscribe">🎁 الهدية المجانية</a>
    </div>
    <p class="copy">© <span id="year"></span> {E(BRAND)} — جميع الحقوق محفوظة</p>
  </div>
</footer>
<script>document.getElementById("year").textContent = new Date().getFullYear();</script>
</body>
</html>
"""


def product_page(p, labels, files):
    url = f"{SITE}/p/{p['key']}"
    img_abs = f"{SITE}/products/{p['img']}"
    my_files = files.get(p["key"], [])
    n = len(my_files)

    # امتدادات الملفات محتوى فريد وصادق لكل صفحة، ويجيب عن أول سؤال يسأله المشتري
    exts = []
    for f in my_files:
        e = f.rsplit(".", 1)[-1].upper()
        if e not in exts:
            exts.append(e)
    fmt = " و".join(exts) if exts else "PDF"

    title = f"{p['name']} — {p['price']} ر.س | {BRAND}"
    desc = f"{p['desc']}. تحميل فوري بصيغة {fmt}، عربي أصيل، وتحديثات مجانية مدى الحياة."

    ld_product = {
        "name": p["name"], "desc": desc, "img": img_abs, "url": url,
        "price": p["price"], "cat": CAT_WORD.get(p["cat"], "منتجات رقمية"),
    }

    ld = f"""<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@graph": [
    {{
      "@type": "Product",
      "@id": "{url}#product",
      "name": {jstr(p['name'])},
      "description": {jstr(desc)},
      "image": "{img_abs}",
      "sku": "{p['key']}",
      "category": "{ld_product['cat']}",
      "brand": {{ "@type": "Brand", "name": {jstr(BRAND)} }},
      "offers": {{
        "@type": "Offer",
        "url": "{url}",
        "price": "{p['price']}",
        "priceCurrency": "SAR",
        "availability": "https://schema.org/InStock",
        "itemCondition": "https://schema.org/NewCondition",
        "seller": {{ "@type": "Organization", "name": {jstr(BRAND)} }}
      }}
    }},
    {{
      "@type": "BreadcrumbList",
      "itemListElement": [
        {{ "@type": "ListItem", "position": 1, "name": "الرئيسية", "item": "{SITE}/" }},
        {{ "@type": "ListItem", "position": 2, "name": {jstr(ld_product['cat'])}, "item": "{SITE}/#products" }},
        {{ "@type": "ListItem", "position": 3, "name": {jstr(p['name'])} }}
      ]
    }},
    {{
      "@type": "FAQPage",
      "mainEntity": [
        {",".join(faq_ld(q, a) for q, a in FAQ)}
      ]
    }}
  ]
}}
</script>"""

    save = ""
    if p["old"]:
        save = (f'<div class="pd-save">وفّر {p["old"] - p["price"]} ريالاً '
                f'— بدلاً من {p["old"]} ر.س</div>')

    files_list = "".join(
        f'<li><b>{E(labels.get(f, f))}</b> <span class="pd-ext">{E(f.rsplit(".", 1)[-1].upper())}</span></li>'
        for f in my_files
    ) or "<li>يصلك الملف كاملاً على بريدك بعد الدفع مباشرة</li>"

    faq_html = "".join(
        f'<details class="pd-faq"><summary>{E(q)}</summary><p>{E(a)}</p></details>'
        for q, a in FAQ
    )

    return head(title, desc, url, img_abs, ld) + f"""
<main class="pd-wrap wrap">
  <nav class="pd-crumbs" aria-label="مسار التصفح">
    <a href="/">الرئيسية</a> ← <a href="/#products">{E(CAT_WORD.get(p['cat'], 'المنتجات'))}</a> ← <span>{E(p['name'])}</span>
  </nav>

  <div class="pd-top">
    <div class="pd-media">
      <img src="/products/{E(p['img'])}" alt="{E(p['name'])}" width="600" height="600">
    </div>
    <div class="pd-info">
      {'<span class="badge">' + E(p['tag']) + '</span>' if p['tag'] else ''}
      <h1>{E(p['name'])}</h1>
      <p class="pd-lead">{E(p['desc'])}</p>
      <div class="pd-price">
        {'<s>' + str(p['old']) + '</s> ' if p['old'] else ''}<b>{p['price']}</b> ر.س
      </div>
      {save}
      <a class="btn btn-primary pd-cta" href="/checkout?p={E(p['key'])}">اطلب الآن وحمّله فوراً 🛒</a>
      <ul class="pd-trust">
        <li>⚡ تحميل فوري بعد الدفع — بدون انتظار</li>
        <li>🔄 تحديثات مجانية مدى الحياة على بريدك</li>
        <li>💳 مدى · آبل باي · فيزا وماستركارد</li>
      </ul>
    </div>
  </div>

  <section class="pd-sec">
    <h2>وش يوصلك بالضبط؟</h2>
    <p>{E(CAT_INTRO.get(p['cat'], CAT_INTRO['adult']))}</p>
    <p class="pd-meta">عدد الملفات: <b>{n if n else '—'}</b> · الصيغة: <b>{E(fmt)}</b> · اللغة: <b>العربية</b></p>
    <ul class="pd-files">{files_list}</ul>
  </section>

  <section class="pd-sec">
    <h2>ليش تشتريه من {E(BRAND)}؟</h2>
    <ul class="pd-why">
      <li><b>عربي من الصفر.</b> التصميم من اليمين لليسار بخطوط عربية — مو قالباً أجنبياً مترجماً تنكسر فيه الحروف.</li>
      <li><b>تدفع مرة وتملكه للأبد.</b> بلا اشتراك شهري ولا رسوم متكررة.</li>
      <li><b>التحديثات مجانية.</b> أي تطوير على المنتج يوصلك على نفس البريد بلا مقابل.</li>
      <li><b>دعم حقيقي.</b> إذا ما وصلك الملف أو واجهت مشكلة، كلمنا واتساب ونحلها.</li>
    </ul>
  </section>

  <section class="pd-sec">
    <h2>أسئلة شائعة</h2>
    {faq_html}
  </section>

  <section class="pd-sec pd-more">
    <h2>منتجات ذات صلة</h2>
    <div class="pd-related">__RELATED__</div>
    <p style="margin-top:14px"><a class="link-arrow" href="/#products">شوف كل المنتجات</a></p>
  </section>
</main>
""" + FOOT


def jstr(s):
    """نص آمن داخل JSON-LD."""
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def faq_ld(q, a):
    return ('{ "@type": "Question", "name": ' + jstr(q) +
            ', "acceptedAnswer": { "@type": "Answer", "text": ' + jstr(a) + ' } }')


def related_html(current, products):
    same = [x for x in products if x["cat"] == current["cat"] and x["key"] != current["key"]]
    others = [x for x in products if x["cat"] != current["cat"]]
    picks = (same + others)[:4]
    return "".join(
        f'<a class="pd-rel" href="/p/{E(x["key"])}">'
        f'<img loading="lazy" src="/products/{E(x["img"])}" alt="{E(x["name"])}" width="200" height="200">'
        f'<b>{E(x["name"])}</b><span>{x["price"]} ر.س</span></a>'
        for x in picks
    )


# ───────────────────────── التشغيل ─────────────────────────

def main():
    products = read_products()
    labels, files = read_files_map()
    out_dir = ROOT / "p"
    out_dir.mkdir(exist_ok=True)

    for p in products:
        page = product_page(p, labels, files).replace("__RELATED__", related_html(p, products))
        (out_dir / f"{p['key']}.html").write_text(page, encoding="utf-8")

    today = datetime.date.today().isoformat()
    urls = [(f"{SITE}/", "1.0", "weekly"), (f"{SITE}/policies", "0.3", "yearly")]
    urls += [(f"{SITE}/p/{p['key']}", "0.8", "monthly") for p in products]

    sitemap = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">'.replace(
                   "www.sitemap.org", "www.sitemaps.org")]
    for loc, pri, freq in urls:
        sitemap.append(f"  <url><loc>{loc}</loc><lastmod>{today}</lastmod>"
                       f"<changefreq>{freq}</changefreq><priority>{pri}</priority></url>")
    sitemap.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(sitemap) + "\n", encoding="utf-8")

    print(f"  {len(products)} صفحة منتج في p/")
    print(f"  sitemap.xml بـ {len(urls)} رابطاً")
    missing = [p["key"] for p in products if not files.get(p["key"])]
    if missing:
        print("  ! منتجات بلا ملفات معروفة: " + "، ".join(missing))


if __name__ == "__main__":
    main()
