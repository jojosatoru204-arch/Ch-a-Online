# CHÙA ONLINE — bản dự án gộp 3 giai đoạn

Dự án web 3D nhiều người chơi, giao diện tiếng Việt. Stack: Node.js 18+, Express, Socket.IO, Three.js.

## Chạy thử trên Android

1. Cài một môi trường Node.js trên Android (ví dụ Termux từ nguồn chính thức F-Droid/GitHub).
2. Giải nén ZIP, mở terminal tại thư mục `chua-online-full`.
3. Chạy `npm install` rồi `npm start`.
4. Mở trình duyệt tại `http://127.0.0.1:3000`.

Nếu dùng dịch vụ host Node.js, tải toàn bộ thư mục lên GitHub rồi tạo dịch vụ Web Service, lệnh build `npm install`, lệnh start `npm start`. Thêm các biến môi trường trong `.env.example` vào phần Environment của host. Không commit `.env`.

## Cấu hình quản trị

Tạo hash bcrypt cho mật khẩu của bạn:

```bash
node -e "require('bcryptjs').hash('MAT_KHAU_RIENG_CUA_BAN',12).then(console.log)"
```

Thiết lập các biến:

- `ADMIN_USERNAME`: tên đăng nhập quản trị.
- `ADMIN_PASSWORD_HASH`: hash bcrypt vừa tạo.
- `ADMIN_TOKEN_SECRET`: chuỗi bí mật ngẫu nhiên dài.
- `MAX_PLAYERS`: tối đa 500.

Trong game, mở bảng quản trị bằng `Ctrl + Shift + A` (hoặc `⌘ + Shift + A`). Đăng nhập để quản lý nhạc, nghi lễ và thông báo. Không dùng mật khẩu mẫu; không chia sẻ token hoặc hash.

## Chức năng hiện có

- Sảnh 3D Three.js, cổng chùa, sân, chính điện, tượng biểu trưng, cây và hồ.
- Chọn tên, kiểm tra tên, tự thêm hậu tố khi trùng.
- Socket.IO realtime, giới hạn chỗ tối đa 500, cấp chỗ tự động và hàng chờ FIFO.
- Avatar đại diện, camera kéo/zoom, thao tác dâng hương/hoa/chắp tay/cúi chào/thỉnh chuông.
- Chat, lời nguyện, thông báo và nghi lễ do quản trị phát.
- Âm thanh URL HTTPS, chỉ phát sau thao tác bật âm thanh của người chơi.
- Bảng quản trị có xác thực bcrypt, token hết hạn và giới hạn thử đăng nhập.
- `/health` để kiểm tra máy chủ.

## Giới hạn cần biết

- Đây là bản nền hoàn chỉnh để chạy và phát triển tiếp, không phải sản phẩm đã QA tải 500 người thật. Cần stress-test, kiểm thử trên nhiều trình duyệt và cấu hình database/Redis nếu triển khai quy mô lớn hoặc chạy nhiều instance.
- Dữ liệu người chơi, lời nguyện và báo cáo hiện lưu trong RAM; khởi động lại máy chủ sẽ xóa dữ liệu. Bản này không lưu mật khẩu/tài khoản người chơi.
- Âm thanh quản trị nhận URL HTTPS; chưa có upload file nhạc. Chỉ dùng nội dung âm thanh bạn có quyền sử dụng.
- Đồ họa là hình học Three.js dựng procedural, chưa có model/texture PBR chuyên nghiệp. Tối ưu 500 avatar cần bổ sung instancing/LOD và kiểm thử thiết bị mục tiêu.
- Âm thanh tự động bị giới hạn bởi chính sách autoplay của trình duyệt; người chơi phải chạm nút Âm thanh.
- Hệ thống hàng chờ cấp ghế khi còn chỗ; bản nền chưa triển khai offer có thời hạn 60 giây, reconnect khôi phục danh tính qua tài khoản, hoặc AFK kick hoàn chỉnh.

## Kiểm tra nhanh

- Mở `/health`, cần nhận JSON `ok: true`.
- Mở game ở hai trình duyệt/thiết bị, đặt hai tên khác nhau và kiểm tra thấy avatar/chat realtime.
- Thử trùng tên, tên quá dài, từ bị chặn.
- Thử gửi lời nguyện và các nút tương tác.
- Cấu hình hash quản trị trước khi thử bảng quản trị.

## Bảo mật triển khai

Dùng HTTPS, mật khẩu quản trị mạnh, `ADMIN_TOKEN_SECRET` riêng; không đưa `.env` lên GitHub. Nếu public rộng, bổ sung persistent database, Redis adapter, kiểm duyệt nâng cao, CSRF/origin policy, audit log và giới hạn tốc độ theo IP/người dùng.
