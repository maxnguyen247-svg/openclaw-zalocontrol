// Mô phỏng Apps Script runtime (CalendarApp) để kiểm tra Code.gs trên dữ liệu thật.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const data = JSON.parse(fs.readFileSync(__dirname + '/sheets.json', 'utf8'));
const code = fs.readFileSync(process.argv[2], 'utf8');
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let VmDate = Date;
function rev(v) { if (v && v.$date) { const [y, m, d] = v.$date.split('-').map(Number); return new VmDate(y, m - 1, d); } return v == null ? '' : v; }
class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows.map(r => r.map(rev)); }
  getName() { return this.name; }
  getLastRow() { let n = 0; this.rows.forEach((r, i) => { if (r.some(v => v !== '')) n = i + 1; }); return n; }
  getLastColumn() { let n = 0; this.rows.forEach(r => r.forEach((v, j) => { if (v !== '') n = Math.max(n, j + 1); })); return n; }
  row(r) { while (this.rows.length < r) this.rows.push([]); return this.rows[r - 1]; }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((s.rows[r - 1 + i] || [])[c - 1 + j] ?? ''); o.push(row); } return o; },
      getValue() { return (s.rows[r - 1] || [])[c - 1] ?? ''; },
      setValue(v) { s.row(r)[c - 1] = v; },
      setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { s.row(r + i)[c + j - 1] = v; })); },
      clearContent() { if (s.rows[r - 1]) s.rows[r - 1][c - 1] = ''; }
    };
  }
  clearContents() { this.rows = []; }
  hideSheet() {}
}
const ss = { sheets: {}, getSheetByName(n) { return this.sheets[n] || null; }, insertSheet(n) { return this.sheets[n] = new Sheet(n, []); }, getSpreadsheetTimeZone() { return 'Asia/Ho_Chi_Minh'; } };

const api = { calls: [] };
class Ev {
  constructor(id, title, date) { this.id = id; this.title = title; this.date = date; this.color = ''; this.deleted = false; }
  getId() { return this.id; } getTitle() { return this.title; }
  setTitle(t) { api.calls.push('setTitle'); this.title = t; }
  setColor(c) { api.calls.push('setColor'); this.color = c; }
  getAllDayStartDate() { return new Date(this.date); }
  setAllDayDate(d) { api.calls.push('setDate'); this.date = new Date(d); }
  deleteEvent() { api.calls.push('delete'); this.deleted = true; }
}
const cal = { id: 'cal1', events: {}, n: 1,
  createAllDayEvent(title, d) { api.calls.push('create'); const e = new Ev('ev' + (this.n++) + '@google.com', title, new Date(d)); this.events[e.id] = e; return e; },
  getEventById(id) { api.calls.push('get'); const e = this.events[id]; return e && !e.deleted ? e : null; },
  getId() { return this.id } };
const props = { d: {}, getProperty(k) { return this.d[k] ?? null; }, setProperty(k, v) { this.d[k] = v; }, deleteProperty(k) { delete this.d[k]; } };
const builder = new Proxy({}, { get: (_, p) => p === 'create' ? () => ({}) : () => builder });
const ctx = {
  SpreadsheetApp: { getActive: () => ss },
  CalendarApp: { createCalendar: () => cal, getCalendarById: id => id === 'cal1' ? cal : null, EventColor: { BLUE: 'BLUE', GREEN: 'GREEN' } },
  Logger: { log: console.log },
  PropertiesService: { getScriptProperties: () => props },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => builder },
  Utilities: { formatDate: d => iso(d) },
  Session: { getScriptTimeZone: () => 'Asia/Ho_Chi_Minh' },
  console
};
vm.createContext(ctx);
VmDate = vm.runInContext('Date', ctx);
for (const n in data) ss.sheets[n] = new Sheet(n, data[n]);
vm.runInContext(code + '\n;this.__fns = { setup, sync, layouts_, loadMap_, CONFIG };', ctx);
const F = ctx.__fns;
const sh = ss.sheets['2026工作日報'];
const live = () => Object.values(cal.events).filter(e => !e.deleted);
const byDate = d => live().find(e => iso(e.date) === d);
const reset = () => { api.calls = []; };
const muts = () => api.calls.filter(c => c !== 'get');
const setToday = d => { ctx.today_ = () => d; };
const cellSet = (d, k, v) => { const c = F.layouts_()[0].dates[d][k]; v === '' ? sh.getRange(10, c).clearContent() : sh.getRange(10, c).setValue(v); };

