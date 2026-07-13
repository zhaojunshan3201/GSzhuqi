"""
Degarble server.ts using GB18030 reverse mapping.
Simplified: just reverse the UTF-8→GB18030→UTF-8 mojibake for non-ASCII
segments inside strings/templates. Handle consumed delimiters via
the recovered trailing byte.
"""
import sys

# Build reverse GB18030 lookup
print('Building GB18030 reverse lookup...')
uni_to_gb18030 = {}
for first in range(0x81, 0xFF):
    for second in list(range(0x40, 0x7F)) + list(range(0x80, 0xFF)):
        pair = bytes([first, second])
        try:
            char = pair.decode('gb18030')
            uni_to_gb18030[char] = pair
        except:
            pass
print(f'  {len(uni_to_gb18030)} 2-byte entries')

def degarble_bytes(garbled_bytes):
    """Degarble garbled UTF-8 bytes.
    Returns corrected bytes (valid UTF-8 + possibly a recovered delimiter byte).
    """
    try:
        chars = garbled_bytes.decode('utf-8')
    except:
        return garbled_bytes  # Can't decode, return as-is

    # Encode each char back to GB18030
    gb18030_bytes = bytearray()
    for c in chars:
        if c in uni_to_gb18030:
            gb18030_bytes.extend(uni_to_gb18030[c])
        else:
            try:
                gb18030_bytes.extend(c.encode('gb18030'))
            except:
                # Can't encode this char - replace with _
                # This char likely contains a consumed delimiter
                gb18030_bytes.append(ord('_'))
                gb18030_bytes.append(ord('_'))

    original = bytes(gb18030_bytes)

    # Find longest valid UTF-8 prefix
    for j in range(len(original), 0, -1):
        try:
            original[:j].decode('utf-8')
            return original[:j] + original[j:]  # Return everything
        except:
            continue

    return garbled_bytes  # Can't recover, return as-is


print('Processing server.corrupted.orig...')
with open('server.corrupted.orig', 'rb') as f:
    data = f.read()

result = bytearray()
i = 0
in_double = False
in_single = False
in_template = False
in_line_comment = False
in_block_comment = False
escape_next = False
fix_count = 0
fail_count = 0

while i < len(data):
    b = data[i]

    if b == 0x0A:
        in_line_comment = False
        result.append(b)
        i += 1
        continue

    if escape_next:
        result.append(b)
        escape_next = False
        i += 1
        continue

    if in_line_comment or in_block_comment:
        result.append(b)
        i += 1
        continue

    if not in_double and not in_single and not in_template and not in_block_comment:
        if b == 0x2F and i + 1 < len(data) and data[i+1] == 0x2F:
            in_line_comment = True
            result.append(b)
            i += 1
            continue

    if b == 0x5C:
        result.append(b)
        escape_next = True
        i += 1
        continue

    if not in_double and not in_single and not in_template:
        if b == 0x2F and i + 1 < len(data) and data[i+1] == 0x2A:
            in_block_comment = True
            result.append(b)
            i += 1
            continue
        if b == 0x2A and i + 1 < len(data) and data[i+1] == 0x2F:
            if in_block_comment:
                in_block_comment = False
            result.append(b)
            i += 1
            continue

    if b == 0x60 and not in_double and not in_single:
        in_template = not in_template
        result.append(b)
        i += 1
        continue

    if b == 0x22 and not in_single and not in_template:
        in_double = not in_double
        result.append(b)
        i += 1
        continue

    if b == 0x27 and not in_double and not in_template:
        in_single = not in_single
        result.append(b)
        i += 1
        continue

    if (in_double or in_single or in_template) and b >= 0x80:
        start = i
        while i < len(data) and data[i] >= 0x80:
            i += 1
        garbled_bytes = data[start:i]

        corrected = degarble_bytes(garbled_bytes)
        if corrected != garbled_bytes:
            fix_count += 1
            # Verify it's valid UTF-8 (possibly with trailing delimiter byte)
            try:
                corrected.decode('utf-8')
                result.extend(corrected)
            except:
                # Has trailing byte - find valid prefix and add the rest too
                for j in range(len(corrected), 0, -1):
                    try:
                        corrected[:j].decode('utf-8')
                        result.extend(corrected[:j])
                        # The remaining byte(s) might be a recovered delimiter
                        # Add them as raw bytes (they're ASCII delimiters)
                        if j < len(corrected):
                            result.extend(corrected[j:])
                        break
                    except:
                        continue
                else:
                    result.extend(garbled_bytes)
                    fail_count += 1
                    fix_count -= 1
        else:
            result.extend(garbled_bytes)
            fail_count += 1
        continue

    result.append(b)
    i += 1

final = bytes(result)

orig_nonascii = sum(1 for b in data if b >= 0x80)
new_nonascii = sum(1 for b in final if b >= 0x80)
print(f'Non-ASCII bytes: {orig_nonascii} -> {new_nonascii}')
print(f'Segments fixed: {fix_count}, failed: {fail_count}')

lines = final.split(b'\n')
odd_qt = sum(1 for l in lines if l.count(b'"') % 2 != 0)
odd_bt = sum(1 for l in lines if l.count(b'\x60') % 2 != 0)
sq_byte = 0x27
odd_sq = sum(1 for l in lines if l.count(bytes([sq_byte])) % 2 != 0)
print(f'Odd-quote lines: {odd_qt}')
print(f'Odd-backtick lines: {odd_bt}')
print(f'Odd-single-quote lines: {odd_sq}')

with open('server.ts', 'wb') as f:
    f.write(final)

print('Done - server.ts written')
