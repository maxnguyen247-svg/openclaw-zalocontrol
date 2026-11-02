/**
 * Đồng bộ 2 chiều: Google Sheet (hàng 春豐) <-> Google Calendar <-> Calendar iPhone.
 * Cấu trúc sheet: hàng 1 = ngày, hàng 2 = 預計工作 / 實際工作, cột B = tên.
 * Mỗi ô có chữ = 1 sự kiện cả ngày: "[預計] nội dung" hoặc "[實際] nội dung".
 */
const CONFIG = {
  NAME: '春豐',
  NAME_COL: 2,
  SHEETS: ['2026工作日報'],          // thêm '2025工作日報'... nếu muốn đồng bộ năm khác
  CAL_NAME: '春豐 工作日報',
  LABEL: { plan: '預計工作', actual: '實際工作' },
  PREFIX: { plan: '[預計] ', actual: '[實際] ' },
  COLOR: { plan: '9', actual: '10' }, // 9 xanh dương, 10 xanh lá
  MAP_SHEET: '_CalSync'
};

// ---------- Cài đặt (chạy 1 lần) ----------
function setup() {
  const props = PropertiesService.getScriptProperties();
  let calId = props.getProperty('CAL_ID');
  if (!calId) {
    calId = CalendarApp.createCalendar(CONFIG.CAL_NAME).getId();
    props.setProperty('CAL_ID', calId);
  }
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('pullChanges').forUserCalendar(Session.getEffectiveUser().getEmail()).onEventUpdated().create();
  ScriptApp.newTrigger('pullChanges').timeBased().everyMinutes(5).create();
  pushAll();
  Logger.log('Xong. Calendar: ' + CONFIG.CAL_NAME);
}

// ---------- Đọc bố cục sheet ----------
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
    const cols = {};
    let cur = null;
    for (let c = 0; c < lastCol; c++) {
      const v = head[0][c];
      const label = String(head[1][c]).trim();
      const kind = label === CONFIG.LABEL.plan ? 'plan' : label === CONFIG.LABEL.actual ? 'actual' : null;
      if (v instanceof Date) cur = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      else if (kind === 'plan') cur = null;
      if (kind && cur) cols[cur + '|' + kind] = c + 1;
    }
    out.push({ sheet: sh, row: row, cols: cols, lastCol: lastCol });
  });
  return out;
}

function locate_(key, lays) {
  for (const l of lays) if (l.cols[key]) return { sheet: l.sheet, row: l.row, col: l.cols[key] };
  return null;
}

function norm_(s) { return String(s).trim().replace(/\s*\n\s*/g, ' / '); }
function title_(kind, text) { return CONFIG.PREFIX[kind] + norm_(text); }
function parseTitle_(summary) {
  let kind = null, text = summary || '';
  for (const k of ['plan', 'actual']) {
    if (text.indexOf(CONFIG.PREFIX[k].trim()) === 0) { kind = k; text = text.slice(CONFIG.PREFIX[k].trim().length).trim(); break; }
  }
  return { kind: kind, text: text };
}
function nextDay_(iso) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function calId_() { return PropertiesService.getScriptProperties().getProperty('CAL_ID'); }

// ---------- Bảng ánh xạ key <-> eventId (sheet ẩn) ----------
function loadMap_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CONFIG.MAP_SHEET);
  if (!sh) { sh = ss.insertSheet(CONFIG.MAP_SHEET); sh.hideSheet(); }
  const n = sh.getLastRow();
  const map = {};
  if (n > 0) sh.getRange(1, 1, n, 2).getValues().forEach(r => { if (r[0]) map[r[0]] = r[1]; });
  return map;
}
function saveMap_(map) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.MAP_SHEET);
  sh.clearContents();
  const rows = Object.keys(map).map(k => [k, map[k]]);
  if (rows.length) sh.getRange(1, 1, rows.length, 2).setValues(rows);
}

// ---------- Sheet -> Calendar ----------
function eventResource_(key, text) {
  const p = key.split('|');
  return {
    summary: title_(p[1], text),
    start: { date: p[0] },
    end: { date: nextDay_(p[0]) },
    colorId: CONFIG.COLOR[p[1]],
    transparency: 'transparent',
    extendedProperties: { private: { key: key } }
  };
}

function upsert_(map, key, text) {
  const cal = calId_();
  if (map[key]) {
    try {
      const ev = Calendar.Events.get(cal, map[key]);
      if (ev.status !== 'cancelled') {
        if (norm_(text) !== parseTitle_(ev.summary).text) {
          Calendar.Events.patch({ summary: title_(key.split('|')[1], text) }, cal, map[key]);
        }
        return;
      }
    } catch (e) { /* sự kiện đã mất, tạo lại */ }
  }
  map[key] = Calendar.Events.insert(eventResource_(key, text), cal).id;
}

