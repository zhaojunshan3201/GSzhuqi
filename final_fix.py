"""
Complete pipeline - fresh from server.corrupted.orig:
1. Fix consumed backticks (U+255C -> actual backtick)
2. Fix consumed quotes (? after non-ASCII before delimiter)
3. Replace ALL non-ASCII bytes with _
4. Fix remaining syntax issues
"""
import sys

# Start fresh
with open('server.corrupted.orig', 'rb') as f:
    data = f.read()
print(f'Step 0: Loaded {len(data)} bytes, {sum(1 for b in data if b >= 0x80)} non-ASCII')

# Step 1: Fix consumed backticks
bt_fixed = data.count(bytes.fromhex('e2959c'))
data = data.replace(bytes.fromhex('e2959c'), b'\x60')
print(f'Step 1: Fixed {bt_fixed} consumed backticks')

# Step 2: Fix consumed quotes (? after non-ASCII before delimiter)
lines = data.split(b'\n')
qt_fixed = 0
for i, line in enumerate(lines):
    idx = 0
    while True:
        idx = line.find(b'?', idx)
        if idx < 0:
            break
        if idx > 0 and line[idx-1] >= 0x80:
            rest = idx + 1
            while rest < len(line) and line[rest:rest+1] in [b' ', b'\t']:
                rest += 1
            if rest < len(line) and line[rest:rest+1] in [b')', b',', b';', b']']:
                line = line[:idx+1] + b'"' + line[idx+1:]
                qt_fixed += 1
                idx += 1
        idx += 1
    lines[i] = line
data = b'\n'.join(lines)
print(f'Step 2: Fixed {qt_fixed} consumed quotes')

# Step 3: Replace ALL non-ASCII with _
result = bytearray()
for b in data:
    if b >= 0x80:
        result.append(ord('_'))
    else:
        result.append(b)
data = bytes(result)
print(f'Step 3: {len(data)} bytes, {sum(1 for b in data if b >= 0x80)} non-ASCII remain')

# Step 4: Fix missing closing backticks in one-liner templates
lines = data.split(b'\n')
bt_fixes = 0
for i, line in enumerate(lines):
    stripped = line.rstrip()
    if stripped.endswith(b');'):
        bt_count = line.count(b'\x60')
        if bt_count == 1:  # Only opening backtick, missing closing
            # Check it's not a multi-line template closing
            # Multi-line closing: ____); with a backtick right before );
            j = len(stripped) - 2  # position of ;
            if stripped[j] == 0x3B and stripped[j-1] != 0x60:
                fixed = bytearray(line)
                k = len(fixed) - 1
                while k >= 0 and fixed[k] != 0x3B:
                    k -= 1
                if k > 0 and fixed[k-1] != 0x60:
                    fixed.insert(k, 0x60)
                    lines[i] = bytes(fixed)
                    bt_fixes += 1
data = b'\n'.join(lines)
print(f'Step 4: Fixed {bt_fixes} missing backticks')

# Step 5: Fix remaining odd quotes
lines = data.split(b'\n')
qt_fixes = 0
for i, line in enumerate(lines):
    dq_count = line.count(b'"')
    if dq_count % 2 != 0:
        fixed = bytearray(line)
        stripped = line.rstrip()
        if stripped.endswith(b');'):
            k = len(fixed) - 1
            while k >= 0 and fixed[k] != 0x3B:
                k -= 1
            if k > 0:
                fixed.insert(k, 0x22)
                lines[i] = bytes(fixed)
                qt_fixes += 1
        elif stripped.endswith(b','):
            k = len(fixed) - 1
            while k >= 0 and fixed[k] != 0x2C:
                k -= 1
            if k > 0:
                fixed.insert(k, 0x22)
                lines[i] = bytes(fixed)
                qt_fixes += 1
data = b'\n'.join(lines)
print(f'Step 5: Fixed {qt_fixes} odd quotes')

# Step 6: Fix broken regex patterns
sq = 0x27  # '
dq = 0x22  # "

# /[:__/g -> /[:]/g
data = data.replace(
    bytes([0x2F, 0x5B, 0x3A, 0x5F, 0x5F, 0x2F, 0x67]),
    bytes([0x2F, 0x5B, 0x3A, 0x5D, 0x2F, 0x67])
)

# /[./__/g -> /[-./]/g
data = data.replace(
    bytes([0x2F, 0x5B, 0x2E, 0x2F, 0x5F, 0x5F, 0x2F, 0x67]),
    bytes([0x2F, 0x5B, 0x2D, 0x2E, 0x2F, 0x5D, 0x2F, 0x67])
)

# Fix the big regex chain on line 2018
old_chain = (
    b'.replace(/[_?"__]/g, "").replace(/[_?"__]/g, "")'
    b'.replace(/["___?_______]/g, "").replace(/[:__/g, "")'
    b'.replace(/[_-]/g, "")";'
)
new_chain = (
    b'.replace(/[_?"\']/g, "").replace(/[:_-]/g, "");'
)
if old_chain in data:
    data = data.replace(old_chain, new_chain)
    print('Step 6: Fixed regex chain on line 2018')
else:
    print('Step 6: Regex chain not found (may have different pattern)')

# Step 7: Clean up
data = data.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
data = data.rstrip(b'\n') + b'\n'

# Final stats
lines = data.split(b'\n')
odd_qt = sum(1 for l in lines if l.count(b'"') % 2 != 0)
odd_bt = sum(1 for l in lines if l.count(b'\x60') % 2 != 0)
non_ascii = sum(1 for b in data if b >= 0x80)
print(f'\nFinal stats:')
print(f'  File size: {len(data)} bytes')
print(f'  Non-ASCII: {non_ascii}')
print(f'  Odd-quote: {odd_qt}')
print(f'  Odd-backtick: {odd_bt}')

# Print odd-quote lines for debugging
if odd_qt > 0:
    print('\nOdd-quote lines:')
    for i, line in enumerate(lines):
        if line.count(b'"') % 2 != 0:
            print(f'  Line {i+1}: {line[:150]!r}')

with open('server.ts', 'wb') as f:
    f.write(data)
print('\nComplete! server.ts written')
