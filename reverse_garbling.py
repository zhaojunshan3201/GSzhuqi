# Attempt to reverse the garbling properly
# The corruption: correct UTF-8 bytes → GBK decode → encode as UTF-8
# Reverse: garbled UTF-8 text → decode to Unicode → encode as GBK → decode as UTF-8

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.corrupted.orig', 'rb') as f:
    data = f.read()

# We need to process the file character by character
# For each CJK character, encode as GBK, collect bytes, then decode as UTF-8

text = data.decode('utf-8')
result = []
i = 0
fixed_chars = 0

def is_garbled_cjk(ch):
    """Check if character is likely a garbled CJK char (not standard Chinese)"""
    cp = ord(ch)
    # Most common Chinese chars are in 4E00-9FFF
    # Garbled chars are also in this range but form nonsensical sequences
    return 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF

while i < len(text):
    ch = text[i]

    if is_garbled_cjk(ch):
        # Collect run of CJK chars
        run_start = i
        run_chars = []
        while i < len(text) and is_garbled_cjk(text[i]):
            run_chars.append(text[i])
            i += 1

        # Try to degarble
        try:
            gbk_bytes = b''
            for c in run_chars:
                gbk_bytes += c.encode('gbk')

            decoded = gbk_bytes.decode('utf-8')

            # Verify the result is valid (all printable or ASCII or proper Chinese)
            valid = True
            for d in decoded:
                cp = ord(d)
                if cp < 32 and cp not in (9, 10, 13):
                    valid = False
                    break

            if valid:
                result.append(decoded)
                fixed_chars += len(run_chars)
            else:
                result.append(''.join(run_chars))
        except:
            result.append(''.join(run_chars))
    else:
        result.append(ch)
        i += 1

output = ''.join(result)

# Check for syntax issues
lines = output.split('\n')
odd = sum(1 for l in lines if l.count('"') % 2 != 0)
print(f'Fixed {fixed_chars} characters')
print(f'Lines with odd quote count: {odd}')

# Write output
with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'wb') as f:
    f.write(output.encode('utf-8'))

print('Done')
