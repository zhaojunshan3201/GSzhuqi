with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'rb') as f:
    data = f.read()

lines = data.split(b'\n')
odd = 0
for i, line in enumerate(lines):
    if line.count(b'"') % 2 != 0:
        odd += 1
        if odd <= 10:
            text = line.decode('utf-8', errors='replace')
            print(f'Line {i+1}: {text.strip()[:120]}')

print(f'\nTotal odd-quote lines: {odd}')

# Also count lines where template literals (backticks) are odd
odd_bt = 0
for i, line in enumerate(lines):
    if line.count(b'\x60') % 2 != 0:
        odd_bt += 1
        if odd_bt <= 10:
            text = line.decode('utf-8', errors='replace')
            print(f'Template Line {i+1}: {text.strip()[:120]}')

print(f'Total odd-backtick lines: {odd_bt}')
