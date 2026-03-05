interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: string;
  boolValue?: boolean;
  doubleValue?: number;
}

export interface CollectedSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: OtlpAttributeValue }>;
  status?: { code?: number; message?: string };
  events?: Array<{
    name: string;
    attributes?: Array<{ key: string; value: OtlpAttributeValue }>;
  }>;
}

export const collectorUrl = (): string => {
  const port = import.meta.env.VITE_COLLECTOR_PORT;
  if (!port) throw new Error("VITE_COLLECTOR_PORT not set");
  return `http://localhost:${port}`;
};

export const clearSpans = async (): Promise<void> => {
  await fetch(`${collectorUrl()}/spans`, { method: "DELETE" });
};

export const getSpans = async (): Promise<CollectedSpan[]> => {
  const res = await fetch(`${collectorUrl()}/spans`);
  return res.json() as Promise<CollectedSpan[]>;
};

export const waitForSpans = async (
  predicate: (spans: CollectedSpan[]) => boolean,
  { timeout = 5000, interval = 50 } = {},
): Promise<CollectedSpan[]> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const spans = await getSpans();
    if (predicate(spans)) return spans;
    await new Promise((r) => setTimeout(r, interval));
  }
  return getSpans();
};

export interface CollectedLogRecord {
  timeUnixNano: string;
  severityNumber?: number;
  severityText?: string;
  body?: { stringValue?: string };
  attributes?: Array<{ key: string; value: OtlpAttributeValue }>;
}

export const clearLogs = async (): Promise<void> => {
  await fetch(`${collectorUrl()}/logs`, { method: "DELETE" });
};

export const getLogs = async (): Promise<CollectedLogRecord[]> => {
  const res = await fetch(`${collectorUrl()}/logs`);
  return res.json() as Promise<CollectedLogRecord[]>;
};

export const waitForLogs = async (
  predicate: (logs: CollectedLogRecord[]) => boolean,
  { timeout = 8000, interval = 100 } = {},
): Promise<CollectedLogRecord[]> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const logs = await getLogs();
    if (predicate(logs)) return logs;
    await new Promise((r) => setTimeout(r, interval));
  }
  return getLogs();
};

export const getAttr = (
  span: CollectedSpan,
  key: string,
): string | number | boolean | undefined => {
  const attr = span.attributes.find((a) => a.key === key);
  if (!attr) return undefined;
  const v = attr.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  return undefined;
};
