# Deploy to Cloudflare

Atlas Portal supports Cloudflare as an optional deployment target. The integration uses Workers Static Assets to serve the ordinary static Astro build. It does not change Atlas validation, publication-profile selection, route generation, or browser behavior.

## Architecture

The deployment path is:

```text
Atlas + publication profile + Resource roots
  -> Atlas Portal validation and static build
  -> dist/
  -> Wrangler local workerd or Cloudflare upload
  -> Workers Static Assets
  -> Cloudflare cache
  -> workers.dev or a Custom Domain
```

The default `wrangler.jsonc` declares only an asset directory. There is no `main` entry and no Worker code. Static asset requests therefore do not invoke a server-side application.

Cloudflare provides these parts of the deployment:

- Workers Static Assets stores and serves the generated files.
- Wrangler runs the Cloudflare runtime locally and uploads deployments.
- Cloudflare cache and tiered caching distribute assets across the network.
- Workers routing supplies a `workers.dev` endpoint or a Custom Domain.
- Cloudflare manages TLS for its endpoints and attached Custom Domains.
- `_headers` applies response security policy and immutable browser caching to fingerprinted assets.

The static reader does not require Pages, D1, KV, R2, Durable Objects, Queues, service bindings, Cron Triggers, or a server-side Astro adapter. Add a Cloudflare data or compute service only after the application gains a runtime requirement that static generation cannot satisfy.

## Configuration

The included `wrangler.jsonc` uses:

```json
{
  "name": "atlas-portal",
  "compatibility_date": "2026-08-27",
  "workers_dev": true,
  "preview_urls": false,
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash"
  }
}
```

Change the Worker name before using the configuration for a project. The `--name` option can override it for one command.

`404-page` serves the generated `404.html` with status `404` when no asset matches. `auto-trailing-slash` matches Atlas Portal’s directory-form routes and redirects noncanonical HTML paths.

Keep the Wrangler file as the source of truth for Worker names, assets, routes, and environments. Dashboard changes to the same fields can drift or be replaced by a later Wrangler deployment.

## Run the Cloudflare setup locally

Install Atlas Portal first:

```text
corepack enable
pnpm --dir tools install --frozen-lockfile
```

Build the selected Atlas and start local `workerd`:

```text
pnpm --dir tools --filter atlas-portal cloudflare:dev -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project" \
  --host 127.0.0.1 \
  --port 8787 \
  --name project-atlas
```

Open `http://127.0.0.1:8787/`. The command runs Wrangler with `--local`, disables remote `Request.cf` data retrieval, and does not require Cloudflare authentication or contact remote bindings. The runner also disables Wrangler usage metrics and automatic error reports unless the caller explicitly supplies different Wrangler environment settings.

This path differs from `atlas-portal dev`. Astro development serves source-oriented feedback at port `4321`. Wrangler serves the completed `dist/` output through Cloudflare’s local runtime at port `8787`. Use Astro while developing the reader. Use Wrangler before deployment to verify Cloudflare routing and response behavior.

Restart the command after changing an Atlas record, publication profile, selected Resource, portal source, `_headers`, or Wrangler configuration. The command builds once before the server starts.

Verify at least:

- `/` returns the Atlas landing page;
- Map, Area, Point, Resource, search, and Check routes open directly;
- a nonexistent path returns status `404` and the generated not-found page;
- canonical directory routes preserve trailing slashes;
- the response includes the expected security headers; and
- fingerprinted `/_astro/` files use the immutable cache policy.

## Validate without uploading

Run a full build and Wrangler deployment dry run:

```text
pnpm --dir tools --filter atlas-portal cloudflare:deploy:dry-run -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project" \
  --name project-atlas
```

This validates the Wrangler configuration and packages the static asset deployment without creating or changing a remote Worker.

## Authenticate

For an interactive local deployment:

```text
pnpm --dir tools --filter atlas-portal exec wrangler login
pnpm --dir tools --filter atlas-portal exec wrangler whoami
```

For CI, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the CI secret store. Scope the API token to the intended account, zone, and Worker permissions. Never store credentials in `wrangler.jsonc`, Atlas records, publication profiles, package scripts, or committed environment files.

## Deploy

Deploy a generated portal to Workers Static Assets:

```text
pnpm --dir tools --filter atlas-portal cloudflare:deploy -- \
  --atlas "/absolute/path/to/project/atlas" \
  --profile public \
  --resource-root "/absolute/path/to/project" \
  --name project-atlas
```

The command rebuilds from source before every upload. It uses Wrangler strict mode so conflicting remote configuration stops the upload. Wrangler creates a new Worker version and updates the configured endpoint after the upload succeeds. A failed build cannot advance the remote deployment.

The default configuration enables the stable `workers.dev` endpoint and disables per-version preview URLs. The endpoint is Internet-reachable unless Cloudflare Access protects the Worker or hostname.

## Add a Custom Domain

For a Worker that is the site origin, Cloudflare recommends a Custom Domain. Add the target domain to Cloudflare, then declare the domain in the Wrangler configuration:

```json
{
  "workers_dev": false,
  "routes": [
    {
      "pattern": "atlas.example.com",
      "custom_domain": true
    }
  ]
}
```

Wrangler attaches the Custom Domain during deployment. Cloudflare creates and renews its certificate. Custom Domains match exact hostnames, so add an explicit redirect rule when both an apex and `www` hostname must resolve.

## Restrict access

A publication profile determines which source units can enter the generated site. It does not authenticate readers or make a deployment private.

Use Cloudflare Access when a portal requires sign-in. Protect the exact Worker, `workers.dev` hostname, Custom Domain, or route and define an explicit allow policy. Configure Access before sharing the deployment URL. WAF rules and rate limits can add request controls for public deployments.

Access, WAF, rate limits, DNS, and zone-level TLS policy live in the Cloudflare account. They are not Atlas fields and are not encoded in the generic Wrangler file.

## Headers and caching

Astro copies `public/_headers` into every build. Workers Static Assets reads that file during local development and deployment.

The included rules set:

- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- a restrictive `Permissions-Policy`; and
- a one-year immutable cache lifetime for fingerprinted `/_astro/` assets.

Cloudflare automatically caches static assets. Atlas Portal does not add a Worker script or `run_worker_first`, so asset requests remain on the direct static path. HTML keeps Cloudflare’s normal revalidation behavior while content-hashed assets receive a long browser cache lifetime.

Add Content Security Policy only after testing every generated route. Search data currently uses an inline JSON script element, so a strict policy requires a hash, nonce, or a changed data-delivery mechanism.

## Optional Cloudflare services

Cloudflare Web Analytics can provide reader traffic without adding an application database. Enable it only when the site’s privacy policy permits measurement.

Workers Logs and Tail Workers become relevant when Worker code executes. The asset-only configuration has no application logs to emit. Cloudflare’s dashboard still reports deployment and traffic information for the Worker.

Images, R2, and KV may become useful if a future portal publishes large attachments or generated media that exceed the static asset model. They are not needed for the current HTML and text reader.

## Platform limits

Before deployment, check the generated asset inventory against current Workers limits. Cloudflare currently limits each static asset to 25 MiB and the number of files per Worker version according to the account plan. Atlas Portal already avoids copying unsupported or oversized Resource bytes, but a large publication can still produce many HTML routes.

Use Wrangler’s dry run and the Cloudflare dashboard to review the deployment before changing the live endpoint.

## Official Cloudflare references

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static-site generation routing](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Workers Static Assets limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
