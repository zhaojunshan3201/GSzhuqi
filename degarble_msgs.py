"""
Recover Chinese text from garbled server.corrupted.orig using GB18030 reverse.
This targets specific user-facing messages.
"""
import struct

# Build GB18030 reverse lookup: garbled UTF-8 bytes -> original bytes
# Corruption: original_utf8 -> interpreted as GB18030 -> decoded to Unicode -> encoded as UTF-8
# Reverse: garbled UTF-8 -> decode to Unicode -> encode as GB18030 -> original UTF-8

def build_gb18030_reverse():
    """Build reverse mapping from corrupted UTF-8 to original bytes."""
    reverse_map = {}
    # Iterate all valid GB18030 2-byte sequences
    for b1 in range(0x81, 0xFF):
        for b2 in range(0x40, 0xFF):
            if b2 == 0x7F:
                continue
            try:
                gb_bytes = bytes([b1, b2])
                unicode_char = gb_bytes.decode('gb18030')
                utf8_bytes = unicode_char.encode('utf-8')
                # Map: corrupted UTF-8 -> original 2 GB18030 bytes
                reverse_map[utf8_bytes] = gb_bytes
            except:
                pass
    return reverse_map

def degarble_text(garbled_utf8: bytes, reverse_map: dict) -> bytes:
    """Convert garbled UTF-8 text back to original bytes."""
    result = bytearray()
    i = 0
    while i < len(garbled_utf8):
        b = garbled_utf8[i]
        if b < 0x80:
            result.append(b)
            i += 1
            continue

        # Try to match multi-byte UTF-8 sequences
        matched = False
        for seq_len in [3, 2, 4]:
            if i + seq_len <= len(garbled_utf8):
                seq = garbled_utf8[i:i+seq_len]
                if seq in reverse_map:
                    result.extend(reverse_map[seq])
                    i += seq_len
                    matched = True
                    break

        if not matched:
            # Check if it's an ASCII char that looks garbled
            # If we can't reverse, keep as-is (for ? handling later)
            if garbled_utf8[i] == 0x3F:  # ?
                result.append(garbled_utf8[i])
            else:
                result.append(ord('_'))
            i += 1

    # Now try to decode the result as UTF-8 (should be the original Chinese)
    try:
        return result
    except:
        return result

# Build the reverse map
print("Building GB18030 reverse lookup...")
reverse_map = build_gb18030_reverse()
print(f"Built with {len(reverse_map)} entries")

# Read the corrupted file (without BOM)
with open('server.corrupted.orig', 'rb') as f:
    data = f.read()
if data[:3] == b'\xef\xbb\xbf':
    data = data[3:]

lines = data.split(b'\n')

# Target specific lines with user-facing messages
target_lines = [
    (942, 'default admin user array'),
    (1231, 'throw error message'),
    (1238, 'sync in progress error'),
    (1347, 'last_error default'),
    (2280, 'measures error'),
    (2302, 'measures import error'),
    (2713, 'summary error'),
    (2946, 'login success user name'),
    (2948, 'login failed message'),
    (2952, 'server error message'),
    (2963, 'register success'),
    (2966, 'register exists error'),
    (2968, 'register error'),
    (2979, 'sync success'),
    (2984, 'sync in progress check'),
    (2985, 'sync error'),
    (2994, 'sync catch error'),
    (3003, 'cache error'),
    (3012, 'data error'),
    (3254, 'import empty error'),
    (3276, 'import error'),
    (3286, 'import no file error'),
    (3293, 'import parse error'),
]

for line_no, desc in target_lines:
    if line_no <= len(lines):
        line = lines[line_no - 1]
        # Find the string content between quotes
        # Look for message: "...", or "..." pattern
        print(f'\n--- Line {line_no} ({desc}) ---')
        # Print up to 200 chars
        print(f'Corrupted: {line[:200]}')

print("\nDone. Use the garbled text to manually identify what each message was.")
