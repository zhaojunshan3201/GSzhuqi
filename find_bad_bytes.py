with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'rb') as f:
    data = f.read()

# Find 0x60 inside CJK UTF-8 sequences
count_bt = 0
count_dollar = 0
count_lbrace = 0
count_quote = 0

for i in range(len(data) - 3):
    if 0xE0 <= data[i] <= 0xEF:
        if data[i+1] == 0x60 or data[i+2] == 0x60:
            count_bt += 1
            line_num = data[:i].count(b'\n') + 1
        if data[i+1] == 0x24 or data[i+2] == 0x24:
            count_dollar += 1
        if data[i+1] == 0x7B or data[i+2] == 0x7B:
            count_lbrace += 1
        if data[i+1] == 0x22 or data[i+2] == 0x22:
            count_quote += 1

print(f'CJK chars containing 0x60 (backtick): {count_bt}')
print(f'CJK chars containing 0x24 ($): {count_dollar}')
print(f'CJK chars containing 0x7B (brace): {count_lbrace}')
print(f'CJK chars containing 0x22 (quote): {count_quote}')

# List the lines with problematic template literals
if count_bt > 0:
    print('\nLines with CJK chars containing backtick:')
    lines = data.split(b'\n')
    seen_lines = set()
    for i in range(len(data) - 3):
        if 0xE0 <= data[i] <= 0xEF:
            if data[i+1] == 0x60 or data[i+2] == 0x60:
                line_num = data[:i].count(b'\n') + 1
                if line_num not in seen_lines:
                    seen_lines.add(line_num)
                    line = lines[line_num-1]
                    text = line.decode('utf-8', errors='replace')
                    print(f'  Line {line_num}: {text.strip()[:100]}')
                    if len(seen_lines) >= 10:
                        break