// 1. setup với hôm nay = 2026-03-10
setToday('2026-03-10');
F.setup();
const lay = F.layouts_()[0];
assert.strictEqual(lay.row, 10);
const dates = Object.keys(lay.dates);
assert.ok(dates.every(d => lay.dates[d].plan && lay.dates[d].actual), 'mỗi ngày phải có đủ 2 cột');
console.log('ngày trong sheet:', dates.length, dates[0], '->', dates[dates.length - 1], '| sự kiện:', live().length);
assert.ok(live().every(e => e.id && e.title.length > 0));
// ngày đã qua, 實際 trống -> fallback 預計
assert.strictEqual(byDate('2026-01-01').title, '元旦節'); assert.strictEqual(byDate('2026-01-01').color, 'BLUE');
// ngày đã qua, có 實際 -> lấy 實際
assert.strictEqual(byDate('2026-01-07').title, 'Carima'); assert.strictEqual(byDate('2026-01-07').color, 'GREEN');
// ngày tương lai -> 預計 dù 實際 có chữ
const fut = dates.find(d => d > '2026-03-10' && String(sh.getRange(10, lay.dates[d].plan).getValue()).trim());
console.log('ngày tương lai mẫu:', fut, byDate(fut).title);
assert.strictEqual(byDate(fut).color, 'BLUE');
assert.ok(live().every(e => e.date.getHours() === 0));
assert.strictEqual(Object.keys(F.loadMap_()).length, live().length);
const past = live().filter(e => iso(e.date) <= '2026-03-10'), actuals = past.filter(e => e.color === 'GREEN');
console.log('đã qua:', past.length, 'trong đó 實際:', actuals.length, '| tương lai:', live().length - past.length);

// 2. chạy lại không đổi -> chỉ getEventById, không sửa gì
reset(); let st = F.sync(); assert.deepStrictEqual(muts(), []); assert.strictEqual(st.create + st.update + st.remove, 0);

// 3. sang ngày: ngày tương lai có cả 2 cột -> chuyển từ 預計 sang 實際
cellSet(fut, 'actual', 'Đã làm X'); setToday(fut);
reset(); st = F.sync();
assert.strictEqual(byDate(fut).title, 'Đã làm X'); assert.strictEqual(byDate(fut).color, 'GREEN');
assert.deepStrictEqual(muts(), ['setTitle', 'setColor']); assert.strictEqual(st.update, 1);

// 4. sửa ô -> đổi tiêu đề; xóa ô -> xóa sự kiện; điền lại -> tạo lại
cellSet(fut, 'actual', 'Đã làm Y'); reset(); F.sync(); assert.strictEqual(byDate(fut).title, 'Đã làm Y'); assert.deepStrictEqual(muts(), ['setTitle']);
cellSet(fut, 'actual', ''); cellSet(fut, 'plan', ''); reset(); st = F.sync(); assert.ok(!byDate(fut)); assert.deepStrictEqual(muts(), ['delete']); assert.strictEqual(st.remove, 1);
cellSet(fut, 'plan', 'Lại'); reset(); F.sync(); assert.strictEqual(byDate(fut).title, 'Lại'); assert.deepStrictEqual(muts(), ['create', 'setColor']);

// 5. người dùng xóa / sửa / kéo sự kiện trên điện thoại -> lần chạy sau khôi phục theo sheet
const e1 = byDate('2026-01-07'); e1.deleted = true; reset(); F.sync(); assert.strictEqual(byDate('2026-01-07').title, 'Carima'); assert.ok(muts().includes('create'));
const e2 = byDate('2026-01-01'); e2.title = 'Sửa tay'; e2.date = new Date(2026, 0, 2); reset(); F.sync();
assert.strictEqual(e2.title, '元旦節'); assert.strictEqual(iso(e2.date), '2026-01-01'); assert.deepStrictEqual(muts(), ['setTitle', 'setDate']);

// 6. ô có xuống dòng -> gộp thành " / "
cellSet('2026-01-02', 'plan', 'A\nB'); reset(); F.sync(); assert.strictEqual(byDate('2026-01-02').title, 'A / B');

// 7. FALLBACK tắt -> ngày đã qua không có 實際 thì không tạo
F.CONFIG.FALLBACK_TO_PLAN = false; reset(); st = F.sync(); assert.ok(!byDate('2026-01-01')); assert.ok(st.remove > 0);
F.CONFIG.FALLBACK_TO_PLAN = true; F.sync(); assert.strictEqual(byDate('2026-01-01').title, '元旦節');

// 8. sheet năm khác có 春豐 ở hàng khác (2025: hàng 9)
F.CONFIG.SHEETS = ['2026工作日報', '2025工作日報']; const l2 = F.layouts_(); assert.strictEqual(l2[1].row, 9);
console.log('2025: ngày', Object.keys(l2[1].dates).length);
reset(); st = F.sync(); assert.ok(st.create > 100); assert.strictEqual(Object.keys(F.loadMap_()).length, live().length);
console.log('sau khi thêm 2025 -> sự kiện:', live().length, st);

console.log('ALL OK');
