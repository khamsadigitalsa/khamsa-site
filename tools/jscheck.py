"""فحص بنيوي سريع لملفات JS/HTML — يوازن الأقواس متجاهلاً التعليقات والنصوص.

ليس بديلاً عن مفسّر JS، لكنه يمسك أخطاء التحرير الشائعة (قوس ناقص، نص غير مغلق)
وهذا الجهاز لا يحتوي Node لتشغيل `node --check`.

    python tools/jscheck.py
"""
import pathlib
import re
import sys

BACKSLASH = chr(92)
PAIRS = {")": "(", "]": "[", "}": "{"}


def scan(src):
    i, n, line = 0, len(src), 1
    stack = []
    while i < n:
        c = src[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            i += 2
            while i + 1 < n and not (src[i] == "*" and src[i + 1] == "/"):
                if src[i] == "\n":
                    line += 1
                i += 1
            i += 2
            continue
        if c in "\"'`":
            quote, start_line = c, line
            i += 1
            while i < n:
                if src[i] == BACKSLASH:
                    i += 2
                    continue
                if src[i] == "\n":
                    line += 1
                    if quote != "`":
                        return f"نص غير مغلق ({quote}) بدأ في السطر {start_line}"
                if src[i] == quote:
                    break
                if quote == "`" and src[i] == "$" and i + 1 < n and src[i + 1] == "{":
                    depth, i = 1, i + 2
                    while i < n and depth:
                        if src[i] == "{":
                            depth += 1
                        elif src[i] == "}":
                            depth -= 1
                        elif src[i] == "\n":
                            line += 1
                        i += 1
                    continue
                i += 1
            i += 1
            continue
        if c in "([{":
            stack.append((c, line))
        elif c in ")]}":
            if not stack:
                return f"قوس زائد {c} في السطر {line}"
            op, ol = stack.pop()
            if op != PAIRS[c]:
                return f"قوس غير متطابق {op} (سطر {ol}) أُغلق بـ {c} في السطر {line}"
        i += 1
    if stack:
        op, ol = stack[-1]
        return f"قوس {op} لم يُغلق، فُتح في السطر {ol}"
    return None


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    targets = sorted(root.glob("api/*.js")) + [root / "thanks.html",
                                               root / "admin.html",
                                               root / "index.html",
                                               root / "checkout.html"]
    bad = 0
    for p in targets:
        if not p.is_file():
            continue
        src = p.read_text(encoding="utf-8")
        if p.suffix == ".html":
            src = "\n".join(re.findall(r"<script[^>]*>(.*?)</script>", src, re.S))
            if not src.strip():
                continue
        err = scan(src)
        print(("  OK    " if not err else "  خطأ  ") + p.name
              + ("" if not err else "  ← " + err))
        bad += bool(err)
    print(f"\n  {len(targets) - bad}/{len(targets)} ملف سليم بنيوياً")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
