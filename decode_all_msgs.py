"""Extract and decode ALL user-facing message strings from corrupted.orig."""
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

def reverse_bytes(garbled_bytes):
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
        return result.decode('utf-8', errors='replace')
    except:
        return str(result)

# Read corrupted file
with open('server.corrupted.orig', 'rb') as f:
    data = f.read()
if data[:3] == b'\xef\xbb\xbf':
    data = data[3:]

lines = data.split(b'\n')

# Find all lines with user-facing message strings
# Patterns: message: "...", error: "...", console.log(`...`), console.error("...")
import re

# Target lines - extracted from the grep of current server.ts
targets = [
    (942, 'admin_name'),
    (1231, 'throw_error'),
    (1238, 'sync_busy_error'),
    (1347, 'default_error'),
    (2280, 'measures_error'),
    (2302, 'measures_import_error'),
    (2713, 'summary_error'),
    (2946, 'admin_display_name'),
    (2948, 'login_failed'),
    (2952, 'server_error_msg'),
    (2963, 'register_success'),
    (2966, 'register_duplicate'),
    (2968, 'register_error'),
    (2979, 'sync_result'),
    (2984, 'sync_conflict_check'),
    (2985, 'sync_error'),
    (2994, 'sync_catch_error'),
    (3003, 'cache_error'),
    (3012, 'data_error'),
    (3020, 'data_400_error'),
    (3094, 'general_error'),
    (3102, 'bad_request'),
    (3108, 'not_found'),
    (3123, 'data_400_error2'),
    (3198, 'general_error2'),
    (3206, 'bad_request2'),
    (3212, 'not_found2'),
    (3216, 'delete_success'),
    (3218, 'delete_error'),
    (3226, 'import_bad_file'),
    (3244, 'import_error'),
    (3254, 'import_empty'),
    (3276, 'import_catch_error'),
    (3286, 'import_no_file'),
    (3293, 'import_parse_error'),
]

for line_no, desc in targets:
    if line_no >= len(lines):
        continue
    line = lines[line_no]
    # Find strings between quotes
    # Try message: "..." pattern
    for prefix in [b'message: "', b'error: "', b'name: "', b'user: { name: "']:
        idx = line.find(prefix)
        if idx >= 0:
            start = idx + len(prefix)
            end = line.find(b'"', start)
            if end >= 0:
                garbled = line[start:end]
                decoded = reverse_bytes(garbled)
                # Clean up replacement chars for display
                cleaned = decoded.replace('\ufffd', '?')
                print(f'Line {line_no} [{desc}]: {cleaned}')
                break
    else:
        # Check for console.log/error patterns
        for prefix in [b'console.log(`', b'console.error("']:
            idx = line.find(prefix)
            if idx >= 0:
                start = idx + len(prefix)
                # Find end pattern
                if prefix == b'console.log(`':
                    end = line.rfind(b'`)')
                    if end < 0:
                        end = line.rfind(b'`);')
                else:
                    end = line.rfind(b'")')
                    if end < 0:
                        end = line.rfind(b'");')
                if end >= start:
                    garbled = line[start:end]
                    decoded = reverse_bytes(garbled)
                    cleaned = decoded.replace('\ufffd', '?')
                    print(f'Line {line_no} [{desc}]: {cleaned[:200]}')
                break
        else:
            print(f'Line {line_no} [{desc}]: (no string found)')
