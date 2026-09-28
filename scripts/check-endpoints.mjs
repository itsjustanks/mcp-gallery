#!/usr/bin/env node
// Checks that every remote endpoint answers and every package version exists.
// Never sends credentials. A 401/403 means "alive, needs auth" and counts as healthy.
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = new URL("../v0.2/servers.json", import.meta.url);
const TIMEOUT_MS = 15_000;
const HEALTHY_STATUSES = new Set([400, 401, 403, 405, 406, 415]);
const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-gallery-endpoint-check", version: "0.1.0" },
  },
});

const isHealthy = (status) => (status >= 200 && status < 300) || HEALTHY_STATUSES.has(status);

async function request(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
    await response.body?.cancel();
    return { status: response.status };
  } catch (error) {
    return { error: error.name === "AbortError" ? "timeout" : error.cause?.code ?? error.message };
  } finally {
    clearTimeout(timer);
  }
}

// A per-org or admin address holds a placeholder; it is probed with a value
// that exists (Zendesk's own subdomain) or answers without one (an all-zero tenant).
const PROBE_VALUES = { subdomain: "support", org: "support", tenantId: "00000000-0000-0000-0000-000000000000" };

function probeUrl(url) {
  return url.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, id) => PROBE_VALUES[id] ?? match);
}

function probeRemote(remote) {
  const url = probeUrl(remote.url);
  if (remote.type === "sse") {
    return request(url, { method: "GET", headers: { Accept: "text/event-stream" } });
  }
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: INITIALIZE,
  });
}

function packageUrl(pkg) {
  const id = encodeURIComponent(pkg.identifier).replace("%40", "@");
  if (pkg.registryType === "npm") return `https://registry.npmjs.org/${id.replace("%2F", "/")}/${pkg.version}`;
  if (pkg.registryType === "pypi") return `https://pypi.org/pypi/${pkg.identifier}/${pkg.version}/json`;
  return null;
}

async function withRetry(check) {
  const first = await check();
  if (first.status && isHealthy(first.status)) return first;
  return check();
}

function targetsOf(entry) {
  const { name, remotes = [], packages = [] } = entry.server;
  const remoteTargets = remotes.map((remote) => ({
    name,
    label: `${remote.type} ${remote.url}`,
    check: () => probeRemote(remote),
    ok: (result) => result.status && isHealthy(result.status),
  }));
  const packageTargets = packages
    .map((pkg) => ({ pkg, url: packageUrl(pkg) }))
    .filter(({ url }) => url)
    .map(({ pkg, url }) => ({
      name,
      label: `${pkg.registryType} ${pkg.identifier}@${pkg.version}`,
      check: () => request(url, { method: "GET" }),
      ok: (result) => result.status === 200,
    }));
  return [...remoteTargets, ...packageTargets];
}

async function main() {
  const list = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  const targets = list.servers.flatMap(targetsOf);
  const results = await Promise.all(
    targets.map(async (target) => ({ ...target, result: await withRetry(target.check) })),
  );

  const failures = results.filter(({ ok, result }) => !ok(result));
  for (const { name, label, result, ok } of results) {
    const outcome = result.status ?? result.error;
    console.log(`${ok(result) ? "ok  " : "FAIL"} ${outcome}\t${name}\t${label}`);
  }

  if (failures.length && process.env.REPORT_PATH) {
    const rows = failures.map(({ name, label, result }) => `| \`${name}\` | ${label} | ${result.status ?? result.error} |`);
    const report = [
      `The weekly endpoint check found ${failures.length} unreachable target(s).`,
      "",
      "| Server | Target | Result |",
      "| --- | --- | --- |",
      ...rows,
      "",
      "Healthy means HTTP 2xx or 400/401/403/405/406/415 for remotes, and 200 for package versions.",
      "Check the vendor docs and update or remove the entry.",
    ].join("\n");
    writeFileSync(process.env.REPORT_PATH, report);
  }

  console.log(`\n${results.length - failures.length}/${results.length} targets healthy`);
  process.exit(failures.length ? 1 : 0);
}

main();
