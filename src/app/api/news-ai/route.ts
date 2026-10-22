import { checkCron, failure, json } from "@/lib/http";
import { readNextHeadline } from "@/lib/news-ai";
export const runtime = "nodejs";
export const maxDuration = 300;
/** Local worker: one headline per call, read by the configured model (off by default). */
export async function POST(request: Request) {
  try {
    checkCron(request);
    return json(await readNextHeadline());
  } catch (error) {
    return failure(error);
  }
}
