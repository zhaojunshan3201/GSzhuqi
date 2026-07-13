import re

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'rb') as f:
    data = f.read()

# Find all lines containing ? in string literals that break syntax
# The pattern is: a string literal containing "? that's not closed properly
# Let's fix all instances where "? appears inside a string and breaks it

# Pattern 1: "?] -> "]
# Pattern 2: "?) -> ")
# Pattern 3: "?, -> ",
# Pattern 4: "?; -> ";

replacements = [
    # In hasAnyRemarkKeyword arrays
    (b'["\x8d\x9e\xe6\xb2\xb9", "\xef\xbf\xbd?])', b'["\x8d\x9e\xe6\xb2\xb9", "\x8d\x9e\xe6\xb2\xb9\xe5\xbc\x80"])'),  # 捞油
]

# Actually, let's take a simpler approach: find all "? sequences and fix them
# by replacing the "? with a correct closing

# Let me just find all the broken string patterns
text = data.decode('utf-8')

# Find all lines with "? pattern that could break syntax
import sys
broken = []
for i, line in enumerate(text.split('\n')):
    if line.count('"') % 2 != 0:
        broken.append((i+1, line.strip()[:120]))

print(f'Found {len(broken)} lines with odd number of double quotes:')
for line_num, content in broken[:30]:
    print(f'  Line {line_num}: {content}')

# Write a list to a file for reference
with open('C:/Users/31541/Desktop/Manus/GS/GS/broken_lines.txt', 'w', encoding='utf-8') as f:
    for line_num, content in broken:
        f.write(f'Line {line_num}: {content}\n')
print(f'\nFull list written to broken_lines.txt')
