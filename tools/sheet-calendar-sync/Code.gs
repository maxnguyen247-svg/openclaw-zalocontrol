/**
 * Đồng bộ MỘT CHIỀU: Google Sheet (hàng 春豐) -> Google Calendar -> Calendar iPhone.
 *
 * Cấu trúc sheet: hàng 1 = ngày, hàng 2 = 預計工作 / 實際工作, cột B = tên.
 * Mỗi ngày tạo tối đa 1 sự kiện cả ngày, tiêu đề = nội dung ô:
 *   - ngày <= hôm nay : lấy cột 實際工作 (xanh lá)
 *                        (nếu cột 實際 trống và FALLBACK_TO_PLAN = true thì lấy 預計)
 *   - ngày >  hôm nay : lấy cột 預計工作 (xanh dương)
 * PREFIX: điền '[實際] ' / '[預計] ' nếu muốn có nhãn ở đầu tiêu đề.
 * Chạy tự động mỗi ngày lúc 0h (RUN_HOUR). Sheet là nguồn chuẩn: sửa/xóa trên
 * điện thoại sẽ bị ghi đè ở lần chạy kế tiếp.
 *
 * Cài đặt: chạy hàm setup() một lần. Muốn đồng bộ ngay: chạy sync().
 */
const CONFIG = {
  NAME: '春豐',
  NAME_COL: 2,
  SHEETS: ['2026工作日報'],            // thêm '2025工作日報', ... nếu muốn đồng bộ năm khác
  CAL_NAME: '春豐 工作日報',
  LABEL: { plan: '預計工作', actual: '實際工作' },
  PREFIX: { plan: '', actual: '' },      // nhãn đầu tiêu đề, ví dụ '[預計] ' / '[實際] '
  FALLBACK_TO_PLAN: true,              // ngày đã qua mà 實際 trống -> dùng 預計
  RUN_HOUR: 0,                         // giờ chạy hằng ngày (0 = 0h-1h sáng)
  MAP_SHEET: '_CalSync'                // sheet ẩn: ngày | eventId | loại | nội dung đã đồng bộ
};

// ====================== CÀI ĐẶT (chạy 1 lần) ======================
function setup() {
  const props = PropertiesService.getScriptProperties();
  let calId = props.getProperty('CAL_ID');
  if (!calId || !CalendarApp.getCalendarById(calId)) {
    calId = CalendarApp.createCalendar(CONFIG.CAL_NAME).getId();
    props.setProperty('CAL_ID', calId);
  }
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sync').timeBased().everyDays(1).atHour(CONFIG.RUN_HOUR).create();
  sync();
  Logger.log('Xong. Calendar: ' + CONFIG.CAL_NAME + ' (' + calId + ')');
}

// ====================== TIỆN ÍCH ======================
function calId_() { return PropertiesService.getScriptProperties().getProperty('CAL_ID'); }
function norm_(s) { return String(s == null ? '' : s).trim().replace(/\s*\n\s*/g, ' / '); }
function title_(kind, text) { return CONFIG.PREFIX[kind] + text; }
function color_(kind) { return kind === 'actual' ? CalendarApp.EventColor.GREEN : CalendarApp.EventColor.BLUE; }
function today_(tz) { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'); }
function toDate_(iso) { const p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function isoOf_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function isIso_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

// ====================== BỐ CỤC SHEET ======================
/** [{sheet, row, dates: {'yyyy-MM-dd': {plan: col, actual: col}}, lastCol}] */
function layouts_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const out = [];
  CONFIG.SHEETS.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    const head = sh.getRange(1, 1, 2, lastCol).getValues();
    const names = sh.getRange(1, CONFIG.NAME_COL, lastRow, 1).getValues();
    let row = 0;
    for (let r = 0; r < names.length; r++) {
      if (String(names[r][0]).trim() === CONFIG.NAME) { row = r + 1; break; }
    }
    if (!row) return;
    const dates = {};
    let cur = null;
    for (let c = 0; c < lastCol; c++) {
      const v = head[0][c];
      const label = String(head[1][c]).trim();
      const kind = label === CONFIG.LABEL.plan ? 'plan' : label === CONFIG.LABEL.actual ? 'actual' : null;
      if (v instanceof Date && !isNaN(v)) cur = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      else if (kind === 'plan') cur = null;          // cột 預計 không có ngày: bỏ qua cặp này
      if (!kind || !cur) continue;
      if (!dates[cur]) dates[cur] = {};
      if (!dates[cur][kind]) dates[cur][kind] = c + 1;
    }
    out.push({ sheet: sh, row: row, dates: dates, lastCol: lastCol });
  });
  return out;
}

