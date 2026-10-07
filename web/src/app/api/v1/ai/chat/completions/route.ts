// POST /api/v1/ai/chat/completions — OpenAI-compatible proxy (billed in credits unless an admin turned them off).

import { handleChatCompletions } from "@/lib/ai-proxy";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export const POST = route(handleChatCompletions);
