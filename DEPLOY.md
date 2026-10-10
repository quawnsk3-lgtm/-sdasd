# Đưa Veo Studio lên mạng thành website (không cần cài app)

Cách dễ nhất, **miễn phí, không cần thẻ visa**: dùng **Render**
(hosting này cho chạy Docker miễn phí).

> Lưu ý: Hugging Face Spaces bản Docker hiện đã thu phí (chỉ còn Static miễn phí)
> nên không dùng được cho app này nữa.

## Bước 1 — Đưa code lên GitHub (làm 1 lần duy nhất, chỉ cần trình duyệt)

1. Tạo tài khoản https://github.com (miễn phí).
2. Vào https://github.com/new → đặt tên repo `veo-studio` → chọn **Public** → **Create repository**.
3. Trên trang repo vừa tạo: bấm **Add file** → **Upload files** → kéo toàn bộ
   nội dung thư mục `veo-studio` đã giải nén vào (giữ nguyên cấu trúc thư mục) →
   bấm **Commit changes**. Xong, không cần cài gì thêm.

## Bước 2 — Deploy lên Render

1. Vào https://render.com → đăng ký bằng tài khoản GitHub.
2. Bấm **New +** → **Web Service** → chọn repo `veo-studio` vừa push.
3. Render tự nhận `Dockerfile` và `render.yaml` → cứ để mặc định, plan **Free**.
4. Bấm **Deploy** → chờ build ~5-10 phút → có link dạng
   `https://veo-studio.onrender.com`. Mở link lên là xài.

## Bước 3 — Nạp API key (nếu gen video thật)

1. Trên dashboard Render, mở service `veo-studio` → tab **Environment**.
2. Thêm biến `GEMINI_API_KEY` = key lấy ở https://aistudio.google.com/apikey
   (key cần được bật Billing mới gen được video) → **Save** (tự deploy lại).
3. Chưa có key thì bỏ qua — app chạy **chế độ demo**, vọc thoải mái không tốn tiền.

## Lưu ý với gói miễn phí

- Web sẽ **ngủ sau 15 phút không ai vào**; lần mở đầu tiên sau đó chờ ~30-60 giây
  để nó tỉnh dậy. Các job đang gen dở sẽ tự tiếp tục khi web tỉnh.
- File video gen ra lưu **tạm** trên server — **tải về máy ngay** sau khi xong.
- RAM 512MB đủ cho tool cá nhân (gen vài clip, ghép vài video cùng lúc).
- Muốn luôn thức + khỏe hơn: nâng plan Starter ($7/tháng), không bắt buộc.
