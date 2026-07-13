"""
Nuke approach: pre-fix consumed delimiters, then replace all non-ASCII
in strings/templates with _. Should produce a compilable file.
"""
import sys

with open('server.ts', 'rb') as f:
    data = f.read()

result = bytearray()
i = 0
in_double = False
in_single = False
in_template = False
in_line_comment = False
in_block_comment = False
escape_next = False
replaced = 0

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
        if b >= 0xF0:
            skip = 3
        elif b >= 0xE0:
            skip = 2
        elif b >= 0xC0:
            skip = 1
        else:
            skip = 0
        result.append(ord('_'))
        i += skip + 1
        replaced += 1
        continue

    result.append(b)
    i += 1

data = bytes(result)
print(f'Replaced {replaced} non-ASCII chars in strings')

# Fix remaining odd delimiters (few should remain)
lines = data.split(b'\n')
fixed_lines = []
qt_fixes = 0
bt_fixes = 0

for line in lines:
    dq = line.count(b'"')
    bt = line.count(b'\x60')
    fixed = bytearray(line)

    if dq % 2 != 0:
        stripped = line.rstrip()
        if stripped.endswith(b');'):
            # Insert " before );
            j = len(fixed) - 1
            while j >= 0 and fixed[j] != 0x3B:
                j -= 1
            if j > 0:
                fixed.insert(j, 0x22)
                qt_fixes += 1
        elif stripped.endswith(b','):
            j = len(fixed) - 1
            while j >= 0 and fixed[j] != 0x2C:
                j -= 1
            if j > 0:
                fixed.insert(j, 0x22)
                qt_fixes += 1
        else:
            fixed.append(0x22)
            qt_fixes += 1

    fixed_lines.append(bytes(fixed))

data = b'\n'.join(fixed_lines)
print(f'Additional fixes: {qt_fixes} quotes')

# Clean up
data = data.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
data = data.rstrip(b'\n') + b'\n'

# Validate and fix UTF-8
result = bytearray()
i = 0
while i < len(data):
    b = data[i]
    if b < 0x80:
        result.append(b)
        i += 1
    elif b < 0xC0:
        result.append(ord('_'))
        i += 1
    elif b < 0xE0:
        if i + 1 < len(data) and 0x80 <= data[i+1] < 0xC0:
            result.append(b)
            result.append(data[i+1])
            i += 2
        else:
            result.append(ord('_'))
            i += 1
    elif b < 0xF0:
        if i + 2 < len(data) and 0x80 <= data[i+1] < 0xC0 and 0x80 <= data[i+2] < 0xC0:
            result.append(b)
            result.append(data[i+1])
            result.append(data[i+2])
            i += 3
        else:
            result.append(ord('_'))
            i += 1
    elif b < 0xF8:
        if i + 3 < len(data) and 0x80 <= data[i+1] < 0xC0 and 0x80 <= data[i+2] < 0xC0 and 0x80 <= data[i+3] < 0xC0:
            result.append(b)
            result.append(data[i+1])
            result.append(data[i+2])
            result.append(data[i+3])
            i += 4
        else:
            result.append(ord('_'))
            i += 1
    else:
        result.append(ord('_'))
        i += 1

data = bytes(result)

# Final stats
lines = data.split(b'\n')
odd_qt = sum(1 for l in lines if l.count(b'"') % 2 != 0)
odd_bt = sum(1 for l in lines if l.count(b'\x60') % 2 != 0)
try:
    text = data.decode('utf-8')
    print(f'Valid UTF-8: {len(text)} chars')
except Exception as e:
    print(f'UTF-8 error: {e}')
print(f'Final: odd-quote={odd_qt}, odd-backtick={odd_bt}')

with open('server.ts', 'wb') as f:
    f.write(data)
print('Done')
