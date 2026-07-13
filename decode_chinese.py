"""Try to decode garbled Chinese using GB18030 reverse - using hex to avoid encoding issues."""
import sys

def build_gb18030_reverse():
    rev = {}
    for b1 in range(0x81, 0xFF):
        for b2 in range(0x40, 0xFF):
            if b2 == 0x7F:
                continue
            try:
                gb_bytes = bytes([b1, b2])
                unicode_char = gb_bytes.decode('gb18030')
                garbled_utf8 = unicode_char.encode('utf-8')
                rev[garbled_utf8] = gb_bytes
            except:
                pass
    return rev

rev_map = build_gb18030_reverse()
print(f"Reverse map: {len(rev_map)} entries")

def reverse_garbled(garbled_bytes):
    """Reverse garbled UTF-8 back to original bytes."""
    result = bytearray()
    i = 0
    while i < len(garbled_bytes):
        b = garbled_bytes[i]
        if b < 0x80:
            result.append(b)
            i += 1
            continue

        matched = False
        for seq_len in [3, 2, 4]:
            if i + seq_len <= len(garbled_bytes):
                seq = garbled_bytes[i:i+seq_len]
                if seq in rev_map:
                    result.extend(rev_map[seq])
                    i += seq_len
                    matched = True
                    break

        if not matched:
            # Keep as-is (original char or unrecoverable)
            for sl in [4, 3, 2, 1]:
                if i + sl <= len(garbled_bytes):
                    try:
                        garbled_bytes[i:i+sl].decode('utf-8')
                        result.extend(garbled_bytes[i:i+sl])
                        i += sl
                        matched = True
                        break
                    except:
                        pass
            if not matched:
                result.append(ord('_'))
                i += 1

    try:
        return result.decode('utf-8')
    except:
        return result.decode('utf-8', errors='replace')

# Read corrupted file and extract specific lines
with open('server.corrupted.orig', 'rb') as f:
    data = f.read()
if data[:3] == b'\xef\xbb\xbf':
    data = data[3:]

lines = data.split(b'\n')

# Extract user-facing messages from specific lines
msgs = {
    'login_error': (2947, b'message: "'),
    'register_success': (2962, b'message: "'),
    'register_dup': (2965, b'message: "'),
    'register_error': (2967, b'message: "'),
    'sync_error_prefix': (2984, b'message: "'),
    'admin_name': (2945, b'name: "'),
}

for name, (line_no, prefix) in msgs.items():
    line = lines[line_no]
    idx = line.find(prefix)
    if idx >= 0:
        start = idx + len(prefix)
        end = line.find(b'"', start)
        if end >= 0:
            garbled = line[start:end]
            decoded = reverse_garbled(garbled)
            print(f'{name}: {decoded}')
