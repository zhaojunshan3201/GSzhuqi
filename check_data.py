import sqlite3

db = sqlite3.connect(r"C:\Users\31541\Desktop\Manus\GS\GS\production.db")
db.row_factory = sqlite3.Row

# Get a sample measure with both current and previous round transfer times
measures = db.execute("""
  SELECT jh, current_round_transfer_time, detail_json
  FROM measures
  WHERE current_round_transfer_time IS NOT NULL
  AND detail_json IS NOT NULL
  LIMIT 5
""").fetchall()

import json
for m in measures:
    jh = m['jh']
    curr = m['current_round_transfer_time']
    detail = json.loads(m['detail_json']) if m['detail_json'] else {}
    prev_round = detail.get('previousRound', {})
    
    # Find上轮转抽时间
    prev_keys = ['\u4e0a\u8f6e\u8f6c\u62bd\u65f6\u95f4', '\u4e0a\u8f6e\u8f6c\u62bd\u65e5\u671f',
                 '\u4e0a\u8f6e\u540c\u671f\u8f6c\u62bd\u65f6\u95f4', '\u4e0a\u8f6e\u540c\u671f\u8f6c\u62bd\u65e5\u671f']
    prev_time = None
    for k in prev_keys:
        if k in prev_round:
            prev_time = prev_round[k]
            break
    
    if not prev_time:
        # Try fuzzy
        for k, v in prev_round.items():
            clean = k.replace(' ', '')
            if '\u8f6c\u62bd' in clean and ('\u65f6\u95f4' in clean or '\u65e5\u671f' in clean):
                prev_time = v
                break
    
    print(f"JH: {jh}")
    print(f"  本轮转抽时间: {curr}")
    print(f"  上轮转抽时间: {prev_time}")
    
    if curr and prev_time:
        # Count production days for current round
        curr_days = db.execute(
            "SELECT COUNT(DISTINCT rq) as cnt FROM production WHERE jh=? AND rq >= ?",
            [jh, curr]
        ).fetchone()['cnt']
        
        # Get first and last production dates
        curr_range = db.execute(
            "SELECT MIN(rq) as first_rq, MAX(rq) as last_rq FROM production WHERE jh=? AND rq >= ?",
            [jh, curr]
        ).fetchone()
        
        # Previous round: same number of days
        prev_days = db.execute(
            "SELECT COUNT(DISTINCT rq) as cnt FROM production WHERE jh=? AND rq >= ?",
            [jh, prev_time]
        ).fetchone()['cnt']
        
        # Get production data for first 5 days of each
        curr_data = db.execute(
            "SELECT rq, liquid, oil, water_cut FROM production WHERE jh=? AND rq >= ? ORDER BY rq LIMIT 5",
            [jh, curr]
        ).fetchall()
        
        prev_data = db.execute(
            "SELECT rq, liquid, oil, water_cut FROM production WHERE jh=? AND rq >= ? ORDER BY rq LIMIT 5",
            [jh, prev_time]
        ).fetchall()
        
        print(f"  本轮生产天数(数据库中): {curr_days}")
        print(f"  本轮数据范围: {curr_range['first_rq']} ~ {curr_range['last_rq']}")
        print(f"  上轮可用天数(数据库中): {prev_days}")
        print(f"  本轮前5天:")
        for r in curr_data:
            print(f"    {r['rq']}: liquid={r['liquid']}, oil={r['oil']}, wc={r['water_cut']}")
        print(f"  上轮前5天:")
        for r in prev_data:
            print(f"    {r['rq']}: liquid={r['liquid']}, oil={r['oil']}, wc={r['water_cut']}")
    print()

db.close()