// ====================== BẢNG ÁNH XẠ (sheet ẩn) ======================
/** map[date] = { id, kind, text } */
function loadMap_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CONFIG.MAP_SHEET);
  if (!sh) { sh = ss.insertSheet(CONFIG.MAP_SHEET); sh.hideSheet(); }
  const n = sh.getLastRow();
  const map = {};
  if (n > 0) sh.getRange(1, 1, n, 4).getValues().forEach(r => {
    if (isIso_(r[0]) && r[1]) map[r[0]] = { id: String(r[1]), kind: String(r[2]), text: norm_(r[3]) };
  });
  return map;
}
function saveMap_(map) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.MAP_SHEET);
  sh.clearContents();
  const rows = Object.keys(map).sort().map(k => [k, map[k].id, map[k].kind, map[k].text]);
  if (rows.length) sh.getRange(1, 1, rows.length, 4).setValues(rows);
}

// ====================== ĐỒNG BỘ ======================
/** Chọn nội dung cho 1 ngày theo quy tắc. Trả về {kind, text} hoặc null. */
function pick_(date, today, plan, actual) {
  if (date <= today) {
    if (actual) return { kind: 'actual', text: actual };
    if (CONFIG.FALLBACK_TO_PLAN && plan) return { kind: 'plan', text: plan };
    return null;
  }
  return plan ? { kind: 'plan', text: plan } : null;
}

function ensure_(cal, map, date, kind, text) {
  const title = title_(kind, text);
  let ev = null;
  if (map[date]) { try { ev = cal.getEventById(map[date].id); } catch (e) { ev = null; } }
  if (!ev) {
    ev = cal.createAllDayEvent(title, toDate_(date));
    ev.setColor(color_(kind));
    map[date] = { id: ev.getId(), kind: kind, text: text };
    return 'create';
  }
  let changed = false;
  if (ev.getTitle() !== title) { ev.setTitle(title); changed = true; }
  if (map[date].kind !== kind) { ev.setColor(color_(kind)); changed = true; }
  const start = ev.getAllDayStartDate();
  if (!start || isoOf_(start) !== date) { ev.setAllDayDate(toDate_(date)); changed = true; }
  map[date] = { id: map[date].id, kind: kind, text: text };
  return changed ? 'update' : 'same';
}

function remove_(cal, map, date) {
  try { const ev = cal.getEventById(map[date].id); if (ev) ev.deleteEvent(); } catch (e) { /* đã xóa rồi */ }
  delete map[date];
}

/** Đồng bộ toàn bộ hàng 春豐 lên calendar (trigger hằng ngày, hoặc chạy tay). */
function sync() {
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const cal = CalendarApp.getCalendarById(calId_());
    if (!cal) throw new Error('Chưa có calendar. Hãy chạy setup() trước.');
    const ss = SpreadsheetApp.getActive();
    const today = today_(ss.getSpreadsheetTimeZone());
    const lays = layouts_();
    const map = loadMap_();
    const seen = {};
    const stat = { create: 0, update: 0, same: 0, remove: 0 };
    lays.forEach(l => {
      const vals = l.sheet.getRange(l.row, 1, 1, l.lastCol).getValues()[0];
      Object.keys(l.dates).forEach(date => {
        if (seen[date]) return;
        const cols = l.dates[date];
        const plan = cols.plan ? norm_(vals[cols.plan - 1]) : '';
        const actual = cols.actual ? norm_(vals[cols.actual - 1]) : '';
        const p = pick_(date, today, plan, actual);
        if (!p) return;
        seen[date] = true;
        stat[ensure_(cal, map, date, p.kind, p.text)]++;
      });
    });
    Object.keys(map).forEach(d => { if (!seen[d]) { remove_(cal, map, d); stat.remove++; } });
    saveMap_(map);
    Logger.log('sync ' + today + ': ' + JSON.stringify(stat));
    return stat;
  } finally { lock.releaseLock(); }
}
