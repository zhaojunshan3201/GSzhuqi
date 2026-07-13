"""
Radical approach: replace ALL non-ASCII in strings/templates with _,
fix remaining delimiter issues, and produce a COMPILABLE file.
"""
import sys

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
replaced = 0

while i < len(data):
    b = data[i]

    if b == 0x0A:  # \n
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

    if b == 0x5C:  # backslash
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

    # Track delimiters
    if b == 0x60 and not in_double and not in_single:  # backtick
        in_template = not in_template
        result.append(b)
        i += 1
        continue

    if b == 0x22 and not in_single and not in_template:  # "
        in_double = not in_double
        result.append(b)
        i += 1
        continue

    if b == 0x27 and not in_double and not in_template:  # '
        in_single = not in_single
        result.append(b)
        i += 1
        continue

    # Replace non-ASCII in strings/templates with _
    if (in_double or in_single or in_template) and b >= 0x80:
        # Skip the entire UTF-8 sequence, replace with single _
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
print(f'Replaced {replaced} non-ASCII characters in strings/templates')

# Now fix consumed delimiters: where garbled text consumed closing " or `
# These show up as odd-count delimiters on a line
# Strategy: for each line with odd " count, add closing " at a sensible position
# For each line with odd ` count that ends with ); or ,, add closing `

lines = data.split(b'\n')
fixed_lines = []
quote_fixes = 0
bt_fixes = 0

for i, line in enumerate(lines):
    dq = line.count(b'"')
    bt = line.count(b'`')

    # Fix odd double quotes
    if dq % 2 != 0:
        # Find where to add closing quote
        # Strategy: insert " before the last ), ;, , or ] that follows a ?
        # Or insert at the end of the line before );
        fixed = bytearray(line)
        stripped = line.rstrip()

        # Try to find ? pattern
        q_pos = line.rfind(b'?')
        if q_pos >= 0:
            # Check what follows ?
            rest_start = q_pos + 1
            # Find the next delimiter after ?
            for j in range(rest_start, len(line)):
                if line[j:j+1] in [b')', b',', b';', b']', b':']:
                    fixed.insert(j, 0x22)
                    quote_fixes += 1
                    break
            else:
                # No delimiter found, add at end
                if stripped.endswith(b');'):
                    fixed.insert(len(fixed.rstrip()) - 2, 0x22)
                else:
                    fixed.append(0x22)
                quote_fixes += 1
        else:
            # No ? - insert before );
            if stripped.endswith(b');'):
                j = len(fixed) - 1
                while j >= 0 and fixed[j] != 0x3B:
                    j -= 1
                if j > 0:
                    fixed.insert(j, 0x22)
                    quote_fixes += 1
            elif stripped.endswith(b','):
                j = len(fixed) - 1
                while j >= 0 and fixed[j] != 0x2C:
                    j -= 1
                if j > 0:
                    fixed.insert(j, 0x22)
                    quote_fixes += 1
            else:
                fixed.append(0x22)
                quote_fixes += 1

        fixed_lines.append(bytes(fixed))
    elif bt % 2 != 0:
        # Odd backtick - add closing backtick before ); or ,
        fixed = bytearray(line)
        stripped = line.rstrip()
        if stripped.endswith(b');'):
            j = len(fixed) - 1
            while j >= 0 and fixed[j] != 0x3B:
                j -= 1
            if j > 0 and fixed[j-1] != 0x60:
                fixed.insert(j, 0x60)
                bt_fixes += 1
        elif stripped.endswith(b','):
            j = len(fixed) - 1
            while j >= 0 and fixed[j] != 0x2C:
                j -= 1
            if j > 0 and fixed[j-1] != 0x60:
                fixed.insert(j, 0x60)
                bt_fixes += 1
        fixed_lines.append(bytes(fixed))
    else:
        fixed_lines.append(line)

data = b'\n'.join(fixed_lines)
print(f'Quote fixes: {quote_fixes}, Backtick fixes: {bt_fixes}')

# Final UTF-8 validation
# Fix any orphaned continuation bytes
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

# Clean line endings
data = data.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
data = data.rstrip(b'\n') + b'\n'

# Final stats
lines = data.split(b'\n')
odd_qt = sum(1 for l in lines if l.count(b'"') % 2 != 0)
odd_bt = sum(1 for l in lines if l.count(b'\x60') % 2 != 0)

# Verify UTF-8
try:
    text = data.decode('utf-8')
    print(f'Valid UTF-8: {len(text)} chars')
except Exception as e:
    print(f'UTF-8 error: {e}')

print(f'Final odd-quote: {odd_qt}, Final odd-backtick: {odd_bt}')

with open('server.ts', 'wb') as f:
    f.write(data)

print('Done - server.ts written')
