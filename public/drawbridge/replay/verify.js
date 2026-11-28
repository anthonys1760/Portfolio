/**
 * Browser port of packages/core audit verification.
 * stableStringify matches packages/core/src/hash.ts. The hash is
 * sha256(prevHash + stableStringify(event without hash)), via WebCrypto.
 * Re-canonicalize every line. Do not hash the raw line text.
 */

export const GENESIS_HASH = "0".repeat(64);

const METHODS = new Set(["tools/call", "tools/list", "resources/read", "prompts/get"]);
const DECISIONS = new Set(["allow", "deny", "approve_pending", "approved", "denied_by_human", "timeout"]);
const VERDICTS = new Set(["clean", "flagged", "wrapped", "blocked"]);
const TARGETS = new Set(["args", "result", "description"]);
const CHANNELS = new Set(["elicitation", "dashboard", "cli"]);
const HIT_PATH = /^(?:[A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*|\[(?:0|[1-9][0-9]*)\])*$/;

const REQUIRED = [
  "id",
  "ts",
  "sessionId",
  "client",
  "upstream",
  "method",
  "argsRedacted",
  "argsHash",
  "decision",
  "taint",
  "prevHash",
  "hash",
];
const OPTIONAL = new Set([
  "tool",
  "ruleId",
  "reason",
  "taintAfter",
  "scanner",
  "approval",
  "expiresAt",
  "intentId",
  "resultHash",
  "durationMs",
]);

export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function eventHash(event) {
  return sha256(event.prevHash + stableStringify(event));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function stringField(issues, event, key, required) {
  if (!Object.hasOwn(event, key)) {
    if (required) issues.push(`${key}: required`);
    return;
  }
  if (typeof event[key] !== "string") issues.push(`${key}: expected string`);
}

function taintField(issues, value, key) {
  if (!isObject(value)) {
    issues.push(`${key}: expected object`);
    return;
  }
  const extra = unknownKeys(value, ["tainted", "sources"]);
  for (const name of extra) issues.push(`${key}.${name}: unrecognized key`);
  if (typeof value.tainted !== "boolean") issues.push(`${key}.tainted: expected boolean`);
  if (!Array.isArray(value.sources) || value.sources.some((item) => typeof item !== "string")) {
    issues.push(`${key}.sources: expected an array of strings`);
  }
}

function schemaIssues(event) {
  if (!isObject(event)) return ["(root): expected an object"];
  const issues = [];
  for (const key of unknownKeys(event, [...REQUIRED, ...OPTIONAL])) issues.push(`${key}: unrecognized key`);
  for (const key of ["id", "ts", "sessionId", "upstream", "argsHash", "prevHash", "hash"]) stringField(issues, event, key, true);
  stringField(issues, event, "method", true);
  stringField(issues, event, "decision", true);
  if (Object.hasOwn(event, "method") && !METHODS.has(event.method)) issues.push("method: unrecognized method");
  if (Object.hasOwn(event, "decision") && !DECISIONS.has(event.decision)) issues.push("decision: unrecognized decision");
  if (!Object.hasOwn(event, "argsRedacted")) issues.push("argsRedacted: required");
  if (!Object.hasOwn(event, "client")) issues.push("client: required");
  else if (!isObject(event.client)) issues.push("client: expected object");
  else {
    for (const key of unknownKeys(event.client, ["name", "version"])) issues.push(`client.${key}: unrecognized key`);
    if (Object.hasOwn(event.client, "name") && typeof event.client.name !== "string") issues.push("client.name: expected string");
    if (Object.hasOwn(event.client, "version") && typeof event.client.version !== "string") {
      issues.push("client.version: expected string");
    }
  }
  if (!Object.hasOwn(event, "taint")) issues.push("taint: required");
  else taintField(issues, event.taint, "taint");
  if (Object.hasOwn(event, "taintAfter")) taintField(issues, event.taintAfter, "taintAfter");
  for (const key of ["tool", "ruleId", "reason", "expiresAt", "intentId", "resultHash"]) {
    if (Object.hasOwn(event, key) && typeof event[key] !== "string") issues.push(`${key}: expected string`);
  }
  if (Object.hasOwn(event, "durationMs") && typeof event.durationMs !== "number") issues.push("durationMs: expected number");
  if (Object.hasOwn(event, "scanner")) checkScanner(issues, event.scanner);
  if (Object.hasOwn(event, "approval")) checkApproval(issues, event.approval);
  return issues;
}

function checkScanner(issues, scanner) {
  if (!isObject(scanner)) {
    issues.push("scanner: expected object");
    return;
  }
  for (const key of unknownKeys(scanner, ["verdict", "hits"])) issues.push(`scanner.${key}: unrecognized key`);
  if (!VERDICTS.has(scanner.verdict)) issues.push("scanner.verdict: unrecognized verdict");
  if (!Array.isArray(scanner.hits)) {
    issues.push("scanner.hits: expected array");
    return;
  }
  scanner.hits.forEach((hit, index) => {
    const path = `scanner.hits[${index}]`;
    if (!isObject(hit)) {
      issues.push(`${path}: expected object`);
      return;
    }
    for (const key of unknownKeys(hit, ["rule", "span", "target", "path"])) issues.push(`${path}.${key}: unrecognized key`);
    if (typeof hit.rule !== "string") issues.push(`${path}.rule: expected string`);
    if (!TARGETS.has(hit.target)) issues.push(`${path}.target: unrecognized target`);
    if (typeof hit.path !== "string" || !HIT_PATH.test(hit.path)) issues.push(`${path}.path: expected a field path`);
    if (!Array.isArray(hit.span) || hit.span.length !== 2 || hit.span.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      issues.push(`${path}.span: expected two numbers`);
    }
  });
}

function checkApproval(issues, approval) {
  if (!isObject(approval)) {
    issues.push("approval: expected object");
    return;
  }
  for (const key of unknownKeys(approval, ["channel", "by", "latencyMs", "pendingId"])) {
    issues.push(`approval.${key}: unrecognized key`);
  }
  if (Object.hasOwn(approval, "channel") && !CHANNELS.has(approval.channel)) issues.push("approval.channel: unrecognized channel");
  if (Object.hasOwn(approval, "by") && typeof approval.by !== "string") issues.push("approval.by: expected string");
  if (Object.hasOwn(approval, "latencyMs") && typeof approval.latencyMs !== "number") issues.push("approval.latencyMs: expected number");
  if (Object.hasOwn(approval, "pendingId") && typeof approval.pendingId !== "string") issues.push("approval.pendingId: expected string");
}

export async function verifyAuditJsonl(contents, onProgress) {
  if (contents.length === 0) return { ok: true, events: 0, lastHash: GENESIS_HASH };
  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let previous = GENESIS_HASH;
  let events = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (onProgress) await onProgress({ done: index, total: lines.length });
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    if (line.length === 0) return { ok: false, events, error: "blank line in audit log", line: lineNumber };
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { ok: false, events, error: "line is not valid JSON", line: lineNumber };
    }
    const issues = schemaIssues(parsed);
    if (issues.length > 0) {
      return { ok: false, events, error: `line is not an audit event (${issues.join("; ")})`, line: lineNumber };
    }
    if (parsed.prevHash !== previous) {
      return { ok: false, events, error: "prevHash does not match the previous event", line: lineNumber };
    }
    const { hash, ...rest } = parsed;
    const expected = await eventHash(rest);
    if (expected !== hash) {
      return { ok: false, events, error: "hash does not match the event contents", line: lineNumber };
    }
    previous = hash;
    events += 1;
  }
  return { ok: true, events, lastHash: previous };
}
