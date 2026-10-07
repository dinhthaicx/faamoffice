<p align="center">
  <img src="apps/shell/build/icons/256x256.png" alt="FaamOffice" width="128">
</p>

<h1 align="center">FaamOffice</h1>

<p align="center"><b>Bộ ứng dụng văn phòng mã nguồn mở có trợ lý Faam AI.</b><br>
Soạn và sửa Word, Excel, PowerPoint, PDF, Markdown, HTML ngay trên máy; lưu lại đúng định dạng gốc.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="../../releases/latest"><b>Tải về</b></a>
</p>

---

## Có gì trong FaamOffice

| Ứng dụng     | Mở và lưu                        |
| ------------ | -------------------------------- |
| **Docs**     | `.docx`                          |
| **Sheets**   | `.xlsx`, `.xlsm`, `.xls`, `.csv` |
| **Slides**   | `.pptx`                          |
| **PDF**      | `.pdf` (đọc, chú thích, sửa chữ) |
| **Markdown** | `.md`                            |
| **HTML**     | `.html`                          |

Mọi tệp được mở, sửa và lưu ngay trên máy của bạn. Mỗi ứng dụng có bảng
**Faam AI** bên cạnh: trợ lý đọc tài liệu đang mở và sửa trực tiếp qua công cụ
của trình soạn thảo.

## Faam AI: chọn AI bạn muốn

Vào **Cài đặt → Mô hình AI** và chọn nhà cung cấp:

| Loại              | Nhà cung cấp                                                                                                      | Cần gì                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **AI cục bộ**     | Ollama, LM Studio, llama.cpp server                                                                               | Không cần API key              |
| **Đám mây**       | OpenAI, Anthropic Claude, Google Gemini, DeepSeek, xAI Grok, Mistral, Groq, OpenRouter, Kimi, Qwen, GLM, MiniMax… | API key của bạn                |
| **Faam AI Cloud** | Các mô hình AI trên máy chủ FaamOffice, có thể giới hạn số lượt mỗi ngày                                          | Đăng nhập tài khoản FaamOffice |
| **Tuỳ chỉnh**     | Bất kỳ máy chủ nào tương thích OpenAI (vLLM, LocalAI, Jan…)                                                       | Base URL, key nếu máy chủ cần  |

### Dùng AI chạy trên máy (không gửi dữ liệu ra ngoài)

