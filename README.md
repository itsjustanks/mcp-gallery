# MCP Gallery

A small, hand-checked list of MCP servers run by the companies behind the product (Notion, GitHub, Stripe, and so on), plus a few official local servers. The list uses the same format as the official [MCP Registry](https://github.com/modelcontextprotocol/registry), so any client that can read a registry can read this list.

## Subscribe

Point your client at this URL:

```
https://raw.githubusercontent.com/itsjustanks/mcp-gallery/main/v0.2/servers.json
```

`v0.1/servers.json` is the same list without the "Needs setup" entries (below), for clients that can't read `setup` yet (paseo-mcp before 0.16.0). It is built from v0.2 by `npm run build`; never edit it by hand.

Each is one static file, laid out like the registry's `GET /v0.1/servers` response:

```json
{
  "servers": [
    {
      "server": { "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json", "name": "com.notion/mcp", "...": "..." },
      "_meta": {
        "io.github.itsjustanks/mcp-gallery": {
          "displayName": "Notion",
          "category": "productivity",
          "iconUrl": "https://...",
          "auth": "oauth",
          "docsUrl": "https://developers.notion.com/docs/get-started-with-mcp",
          "verifiedAt": "2026-09-24"
        }
      }
    }
  ],
  "metadata": { "count": 34 }
}
```

- `server` is a standard `server.json` ([2025-12-11 schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)).
- `_meta["io.github.itsjustanks/mcp-gallery"]` holds the gallery's own notes:
  - `displayName`: name to show in a UI.
  - `category`: one of `developer`, `data`, `docs`, `productivity`, `design`, `crm`, `support`, `marketing`, `analytics`, `payments`, `automation`, `other`. These are the paseo-mcp plugin's own filter names, so a server lands in the same filter as its recommended card.
  - `iconUrl` (optional): the vendor's GitHub organisation avatar.
  - `auth`: what the user needs to connect. `oauth` means the client signs in through the browser. `token` means the user pastes an API key or token into a declared header or environment variable. `none` means no sign-in.
  - `docsUrl`: the vendor page used to check the entry.
  - `verifiedAt`: the date the entry was last checked against that page.
  - `setup` (optional): only on a "Needs setup" entry. See below.
- Header and environment variable entries are templates only. They never contain a secret. A header may have a `value` template such as `Bearer {token}`, with each `{name}` described in `variables`; your client asks the user for it. Environment variables never have a value.

## What gets in

An entry is accepted only if all of these are true:

1. **The vendor runs it.** The server is operated or published by the company that owns the product, or it is an official MCP reference server. No community wrappers, proxies, or gateways.
2. **The vendor documents it.** The exact URL, transport, and sign-in method appear in the vendor's own docs, and `docsUrl` links to that page.
3. **Anyone can connect.** A normal MCP client can connect with OAuth (including dynamic client registration), a user-supplied token, or no sign-in. The one exception is a "Needs setup" entry (below): an official server for an everyday app that only accepts approved clients, needs each user's own OAuth app, needs an admin, or lives on each customer's own address. It says so in `setup`.
4. **It answers.** An unauthenticated request gets a real response (2xx, 401, 403, 405 and similar), not a DNS error or a 404.
5. **It is public.** No self-hosted, private or company-internal URLs. A per-customer address (`https://{subdomain}.zendesk.com/api/mcp`) is allowed only on a "Needs setup" entry, as a template.

Remote servers are preferred. Local (`packages`) entries are kept to a few official, widely used ones.

## Needs setup

Some official servers can't be added in one click. Their entry carries `setup` in the gallery metadata, so a client can show why and how, instead of a button that fails at sign-in:

```json
"setup": {
  "kind": "byo-oauth",
  "reason": "Google only lets in a sign-in app you create in your own Google Cloud project, and these servers are in preview.",
  "guideUrl": "https://developers.google.com/workspace/guides/configure-mcp-servers",
  "steps": ["Create or pick a Google Cloud project: https://console.cloud.google.com/projectcreate", "…"],
  "redirectHint": "Authorized redirect URIs",
  "clients": ["claude"],
  "scopes": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose"
}
```

| `kind` | Meaning | Extra fields |
| --- | --- | --- |
| `byo-oauth` | Each user registers their own OAuth client with the vendor (no dynamic client registration). | `steps` (plain lines; an https address in one is shown as a link), `redirectHint` (the vendor's name for the redirect field; the client fills in its own address), `clients` (AI apps that can take a pre-registered client: `claude`, `codex`), optional `scopes` (space-separated, as the vendor's guide lists them) |
| `approved-clients` | The vendor only lets its approved AI apps sign in. | optional `clients`: the approved apps among `claude` and `codex`, which a client may add it to |
| `admin` | An administrator has to turn it on or register an app first. | none |
| `per-org` | The address holds the user's own subdomain or org. | `urlTemplate` (the remote's own URL, with one `{subdomain}` or `{org}` as the whole first host label or one whole path segment), `label` |

Every kind needs `reason` (one plain line) and `guideUrl` (the vendor's own https page). A field its kind doesn't use is an error. A remote URL may hold a placeholder only on a `per-org` or `admin` entry, described in the remote's `variables`. The paseo-mcp plugin reads `setup` from 0.16.0. A client that doesn't read `setup` would show these entries as a normal card, which is why they are only in `v0.2/servers.json`.

A `byo-oauth` entry is limited to vendors the client itself ships a list of (paseo-mcp: Google, HubSpot and Zoom), at their own MCP host, and every link in its `guideUrl` and `steps` must be on that vendor's own sites. The user pastes a real client secret on that screen, and Claude Code sends it to whichever sign-in server the MCP server names, so a list must not be able to point one somewhere else.

## Checks

- `npm run validate` checks every entry against the pinned `server.json` schema and the gallery's metadata schema. It also checks that names are unique, the list is sorted, every URL is `https`, no secret has a value, a header `value` is a `{name}` template (no `${…}`, every placeholder in `variables`, nothing but a scheme word such as `Bearer` beside it on a credential header), the `auth` field matches the declared inputs, a `setup` is well-formed for its kind (a `per-org` template can only name its own vendor host, not a shared hosting domain; a `byo-oauth` entry is at a known vendor's own host with every link on that vendor's sites), no text holds a control or direction character, `v0.1/servers.json` is v0.2 without its setup entries, and nothing in the file looks like an email address, IP address, or token. This runs on every pull request.
- `npm run check-endpoints` sends an unauthenticated `initialize` request to every remote and checks that every package version exists. It never sends credentials. It runs every Monday and opens an issue if something stops responding.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
