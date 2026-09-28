#!/usr/bin/env node
// Validates v0.2/servers.json (or the file given), and that v0.1/servers.json
// is v0.2 without its setup entries (see scripts/build.mjs). Exits non-zero on
// any problem.
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { v01Text } from "./build.mjs";

const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const SERVER_SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const META_KEY = "io.github.itsjustanks/mcp-gallery";
const DATA_PATH = process.argv[2] ?? "v0.2/servers.json";

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

// Header value templates, held to the same rules as the paseo-mcp plugin
// (shared/catalog.ts): `{name}` placeholders the user fills in, never `${…}`,
// and beside the placeholders only a scheme word on a credential header.
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;
const CREDENTIAL_NAME = /(token|secret|key|password|passwd|auth|bearer|credential|cookie|session|signature)/i;
const CREDENTIAL_LITERAL = /^\s*(bearer|basic|token|apikey|api-key)?[\s:=,;]*$/i;

/** A long run of mixed letters and digits: the shape of a random key. */
function looksLikeKey(text) {
  const mixed = (piece) => /[A-Za-z]/.test(piece) && /[0-9]/.test(piece);
  for (const run of text.match(/[A-Za-z0-9+=_-]{20,}/g) ?? []) {
    if (run.split(/[-_]/).some((piece) => piece.length >= 20 && mixed(piece))) return true;
    if (run.length >= 32 && (run.match(/[0-9]/g) ?? []).length >= 6 && mixed(run)) return true;
  }
  return false;
}

/** Why a header's `value` is not a template the user fills in, "" when it is one. */
function headerTemplateProblem(header) {
  const value = header.value;
  if (typeof value !== "string") return "value must be text";
  if (value.includes("${")) return "value uses ${…}; use {name} placeholders";
  const ids = [...value.matchAll(PLACEHOLDER)].map((match) => match[1]);
  if (ids.length === 0) return "has a value with no {placeholder}; header values must be left for the user to fill in";
  const missing = ids.find((id) => !header.variables?.[id]);
  if (missing) return `value uses {${missing}}, which is not in variables`;
  const literal = value.replace(PLACEHOLDER, " ");
  if (CREDENTIAL_NAME.test(header.name ?? "") && !CREDENTIAL_LITERAL.test(literal.replace(/\s+/g, " "))) {
    return "value holds literal text beside its placeholder; a credential header may only add a scheme such as 'Bearer '";
  }
  if (looksLikeKey(literal)) return "value holds what looks like a literal key";
  return "";
}

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

// Control, zero-width and direction-changing characters: text that reads one
// way and is another. The plugin strips them; the list shouldn't hold them.
const UNSAFE_CHAR = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

function checkPlainText(where, entry) {
  for (const [path, value] of walk(entry)) {
    if (typeof value === "string" && UNSAFE_CHAR.test(value)) fail(where, `${path} holds a control or direction character`);
  }
}

