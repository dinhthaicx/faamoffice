// GET /api/v1/ai/models — OpenAI-format list of Faam AI Cloud models.

import { configuredModels, notConfigured } from "@/lib/ai-proxy";
import { authenticateBearer } from "@/lib/api-token";
import { json, route } from "@/lib/http";

export const GET = route(async (req) => {
  await authenticateBearer(req);
  const models = await configuredModels();
  if (!models) return notConfigured();
  return json({
    object: "list",
    data: models.map((m) => ({ id: m.id, object: "model", owned_by: "faam" })),
  });
});
