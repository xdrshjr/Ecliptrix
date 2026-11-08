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
- [ ] `client_max_body_size 1m`; the app enforces 64 KB itself and answers 413.
- [ ] Do **not** add a second CSP header in Nginx: two CSPs intersect, and the
      console's inline styles break with no error message.
- [ ] Static `/_next/static/*` cached with `immutable`; everything else `no-store`
      (the app sets that header itself).

## 5. Functional smoke (release gate)

- [ ] `node scripts/smoke.mjs` against the deployed origin: 46 checks green.
      It registers throwaways — point `SMOKE_BASE_URL` at staging, or accept the
      noise on production and clean up afterwards.
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
- [ ] Offline grace (7 days) is understood by support: an unreachable server is not
      a lockout, and only a `403 account_suspended` is.

## 7. Operations

- [ ] `npm run db:backup` scheduled (daily), backups restored once to prove they work.
- [ ] Log retention configured; logs are single-line JSON with `requestId`.
- [ ] Audit retention decided (default recommendation: 180 days) and the SQL for it
      is stored next to the backup script, not in someone's shell history.
- [ ] `/admin` and `/account` excluded from any external uptime monitor's
      screenshot tooling (they redirect to `/login`).
