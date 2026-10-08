import { requireApiAdmin } from "@/lib/auth";
import { checkAiBackend, parseAiBackend } from "@/lib/ai-backend";
import { json, readJson, route } from "@/lib/http";

export const POST = route(async (req) => {
  await requireApiAdmin(req);
  const config = parseAiBackend(await readJson(req, 16 * 1024));
  return json({ ok: true, ...(await checkAiBackend(config, req.signal)) });
});
