import { requireApiAdminRead } from "@/lib/auth";
import { downloadReport } from "@/lib/downloads";
import { downloadRange } from "@/lib/downloads-shared";
import { json, route } from "@/lib/http";

export const GET = route(async (req) => {
  await requireApiAdminRead();
  return json(await downloadReport(downloadRange(new URL(req.url).searchParams.get("days"))));
});
