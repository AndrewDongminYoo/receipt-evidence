// Route Handlers use the standard Web Request/Response APIs (no `next/server`
// import needed for this shape) — https://nextjs.org/docs/app/api-reference/file-conventions/route.
import { extract } from "../../../src/extract.ts";
import { createOpenAIClient } from "../../../src/model-client.ts";
import { isRequestBody } from "../../../src/request.ts";

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
  }

  // A malformed body throws out of request.json(), which without this would
  // surface as an unhandled 500 carrying a stack trace. It is a bad request,
  // and it says so.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "request body is not valid JSON" }, { status: 400 });
  }
  if (!isRequestBody(body)) {
    return Response.json(
      { error: "expected { pages: [{ text, lines: [{ text, frame: {x,y,width,height} }] }] }" },
      { status: 400 },
    );
  }
  // An empty page list is well-formed and still meaningless: extract() would
  // fall back to an empty receipt, assert a currency for text it never saw,
  // and still spend a billable model call on a request carrying no receipt.
  if (body.pages.length === 0) {
    return Response.json({ error: "no pages to extract from" }, { status: 400 });
  }

  // The key is read from the environment above and never touches the
  // response below — createOpenAIClient only holds it in closure.
  const client = createOpenAIClient(apiKey);
  try {
    const result = await extract({ pages: body.pages }, client, new Date());
    return Response.json(result);
  } catch (error) {
    // The model call is the one thing here that can fail for reasons outside
    // this process — a timeout, a rejected key, a rate limit. Report the
    // message, not the stack, and never the request body: a receipt's
    // contents must not travel back out through an error string.
    const message = error instanceof Error ? error.message : "extraction failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
