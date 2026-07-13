from pathlib import Path

fp = Path(r"C:\Users\31541\Desktop\Manus\GS\GS\src\App.tsx")
content = fp.read_text(encoding="utf-8", errors="replace")
FFFD = chr(0xFFFD)

# Fix 1: getPreviousMeasureStartDate exactKeys (line 1369)
old = "const exactKeys = ['" + FFFD + FFFD + FFFD + FFFD + FFFD + FFFD + "', '" + FFFD + FFFD + FFFD + FFFD + FFFD + FFFD + "', '" + FFFD + FFFD + FFFD + FFFD + FFFD + FFFD + FFFD + FFFD + "', '" + FFFD + FFFD + FFFD + FFFD + FFFD + FFFD + FFFD + FFFD + "'];"
new = "const exactKeys = ['\u4e0a\u8f6e\u8f6c\u62bd\u65f6\u95f4', '\u4e0a\u8f6e\u8f6c\u62bd\u65e5\u671f', '\u4e0a\u8f6e\u540c\u671f\u8f6c\u62bd\u65f6\u95f4', '\u4e0a\u8f6e\u540c\u671f\u8f6c\u62bd\u65e5\u671f'];"

if old in content:
    content = content.replace(old, new)
    print("Fixed exactKeys in getPreviousMeasureStartDate")
else:
    print("Pattern not found for exactKeys")
    # Try to find what's there
    idx = content.find("const exactKeys")
    if idx >= 0:
        print(repr(content[idx:idx+120]))

fp.write_text(content, encoding="utf-8")