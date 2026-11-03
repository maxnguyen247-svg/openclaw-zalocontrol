#!/usr/bin/env python3
"""Tạo file .ics (lịch đăng ký) từ hàng của một người trong Google Sheet 工作日報.

Quy tắc mỗi ngày (tối đa 1 sự kiện cả ngày, tiêu đề = nội dung ô):
  - ngày <= hôm nay : cột 實際工作; nếu trống và --fallback -> cột 預計工作
  - ngày >  hôm nay : cột 預計工作
  (--mark icon thêm 🔵 dự kiến / 🟢 thực tế vào đầu tiêu đề; --mark label thêm "[預計] "/"[實際] ")

Dùng:
  python3 build_ics.py --src <URL export xlsx | file.xlsx> --name 春豐 --out chunfeng.ics
"""
import argparse
import datetime as dt
import hashlib
import io
import re
import sys
import urllib.request
from zoneinfo import ZoneInfo

import openpyxl

LABEL = {'plan': '預計工作', 'actual': '實際工作'}
PREFIX = {'plan': '[預計] ', 'actual': '[實際] '}
ICON = {'plan': '\U0001F535 ', 'actual': '\U0001F7E2 '}  # 🔵 dự kiến, 🟢 thực tế


def norm(v):
    return re.sub(r'\s*\n\s*', ' / ', str('' if v is None else v).strip())


def load(src):
    if re.match(r'^https?://', src):
        req = urllib.request.Request(src, headers={'User-Agent': 'sheet-calendar-sync'})
        data = urllib.request.urlopen(req, timeout=120).read()
        return openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    return openpyxl.load_workbook(src, data_only=True)


def layout(ws, name, name_col):
    """Trả về (hàng của `name`, {date: {'plan': col, 'actual': col}})."""
    row = next((r for r in range(1, ws.max_row + 1) if norm(ws.cell(r, name_col).value) == name), None)
    if not row:
        return None, {}
    dates, cur = {}, None
    for c in range(1, ws.max_column + 1):
        v = ws.cell(1, c).value
        label = norm(ws.cell(2, c).value)
        kind = 'plan' if label == LABEL['plan'] else 'actual' if label == LABEL['actual'] else None
        if isinstance(v, dt.datetime):
            cur = v.date()
        elif isinstance(v, dt.date):
            cur = v
        elif kind == 'plan':
            cur = None  # cột 預計 không có ngày: bỏ qua cặp này
        if not kind or not cur:
            continue
        dates.setdefault(cur, {}).setdefault(kind, c)
    return row, dates


def pick(date, today, plan, actual, fallback):
    if date <= today:
        if actual:
            return 'actual', actual
        if fallback and plan:
            return 'plan', plan
        return None
    return ('plan', plan) if plan else None


def collect(wb, sheets, name, name_col, today, fallback, past_days=None, future_days=None):
    """past_days/future_days: chỉ lấy ngày trong [today - past_days, today + future_days]; None = không giới hạn."""
    lo = today - dt.timedelta(days=past_days) if past_days is not None else None
    hi = today + dt.timedelta(days=future_days) if future_days is not None else None
    events = {}
    for sheet in sheets:
        if sheet not in wb.sheetnames:
            print(f'bỏ qua: không có tab {sheet}', file=sys.stderr)
            continue
        ws = wb[sheet]
        row, dates = layout(ws, name, name_col)
        if not row:
            print(f'bỏ qua: tab {sheet} không có hàng {name}', file=sys.stderr)
            continue
        for date, cols in sorted(dates.items()):
            if date in events or (lo and date < lo) or (hi and date > hi):
                continue
            plan = norm(ws.cell(row, cols['plan']).value) if 'plan' in cols else ''
            actual = norm(ws.cell(row, cols['actual']).value) if 'actual' in cols else ''
            p = pick(date, today, plan, actual, fallback)
            if p:
                events[date] = p
    return events


def esc(s):
    return s.replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')


def fold(line):
    """Gập dòng theo RFC 5545 (tối đa 75 byte, không cắt giữa ký tự UTF-8)."""
    out, b = [], line.encode('utf-8')
    while len(b) > 75:
        cut = 75
        while cut > 0 and (b[cut] & 0xC0) == 0x80:
            cut -= 1
        out.append(b[:cut].decode('utf-8'))
        b = b' ' + b[cut:]
    out.append(b.decode('utf-8'))
    return '\r\n'.join(out)


