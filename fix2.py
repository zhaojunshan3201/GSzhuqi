with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'rb') as f:
    data = f.read()

# Fix specific corruptions
# Line 49: missing full-width parens in regex
data = data.replace(
    b'base.replace(//g, "(").replace(//g, ")")',
    b'base.replace(/\xef\xbc\x88/g, "(").replace(/\xef\xbc\x89/g, ")")'
)

# Line 52
data = data.replace(
    b'if (base.includes(""))',
    b'if (base.includes("\xef\xbc\x88"))'
)

# Line 53
data = data.replace(
    b'variants.add(base.replace("", ""));',
    b'variants.add(base.replace("\xef\xbc\x88", ""));'
)

# Line 54
data = data.replace(
    b'variants.add(base.replace("", "()"));',
    b'variants.add(base.replace("\xef\xbc\x89", "()"));'
)

with open('C:/Users/31541/Desktop/Manus/GS/GS/server.ts', 'wb') as f:
    f.write(data)

print('Fixed')
