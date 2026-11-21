# Lucena Systems Playground

Visitors use the existing manager cleaning table and scheduling engine with a fictional two-day portfolio in Eastern time. The scenario starts with 12 properties, six cleaners, and 24 reservations. Name and cleaning duration edits, daily shift changes, cancellations, assignment overrides, previews, and published simulations persist for the session. A new preview is required after schedule inputs change. Uncovered work is visible, and an infeasible manual assignment blocks publication.

The staging build serves the Playground and its static assets. Its isolated backend uses the same mock reservation normalization and scheduling feasibility checks as the application, but runs with its own SQLite volume and a private network without outbound access. It has no operational routers or dispatch workers. Maintenance and guest messaging are future features. Sandbox sessions expire one hour after creation. Reset restores the scenario for the current visitor and keeps that session’s original expiration. Creation is capped per network peer and globally. Resume and mutation limits apply per session and globally. Deploy one API instance per SQLite volume.

## Verification

Run the dedicated checks before deploying the tested commit.

```sh
(cd backend && uv sync --frozen && uv run pytest playground_tests)
(cd frontend && npm ci && npx playwright install chromium && PLAYGROUND_ONLY=1 npm run build &&
  PLAYGROUND_TEST_DB="$(mktemp)" npx playwright test --config playground.playwright.config.ts)
```

## Public staging

Use a dedicated staging Docker host with ports 80 and 443 available. Point a dedicated staging DNS record at that host and confirm you have staging host and DNS deployment access. Caddy provisions the HTTPS certificate. No application provider credentials are required.

```sh
export PLAYGROUND_HOST=playground.your-staging-domain.example
docker compose -f infra/playground/compose.yml up --build -d
```

Verify `https://<PLAYGROUND_HOST>/playground` in two separate browser contexts. Confirm the Sandbox label, a simulated publication, and session isolation. Verify the staging host rejects operational pages such as `/dashboard` and operational API calls. Do not mount operational volumes, use existing production domains, or attach this deployment to production networks. To stop staging, run `docker compose -f infra/playground/compose.yml down` on the staging host.

## Railway staging

Create a dedicated Railway project named **Lucena Systems Playground** with a blank `staging` environment. Add one empty service named `playground` in that environment. Leave the project's default environment empty.

- Use the repository root as the service root, and set the Railway config file path to `/infra/playground/railway/railway.toml`. The config selects the staging Dockerfile and a single replica.
- Mount a dedicated Railway volume at `/sandbox`. Session data stays on that volume.
- Set `PORT=8080` and generate a Railway-provided public domain for port 8080. The container uses Railway's `RAILWAY_PUBLIC_DOMAIN` and `RAILWAY_VOLUME_MOUNT_PATH` at startup. Railway terminates HTTPS.
- Deploy the tested Playground commit. For a CLI upload, set `RAILWAY_DOCKERFILE_PATH=infra/playground/railway/Dockerfile` on the staging service and run `railway up --service playground --environment staging` from the repository root.

Only the gateway binds to the service port. The scheduling API and web process bind to loopback. The sandbox image does not contain the operational API or integration workers. Keep operational credentials and volumes out of the staging service. The gateway groups new-session requests by its immediate network peer, so visitors behind a shared Railway ingress may share that limit.

Check the Railway public URL at `/playground`, complete a simulation, and verify that a fresh browser context sees the starting scenario. Verify that `/dashboard` returns 404.
