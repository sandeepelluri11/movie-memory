import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";

export const APP_PORT = 3100;
export const STUB_PORT = 3199;

type StubState = { mode: "ok" | "fail"; delayMs: number; calls: number };

// Minimal stand-in for the OpenAI Responses API, controllable over HTTP from the test workers.
function startOpenAIStub() {
  const state: StubState = { mode: "ok", delayMs: 0, calls: 0 };

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    for await (const chunk of req) raw += chunk;

    if (req.url === "/__control" && req.method === "POST") {
      Object.assign(state, JSON.parse(raw || "{}"));
      return send(200, state);
    }
    if (req.url === "/__state") return send(200, state);

    if (req.url === "/v1/responses" && req.method === "POST") {
      state.calls += 1;
      const n = state.calls;
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.mode === "fail") return send(500, { error: { message: "stub failure", type: "server_error" } });
      const input = String(JSON.parse(raw).input ?? "");
      return send(200, {
        id: `resp_${n}`,
        object: "response",
        created_at: 0,
        status: "completed",
        model: "stub",
        output: [
          {
            type: "message",
            id: `msg_${n}`,
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: `Stub fact #${n} (${input})`, annotations: [] }],
          },
        ],
      });
    }
    send(404, { error: { message: "not found" } });
  });

  return new Promise<http.Server>((resolve) => server.listen(STUB_PORT, "127.0.0.1", () => resolve(server)));
}

async function waitForApp(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`App did not start at ${url}`);
}

export default async function setup() {
  const stub = await startOpenAIStub();

  const app: ChildProcess = spawn("node_modules/.bin/next", ["start", "-p", String(APP_PORT)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-e2e-stub",
      OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
      AUTH_TRUST_HOST: "true",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  await waitForApp(`http://localhost:${APP_PORT}/`);

  return async () => {
    app.kill("SIGTERM");
    await new Promise((r) => stub.close(r));
  };
}
