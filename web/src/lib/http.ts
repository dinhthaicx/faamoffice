// Small helpers shared by the route handlers.

import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return Response.json(data, { status: init?.status ?? 200, headers: { ...NO_STORE, ...init?.headers } });
}

/** Standard error body: { error: "<code>", message: "<human text>" }. */
export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return json({ error: code, message, ...extra }, { status, headers });
}

export function rateLimited(retryAfter: number): HttpError {
  return new HttpError(429, "rate_limited", "Too many requests. Please try again later.", undefined, {
    "Retry-After": String(Math.max(1, retryAfter)),
  });
}

/** Read the request body as text, enforcing a byte limit (default 1 MB). */
export async function readBodyText(req: Request, maxBytes = 1024 * 1024): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "payload_too_large", `Request body exceeds ${maxBytes} bytes.`);
  }
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "payload_too_large", `Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req: Request, maxBytes?: number): Promise<unknown> {
  const text = await readBodyText(req, maxBytes);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

/** Parse and validate a JSON body with a zod schema (400 invalid_request on failure). */
export async function parseJson<T extends z.ZodType>(req: Request, schema: T, maxBytes?: number): Promise<z.infer<T>> {
  const data = await readJson(req, maxBytes);
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    throw new HttpError(400, "invalid_request", issue ? `${field ? `${field}: ` : ""}${issue.message}` : "Invalid request.", {
      field: field || undefined,
    });
  }
  return result.data;
}

/**
 * Best-effort client IP for rate limiting. Uses the right-most X-Forwarded-For
 * entry (the address seen by the closest proxy; Next.js fills it with the
 * socket address when no proxy is present).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Wrap a route handler: converts HttpError into JSON errors and hides unexpected failures. */
export function route<Args extends unknown[]>(handler: (req: Request, ...args: Args) => Promise<Response>) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return jsonError(err.status, err.code, err.message, err.extra, err.headers);
      }
      console.error("[api] unhandled error", err);
      return jsonError(500, "server_error", "Something went wrong. Please try again.");
    }
  };
}
