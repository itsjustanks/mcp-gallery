#!/usr/bin/env node
// Validates v0.1/servers.json. Exits non-zero on any problem.
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const SERVER_SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const META_KEY = "io.github.itsjustanks/mcp-gallery";
const DATA_PATH = process.argv[2] ?? "v0.1/servers.json";

const SECRET_PATTERNS = [
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["IPv4 address", /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ["Stripe key", /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{20,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["bearer credential", /Bearer\s+(?!<)[A-Za-z0-9._~+/=-]{16,}/],
];

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

function buildValidators() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const server = ajv.compile(JSON.parse(read("schema/server.schema.2025-12-11.json")));
  const meta = ajv.compile(JSON.parse(read("schema/gallery-meta.schema.json")));
  return { server, meta };
}

function formatAjvErrors(validate) {
  return validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

function* walk(value, path = "") {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) yield* walk(item, `${path}[${i}]`);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) yield* walk(item, `${path}.${key}`);
  } else {
    yield [path, value];
  }
}

function checkHttpsOnly(where, entry) {
  for (const [path, value] of walk(entry)) {
    if (typeof value === "string" && /^http:\/\//i.test(value)) {
      fail(where, `${path} uses http:// (https only)`);
    }
  }
}

function inputsOf(server) {
  const inputs = [];
  for (const remote of server.remotes ?? []) {
    for (const header of remote.headers ?? []) inputs.push({ kind: "header", ...header });
  }
  for (const pkg of server.packages ?? []) {
    for (const env of pkg.environmentVariables ?? []) inputs.push({ kind: "env", ...env });
    for (const arg of [...(pkg.packageArguments ?? []), ...(pkg.runtimeArguments ?? [])]) {
      inputs.push({ kind: "argument", ...arg });
    }
  }
  return inputs;
}

function checkNoFilledSecrets(where, server) {
  for (const input of inputsOf(server)) {
    const label = `${input.kind} ${input.name ?? input.valueHint ?? "?"}`;
    if (input.kind === "header" && ("value" in input || "default" in input)) {
      fail(where, `${label} has a value; header values must be left for the user to fill in`);
    }
    if (input.isSecret && ("value" in input || "default" in input)) {
      fail(where, `${label} is secret but has a value/default`);
    }
  }
}

function checkAuthConsistency(where, server, meta) {
  const secrets = inputsOf(server).filter((input) => input.isSecret);
  if (meta.auth === "token" && secrets.length === 0) {
    fail(where, `auth is "token" but no secret header or environment variable is declared`);
  }
  if (meta.auth !== "token" && secrets.some((input) => input.isRequired)) {
    fail(where, `auth is "${meta.auth}" but a required secret input is declared (use "token")`);
  }
}

function checkRemotes(where, server) {
  if (!server.remotes?.length && !server.packages?.length) {
    fail(where, "must declare at least one remote or package");
  }
  for (const remote of server.remotes ?? []) {
    if (!remote.url.startsWith("https://")) fail(where, `remote url ${remote.url} must be https`);
  }
}

function checkVerifiedAt(where, meta) {
  const today = new Date().toISOString().slice(0, 10);
  if (meta.verifiedAt > today) fail(where, `verifiedAt ${meta.verifiedAt} is in the future`);
}

function checkSecretPatterns(raw) {
  for (const [label, pattern] of SECRET_PATTERNS) {
    const match = raw.match(pattern);
    if (match) fail(DATA_PATH, `looks like it contains a ${label}: "${match[0].slice(0, 12)}..."`);
  }
}

function checkEntry(entry, index, validators, seenNames) {
  const name = entry?.server?.name ?? `#${index}`;
  const where = `servers[${index}] (${name})`;

  const extraKeys = Object.keys(entry ?? {}).filter((key) => !["server", "_meta"].includes(key));
  if (extraKeys.length) fail(where, `unexpected keys: ${extraKeys.join(", ")}`);

  const server = entry?.server;
  if (!server) return fail(where, "missing server");
  if (!validators.server(server)) fail(where, `server.json schema: ${formatAjvErrors(validators.server)}`);
  if (server.$schema !== SERVER_SCHEMA_URL) fail(where, `$schema must be ${SERVER_SCHEMA_URL}`);

  if (seenNames.has(server.name)) fail(where, `duplicate name ${server.name}`);
  seenNames.add(server.name);

  const meta = entry?._meta?.[META_KEY];
  if (!meta) return fail(where, `missing _meta["${META_KEY}"]`);
  if (!validators.meta(meta)) fail(where, `gallery metadata: ${formatAjvErrors(validators.meta)}`);

  checkRemotes(where, server);
  checkHttpsOnly(where, entry);
  checkNoFilledSecrets(where, server);
  checkAuthConsistency(where, server, meta);
  checkVerifiedAt(where, meta);
}

function checkList(list) {
  const extraKeys = Object.keys(list).filter((key) => !["servers", "metadata"].includes(key));
  if (extraKeys.length) fail(DATA_PATH, `unexpected top-level keys: ${extraKeys.join(", ")}`);
  if (!Array.isArray(list.servers)) return fail(DATA_PATH, "servers must be an array");
  if (list.metadata?.count !== list.servers.length) {
    fail(DATA_PATH, `metadata.count (${list.metadata?.count}) must equal servers.length (${list.servers.length})`);
  }
  const names = list.servers.map((entry) => entry?.server?.name ?? "");
  const sorted = [...names].sort();
  if (names.join("\n") !== sorted.join("\n")) fail(DATA_PATH, "servers must be sorted by server.name");
}

function main() {
  const raw = read(DATA_PATH);
  let list;
  try {
    list = JSON.parse(raw);
  } catch (error) {
    console.error(`${DATA_PATH}: invalid JSON: ${error.message}`);
    process.exit(1);
  }

  const validators = buildValidators();
  const seenNames = new Set();
  checkList(list);
  checkSecretPatterns(raw);
  (list.servers ?? []).forEach((entry, index) => checkEntry(entry, index, validators, seenNames));

  if (errors.length) {
    console.error(`Validation failed with ${errors.length} problem(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${list.servers.length} servers valid in ${DATA_PATH}`);
}

main();
