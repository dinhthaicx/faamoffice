// Transactional email content (Vietnamese and English).

import type { Locale } from "@/i18n/config";

type Message = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, paragraphs: string[], cta: { label: string; url: string }, footer: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p)}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 24px;font-weight:700;font-size:18px;color:#1D74FA">FaamOffice</p>
<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#1D74FA;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(cta.label)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#475569;word-break:break-all">${escapeHtml(cta.url)}</p>
<p style="margin:24px 0 0;font-size:13px;color:#64748b">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function verifyEmailMessage(locale: Locale, name: string, url: string): Message {
  if (locale === "en") {
    const title = "Confirm your email address";
    const lines = [`Hi ${name},`, "Thanks for creating a FaamOffice account. Confirm your email address to finish setting it up. The link is valid for 24 hours."];
    const footer = "If you did not create this account, you can ignore this email.";
    return {
      subject: "Confirm your FaamOffice email",
      text: `${lines.join("\n\n")}\n\n${url}\n\n${footer}`,
      html: layout(title, lines, { label: "Confirm email", url }, footer),
    };
  }
  const title = "Xác nhận địa chỉ email";
  const lines = [`Chào ${name},`, "Cảm ơn bạn đã tạo tài khoản FaamOffice. Hãy xác nhận địa chỉ email để hoàn tất. Liên kết có hiệu lực trong 24 giờ."];
  const footer = "Nếu bạn không tạo tài khoản này, hãy bỏ qua email này.";
  return {
    subject: "Xác nhận email tài khoản FaamOffice",
    text: `${lines.join("\n\n")}\n\n${url}\n\n${footer}`,
    html: layout(title, lines, { label: "Xác nhận email", url }, footer),
  };
}

export function resetPasswordMessage(locale: Locale, name: string, url: string): Message {
  if (locale === "en") {
    const title = "Reset your password";
    const lines = [`Hi ${name},`, "We received a request to reset the password of your FaamOffice account. The link below is valid for 1 hour and can be used once."];
    const footer = "If you did not ask for this, ignore this email: your password stays the same.";
    return {
      subject: "Reset your FaamOffice password",
      text: `${lines.join("\n\n")}\n\n${url}\n\n${footer}`,
      html: layout(title, lines, { label: "Choose a new password", url }, footer),
    };
  }
  const title = "Đặt lại mật khẩu";
  const lines = [`Chào ${name},`, "Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản FaamOffice của bạn. Liên kết dưới đây có hiệu lực trong 1 giờ và chỉ dùng được một lần."];
  const footer = "Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu của bạn vẫn giữ nguyên.";
  return {
    subject: "Đặt lại mật khẩu FaamOffice",
    text: `${lines.join("\n\n")}\n\n${url}\n\n${footer}`,
    html: layout(title, lines, { label: "Đặt mật khẩu mới", url }, footer),
  };
}
