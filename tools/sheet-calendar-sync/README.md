# Đồng bộ Sheet 工作日報 → Calendar iPhone (một chiều)

Google Apps Script gắn vào file Google Sheet, mỗi ngày lúc 0h đọc hàng **春豐** và cập
nhật một Google Calendar riêng (`春豐 工作日報`). iPhone thêm tài khoản Google là thấy lịch này.

## Quy tắc

| Ngày trong sheet | Lấy cột | Tiêu đề sự kiện | Màu |
|---|---|---|---|
| ≤ hôm nay | 實際工作 (nếu trống và `FALLBACK_TO_PLAN = true` → 預計工作) | `[實際] …` / `[預計] …` | xanh lá / xanh dương |
| > hôm nay | 預計工作 | `[預計] …` | xanh dương |

- Mỗi ngày tối đa 1 sự kiện cả ngày. Ô trống → không có sự kiện (sự kiện cũ bị xóa).
- Sheet là nguồn chuẩn: sửa, xóa hay kéo sự kiện trên điện thoại sẽ bị ghi đè ở lần chạy kế tiếp.
- Ô có xuống dòng được nối bằng ` / ` trong tiêu đề.
- Script tạo một tab ẩn `_CalSync` để nhớ sự kiện nào thuộc ngày nào. Không xóa tab này.

## Cài đặt (làm một lần)

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
