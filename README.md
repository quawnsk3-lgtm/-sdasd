# Veo Studio — Nhập prompt, nhận video AI

App web giúp anh nhập prompt → gọi **Veo 3.1 API** của Google để gen footage AI thật
→ tải clip về → ghép nhiều clip thành 1 video 9:16 đăng TikTok.

## Chạy app

```bash
cd veo-studio
npm install        # lần đầu thôi
npm start          # mở http://127.0.0.1:8787
```

## Lấy API key (để gen video thật)

1. Vào https://aistudio.google.com/apikey → tạo API key.
2. **Bắt buộc bật Billing** cho project (Veo không có free tier — chỉ tính tiền khi gen thành công).
3. Copy file `.env.example` thành `.env`, dán key vào `GEMINI_API_KEY=...`, chạy lại `npm start`.

Chưa có key thì app tự chạy **chế độ MOCK (demo)**: mọi nút bấm hoạt động bình thường,
chỉ thay clip AI thật bằng clip mẫu — không tốn một đồng nào. Rất hợp để test workflow.

## Chi phí (giá Google 10/2026, đã gồm audio)

| Model | 720p | 1080p | 1 clip 8s 1080p |
|---|---|---|---|
| Veo 3.1 Lite | $0.05/s | $0.08/s | ≈ $0.64 |
| Veo 3.1 Fast | $0.10/s | $0.12/s | ≈ $0.96 |
| Veo 3.1 Standard | $0.40/s | $0.40/s | ≈ $3.20 |

App luôn hiện **ước tính chi phí trước khi bấm Tạo video**. Mẹo tiết kiệm: test prompt
bằng Lite 720p ($0.40/clip), ưng rồi mới gen Fast/Standard 1080p.

## Cách dùng

1. Nhập prompt **tiếng Anh** (Veo hiểu tiếng Anh tốt nhất), mô tả: góc máy + hành động +
   bối cảnh + ánh sáng + phong cách. VD: `Cinematic close-up of a young woman lighting
   incense at a Thai temple, slow push-in, warm candlelight, photorealistic`.
2. Điền negative prompt để loại thứ không muốn: `text, subtitles, watermark, blurry`.
3. Chọn model → khổ 9:16 → số clip (tối đa 4/lần) → bấm **Tạo video**.
4. Chờ job chuyển sang **Xong** (thường 1–6 phút/clip) → xem preview → tải clip.
5. Tick chọn nhiều clip → đặt tên file → **Ghép thành 1 video** → tải file cuối.

## Dùng với Flow Pro (không cần API key)

Credit Flow Pro **không** dùng được cho API — Google tách riêng 2 hệ thống tính tiền.
Nhưng anh vẫn tận dụng được gói Pro: gen clip trên web Flow như bình thường → tải file
về → vào mục **📤 Upload clip có sẵn** trong app để upload → tick chọn → ghép thành
video cuối. Cách này không tốn thêm đồng API nào.

## Lưu ý

- Veo 3.1 gen clip **8 giây**, có âm thanh gốc (thoại, nhạc nền, SFX).
- Bộ lọc nội dung của Google khá gắt: tránh trẻ em trong cảnh căng thẳng, bạo lực
  hình ảnh. Prompt bị từ chối sẽ hiện lỗi đỏ ở job — sửa prompt rồi gen lại (lần bị
  từ chối **không** bị tính tiền).
- File video lưu trong `output/`, job lưu trong `jobs.json`. Xóa job trên UI cũng xóa file.
- API key chỉ nằm trong file `.env` trên máy anh, không gửi đi đâu ngoài Google.
