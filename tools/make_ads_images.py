"""مولّد صور إعلانات Google Ads (Performance Max).

يركّب أغلفة المنتجات الحقيقية على خلفيات بألوان الهوية وينتج:
    ads/pmax-landscape-*.png   عريضة 1200×628 (نسبة 1.91:1)
    ads/pmax-square-brand.png  مربعة 1200×1200

بدون أي نص فوق الصور — قوقل يخفّض توزيع الصور المزدحمة بالنصوص،
والنصوص مكانها خانات العناوين والأوصاف في الحملة نفسها.

    python tools/make_ads_images.py
"""
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFilter

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "ads"
OUT.mkdir(exist_ok=True)

CREAM = (250, 247, 240, 255)
TEAL_DEEP = (15, 59, 58, 255)
TEAL = (31, 110, 107, 255)
GOLD = (201, 162, 39, 255)


def rounded(img, radius):
    """قصّ زوايا الصورة بشكل دائري عبر قناع ألفا."""
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def cover(name, height, radius=22):
    img = Image.open(ROOT / "products" / name).convert("RGB")
    w = round(img.width * height / img.height)
    return rounded(img.resize((w, height), Image.LANCZOS), radius)


def paste_card(canvas, card, xy, angle=0):
    """لصق بطاقة بظل ناعم — الظل يُرسم من قناع البطاقة نفسه بعد تدويرها."""
    if angle:
        card = card.rotate(angle, expand=True, resample=Image.BICUBIC)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sh = Image.new("RGBA", card.size, (0, 0, 0, 0))
    sh.paste((15, 25, 24, 110), mask=card.getchannel("A"))
    shadow.paste(sh, (xy[0] + 6, xy[1] + 16), sh)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(card, xy)


def soft_circle(canvas, center, r, color, alpha, blur=120):
    """هالة لونية ناعمة تعطي عمقاً للخلفية بدون تشويش."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        [center[0] - r, center[1] - r, center[0] + r, center[1] + r],
        fill=color[:3] + (alpha,))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def gradient_bg(size, top, bottom):
    col = Image.new("RGBA", (1, size[1]))
    for y in range(size[1]):
        t = y / (size[1] - 1)
        col.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    return col.resize(size)


def add_logo(canvas, xy, size=86):
    logo = Image.open(ROOT / "logo.png").convert("RGBA").resize((size, size), Image.LANCZOS)
    paste_card(canvas, rounded(logo.convert("RGB"), size // 4), xy)


def banner_kids():
    """كراسات الأطفال على خلفية كريمية دافئة."""
    c = Image.new("RGBA", (1200, 628), CREAM)
    soft_circle(c, (1050, 80), 260, GOLD, 70)
    soft_circle(c, (120, 560), 300, TEAL, 55)
    paste_card(c, cover("p05.jpg", 400), (95, 120), -6)
    paste_card(c, cover("p11.jpg", 380), (455, 140), 3)
    paste_card(c, cover("p09.jpg", 360), (800, 160), -3)
    add_logo(c, (40, 36))
    c.convert("RGB").save(OUT / "pmax-landscape-kids.png", optimize=True)


def banner_adults():
    """البلانرات وملفات الإنتاجية على تدرّج تركوازي غامق."""
    c = gradient_bg((1200, 628), TEAL_DEEP, TEAL)
    soft_circle(c, (1080, 540), 280, GOLD, 60)
    paste_card(c, cover("p01.jpg", 410), (105, 115), -5)
    paste_card(c, cover("p02.jpg", 380), (470, 145), 4)
    paste_card(c, cover("p03.jpg", 355), (815, 165), -2)
    add_logo(c, (40, 36))
    c.convert("RGB").save(OUT / "pmax-landscape-adults.png", optimize=True)


def banner_mix():
    """تشكيلة من المتجر كله — خمسة أغلفة في صف متموج."""
    c = Image.new("RGBA", (1200, 628), CREAM)
    soft_circle(c, (600, -80), 380, TEAL, 45)
    soft_circle(c, (1120, 600), 240, GOLD, 65)
    names = ["p05.jpg", "p01.jpg", "p10.jpg", "p02.jpg", "p14.jpg"]
    angles = [-5, 4, -3, 5, -4]
    x = 42
    for i, (n, a) in enumerate(zip(names, angles)):
        y = 160 + (26 if i % 2 else 0)
        paste_card(c, cover(n, 318), (x, y), a)
        x += 220
    add_logo(c, (40, 36))
    c.convert("RGB").save(OUT / "pmax-landscape-mix.png", optimize=True)


def square_brand():
    """مربعة 1200×1200: الشعار يتوسط أربعة أغلفة."""
    c = gradient_bg((1200, 1200), TEAL_DEEP, TEAL)
    soft_circle(c, (1050, 150), 300, GOLD, 55)
    soft_circle(c, (150, 1050), 320, (46, 154, 143, 255), 60)
    paste_card(c, cover("p05.jpg", 430), (120, 105), -6)
    paste_card(c, cover("p01.jpg", 430), (650, 120), 5)
    paste_card(c, cover("p02.jpg", 430), (110, 660), 4)
    paste_card(c, cover("p10.jpg", 430), (660, 645), -5)
    logo = Image.open(ROOT / "logo.png").convert("RGBA").resize((190, 190), Image.LANCZOS)
    paste_card(c, rounded(logo.convert("RGB"), 46), (505, 505))
    c.convert("RGB").save(OUT / "pmax-square-brand.png", optimize=True)


def main():
    banner_kids()
    banner_adults()
    banner_mix()
    square_brand()
    for f in sorted(OUT.glob("pmax-*.png")):
        img = Image.open(f)
        kb = f.stat().st_size // 1024
        ratio = img.width / img.height
        print(f"  {f.name}: {img.width}x{img.height} ({ratio:.2f}:1) — {kb} KB")


if __name__ == "__main__":
    main()
