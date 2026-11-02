"""Xuất các tab 工作日報 từ file .xlsx (tải từ Google Sheet) ra JSON cho test/run.js.

Dùng: python3 dump_sheets.py <file.xlsx> <out.json>
"""
import datetime
import json
import sys

import openpyxl

src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)
out = {}
for ws in wb:
    if '工作日報' not in ws.title:
        continue

    def cell(v):
        if isinstance(v, datetime.datetime):
            return {'$date': v.strftime('%Y-%m-%d')}
        return v

    out[ws.title] = [[cell(ws.cell(r, c).value) for c in range(1, ws.max_column + 1)]
                     for r in range(1, ws.max_row + 1)]
json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print({k: len(v) for k, v in out.items()})
