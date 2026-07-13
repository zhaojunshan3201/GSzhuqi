"""
De-garble ALL Chinese text in corrupted.orig using GB18030 reverse.
Process: garbled UTF-8 bytes → decode as GB18030 → re-interpret as UTF-8 = original
"""
import sys

# Build reverse lookup: garbled UTF-8 byte sequence -> original bytes
# Corruption: original_utf8_pair → interpreted as GB18030 2-byte → Unicode char → UTF-8
# Reverse: garbled_utf8 → Unicode char → GB18030 2-byte → this IS the original UTF-8 fragment

def build_gb18030_reverse():
    """Build mapping from corrupted UTF-8 to original 2-byte sequence."""
    rev = {}
    for b1 in range(0x81, 0xFF):
        for b2 in range(0x40, 0xFF):
            if b2 == 0x7F:
                continue
            try:
                gb_bytes = bytes([b1, b2])
                unicode_char = gb_bytes.decode('gb18030')
                garbled_utf8 = unicode_char.encode('utf-8')
                # The garbled UTF-8 represents 2 bytes of the original
                rev[garbled_utf8] = gb_bytes
            except:
                pass
    return rev

print("Building GB18030 reverse map (23940 entries)...")
rev_map = build_gb18030_reverse()
print(f"Built {len(rev_map)} mappings")

# Read corrupted file
with open('server.corrupted.orig', 'rb') as f:
    data = f.read()

# Strip BOM
if data[:3] == b'\xef\xbb\xbf':
    data = data[3:]
    print("Stripped BOM")

# Process the file byte by byte
result = bytearray()
i = 0
fixed_count = 0
unfixed_count = 0

while i < len(data):
    b = data[i]
    if b < 0x80:
        # ASCII byte - pass through
        result.append(b)
        i += 1
        continue

    # Non-ASCII byte - try to find a matching garbled sequence
    # Try longer sequences first (3-byte UTF-8 chars are most common for CJK)
    matched = False
    for seq_len in [3, 2, 4]:
        if i + seq_len <= len(data):
            seq = data[i:i+seq_len]
            # Only try if all bytes in seq are non-ASCII (or at least the first is)
            if seq in rev_map:
                original_bytes = rev_map[seq]
                result.extend(original_bytes)
                i += seq_len
                fixed_count += 1
                matched = True
                break

    if not matched:
        # Could be an original uncorrupted Chinese char (valid UTF-8)
        # Check if this byte starts a valid UTF-8 sequence
        seq_len = 0
        if b >= 0xF0:
            seq_len = 4
        elif b >= 0xE0:
            seq_len = 3
        elif b >= 0xC0:
            seq_len = 2
        else:
            seq_len = 1  # Lone continuation byte, shouldn't happen

        if seq_len > 1 and i + seq_len <= len(data):
            seq = data[i:i+seq_len]
            # Check if it's valid UTF-8
            try:
                seq.decode('utf-8')
                # It's valid UTF-8, could be original Chinese
                # Keep as-is
                result.extend(seq)
                i += seq_len
                unfixed_count += 1
            except:
                # Invalid UTF-8, replace with _
                result.append(ord('_'))
                i += 1
        else:
            result.append(ord('_'))
            i += 1

print(f"Fixed (de-garbled): {fixed_count} sequences")
print(f"Kept original: {unfixed_count} sequences")
print(f"Output size: {len(result)} bytes")

# Check non-ASCII remaining
non_ascii = sum(1 for b in result if b >= 0x80)
print(f"Non-ASCII in output: {non_ascii}")

# Validate UTF-8
try:
    text = result.decode('utf-8')
    print(f"Valid UTF-8: YES, {len(text)} characters")
    # Check for common Chinese characters
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    print(f"Chinese characters in CJK range: {chinese_chars}")
except Exception as e:
    print(f"UTF-8 validation failed: {e}")
    # Find the problematic byte
    for j in range(len(result)):
        try:
            result[:j].decode('utf-8')
        except:
            print(f"First invalid at byte {j-1}: {result[j-5:j+10]!r}")
            break

# Write output
with open('server_degarble_test.ts', 'wb') as f:
    f.write(result)
print("\nWritten to server_degarble_test.ts")
