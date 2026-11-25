# Deployment checklist — Ecliptrix account server

Run this before the first production deploy and after every upgrade. Each line is
something that has already failed at least once in a real rollout or in review;
they are ordered by "how bad is it if you skip it".

## 1. Secrets and bootstrap

- [ ] `.env` exists on the server, mode `0600`, owned by the service user.
- [ ] `SESSION_SECRET` is at least 32 bytes of real entropy — not a passphrase, not
      copied from `.env.example` (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`).
- [ ] `ROOT_ADMIN_PASSWORD` is strong and unique; `RESET_ROOT_ADMIN_PASSWORD=false`
      after the first successful boot. The password is only written when the account
      has no hash yet, so leaving the env value in place is not automatically unsafe —
      but a stale plaintext in `.env` is still a credential lying around.
- [ ] `PUBLIC_BASE_URL` matches the real origin (`https://…`), no trailing slash.
      Behind TLS this is also what makes cookies `Secure`.
- [ ] Database file is **outside** the release directory (`/opt/webserver/data`) and
      is on local disk. SQLite over NFS corrupts.

## 2. Schema

- [ ] The schema is current after the first boot. `deploy/webserver.service` and
      `docker-compose.yml` ship `AUTO_MIGRATE=true` on purpose: the runtime tree has
      no TypeScript toolchain, so `npm run db:migrate` cannot run there, and
      `AUTO_MIGRATE=false` with a pending migration exits non-zero — `Restart=always`
      turns that into a restart storm. The runner is idempotent and wraps each
      migration in one transaction, so repeated boots are safe.
- [ ] If you CAN pre-migrate (source checkout in CI, rolling upgrade), do that in CI
      with `npm run db:migrate` and then set `AUTO_MIGRATE=false` to make an
      accidental schema change during a restart impossible.
- [ ] `.next/static` (and `public/`, if present) were copied into
      `.next/standalone/` on a bare-metal deploy. `next build` does not do it, and
      the symptom is a page that renders without any styling.
- [ ] `MIGRATIONS_DIR` points at the migrations shipped with the build
      (`.next/standalone` does not include them unless traced — see `Dockerfile`).
- [ ] `GET /api/v1/ready` returns `200` with `migrations: "current"`.
- [ ] The boot did **not** fail with `migration version N is already applied as "…" but
      this tree has "…"`. That message means the database was built by a different
      migration lineage (another branch, another checkout) and this build is refusing
      to run against a schema it does not own — point `DATABASE_PATH` at a fresh file
      or reconcile `schema_migrations` deliberately. Starting anyway would leave code
      querying tables that were never created.
- [ ] `RELEASES_DIR` exists (boot creates it) and is **outside** `public/` and outside
      `.next/standalone`. It defaults to `releases/` next to `DATABASE_PATH`; the
      systemd unit sets it explicitly to `/opt/webserver/data/releases` because the
      service may only write under `/opt/webserver/data`.

## 3. Process

- [ ] Exactly **one** instance. SQLite WAL allows a single writer; a second replica
      answers 500s under write load. Scale-out requires PostgreSQL.
- [ ] Started from the standalone bundle: `node .next/standalone/server.js`
      (`next start` prints a warning and is not the deployment path).
- [ ] Environment is supplied by the supervisor (`EnvironmentFile=` /
      `env_file:`), never by a `.env` inside `.next/standalone`.
- [ ] `HEALTHCHECK` / systemd watchdog hits `/api/v1/health` (cheap, no DB) for
      liveness and `/api/v1/ready` (touches DB) for readiness.
- [ ] A boot with missing configuration **exits non-zero** with the list of missing
      variables — verify this once on purpose (`docker run --rm image` with no env).

## 4. Reverse proxy / TLS

- [ ] Nginx (or equivalent) terminates TLS, forwards `X-Forwarded-For` and
      `X-Forwarded-Proto`; `TRUST_PROXY=true` only when it does.
- [ ] `client_max_body_size 1m` globally — **plus** the two raised locations from
      `deploy/nginx.conf.example`: `^/api/v1/admin/releases` (`1024m`,
      `client_body_timeout 120s`, `proxy_request_buffering off`) and
      `^/api/v1/downloads/` (`proxy_read_timeout 300s`). Without them every installer
      upload answers `413` and a slow 188 MB download dies mid-transfer. Keep the
      default at `1m`: raising it globally hands `/login` and `/register` a 1 GiB
      denial-of-service surface.
- [ ] Do **not** add a second CSP header in Nginx: two CSPs intersect, and the
      console's inline styles break with no error message.
- [ ] Static `/_next/static/*` cached with `immutable`; everything else `no-store`
      (the app sets that header itself).

## 5. Functional smoke (release gate)

- [ ] `node scripts/smoke.mjs` against the deployed origin: 62 checks green.
      It registers throwaways — point `SMOKE_BASE_URL` at staging, or accept the
      noise on production and clean up afterwards. Run it against a **freshly
      started** process: the login IP budget (20 / 5 min) makes a second run on
      the same process fail for reasons that have nothing to do with the code.
- [ ] Sign in at `/login` as the owner in a real browser on http*S*;
      landing page → console → users list all render.
- [ ] Create a user, copy the one-time password, sign in with it and confirm the
      forced password change appears.
- [ ] Suspend that user and confirm their session is gone on refresh (401 →
      login screen).

## 6. Desktop client contract

- [ ] `ACCOUNT_SERVER_URL` in `env.template.desktop` matches `PUBLIC_BASE_URL`.
- [ ] `client=desktop` login returns tokens and sets **no** cookies (curl check in
      `docs/api.md`).
- [ ] Break-glass: `desktop-config.json` still has a `localAdmin` entry, and its
      password has been **rotated away from the default `adminjr`**.
      Record where the new value is stored (password manager) — there is no
      server-side reset for it.
- [ ] Break-glass default broken: confirm the shipped installer/docs do **not**
      leave `adminjr` as the working password anywhere — grep the release notes and
      the first-run instructions, and try `admin` / `adminjr` once on a clean
      profile (it must fail). A default password in a shipped build is a backdoor:
      it is documented in the repository, so it is public.
- [ ] Offline grace (7 days) is understood by support: an unreachable server is not
      a lockout, and only a `403 account_suspended` is.
- [ ] One client release is published before anything is gated: open `/download`
      signed **out** (it must render, with a sign-in prompt — a 404 here is the whole
      fleet having nowhere to go) and signed **in** (it must offer the Windows button
      and show the version, size and SHA-256).
      Check the byte endpoint too:
      `curl -sI -H "Authorization: Bearer $TOKEN" https://…/api/v1/downloads/stable/win`
      → `200` with `ETag` and `Accept-Ranges: bytes`.
- [ ] Desktop gate settings are deliberate: `GET /api/v1/meta` returns
      `minClientVersion` / `latestClientVersion` / `downloadUrl` /
      `maintenanceMessage` / `maxActiveSessions`, and `client.minVersion` is **empty
      or equal to `latestClientVersion`**. The server refuses a minimum above the
      version the **stable** channel serves, and refuses any non-empty minimum when
      that channel serves nothing — both combinations lock every older client out
      with nowhere to download. A build that is only on `beta` does not count: it is
      not downloadable from `/download`.
- [ ] If this deployment armed `client.minVersion` before this release existed, the
      stored value is left untouched (only a *changed* value is validated, so the
      settings form keeps working). Clear it on the next save if it is above the
      build published now.
- [ ] After publishing a new build, `/download` and the landing page show it **without
      a rebuild** (both are `force-dynamic`; a statically prerendered landing page was
      the reason a publish used to be invisible on the website).
- [ ] `app.maintenanceMessage` is **empty** on go-live (a leftover announcement
      blocks all new sign-ins), and `security.maxActiveSessions` matches the real
      device count you are willing to keep alive per user.

## 7. Releases and rollback

- [ ] Publishing is a pointer move, not a copy: `POST /admin/releases` uploads a draft,
      `PATCH … {action:'publish'}` makes it current, `{action:'rollback'}` points the
      channel back at an older **published** build, `{action:'retract'}` withdraws it
      and clears the pointer. Nothing is deleted — the users who already installed a
      build are exactly the people who need it again.
- [ ] Before publishing, compare the uploaded SHA-256 with the build machine's value:
      `/admin/releases` shows it (copy button) and `/download` publishes it to users.
      An installer is unsigned in v1, so this is the only integrity check available.
- [ ] After a rollback, confirm `GET /api/v1/releases/latest` reports the older
      version and that the newer build is still listed and can be made current again
      (its row offers "Publish", since a rollback may only move backwards).
- [ ] A previous build is still fetchable: open `/download` signed in and follow the
      "Download" link in the history table (`/api/v1/downloads/stable/win?release=<id>`).
      A withdrawn build is deliberately not offered there.
- [ ] Rollback drill done once: retract the current build on staging, confirm
      `/download` shows the empty state instead of a 500, then publish it again.

## 8. Operations

- [ ] `npm run db:backup` scheduled (daily), backups restored once to prove they work.
- [ ] Log retention configured; logs are single-line JSON with `requestId`.
- [ ] Audit retention decided (default recommendation: 180 days) and the SQL for it
      is stored next to the backup script, not in someone's shell history.
- [ ] `/admin` and `/account` excluded from any external uptime monitor's
      screenshot tooling (they redirect to `/login`).
