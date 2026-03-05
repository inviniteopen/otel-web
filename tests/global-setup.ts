import { createServer, type IncomingMessage, type ServerResponse } from "http";

interface OtlpAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    boolValue?: boolean;
    doubleValue?: number;
  };
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status?: { code?: number; message?: string };
  events?: Array<{
    name: string;
    attributes?: Array<{ key: string; value: { stringValue?: string } }>;
  }>;
}

interface StoredSpan extends OtlpSpan {
  resourceAttributes?: OtlpAttribute[];
}

interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber?: number;
  severityText?: string;
  body?: { stringValue?: string };
  attributes?: Array<{
    key: string;
    value: {
      stringValue?: string;
      intValue?: string;
      boolValue?: boolean;
      doubleValue?: number;
    };
  }>;
}

let spans: StoredSpan[] = [];
let logRecords: OtlpLogRecord[] = [];

const cors = (res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, traceparent, tracestate",
  );
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });

const handler = async (req: IncomingMessage, res: ServerResponse) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/v1/traces") {
    const body = await readBody(req);
    try {
      const payload = JSON.parse(body) as {
        resourceSpans?: Array<{
          resource?: { attributes?: OtlpAttribute[] };
          scopeSpans?: Array<{ spans?: OtlpSpan[] }>;
        }>;
      };
      for (const rs of payload.resourceSpans ?? []) {
        const resourceAttributes = rs.resource?.attributes;
        for (const ss of rs.scopeSpans ?? []) {
          for (const span of ss.spans ?? []) {
            spans.push({ ...span, resourceAttributes });
          }
        }
      }
    } catch {
      // ignore parse errors
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
    return;
  }

  if (req.method === "GET" && req.url === "/spans") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(spans));
    return;
  }

  if (req.method === "DELETE" && req.url === "/spans") {
    spans = [];
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/v1/logs") {
    const body = await readBody(req);
    try {
      const payload = JSON.parse(body) as {
        resourceLogs?: Array<{
          scopeLogs?: Array<{ logRecords?: OtlpLogRecord[] }>;
        }>;
      };
      for (const rl of payload.resourceLogs ?? []) {
        for (const sl of rl.scopeLogs ?? []) {
          logRecords.push(...(sl.logRecords ?? []));
        }
      }
    } catch {
      // ignore parse errors
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
    return;
  }

  if (req.method === "GET" && req.url === "/logs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(logRecords));
    return;
  }

  if (req.method === "DELETE" && req.url === "/logs") {
    logRecords = [];
    res.writeHead(204);
    res.end();
    return;
  }

  // Echo back request headers as JSON (useful for testing trace propagation)
  if (req.url === "/echo") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ headers: req.headers }));
    return;
  }

  res.writeHead(404);
  res.end();
};

let serverRef: ReturnType<typeof createServer> | undefined;

export const setup = () => {
  // Guard against double-init (vitest may call globalSetup per project)
  if (process.env.VITE_COLLECTOR_PORT) return;

  const server = createServer(handler);
  serverRef = server;

  return new Promise<void>((resolve, reject) => {
    // Port 0 lets the OS pick a free port — no conflicts possible
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      process.env.VITE_COLLECTOR_PORT = String(addr.port);
      console.log(`OTLP mock collector listening on port ${addr.port}`);
      resolve();
    });
    server.once("error", reject);
  });
};

export const teardown = () => {
  serverRef?.close();
  serverRef = undefined;
  delete process.env.VITE_COLLECTOR_PORT;
};
