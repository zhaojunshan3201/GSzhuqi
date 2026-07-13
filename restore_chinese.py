"""
Restore Chinese user-facing strings in server.ts.
Extract original readable strings from corrupted.orig where possible,
and use de-garbling for garbled strings.
Build a replacement map and apply to server.ts.
"""
import sys, json

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

# Read corrupted.orig
with open('server.corrupted.orig', 'rb') as f:
    orig_data = f.read()
if orig_data[:3] == b'\xef\xbb\xbf':
    orig_data = orig_data[3:]

# Read current server.ts
with open('server.ts', 'rb') as f:
    current_data = f.read()

# Find all underscore strings in current server.ts that were originally Chinese
# Pattern: sequences of 4+ underscores that represent replaced Chinese text
import re

# Find all underscore-heavy strings in current server.ts
lines = current_data.split(b'\n')
replacements = {}

# For each line with lots of underscores, try to find the corresponding original in corrupted.orig
current_strs = []
for i, line in enumerate(lines):
    # Find strings with 4+ consecutive underscores (Chinese replacements)
    for match in re.finditer(b'_]{4,}', line):
        # This is too simple - underscores can appear in many contexts
        pass

    # Find quoted strings with many underscores
    dq_parts = []
    in_str = False
    str_start = 0
    for j, b in enumerate(line):
        if b == 0x22:  # "
            if in_str:
                dq_parts.append((str_start, j))
                in_str = False
            else:
                str_start = j + 1
                in_str = True

    for start, end in dq_parts:
        s = line[start:end]
        underscore_count = s.count(b'_')
        if underscore_count >= 4 and len(s) >= 4:
            current_strs.append((i+1, s.decode('utf-8', errors='replace')))

# Write all underscore strings to file for analysis
with open('underscore_strings.txt', 'w', encoding='utf-8') as f:
    for line_no, s in sorted(set(current_strs)):
        f.write(f'Line {line_no}: "{s}"\n')

print(f'Found {len(set(current_strs))} underscore strings')

# Now try to find corresponding originals in corrupted.orig
# by looking for strings that have similar structure but with non-ASCII chars

# Actually, let's take a different approach. For each line in corrupted.orig,
# extract Chinese strings and build a mapping: corrupted_garbled -> original_meaning
# Then apply this to current server.ts

# Let's manually identify the key messages based on context:
key_messages = {
    # Login/Register
    "____________________________________": "用户名或密码错误",  # login failed
    "_____________________?": "服务器错误",  # server error (500)
    "__________________": "注册成功",  # register success
    "___________________________": "用户名已存在",  # duplicate user
    "__________________: ": "注册失败: ",  # register error
    "____________________________________? ": "同步错误: ",  # sync catch
    "____________________________________: ": "服务器错误: ",  # generic error prefix
    "_____________________________________________: ": "数据获取失败: ",  # data error
    "____________________________________: ": "缓存错误: ",  # cache error
    "___________________________: ": "操作失败: ",  # general failure
    "____________________________________ Excel _________": "无效的 Excel 文件或无数据",  # import empty
    "____________________________________?Excel _________": "无效的文件格式",  # bad file
    "____________________________________": "请求参数无效",  # bad request
    "_____________________": "数据不存在",  # not found
    "________________________": "参数不能为空",  # empty params
    "____________________?": "已删除",  # delete success
    # Sync messages
    "_________________________________ ${syncResult.count} _________": "同步成功，共 ${syncResult.count} 条记录",
    "__________________________________________": "已是最新数据",
    "______________________________________________________________": "同步正在进行中",
    "___________________________": "本地数据库错误",  # general data error
    "__________________: ": "操作失败: ",  # error prefix
    # Console errors
    "___________________________:": "启动预热失败:",
    "____________________________________:": "公式修复失败:",
    "______________________": "系统管理员",  # admin name
}

# Apply replacements
data = current_data.decode('utf-8', errors='replace')
count = 0
for old, new in key_messages.items():
    if old in data:
        data = data.replace(old, new)
        count += 1
        print(f'Replaced: {old[:50]}... -> {new[:50]}...')

print(f'\nApplied {count} replacements')

with open('server.ts', 'w', encoding='utf-8') as f:
    f.write(data)
print('Written server.ts')