def to_ics(events, name, tz, uid_domain, mark='none', color=None):
    marks = {'none': {'plan': '', 'actual': ''}, 'icon': ICON, 'label': PREFIX}[mark]
    tag = hashlib.md5(name.encode('utf-8')).hexdigest()[:8]
    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//openclaw-zalocontrol//sheet-calendar-sync//VI',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        f'X-WR-CALNAME:{esc(name)} 工作日報',
        f'X-WR-TIMEZONE:{tz}',
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
    ]
    if color:
        lines.append(f'X-APPLE-CALENDAR-COLOR:{color}')
    for date in sorted(events):
        kind, text = events[date]
        d = date.strftime('%Y%m%d')
        nxt = (date + dt.timedelta(days=1)).strftime('%Y%m%d')
        lines += [
            'BEGIN:VEVENT',
            f'UID:{d}-{tag}@{uid_domain}',
            f'DTSTAMP:{d}T000000Z',
            f'DTSTART;VALUE=DATE:{d}',
            f'DTEND;VALUE=DATE:{nxt}',
            f'SUMMARY:{esc(marks[kind] + text)}',
            'TRANSP:TRANSPARENT',
            'END:VEVENT',
        ]
    lines.append('END:VCALENDAR')
    return '\r\n'.join(fold(l) for l in lines) + '\r\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='URL export xlsx của Google Sheet, hoặc đường dẫn file .xlsx')
    ap.add_argument('--name', default='春豐', help='tên ở cột B')
    ap.add_argument('--name-col', type=int, default=2)
    ap.add_argument('--sheets', default='auto',
                    help='tên tab, cách nhau bằng dấu phẩy; "auto" = tab <năm nay>工作日報 và <năm sau>工作日報 nếu có')
    ap.add_argument('--tz', default='Asia/Ho_Chi_Minh')
    ap.add_argument('--today', help='yyyy-mm-dd, mặc định hôm nay theo --tz (dùng để kiểm thử)')
    ap.add_argument('--fallback', dest='fallback', action='store_true', default=True,
                    help='ngày đã qua mà 實際 trống thì lấy 預計 (mặc định bật)')
    ap.add_argument('--no-fallback', dest='fallback', action='store_false')
    ap.add_argument('--mark', choices=['none', 'icon', 'label'], default='none',
                    help='đánh dấu đầu tiêu đề: icon = 🔵 dự kiến / 🟢 thực tế; label = [預計]/[實際]; none = không')
    ap.add_argument('--past-days', type=int, default=None, help='chỉ lấy tối đa N ngày trước hôm nay (mặc định: không giới hạn)')
    ap.add_argument('--future-days', type=int, default=None, help='chỉ lấy tối đa N ngày sau hôm nay (mặc định: không giới hạn)')
    ap.add_argument('--color', help='màu gợi ý của cả lịch, dạng #RRGGBB (iPhone có thể bỏ qua, khi đó tự chọn trong app Lịch)')
    ap.add_argument('--uid-domain', default='openclaw-zalocontrol')
    ap.add_argument('--out', default='-')
    a = ap.parse_args()

    today = dt.date.fromisoformat(a.today) if a.today else dt.datetime.now(ZoneInfo(a.tz)).date()
    wb = load(a.src)
    if a.sheets == 'auto':
        sheets = [s for s in (f'{today.year}工作日報', f'{today.year + 1}工作日報') if s in wb.sheetnames]
    else:
        sheets = [s.strip() for s in a.sheets.split(',') if s.strip()]
    events = collect(wb, sheets, a.name, a.name_col, today, a.fallback, a.past_days, a.future_days)
    ics = to_ics(events, a.name, a.tz, a.uid_domain, a.mark, a.color)
    if a.out == '-':
        sys.stdout.write(ics)
    else:
        with open(a.out, 'w', encoding='utf-8', newline='') as f:
            f.write(ics)
    n_act = sum(1 for k, _ in events.values() if k == 'actual')
    print(f'{today}: tabs={sheets} sự kiện={len(events)} (實際={n_act}, 預計={len(events) - n_act})', file=sys.stderr)


if __name__ == '__main__':
    main()
