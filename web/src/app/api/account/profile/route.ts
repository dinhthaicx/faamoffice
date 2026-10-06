import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { json, parseJson, route } from "@/lib/http";
import { nameSchema } from "@/lib/users";

const schema = z.object({ name: nameSchema });

export const POST = route(async (req) => {
  const session = await requireApiSession(req);
  const { name } = await parseJson(req, schema);
  await prisma.user.update({ where: { id: session.userId }, data: { name } });
  return json({ ok: true });
});
