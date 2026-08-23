// Route Handlers use the standard Web Request/Response APIs (no `next/server`
// import needed for this shape) — https://nextjs.org/docs/app/api-reference/file-conventions/route.
import { extract } from "../../../src/extract.ts";
import { createOpenAIClient } from "../../../src/model-client.ts";
import { extractionReferenceDate, isRequestBody } from "../../../src/request.ts";

export async function POST(request: Request): Promise<Response> {
  // The request is judged before the server's own configuration is. Checking
  // the key first meant a caller who sent garbage was told "OPENAI_API_KEY is
  // not configured" — measured against a real running server, `-d 'not json'`
  // came back 500 with that message. Answering the wrong question about the
  // wrong party is the failure this whole boundary has been fixing, and the
  // route's tests could not see it because they set the key.
  //
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
  }

  // The key never touches the response below — createOpenAIClient only holds
  // it in closure.
  //
  // The wrapper exists so the catch below can tell the two failure kinds
  // apart. It used to wrap all of extract() while claiming "the model call is
  // the one thing here that can fail for reasons outside this process", so a
  // bug in the parser or the guards was reported to the caller as a 502 model
  // failure carrying a raw JS message — the same misdiagnosis the request
  // validator was written to eliminate.
  let modelFailed = false;
  const client = createOpenAIClient(apiKey);
  const guarded = {
    async complete(input: Parameters<typeof client.complete>[0]) {
      try {
        return await client.complete(input);
      } catch (error) {
        modelFailed = true;
        throw error;
      }
    },
  };
  try {
      // Padded by a day — see extractionReferenceDate for why.
    const referenceDate = extractionReferenceDate(new Date());
    const result = await extract({ pages: body.pages }, guarded, referenceDate);
    return Response.json(result);
  } catch (error) {
    // Report the message, not the stack, and never the request body: a
    // receipt's contents must not travel back out through an error string.
    // A model failure is upstream (a timeout, a rejected key, a rate limit)
    // and says so; anything else is this service's own bug and must not be
    // dressed up as one.
    if (modelFailed) {
      const message = error instanceof Error ? error.message : "the model call failed";
      return Response.json({ error: message }, { status: 502 });
    }
    return Response.json({ error: "extraction failed" }, { status: 500 });
  }
}
