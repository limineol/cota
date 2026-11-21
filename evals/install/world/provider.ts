/**
 * The world's fake provider, at every provider's host name on the world's
 * network: it answers a message to the Messages API as Anthropic does, and
 * anything else with a 404. It never forwards anything.
 */
const message = (model: string) => ({
  id: `msg_install_eval_${crypto.randomUUID().slice(0, 8)}`,
  type: "message",
  role: "assistant",
  model,
  content: [
    { type: "text", text: "Hello from the install eval's fake provider." },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 12,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 9,
  },
});

const modelOf = (body: unknown): string =>
  typeof body === "object" &&
  body !== null &&
  "model" in body &&
  typeof body.model === "string"
    ? body.model
    : "claude-sonnet-4-5";

Bun.serve({
  hostname: "0.0.0.0",
  port: 443,
  tls: {
    cert: Bun.file("/provider/provider.crt"),
    key: Bun.file("/provider/provider.key"),
  },
  async fetch(request) {
    const url = new URL(request.url);
    console.log(
      JSON.stringify({
        host: request.headers.get("host"),
        method: request.method,
        path: url.pathname,
      }),
    );
    if (request.method === "POST" && url.pathname === "/v1/messages") {
      const body: unknown = await request.json().catch(() => null);
      return Response.json(message(modelOf(body)), {
        headers: { "request-id": `req_install_eval_${Date.now()}` },
      });
    }
    return Response.json(
      {
        type: "error",
        error: {
          type: "not_found_error",
          message: "The install eval's fake provider answers only messages.",
        },
      },
      { status: 404 },
    );
  },
});
