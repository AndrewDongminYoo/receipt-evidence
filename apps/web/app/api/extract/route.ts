// Route Handlers use the standard Web Request/Response APIs (no `next/server`
// import needed for this shape) — https://nextjs.org/docs/app/api-reference/file-conventions/route.
import { extract, type Page } from "../../../src/extract.ts";
import { createOpenAIClient } from "../../../src/model-client.ts";

interface RequestBody {
  pages: Page[];
}

function isRequestBody(value: unknown): value is RequestBody {
  return typeof value === "object" && value !== null && Array.isArray((value as { pages?: unknown }).pages);
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
  }

  const body: unknown = await request.json();
  if (!isRequestBody(body)) {
    return Response.json({ error: "expected { pages: [...] }" }, { status: 400 });
  }

  // The key is read from the environment above and never touches the
  // response below — createOpenAIClient only holds it in closure.
  const client = createOpenAIClient(apiKey);
  const result = await extract({ pages: body.pages }, client, new Date());

  return Response.json(result);
}
