# MCP Gallery

A small, hand-checked list of MCP servers run by the companies behind the product (Notion, GitHub, Stripe, and so on), plus a few official local servers. The list uses the same format as the official [MCP Registry](https://github.com/modelcontextprotocol/registry), so any client that can read a registry can read this list.

## Subscribe

Point your client at this URL:

```
https://raw.githubusercontent.com/itsjustanks/mcp-gallery/main/v0.1/servers.json
```

It is one static file, laid out like the registry's `GET /v0.1/servers` response:

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
- Header and environment variable entries are templates only. They never contain a secret. A header may have a `value` template such as `Bearer {token}`, with each `{name}` described in `variables`; your client asks the user for it. Environment variables never have a value.

## What gets in

An entry is accepted only if all of these are true:

1. **The vendor runs it.** The server is operated or published by the company that owns the product, or it is an official MCP reference server. No community wrappers, proxies, or gateways.
2. **The vendor documents it.** The exact URL, transport, and sign-in method appear in the vendor's own docs, and `docsUrl` links to that page.
3. **Anyone can connect.** A normal MCP client can connect with OAuth (including dynamic client registration), a user-supplied token, or no sign-in. Servers that only accept a fixed list of approved clients, or that need each user to register their own OAuth app first, are left out.
4. **It answers.** An unauthenticated request gets a real response (2xx, 401, 403, 405 and similar), not a DNS error or a 404.
5. **It is public.** No self-hosted, private, company-internal, or per-tenant URLs.

Remote servers are preferred. Local (`packages`) entries are kept to a few official, widely used ones.

## Checks

- `npm run validate` checks every entry against the pinned `server.json` schema and the gallery's metadata schema. It also checks that names are unique, the list is sorted, every URL is `https`, no secret has a value, a header `value` is a `{name}` template (no `${…}`, every placeholder in `variables`, nothing but a scheme word such as `Bearer` beside it on a credential header), the `auth` field matches the declared inputs, and nothing in the file looks like an email address, IP address, or token. This runs on every pull request.
- `npm run check-endpoints` sends an unauthenticated `initialize` request to every remote and checks that every package version exists. It never sends credentials. It runs every Monday and opens an issue if something stops responding.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
