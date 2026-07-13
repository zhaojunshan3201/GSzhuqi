# Radical approach: replace ALL non-ASCII chars in STRING LITERALS
# with ASCII placeholders to ensure file compiles

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.corrupted.orig', 'rb') as f:
    data = f.read()

lines = data.split(b'\n')
fixed_lines = []

for i, line in enumerate(lines):
    result = bytearray()
    in_double_quote = False
    in_template = False
    in_single_quote = False
    escape_next = False
    j = 0

    while j < len(line):
        b = line[j]

        if escape_next:
            result.append(b)
            escape_next = False
            j += 1
            continue

        if b == 0x5C:  # backslash
            result.append(b)
            escape_next = True
            j += 1
            continue

        # Track quote state
        if b == 0x22:  # double quote
            if not in_single_quote and not in_template:
                in_double_quote = not in_double_quote
            result.append(b)
            j += 1
            continue

        if b == 0x27:  # single quote
            if not in_double_quote and not in_template:
                in_single_quote = not in_single_quote
            result.append(b)
            j += 1
            continue

        if b == 0x60:  # backtick
            if not in_double_quote and not in_single_quote:
                in_template = not in_template
            result.append(b)
            j += 1
            continue

        # Handle non-ASCII in strings/templates
        if in_double_quote or in_template or in_single_quote:
            if b >= 0x80:
                # Non-ASCII char in string - replace with _
                # Skip the entire UTF-8 sequence
                if b >= 0xF0:
                    skip = 3
                elif b >= 0xE0:
                    skip = 2
                elif b >= 0xC0:
                    skip = 1
                else:
                    skip = 0
                # Replace with placeholder
                result.append(ord('_'))
                j += skip + 1
                continue

        result.append(b)
        j += 1

    fixed_lines.append(bytes(result))

data = b'\n'.join(fixed_lines)

# Now fix the 3 remaining odd-quote lines
# These are from garbled characters that contain 0x22 (")
# Just find them and fix manually

lines = data.split(b'\n')
for i, line in enumerate(lines):
    if line.count(b'"') % 2 != 0:
        print(f'Odd quote line {i+1}: fixing...')
        # Add closing quote at end of line before ); or similar
        fixed = bytearray(line)
        # Insert closing quote before );
        for j in range(len(fixed)-1, -1, -1):
            if fixed[j] == 0x3B and j > 0:  # ;
                # Check if we're in a string context
                fixed.insert(j, 0x22)
                break
        lines[i] = bytes(fixed)

data = b'\n'.join(lines)

# Final check
lines = data.split(b'\n')
odd_qt = sum(1 for l in lines if l.count(b'"') % 2 != 0)
odd_bt = sum(1 for l in lines if l.count(b'\x60') % 2 != 0)
print(f'Final odd-quote lines: {odd_qt}')
print(f'Final odd-backtick lines: {odd_bt}')

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'wb') as f:
    f.write(data)

print('Done')
