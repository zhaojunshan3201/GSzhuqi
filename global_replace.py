"""Replace ALL non-ASCII bytes with _ everywhere in the file."""
with open('server.ts', 'rb') as f:
    data = f.read()

print(f'Before: {len(data)} bytes, {sum(1 for b in data if b >= 0x80)} non-ASCII')

# Replace every non-ASCII byte with _
result = bytearray()
for b in data:
    if b >= 0x80:
        result.append(ord('_'))
    else:
        result.append(b)

data = bytes(result)
print(f'After: {len(data)} bytes, {sum(1 for b in data if b >= 0x80)} non-ASCII')

with open('server.ts', 'wb') as f:
    f.write(data)
print('Done')
