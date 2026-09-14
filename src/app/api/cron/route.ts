import { checkCron, failure, json } from "@/lib/http";
import { runScheduler } from "@/lib/scheduler";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try { checkCron(request); return json(await runScheduler()); }
  catch (error) { return failure(error); }
}
