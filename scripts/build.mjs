#!/usr/bin/env node
// Writes v0.1/servers.json from v0.2/servers.json: every server except the
// ones that need setting up (a `setup` in the gallery metadata). Plugins
// before paseo-mcp 0.16.0 read v0.1 and can't read `setup`, so they would
// offer those servers as one click. Edit v0.2, then run `npm run build`.
import { readFileSync, writeFileSync } from "node:fs";

export const META_KEY = "io.github.itsjustanks/mcp-gallery";
const ROOT = new URL("..", import.meta.url);

/** The v0.1 file's text for a v0.2 list. */
export function v01Text(list) {
  const servers = list.servers.filter((entry) => !entry?._meta?.[META_KEY]?.setup);
  return `${JSON.stringify({ ...list, servers, metadata: { ...list.metadata, count: servers.length } }, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = JSON.parse(readFileSync(new URL("v0.2/servers.json", ROOT), "utf8"));
  const text = v01Text(list);
  writeFileSync(new URL("v0.1/servers.json", ROOT), text);
  console.log(`Wrote v0.1/servers.json: ${JSON.parse(text).servers.length} of ${list.servers.length} servers (no setup entries).`);
}
