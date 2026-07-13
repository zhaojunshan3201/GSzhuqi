with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'rb') as f:
    data = f.read()

# Check for U+FFFD
ufffd = b'\xef\xbf\xbd'
n_ufffd = data.count(ufffd)
print(f'U+FFFD instances: {n_ufffd}')

# Check for orphan ?
# Look for 3F byte not part of a valid context
lines = data.split(b'\n')
odd = 0
for i, line in enumerate(lines):
    # Count double quotes
    dq = line.count(b'"')
    if dq % 2 != 0:
        odd += 1
        if odd <= 30:
            # Find the position of odd quote
            text = line.decode('utf-8', errors='replace')
            print(f'Line {i+1}: {text.strip()[:120]}')

print(f'\nTotal lines with odd quote count: {odd}')
