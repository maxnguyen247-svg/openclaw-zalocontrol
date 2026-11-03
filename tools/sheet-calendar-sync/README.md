# Đồng bộ Sheet 工作日報 → Calendar iPhone (một chiều)

Hai cách làm, cùng một quy tắc:

1. **Lịch đăng ký (.ics) qua GitHub Actions** — đang dùng. Workflow
   `.github/workflows/calendar-feed.yml` chạy mỗi 10 phút, tải sheet (chia sẻ công khai) một lần,
   rồi dựng **mỗi nhân viên một file lịch** (nhóm dòng 10-14) bằng `ics/build_ics.py`
   (chỉ lấy sự kiện từ 30 ngày trước đến 45 ngày sau hôm nay, đổi ở `--past-days`/`--future-days`)
   và đưa lên nhánh `calendar-feed` khi nội dung có thay đổi. Lịch đăng ký trên iPhone chỉ có
   một màu cho cả lịch, nên muốn mỗi người một màu thì mỗi người một lịch riêng:

   | Nhân viên | File (`https://raw.githubusercontent.com/maxnguyen247-svg/openclaw-zalocontrol/calendar-feed/…`) | Màu gợi ý |
   |---|---|---|
   | 春豐 | `chunfeng.ics` | xanh dương |
   | 名翔 | `mingxiang.ics` | cam |
   | 曰廣 | `yueguang.ics` | tím |
   | 維院 | `weiyuan.ics` | hồng |
   | 文穩 | `wenwen.ics` | xanh ngọc |

   Thêm/bớt người: sửa danh sách `PEOPLE` trong workflow (`tên ở cột B|tên file|màu`).
   iPhone: Cài đặt → Lịch → Tài khoản → Thêm tài khoản → Khác → Thêm lịch đăng ký (làm cho từng link).
   Màu trong file chỉ là gợi ý; nếu iPhone không dùng thì đổi màu ở app Lịch → Lịch → bấm (i) cạnh tên lịch.
   Repo công khai nên ai có link đều đọc được các lịch này (chủ sheet đã đồng ý).
   Không cần tài khoản Google trên máy. iPhone tự tải lại lịch định kỳ.
2. **Google Apps Script** (`Code.gs`) — cần máy tính để cài, sự kiện nằm trong Google
   Calendar. Hướng dẫn ở phần dưới.

Cả hai đều chỉ đọc sheet, không ghi ngược.

## Quy tắc

| Ngày trong sheet | Lấy cột | Tiêu đề sự kiện |
|---|---|---|
| ≤ hôm nay | 實際工作 (nếu trống và fallback bật → 預計工作) | `🟢 nội dung` (thực tế) hoặc `🔵 nội dung` (nếu phải dùng dự kiến) |
| > hôm nay | 預計工作 | `🔵 nội dung` (dự kiến) |

- Mỗi ngày tối đa 1 sự kiện cả ngày. Ô trống → không có sự kiện (sự kiện cũ bị xóa).
- Lịch đăng ký (.ics) không đổi được màu chữ từng sự kiện, nên cách 1 dùng icon nhỏ ở đầu tiêu đề
  (`--mark icon` trong workflow). Đổi sang chữ `[預計]`/`[實際]` bằng `--mark label`, bỏ hẳn bằng `--mark none`.
  Cách 2 (`Code.gs`) phân biệt bằng màu xanh lá/xanh dương của sự kiện, hoặc điền `PREFIX`.
- Sheet là nguồn chuẩn: sửa, xóa hay kéo sự kiện trên điện thoại sẽ bị ghi đè ở lần chạy kế tiếp.
- Ô có xuống dòng được nối bằng ` / ` trong tiêu đề.
- Script tạo một tab ẩn `_CalSync` để nhớ sự kiện nào thuộc ngày nào. Không xóa tab này.

## Chạy thử `build_ics.py` tại chỗ

```bash
pip install openpyxl
python3 ics/build_ics.py --src "https://docs.google.com/spreadsheets/d/<ID>/export?format=xlsx" --name 春豐 --out chunfeng.ics
python3 ics/build_ics.py --src file.xlsx --today 2026-03-10 --no-fallback   # kiểm thử
```

## Cài đặt Apps Script (cách 2, làm một lần)

1. Mở Google Sheet → **Extensions → Apps Script**.
2. Xóa nội dung mặc định, dán toàn bộ `Code.gs` vào, bấm Save.
3. Chọn hàm **`setup`** trên thanh công cụ → **Run**. Cấp quyền khi được hỏi
   (Calendar + Spreadsheet). `setup` tạo calendar, đồng bộ lần đầu và đặt lịch chạy hằng ngày.
4. Trên iPhone: **Cài đặt → Lịch → Tài khoản → Thêm tài khoản → Google**, đăng nhập đúng
   tài khoản vừa chạy script, bật **Lịch**. Mở app Lịch → Lịch → tick `春豐 工作日報`.

Muốn đồng bộ ngay không chờ 0h: trong Apps Script chọn hàm `sync` → Run.

## Tùy chỉnh (đầu file `Code.gs`, khối `CONFIG`)

- `SHEETS`: danh sách tab cần đồng bộ, mặc định `['2026工作日報']`. Thêm `'2025工作日報'` nếu cần.
- `FALLBACK_TO_PLAN`: `false` nếu ngày đã qua mà 實際 trống thì **không** tạo sự kiện.
- `RUN_HOUR`: giờ chạy hằng ngày (Apps Script chạy trong khoảng 1 giờ sau mốc này).
- `NAME`: đổi tên người khác nếu muốn đồng bộ hàng khác.

Sau khi sửa `CONFIG`, chạy lại `setup` một lần.

## Kiểm thử ngoài Google

`test/run.js` mô phỏng SpreadsheetApp/CalendarApp bằng Node và chạy 8 kịch bản trên
dữ liệu thật (xuất từ sheet bằng `test/dump_sheets.py`, file `sheets.json` không commit):

```bash
python3 test/dump_sheets.py <file.xlsx> test/sheets.json
node test/run.js Code.gs
```
