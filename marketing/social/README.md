# FaamOffice social share images

The current PNG set was edited with the built-in OpenAI imagegen tool. It uses
a two-color background gradient from cream to pale violet, wide margins, and a
dark-orange CTA with white text and lightly rounded corners. The four paper
file-type illustrations are retained. Prompt provenance is recorded in
[`prompts-2026-10-08.json`](prompts-2026-10-08.json).

`tools/social/template.html` and `tools/gen-social-images.mjs` are the legacy
native HTML layout and renderer. They do not reproduce the current imagegen
artwork. Running `node tools/gen-social-images.mjs` overwrites the PNGs here and
the website's shared landscape asset with the legacy artwork; do not use it to
recreate the current set.

| File                             | Size      | Use it for                                                                                                                                                                   |
| -------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `faamoffice-share-1200x630.png`  | 1200×630  | Link preview / Open Graph (`og:image`) for Facebook and Zalo when someone shares a faamoffice.net link; also fits X/Twitter and LinkedIn link cards.                         |
| `faamoffice-post-1080x1080.png`  | 1080×1080 | Square feed post (Facebook, Instagram, Zalo OA, LinkedIn).                                                                                                                   |
| `faamoffice-post-1080x1350.png`  | 1080×1350 | 4:5 portrait feed post, the size that takes up the most of the screen in Facebook and Instagram feeds. It is the only one carrying the trademark footnote.                   |
| `faamoffice-story-1080x1920.png` | 1080×1920 | Facebook/Instagram Stories, Reels cover, TikTok photo post or cover. Keep key content inside the safe area, with 280 px clear at the top and 380 px at the bottom for platform UI. |

The legacy HTML template uses the bundled Be Vietnam Pro fonts (SIL OFL 1.1,
in `tools/social/fonts/`). This does not establish the exact font used in the
current imagegen-edited PNGs. The file-type cards are our own generic glyphs
labelled by extension only (.DOCX, .XLSX, .PPTX, .PDF). Keep it that way: no
Microsoft or Adobe logos, icons or look-alike tiles.

## Captions

Wording rules: say **"không cần mua bản quyền"**, never "không bản quyền" on its own
(that reads as "no copyright"). The AI assistant supports Faam AI Cloud through a
FaamOffice account, the user's own API key, or a local model. Cloud usage may have
daily limits; API charges depend on the chosen provider. Do not imply that cloud
AI is free. PDF support covers reading, annotating and filling forms, not full
PDF editing.

### Facebook (Vietnamese, main)

```text
🎉 FaamOffice – bộ văn phòng MIỄN PHÍ, không cần mua bản quyền.
📄 Mở, sửa và lưu file Word, Excel, PowerPoint; đọc, ghi chú và điền biểu mẫu PDF – giữ đúng định dạng gốc.
✨ Có trợ lý AI: Faam AI Cloud qua tài khoản FaamOffice, key riêng (OpenAI, Claude, Gemini, DeepSeek…) hoặc AI chạy ngay trên máy. Lượt dùng Cloud có thể giới hạn; phí API tùy nhà cung cấp.
💻 Windows · macOS · Linux · giao diện tiếng Việt · mã nguồn mở.
👉 Tải miễn phí: https://faamoffice.net/vi/download

#FaamOffice #PhanMemMienPhi #VanPhong #MaNguonMo
```

### TikTok / Reels (Vietnamese)

```text
Bộ văn phòng miễn phí, không cần mua bản quyền 🎉 Mở, sửa, lưu Word · Excel · PowerPoint, ghi chú PDF, có trợ lý AI (Faam AI Cloud, key riêng hoặc AI chạy trên máy). Lượt dùng Cloud có thể giới hạn; phí API tùy nhà cung cấp. Tải tại faamoffice.net 👆
#FaamOffice #PhanMemMienPhi #VanPhong #MaNguonMo #MeoVanPhong
```

### English

```text
🎉 FaamOffice is a free, open-source office suite – no licence to buy.
📄 Open, edit and save Word, Excel and PowerPoint files; read, annotate and fill in PDFs, keeping the original formats.
✨ Built-in AI assistant: use Faam AI Cloud with your FaamOffice account, bring your own key (OpenAI, Claude, Gemini, DeepSeek…) or run AI locally. Cloud usage limits may apply; API fees depend on your provider.
💻 Windows · macOS · Linux · 21 interface languages.
👉 Free download: https://faamoffice.net/en/download

#FaamOffice #FreeSoftware #OpenSource #Office
```

### Trademark line

Add this where the post names the Microsoft products prominently (for example under
the Facebook caption or in a pinned comment):

```text
Word, Excel, PowerPoint là thương hiệu của Microsoft; FaamOffice không liên kết với Microsoft.
```

English: `Word, Excel and PowerPoint are trademarks of Microsoft; FaamOffice is not affiliated with Microsoft.`
