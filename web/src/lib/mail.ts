// Outgoing email. Uses SMTP (nodemailer) when SMTP_HOST is set; otherwise the
// message (including any links) is printed to the server console.

import nodemailer, { type Transporter } from "nodemailer";
import { getConfig } from "./env";

export type MailMessage = { to: string; subject: string; text: string; html: string };

let transporter: Transporter | null = null;

export async function sendMail(message: MailMessage): Promise<void> {
  const { smtp } = getConfig();
  if (!smtp) {
    console.info(
      `\n[mail] SMTP is not configured; printing the email instead.\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`,
    );
    return;
  }
  transporter ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
  });
  try {
    await transporter.sendMail({ from: smtp.from, ...message });
  } catch (err) {
    // Never fail the user-facing request because the mail server is down.
    console.error("[mail] failed to send email", err);
  }
}
