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

| Loại          | Nhà cung cấp                                                                                                      | Cần gì                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **AI cục bộ** | Ollama, LM Studio, llama.cpp server                                                                               | Không cần API key             |
| **Đám mây**   | OpenAI, Anthropic Claude, Google Gemini, DeepSeek, xAI Grok, Mistral, Groq, OpenRouter, Kimi, Qwen, GLM, MiniMax… | API key của bạn               |
| **Tuỳ chỉnh** | Bất kỳ máy chủ nào tương thích OpenAI (vLLM, LocalAI, Jan…)                                                       | Base URL, key nếu máy chủ cần |
| **Genspark**  | Dùng tài khoản Genspark                                                                                           | Đăng nhập Genspark            |

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

## Tải về

Bộ cài cho macOS (Apple Silicon và Intel), Windows (x64) và Linux (AppImage, deb, rpm) nằm ở
trang [Releases](../../releases/latest).

Bản build chưa có chữ ký số của Apple/Microsoft:

- **macOS:** lần đầu mở, nhấp chuột phải vào FaamOffice → **Open**, hoặc chạy
  `xattr -dr com.apple.quarantine /Applications/FaamOffice.app`.
- **Windows:** SmartScreen cảnh báo → **More info → Run anyway**.

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
workflow** để build thử, hoặc đẩy một tag `v*` (ví dụ `v0.11.0-faam.1`) để tạo bản phát hành.

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
