# Strategy: convert garbled Chinese back to correct Chinese
# The garbling: correct UTF-8 bytes → interpreted as GBK → re-encoded as UTF-8
# Reversal: take garbled UTF-8 text → encode as GBK bytes → decode as UTF-8

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'rb') as f:
    data = f.read()

# First, identify all sequences of garbled CJK characters
# Garbled CJK chars are in the CJK Unified Ideographs range (U+4E00-U+9FFF)
# but the specific ones in this file are mostly rare CJK chars

text = data.decode('utf-8', errors='replace')

# Try: for each character that's a garbled CJK char, reverse the transformation
# But we need to handle the boundaries correctly

# Simpler approach: use the known transformation
# garbled.encode('gbk') → bytes of original UTF-8 → .decode('utf-8') → correct Chinese

# But we can't just apply this blindly to the whole file because:
# 1. ASCII characters should be left alone
# 2. Non-garbled characters (if any) would be corrupted

# Let's try a targeted approach: find CJK character sequences and degarble them

import re

def is_cjk(c):
    """Check if char is in CJK unified ideographs range or related"""
    cp = ord(c)
    return (0x4E00 <= cp <= 0x9FFF or
            0x3400 <= cp <= 0x4DBF or
            0xF900 <= cp <= 0xFAFF or
            0xFF00 <= cp <= 0xFFEF)  # Fullwidth forms

# Build a mapping of garbled chars -> original bytes
# For each garbled CJK char, encode as GBK, store the 2 bytes
# Then concatenate all bytes and decode as UTF-8

# Approach: find runs of garbled CJK chars, degarble each run

result_chars = []
i = 0
chars = list(text)

fixed_count = 0
error_count = 0

while i < len(chars):
    c = chars[i]

    # Check if this starts a run of garbled CJK chars
    if is_cjk(c) and ord(c) > 0xFF:
        # Start collecting a run of garbled characters
        run = []
        j = i
        while j < len(chars) and is_cjk(chars[j]) and ord(chars[j]) > 0xFF:
            run.append(chars[j])
            j += 1

        # Try to degarble this run
        try:
            # Encode each garbled char as GBK
            gbk_bytes = b''
            for gc in run:
                try:
                    gb = gc.encode('gbk')
                    gbk_bytes += gb
                except:
                    # Can't encode to GBK, maybe it's already correct Chinese
                    raise ValueError("Can't encode")

            # Try to decode as UTF-8
            decoded = gbk_bytes.decode('utf-8', errors='strict')

            # Check if decoded looks like correct Chinese
            if decoded != ''.join(run):
                # Verify it looks reasonable
                all_chinese = all('\u4e00' <= d <= '\u9fff' or d in '，。、：；（）—…？！《》【】｛｝％＋－×÷＝≠≤≥　' or d.isascii() or d in '0123456789' for d in decoded)
                if all_chinese:
                    result_chars.append(decoded)
                    fixed_count += len(run)
                    i = j
                    continue
        except:
            pass

        # If degarbling failed, keep original
        result_chars.append(''.join(run))
        error_count += len(run)
        i = j
    else:
        result_chars.append(c)
        i += 1

result = ''.join(result_chars)

print(f'Fixed {fixed_count} characters')
print(f'Kept {error_count} characters as-is')

# Check if result looks reasonable
lines = result.split('\n')
odd_quotes = sum(1 for line in lines if line.count('"') % 2 != 0)
print(f'Lines with odd quotes: {odd_quotes}')

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'wb') as f:
    f.write(result.encode('utf-8'))

print('Done')