function inputsOf(server) {
  const inputs = [];
  for (const remote of server.remotes ?? []) {
    for (const header of remote.headers ?? []) {
      inputs.push({ kind: "header", ...header });
      for (const [id, variable] of Object.entries(header.variables ?? {})) inputs.push({ kind: "variable", name: `{${id}} in ${header.name}`, ...variable });
    }
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
    if (input.kind === "header" && "default" in input) {
      fail(where, `${label} has a default; header values must be left for the user to fill in`);
    }
    if (input.kind === "header" && "value" in input) {
      const problem = headerTemplateProblem(input);
      if (problem) fail(where, `${label} ${problem}`);
      // A template's secret is its variables, checked on their own below.
      continue;
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

// "Needs setup" entries (setup in the gallery metadata), held to the same
// rules as the paseo-mcp plugin (shared/setup.ts). A per-org address holds one
// {subdomain} or {org} as the whole first host label or one whole path segment,
// so a typed value can't move it to another site. Only per-org and admin
// entries may have a placeholder in their address at all.
const ORG_PLACEHOLDERS = new Set(["subdomain", "org"]);
const MULTI_LABEL_ONLY = /^(co|com|net|org|ac|gov|edu|ne|or)\.[a-z]{2}$/;
const MULTI_LABEL_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "com.br", "com.cn", "co.in", "co.za", "com.mx", "com.sg", "com.hk", "co.kr"]);
// Hosting domains where each subdomain is someone else's site (the plugin's SHARED_HOSTING).
const SHARED_HOSTING = new Set([
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "herokuapp.com", "azurewebsites.net",
  "web.app", "firebaseapp.com", "appspot.com", "onrender.com", "fly.dev", "cloudfront.net", "amazonaws.com", "blogspot.com",
  "glitch.me", "replit.app", "repl.co", "ngrok.io", "ngrok-free.app", "trycloudflare.com", "run.app", "railway.app", "surge.sh",
]);

function registrableDomain(host) {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  const lastTwo = labels.slice(-2).join(".");
  return labels.length >= 3 && MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

// The vendors whose own sign-in app a byo-oauth entry may ask for, by the exact
// hosts of their MCP servers and guides: the plugin's BYO_OAUTH_VENDORS
// (shared/setup.ts), which it ships and never reads from a list. Adding one
// here does nothing until the plugin knows it too.
const BYO_OAUTH_VENDORS = [
  { vendor: "Google", server: /^[a-z0-9-]+mcp\.googleapis\.com$/, links: ["developers.google.com", "console.cloud.google.com", "cloud.google.com", "workspace.google.com", "support.google.com"] },
  { vendor: "HubSpot", server: /^mcp\.hubspot\.com$/, links: ["developers.hubspot.com", "knowledge.hubspot.com", "app.hubspot.com", "www.hubspot.com"] },
  { vendor: "Zoom", server: /^mcp\.zoom\.us$/, links: ["developers.zoom.us", "marketplace.zoom.us", "support.zoom.com", "www.zoom.com"] },
];

function httpsHost(link) {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && !url.port && !url.username && !url.password ? url.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function orgTemplateProblem(template) {
  const ids = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
  if (ids.length !== 1 || !ORG_PLACEHOLDERS.has(ids[0])) return "needs exactly one {subdomain} or {org}";
  const match = /^https:\/\/([^/?#@:]+)(\/[^?#]*)?$/.exec(template);
  if (!match) return "must be https with no port, user name, query or fragment";
  const [, host, path = ""] = match;
  const token = `{${ids[0]}}`;
  if (host.includes(token)) {
    const base = host.slice(token.length + 1);
    if (!host.startsWith(`${token}.`) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(base) || MULTI_LABEL_ONLY.test(base)) return "must hold the placeholder as the whole first label of a vendor host";
    if (SHARED_HOSTING.has(registrableDomain(base))) return "is under a shared hosting domain, where each subdomain is someone else's site";
    return "";
  }
  if (!path.split("/").includes(token)) return "must hold the placeholder as the whole first host label or a whole path segment";
  return "";
}

function checkSetup(where, server, meta) {
  const setup = meta.setup;
  const remotes = server.remotes ?? [];
  for (const remote of remotes) {
    const ids = [...remote.url.matchAll(PLACEHOLDER)].map((match) => match[1]);
    if (ids.length === 0) continue;
    if (!setup || !["per-org", "admin"].includes(setup.kind)) fail(where, `remote url ${remote.url} has a placeholder; only a per-org or admin setup may`);
    for (const id of ids) if (!remote.variables?.[id]) fail(where, `remote url uses {${id}}, which is not in its variables`);
  }
  if (!setup) return;
  if (setup.kind === "per-org") {
    const problem = orgTemplateProblem(setup.urlTemplate ?? "");
    if (problem) fail(where, `setup.urlTemplate ${problem}`);
    if (!remotes.some((remote) => remote.url === setup.urlTemplate)) fail(where, "setup.urlTemplate must be the remote's own url");
  }
  if (setup.kind === "byo-oauth") {
    if (meta.auth !== "oauth") fail(where, "a byo-oauth setup needs auth \"oauth\"");
    if (remotes.length === 0 || remotes.some((remote) => remote.headers?.length)) fail(where, "a byo-oauth setup needs a remote with no headers");
    const vendors = remotes.map((remote) => BYO_OAUTH_VENDORS.find((known) => known.server.test(httpsHost(remote.url))));
    const vendor = vendors[0];
    if (!vendor || vendors.some((other) => other !== vendor)) {
      fail(where, `a byo-oauth setup is only for a vendor's own server the plugin knows (${BYO_OAUTH_VENDORS.map((known) => known.vendor).join(", ")})`);
    } else {
      // Every link on the card and the sheet: guide, docs, website, and any address in the text (any case, http too).
      const texts = [setup.reason ?? "", setup.redirectHint ?? "", ...(setup.steps ?? [])];
      const links = [setup.guideUrl, meta.docsUrl, server.websiteUrl, ...texts.flatMap((text) => text.match(/https?:\/\/[^\s)<>"']+/gi) ?? [])].filter(Boolean);
      for (const link of links) {
        if (!vendor.links.includes(httpsHost(link.replace(/[.,;:]+$/, "")))) fail(where, `setup link ${link} is not https on ${vendor.vendor}'s own sites`);
      }
    }
  }
  if (setup.kind === "approved-clients" && setup.steps) fail(where, "an approved-clients setup links the vendor's page instead of steps");
  for (const step of setup.steps ?? []) {
    if (step.includes("${")) fail(where, "setup step holds ${…}");
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
  checkPlainText(where, entry);
  checkNoFilledSecrets(where, server);
  checkAuthConsistency(where, server, meta);
  checkSetup(where, server, meta);
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

  // The default run also checks v0.1 is v0.2 without its setup entries.
  if (process.argv[2] === undefined && read("v0.1/servers.json") !== v01Text(list)) {
    fail("v0.1/servers.json", "is not v0.2 without its setup entries; run npm run build");
  }

  if (errors.length) {
    console.error(`Validation failed with ${errors.length} problem(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${list.servers.length} servers valid in ${DATA_PATH}`);
}

main();