1. Cài [Ollama](https://ollama.com) rồi tải một mô hình có hỗ trợ gọi công cụ (tool calling), ví dụ:
   ```bash
   ollama pull qwen3
   ```
2. Trong FaamOffice: **Cài đặt → Mô hình AI → Ollama (local)**. Danh sách mô hình tự hiện ra
   từ `http://localhost:11434/v1`; chọn mô hình rồi bấm **Lưu**.

LM Studio (`http://localhost:1234/v1`) và llama.cpp (`http://localhost:8080/v1`) làm tương tự.
Máy chủ chạy ở máy khác trong mạng LAN thì điền địa chỉ đó vào ô **Base URL**.

> Faam AI sửa tài liệu bằng cách gọi công cụ, nên hãy chọn mô hình hỗ trợ **tool calling**
> (Qwen 3, Llama 3.1+, Mistral, GPT-OSS…). Mô hình không hỗ trợ vẫn trò chuyện được nhưng
> không sửa được tài liệu.

## Tài khoản FaamOffice (không bắt buộc)

App dùng được hoàn toàn mà không cần tài khoản. Đăng nhập (Cài đặt → Hồ sơ → Đăng nhập) chỉ để dùng
các mô hình **Faam AI Cloud** ngay trong app: app mở trình duyệt, bạn xác nhận mã, rồi app nhận token.
Tuỳ cấu hình máy chủ, Cài đặt → Hồ sơ hiện số credit còn lại (khi bật Faam credit) hoặc số lượt Faam AI
đã dùng hôm nay (khi tắt credit và đặt giới hạn mỗi ngày).

Các nút theo dõi kênh (Facebook, YouTube, TikTok…) ngay phía trên **Cài đặt** ở màn hình chính, và ở
chân trang website, do quản trị viên đặt trong **Admin → Cài đặt** trên website. App đọc danh sách này
mỗi lần khởi động và nhớ lại để vẫn hiện khi không có mạng.

Máy chủ tài khoản và website giới thiệu nằm trong thư mục [`web/`](web/) (Next.js + Prisma).
Xem [web/README.md](web/README.md) để chạy thử trên máy, cấu hình AI phía máy chủ, bật/tắt Faam credit
và giới hạn số lượt mỗi ngày.
Máy chủ tài khoản mặc định là **https://faamoffice.net**. Có thể thay bằng biến `FAAMOFFICE_ACCOUNT_URL` lúc
build, và người dùng có thể đổi trong Cài đặt → Hồ sơ (ví dụ trỏ về máy chủ tự dựng).

## Tải về

Bộ cài cho macOS (Apple Silicon và Intel), Windows (x64) và Linux (AppImage, deb, rpm) nằm ở
trang [Releases](../../releases/latest).

Bản build hiện chưa có chữ ký số của Apple/Microsoft, nên lần mở đầu tiên sẽ bị hệ điều hành hỏi lại:

- **macOS 15 Sequoia trở lên (gồm 26 Tahoe):**
  1. Kéo FaamOffice vào Applications rồi mở. Khi macOS báo không mở được, bấm **Done**. Đừng bấm Move to Trash.
  2. Vào **System Settings → Privacy & Security**, kéo xuống mục **Security** và bấm **Open Anyway**. Nút
     này chỉ hiện khoảng 1 giờ sau lần bị chặn.
  3. Nhập mật khẩu máy và bấm **Open**. Từ lần sau app mở bình thường.
- **macOS 14 trở về trước:** nhấp chuột phải (Control-click) vào FaamOffice → **Open** → **Open**.
- **Cách khác (Terminal):** `xattr -dr com.apple.quarantine /Applications/FaamOffice.app`. Chỉ dùng cách này
  với bản tải từ trang Releases chính thức.
- **Windows:** nếu thấy "Windows protected your PC", bấm **More info → Run anyway**. Dòng Publisher ghi
  "Unknown publisher" là bình thường. Nếu Smart App Control của Windows 11 chặn thì không có nút chạy tiếp;
  hãy chờ bản đã ký số hoặc bản trên Microsoft Store.

### Cập nhật phiên bản mới

Các bản phát hành sau 0.11.1 tự kiểm tra bản mới trên trang Releases (khoảng 15 giây sau khi mở app,
rồi vài giờ một lần) và hiện thông báo; mỗi phiên bản chỉ tự nhắc tối đa một lần mỗi ngày. Có thể kiểm tra
bất cứ lúc nào bằng **Help → Check for Updates**.

- **Windows và Linux AppImage:** app tải bản mới về, rồi bấm **Restart & Install**.
- **macOS:** bấm **Update Now**, app tải đúng file `.dmg` cho máy (Apple Silicon hoặc Intel), kiểm tra
  mã sha512 rồi mở nó. Thoát FaamOffice, kéo FaamOffice vào Applications và chọn **Replace**. File do
  app tự tải không bị macOS gắn cờ tải từ Internet, nên không phải bấm **Open Anyway** lần nữa. Nếu tải
  lỗi, app mở link tải trong trình duyệt.
- **Linux .deb / .rpm:** thông báo có nút mở gói mới trong trình duyệt để cài.
- **Đang dùng 0.11.1 hoặc cũ hơn:** các bản này không có địa chỉ cập nhật, nên cần tải và cài lại thủ
  công **một lần** từ trang [Releases](../../releases/latest). Từ bản đó trở đi app tự báo bản mới.

Đặt biến môi trường `FAAMOFFICE_UPDATES=0` khi mở app để tắt việc kiểm tra. Xem [PRIVACY.md](PRIVACY.md)
về những gì app gửi đi khi khởi động.

## Build từ mã nguồn

Cần Node.js 22 (xem `.nvmrc`) và Rust (`cargo`, cài qua [rustup](https://rustup.rs)).

```bash
npm ci
npm run dev          # chạy toàn bộ bộ ứng dụng ở chế độ phát triển
npm test             # chạy test

npm run dist:mac     # macOS: .dmg + .zip (chạy trên máy Mac)
npm run dist:win     # Windows: bộ cài .exe (chạy trên Windows)
npm run dist:linux   # Linux: AppImage, .deb, .rpm (chạy trên Linux)
```

Bản build cho cả ba nền tảng chạy tự động bằng GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)): vào **Actions → Release → Run
workflow** để build thử (bản này không tự cập nhật), hoặc đẩy một tag `v*` (ví dụ `v0.11.2`) để tạo bản
phát hành có tự cập nhật. Tag có dấu `-` (ví dụ `v0.12.0-beta.1`) thành bản prerelease và không được
đẩy tới người dùng qua thông báo cập nhật.

## Cập nhật theo GenOffice gốc

FaamOffice là bản fork của [GenOffice](https://github.com/genspark-ai/genoffice). Phần đổi thương
hiệu được làm bằng script nên có thể áp dụng lại sau mỗi lần cập nhật:

```bash
git fetch upstream
git merge upstream/main
node tools/rebrand.mjs --owner <tài-khoản-github>   # áp lại tên FaamOffice / Faam AI
npm run format                                     # căn lại các dòng dài ra sau khi đổi tên
node tools/gen-app-icons.mjs                       # (chỉ khi đổi logo)
npm ci && npm run typecheck && npm test
```

## Giấy phép

FaamOffice được phát hành theo [Apache License 2.0](LICENSE), dựa trên GenOffice của
Mainfunc, Inc. Xem [NOTICE](NOTICE) để biết thông tin ghi công. Thư mục `ee/` thuộc
[giấy phép riêng](ee/LICENSE) của GenOffice và không được FaamOffice sử dụng.

Tên và logo GenOffice, Genspark là nhãn hiệu của Mainfunc, Inc. FaamOffice không liên kết
với và không được Mainfunc, Inc. bảo trợ.
