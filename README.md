<p align="center">
  <img src="apps/shell/build/icons/256x256.png" alt="FaamOffice" width="128">
</p>

<h1 align="center">FaamOffice</h1>

<p align="center"><b>Bộ ứng dụng văn phòng mã nguồn mở có trợ lý Faam AI.</b><br>
Soạn và sửa Word, Excel, PowerPoint, PDF, Markdown, HTML ngay trên máy; lưu lại đúng định dạng gốc.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="../../releases/latest"><b>Tải về</b></a>
  <a href="#code-signing-policy"><b>Code signing policy</b></a>
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
Xem [Code signing policy](#code-signing-policy) và [chính sách quyền riêng tư](PRIVACY.md)
trước khi tải và cài ứng dụng.

Bộ cài **macOS 0.11.2** hiện được ký bằng Developer ID và được Apple xác minh (notarization),
cho cả Apple Silicon và Intel.

- **macOS:** kéo FaamOffice vào Applications rồi mở. Nếu bản 0.11.2 đã tải trước đây báo
  "Apple không thể xác minh", tải lại bộ cài từ Releases, thoát FaamOffice rồi kéo bản mới vào
  Applications và chọn **Replace**. Số phiên bản vẫn là 0.11.2; các file macOS đã được thay bằng
  bản ký số và xác minh.
- **Windows:** nếu thấy "Windows protected your PC", bấm **More info → Run anyway**. Dòng Publisher ghi
  "Unknown publisher" là bình thường. Nếu Smart App Control của Windows 11 chặn thì không có nút chạy tiếp;
  hãy chờ bản đã ký số hoặc bản trên Microsoft Store.

### Cập nhật phiên bản mới

Các bản phát hành sau 0.11.1 tự kiểm tra bản mới trên trang Releases (khoảng 15 giây sau khi mở app,
rồi vài giờ một lần) và hiện thông báo; mỗi phiên bản chỉ tự nhắc tối đa một lần mỗi ngày. Có thể kiểm tra
bất cứ lúc nào bằng **Help → Check for Updates**.

- **Windows và Linux AppImage:** app tải bản mới về, rồi bấm **Restart & Install**.
- **macOS:** bấm **Update Now**, app tải đúng file `.dmg` cho máy (Apple Silicon hoặc Intel), kiểm tra
  mã sha512 rồi mở nó. Thoát FaamOffice, kéo FaamOffice vào Applications và chọn **Replace**. Nếu tải
  lỗi, app mở link tải trong trình duyệt.
- **Linux .deb / .rpm:** thông báo có nút mở gói mới trong trình duyệt để cài.
- **Đang dùng 0.11.1 hoặc cũ hơn:** các bản này không có địa chỉ cập nhật, nên cần tải và cài lại thủ
  công **một lần** từ trang [Releases](../../releases/latest). Từ bản đó trở đi app tự báo bản mới.

Đặt biến môi trường `FAAMOFFICE_UPDATES=0` khi mở app để tắt việc kiểm tra. Xem [PRIVACY.md](PRIVACY.md)
về những gì app gửi đi khi khởi động.

## Code signing policy

**Trạng thái: đã nộp đơn SignPath, đang chờ phản hồi (pending).** Người duy trì đã xác nhận
đơn được gửi. Dự án chưa được chấp nhận và chưa có bản phát hành nào mang chữ ký SignPath.
Chỉ ghi SignPath cung cấp chữ ký sau khi được chấp nhận. Chữ ký của từng bản phát hành phải
được kiểm tra và ghi riêng trong release notes.

**Status: application submitted to SignPath, awaiting a response (pending).** The maintainer
has confirmed submission. The project has not been accepted, and no release has a SignPath
signature. Credit SignPath as providing code signing only after acceptance; verify and document
the signature status of each release separately.

| Responsibility / Trách nhiệm | Person / Người phụ trách |
| --- | --- |
| Maintainer | [dinhthaicx](https://github.com/dinhthaicx) |
| Reviewer | [dinhthaicx](https://github.com/dinhthaicx) |
| Release approver | [dinhthaicx](https://github.com/dinhthaicx) |

If accepted, every signing request requires release approval. Everyone involved in signing must
use multi-factor authentication for GitHub and SignPath. FaamOffice is a fork of GenOffice and
requires SignPath's review under its conditions for modified upstream software. The current
Windows installer is unsigned; the notarized Apple Developer ID signatures on macOS are separate
from SignPath.

**Microsoft Store — theo xác nhận của người duy trì ngày 08/10/2026:** đã gửi
Submission 1; trạng thái **In certification**, bước **Pre-processing**. Hồ sơ được cấu hình
tự xuất bản sau khi vượt qua xét duyệt. Ứng dụng hiện chưa được công bố trên Store.

**Microsoft Store — confirmed by the maintainer on October 8, 2026:** Submission 1 has been
submitted and is **In certification**, at **Pre-processing**. The submission is configured to
publish automatically after passing certification. The app is not yet public on the Store.

Chính sách trên website: [Tiếng Việt](https://faamoffice.net/vi/code-signing) ·
[English](https://faamoffice.net/en/code-signing). Privacy: [PRIVACY.md](PRIVACY.md) ·
[Tiếng Việt](https://faamoffice.net/vi/privacy) · [English](https://faamoffice.net/en/privacy).
Questions / Liên hệ: [GitHub Issues](https://github.com/dinhthaicx/faamoffice/issues).

Chuẩn bị installer cho SignPath: bộ cài hiện chưa hiển thị privacy trong lúc cài và chưa có lựa
chọn tắt các kết nối tự động. Các biến môi trường trong PRIVACY.md chỉ là công tắc lúc chạy.
Cần bổ sung màn hình privacy, lưu lựa chọn của người cài, cho app đọc lựa chọn trước khi gửi
yêu cầu mạng, rồi build lại shell và bộ cài Windows. Chưa tuyên bố bộ cài đáp ứng yêu cầu này.
Xem [điều kiện SignPath](https://signpath.org/terms.html).

Installer preparation: the current installer does not display privacy or offer installation
options to disable automatic network connections. The runtime environment switches are not
installation options. A privacy screen, persisted installer choices and application support
before network requests require rebuilding the shell and Windows installer. Compliance with
this requirement has not yet been claimed.

Ảnh Microsoft Store: chạy workflow **Microsoft Store screenshots** với ID của run Release có
artifact `faamoffice-store-appx`. Workflow mở chính executable Windows từ AppX, chụp cửa sổ
thật bằng Electron desktopCapturer ở tiếng Việt/Anh và xuất PNG cùng manifest nguồn gốc trong
artifact `faamoffice-store-screenshots`; không thay giao diện hay khung cửa sổ bằng ảnh dựng.
Kiểm tra ảnh trước khi tải vào Partner Center. Theo [hướng dẫn Microsoft](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images),
ảnh desktop phải là PNG từ 1366 × 768, tối đa 50 MB; nên có ít nhất bốn ảnh mỗi ngôn ngữ.

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

Runner macOS trên GitHub hiện chỉ tạo bản ad-hoc; bộ cài macOS chính thức cần được ký và notarize
trên máy có chứng thư **Developer ID Application**. Với profile đã lưu trong Keychain:

```bash
CSC_NAME='Tên trên chứng thư (TEAM_ID)' \
APPLE_KEYCHAIN_PROFILE='tên-profile-notarytool' \
GENOFFICE_MAC_X64=1 \
GENOFFICE_UPDATE_URL='https://github.com/dinhthaicx/faamoffice/releases/latest/download' \
npm run dist:mac
```

Lệnh này ký và notarize cả `.app` lẫn `.dmg`, rồi tính lại blockmap và `latest-mac.yml` sau khi staple
ticket Apple (staple làm thay đổi mã sha512 của DMG). Trước khi phát hành, kiểm tra `codesign --verify
--deep --strict`, `xcrun stapler validate` và `spctl --assess --type execute` trên app; DMG dùng
`spctl --assess --type open --context context:primary-signature`. Khi thay bộ cài trong một release
đã có, tải lên cả DMG, ZIP và blockmap tương ứng, sau đó cập nhật `latest-mac.yml` đã ghim URL vào
đúng tag bằng `scripts/release-feed.cjs`.

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
