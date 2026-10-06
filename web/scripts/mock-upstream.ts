// A tiny OpenAI-compatible upstream for local testing of Faam AI Cloud.
// Used by the smoke test; can also be run on its own:
//   npx tsx scripts/mock-upstream.ts            (listens on MOCK_UPSTREAM_PORT, default 4555)
// then start the site with FAAM_AI_UPSTREAM_BASE_URL=http://127.0.0.1:4555/v1
// and FAAM_AI_UPSTREAM_API_KEY=mock-upstream-key.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const MOCK_API_KEY = "mock-upstream-key";
export const MOCK_USAGE = { prompt_tokens: 1200, completion_tokens: 800 };
export const MOCK_TEXT = ["Hello", " from", " the", " mock", " upstream."];

export type MockRequestLog = {
  body: Record<string, unknown>;
  authorization: string | undefined;
  aborted: boolean;
  completed: boolean;
};

export type MockUpstream = {
  server: Server;
  port: number;
  requests: MockRequestLog[];
  close(): Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function lastUserText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    return last.content.map((p) => (p && typeof p === "object" && "text" in p ? String(p.text) : "")).join(" ");
  }
  return "";
}

async function handleChat(req: IncomingMessage, res: ServerResponse, log: MockRequestLog) {
  const body = log.body;
  const id = `chatcmpl-mock-${Date.now()}`;
  const model = String(body.model);
  const created = Math.floor(Date.now() / 1000);
  res.on("close", () => {
    if (!res.writableFinished) log.aborted = true;
  });

  if (body.stream !== true) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id,
        object: "chat.completion",
        created,
        model,
        choices: [{ index: 0, message: { role: "assistant", content: MOCK_TEXT.join("") }, finish_reason: "stop" }],
        usage: { ...MOCK_USAGE, total_tokens: MOCK_USAGE.prompt_tokens + MOCK_USAGE.completion_tokens },
      }),
    );
    log.completed = true;
    return;
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  const slow = lastUserText(body).includes("[slow]");
  const gap = slow ? 200 : 120;
  const pieces = slow ? Array.from({ length: 50 }, (_, i) => ` word${i}`) : MOCK_TEXT;

  send(chunk({ role: "assistant", content: "" }));
  for (const piece of pieces) {
    if (log.aborted) return;
    await sleep(gap);
    send(chunk({ content: piece }));
  }
  if (Array.isArray(body.tools) && body.tools.length) {
    await sleep(gap);
    send(
      chunk({
        tool_calls: [{ index: 0, id: "call_mock_1", type: "function", function: { name: "insert_text", arguments: '{"text":"hi"}' } }],
      }),
    );
  }
  await sleep(gap);
  send(chunk({}, "stop"));
  const opts = body.stream_options as { include_usage?: boolean } | undefined;
  if (opts?.include_usage) {
    send({ id, object: "chat.completion.chunk", created, model, choices: [], usage: { ...MOCK_USAGE, total_tokens: 2000 } });
  }
  res.write("data: [DONE]\n\n");
  res.end();
  log.completed = true;
}

export function startMockUpstream(port: number): Promise<MockUpstream> {
  const requests: MockRequestLog[] = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model", owned_by: "mock" }] }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        const authorization = req.headers.authorization;
        if (authorization !== `Bearer ${MOCK_API_KEY}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "bad key", type: "invalid_request_error" } }));
          return;
        }
        const log: MockRequestLog = { body: JSON.parse(await readBody(req)), authorization, aborted: false, completed: false };
        requests.push(log);
        await handleChat(req, res, log);
        return;
      }
      res.writeHead(404).end();
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(err) } }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actual,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// Standalone mode.
if (process.argv[1] && /mock-upstream\.(ts|js)$/.test(process.argv[1])) {
  const port = Number(process.env.MOCK_UPSTREAM_PORT || 4555);
  startMockUpstream(port).then((m) => {
    console.log(`Mock upstream listening on http://127.0.0.1:${m.port}/v1 (key: ${MOCK_API_KEY})`);
  });
}
