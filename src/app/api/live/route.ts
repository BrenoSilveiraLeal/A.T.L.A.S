import { checkCron, failure, json } from "@/lib/http";
import { runLive } from "@/lib/live";
export const runtime = "nodejs";
export const maxDuration = 60;
/** Local worker: one real-money tick (off unless every switch is on). */
export async function POST(request: Request) {
  try {
    checkCron(request);
    return json(await runLive());
  } catch (error) {
    return failure(error);
  }
}
