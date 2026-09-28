# Contributing

Pull requests that add, fix, or remove entries are welcome. Please read the rules in the [README](README.md#what-gets-in) first.

## Add an entry

1. Find the vendor's own page that documents the server's URL, transport, and sign-in method. Blog posts, third-party directories, and community READMEs do not count.
2. Check that the endpoint answers without credentials:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' \
     https://mcp.example.com/mcp
   ```

   A `401` is fine. It means the server is up and wants you to sign in.
3. Add an object to the `servers` array in `v0.2/servers.json`, keep the array sorted by `server.name`, update `metadata.count`, then run `npm run build` to rewrite `v0.1/servers.json` (never edit that one by hand):

   ```json
   {
     "server": {
       "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
       "name": "com.example/mcp",
       "title": "Example",
       "description": "One line on what it does, 100 characters or fewer.",
       "version": "1.0.0",
       "websiteUrl": "https://example.com",
       "remotes": [{ "type": "streamable-http", "url": "https://mcp.example.com/mcp" }]
     },
     "_meta": {
       "io.github.itsjustanks/mcp-gallery": {
         "displayName": "Example",
         "category": "productivity",
         "iconUrl": "https://avatars.githubusercontent.com/u/0000000?v=4",
         "auth": "oauth",
         "docsUrl": "https://docs.example.com/mcp",
         "verifiedAt": "2026-09-24"
       }
     }
   }
   ```

4. Run the checks:

   ```sh
   npm ci
   npm run build
   npm run validate
   npm run check-endpoints
   ```

5. Open a pull request with a link to the vendor page you used.

## Field conventions

- **`name`**: if the vendor has published this same server to the official MCP Registry, use that name. Otherwise use the vendor's domain reversed plus a short suffix, for example `com.example/mcp`.
- **`version`**: use the vendor's published version if there is one. Otherwise use `1.0.0`. For packages, use the exact package version.
- **`remotes`**: list `streamable-http` first. Only add `sse` if the vendor still documents it and it still answers.
- **Headers and environment variables** (for `auth: "token"`): give `name`, `description`, `isRequired`, and `isSecret`. Never add a `default` to a header, or a `value` or `default` to a secret or an environment variable.
- **Header templates**: when the vendor wants a scheme in front of the key, give the header a `value` template and describe each placeholder in `variables`, for example `"value": "Bearer {token}"` with `"variables": { "token": { "description": "…", "isRequired": true, "isSecret": true } }`. Placeholders are `{name}` (letters, digits, `_`), never `${…}`. On a credential header (`Authorization`, anything with key, token, secret…) only a scheme word such as `Bearer`, `Basic` or `Token` may sit beside the placeholder. Use the vendor's own header, as their docs show it.
- **`auth`**: `oauth` if the client signs in through the browser, `token` if the user must supply a key, `none` if no sign-in is needed.
- **`iconUrl`**: the vendor's GitHub organisation avatar (`gh api users/<org> --jq .avatar_url`).
- **`verifiedAt`**: the date you checked the vendor page, in `YYYY-MM-DD` format.

## Needs setup entries

An official server for an everyday app that can't be added in one click may still go in, with a `setup` object in the gallery metadata (see the [README](README.md#needs-setup)):

- `kind`: `byo-oauth` (each user registers an OAuth client), `approved-clients` (only approved AI apps can sign in), `admin` (an admin turns it on first) or `per-org` (the address holds the customer's subdomain or org).
- `reason`: one plain line a non-technical person understands, 200 characters or fewer.
- `guideUrl`: the vendor's own setup page.
- `byo-oauth`: only for a vendor the paseo-mcp plugin ships in its `BYO_OAUTH_VENDORS` list (Google, HubSpot, Zoom), at that vendor's own MCP host, with every link on the vendor's own sites; a new vendor needs a plugin release first. `steps` in plain English, each with the exact console link where there is one; `redirectHint` naming the vendor's redirect field; `clients` listing only the AI apps you checked can take a pre-registered client (Claude Code takes a client ID and secret; Codex takes a client ID only); `scopes` when the vendor's guide lists them.
- `approved-clients`: `clients` only for apps the vendor's own page names as supported.
- `per-org`: the remote URL is the template (`https://{subdomain}.zendesk.com/api/mcp`), described in the remote's `variables`, and `urlTemplate` repeats it exactly; `label` says what to type.

Link the vendor page for every claim in `setup` in your pull request.

## Not accepted

- Community-built wrappers or proxies for someone else's API.
- Self-hosted, private or company-internal URLs. A per-customer URL only as a `per-org` template.
- Servers that only work with a fixed list of approved clients, need each user to register their own OAuth app, need an admin, or live on a per-customer address, unless the entry says so in `setup`.
- Any real token, key, email address, or IP address.

## Fix or remove an entry

If a URL changes or a server is shut down, update or delete the entry, set a new `verifiedAt`, and link the vendor page (or the failing endpoint check) in the pull request.
