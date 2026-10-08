// Transactional email. Brevo is preferred when configured, with SMTP kept for
// self-hosted installations. Console delivery is only available outside production.

import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import { getBrevoMailRuntime, type BrevoSmtpSettings } from "./brevo-settings";
import { BREVO_SMTP_HOST } from "./brevo-settings-shared";
import { getConfig } from "./env";
import { HttpError } from "./http";

export type MailMessage = { to: string; subject: string; text: string; html: string };

let transporter: Transporter | null = null;
let transporterConfig: string | null = null;

export class MailDeliveryError extends HttpError {
  constructor() {
    super(503, "email_unavailable", "We could not send the email. Please try again later.");
    this.name = "MailDeliveryError";
  }
}

function unavailable(provider: "brevo" | "smtp" | "none", reason: "configuration" | "response" | "network", status?: number): MailDeliveryError {
  // Provider responses and transport errors can contain credentials, addresses
  // or links. Keep only our own diagnostic labels and the HTTP status.
  console.error("[mail] delivery unavailable", { provider, reason, ...(status !== undefined ? { status } : {}) });
  return new MailDeliveryError();
}

export async function sendMail(message: MailMessage, { sandbox = false }: { sandbox?: boolean } = {}): Promise<void> {
  const config = getConfig();
  let stored: BrevoSmtpSettings | null;
  try {
    stored = await getBrevoMailRuntime();
  } catch {
    throw unavailable("brevo", "configuration");
  }
  if (stored && (!stored.enabled || !stored.smtpKey)) throw unavailable("brevo", "configuration");
  const brevo = stored ? null : config.brevo;
  const smtp = stored ? {
    host: BREVO_SMTP_HOST,
    port: stored.smtpPort,
    secure: stored.smtpPort === 465,
    user: stored.smtpLogin,
    pass: stored.smtpKey!,
    from: { name: stored.senderName, address: stored.senderEmail },
  } : config.smtp;
  const { isProduction } = config;
  if (brevo) {
    if (!z.email().safeParse(brevo.sender.email).success || /[\r\n]/.test(brevo.apiKey)) {
      throw unavailable("brevo", "configuration");
    }
    let response: Response;
    try {
      response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevo.apiKey, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          sender: brevo.sender,
          to: [{ email: message.to, contactPixelTrackingConsent: false }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
          ...(sandbox ? { headers: { "X-Sib-Sandbox": "drop" } } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw unavailable("brevo", "network");
    }
    if (response.status !== 201) {
      await response.body?.cancel().catch(() => {});
      throw unavailable("brevo", "response", response.status);
    }
    let receipt: unknown;
    try {
      receipt = await response.json();
    } catch {
      throw unavailable("brevo", "response", response.status);
    }
    if (!receipt || typeof receipt !== "object" || !("messageId" in receipt) || typeof receipt.messageId !== "string" || !receipt.messageId.trim()) {
      throw unavailable("brevo", "response", response.status);
    }
    return;
  }
  if (sandbox) throw unavailable("none", "configuration");
  if (!smtp) {
    if (isProduction) throw unavailable("none", "configuration");
    console.info(
      `\n[mail] Development only: no email provider configured; printing the email.\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`,
    );
    return;
  }
  try {
    const config = JSON.stringify(smtp);
    if (!transporter || transporterConfig !== config) {
      transporter?.close();
      transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
        requireTLS: smtp.host.toLowerCase() === BREVO_SMTP_HOST && smtp.port === 587,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      });
      transporterConfig = config;
    }
    await transporter.sendMail({ from: smtp.from, ...message });
  } catch {
    throw unavailable("smtp", "network");
  }
}
