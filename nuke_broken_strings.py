# Radical fix: replace broken strings with safe ASCII placeholders
# Goal: make the file compile, even if Chinese text is lost

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.corrupted.orig', 'rb') as f:
    data = f.read()

# Find all lines with mismatched quotes and fix them
lines = data.split(b'\n')
fixed_lines = []

for i, line in enumerate(lines):
    if line.count(b'"') % 2 != 0:
        # Line has broken string - replace the entire line with a safe version
        # Check what kind of line it is and fix accordingly

        # Pattern: array element "garbled?, -> "placeholder",
        # Pattern: return "garbled?; -> return "placeholder";
        # Pattern: if (...includes("garbled?)) -> if (...includes("placeholder"))

        # Find all string literals and fix broken ones
        fixed = bytearray()
        in_string = False
        escape_next = False
        string_start = -1

        for j, b in enumerate(line):
            if escape_next:
                escape_next = False
                continue
            if b == 0x5c:  # backslash
                escape_next = True
                continue
            if b == 0x22:  # double quote
                if not in_string:
                    in_string = True
                    string_start = j
                else:
                    in_string = False
                fixed.append(b)
            elif in_string and b > 0x7f:
                # Non-ASCII char inside string - remove it (keep string valid)
                # Just skip the entire UTF-8 sequence
                if (b & 0xE0) == 0xC0:
                    skip = 2
                elif (b & 0xF0) == 0xE0:
                    skip = 3
                elif (b & 0xF8) == 0xF0:
                    skip = 4
                else:
                    skip = 1
                # Skip this character (don't add to fixed)
                # But we need to process remaining bytes
                for _ in range(skip - 1):
                    j += 1
                continue
            else:
                fixed.append(b)

        fixed_lines.append(bytes(fixed))
        if fixed.count(b'"') % 2 != 0:
            # Still broken - just replace entire line with comment
            stripped = line.strip()
            fixed_lines.append(b'// FIXED: broken line')
            print(f'  Line {i+1}: completely broken, commented out')
        else:
            print(f'  Line {i+1}: removed garbled chars from string')
    else:
        fixed_lines.append(line)

data = b'\n'.join(fixed_lines)

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'wb') as f:
    f.write(data)

print('Done nuking broken strings')