function remove_(map, key) {
  if (!map[key]) return;
  try { Calendar.Events.remove(calId_(), map[key]); } catch (e) {}
  delete map[key];
}

function pushAll() {
  const lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    const lays = layouts_();
    const map = loadMap_();
    const seen = {};
    lays.forEach(l => {
      const vals = l.sheet.getRange(l.row, 1, 1, l.lastCol).getValues()[0];
      Object.keys(l.cols).forEach(key => {
        const v = vals[l.cols[key] - 1];
        if (String(v).trim() !== '') { seen[key] = true; upsert_(map, key, v); }
      });
    });
    Object.keys(map).forEach(k => { if (!seen[k]) remove_(map, k); });
    saveMap_(map);
    advanceToken_();
  } finally { lock.releaseLock(); }
}

function onSheetEdit(e) {
  const r = e.range;
  const lays = layouts_().filter(l => l.sheet.getName() === r.getSheet().getName());
  if (!lays.length || r.getRow() > lays[0].row || r.getLastRow() < lays[0].row) return;
  pushAll(); // vài trăm ô: chạy đầy đủ cho đơn giản và an toàn
}

// ---------- Calendar -> Sheet ----------
function advanceToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('SYNC_TOKEN'), page = null, next = null;
  do {
    let res;
    try {
      res = Calendar.Events.list(calId_(), { syncToken: token || undefined, showDeleted: true, maxResults: 2500, pageToken: page || undefined });
    } catch (err) {
      if (String(err).indexOf('410') >= 0) { token = null; props.deleteProperty('SYNC_TOKEN'); page = null; continue; }
      throw err;
    }
    page = res.nextPageToken; next = res.nextSyncToken || next;
  } while (page || (!next && !token));
  if (next) props.setProperty('SYNC_TOKEN', next);
}

function pullChanges() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('SYNC_TOKEN');
    if (!token) { advanceToken_(); return; }
    let items = [], page = null, next = null;
    do {
      let res;
      try {
        res = Calendar.Events.list(calId_(), { syncToken: token, showDeleted: true, maxResults: 2500, pageToken: page || undefined });
      } catch (err) {
        if (String(err).indexOf('410') >= 0) { props.deleteProperty('SYNC_TOKEN'); pushAll(); return; }
        throw err;
      }
      items = items.concat(res.items || []);
      page = res.nextPageToken; next = res.nextSyncToken || next;
    } while (page);

    if (items.length) {
      const lays = layouts_();
      const map = loadMap_();
      const byId = {};
      Object.keys(map).forEach(k => byId[map[k]] = k);
      items.forEach(ev => applyEvent_(ev, lays, map, byId));
      saveMap_(map);
    }
    if (next) props.setProperty('SYNC_TOKEN', next);
  } finally { lock.releaseLock(); }
}

function setCell_(key, lays, text, append) {
  const loc = locate_(key, lays);
  if (!loc) return false;
  const cell = loc.sheet.getRange(loc.row, loc.col);
  const cur = String(cell.getValue());
  if (norm_(cur) === norm_(text)) return true;
  cell.setValue(append && cur.trim() ? cur + '\n' + text : text);
  return true;
}
function clearCell_(key, lays) {
  const loc = locate_(key, lays);
  if (loc) loc.sheet.getRange(loc.row, loc.col).clearContent();
}

function applyEvent_(ev, lays, map, byId) {
  const oldKey = byId[ev.id] || (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.key) || null;

  if (ev.status === 'cancelled') {
    if (oldKey && map[oldKey] === ev.id) { clearCell_(oldKey, lays); delete map[oldKey]; }
    return;
  }
  const date = ev.start && (ev.start.date || (ev.start.dateTime || '').slice(0, 10));
  if (!date) return;
  const t = parseTitle_(ev.summary);
  const oldKind = oldKey ? oldKey.split('|')[1] : 'plan';
  const kind = t.kind || oldKind;
  const newKey = date + '|' + kind;

  if (oldKey && oldKey === newKey) {           // chỉ đổi nội dung
    setCell_(newKey, lays, t.text, false);
    return;
  }
  if (!locate_(newKey, lays)) return;          // ngày mới không có cột trong sheet: bỏ qua
  if (oldKey) { clearCell_(oldKey, lays); delete map[oldKey]; }
  setCell_(newKey, lays, t.text, true);        // ô đã có chữ thì nối thêm
  map[newKey] = ev.id;
  Calendar.Events.patch({
    summary: title_(kind, t.text),
    colorId: CONFIG.COLOR[kind],
    extendedProperties: { private: { key: newKey } }
  }, calId_(), ev.id);
}
