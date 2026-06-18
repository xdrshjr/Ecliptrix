# Desktop Login Stale Root Password Diagnosis

## Problem description

The packaged desktop app rejects the expected root login `admin` / `admin`.
The desktop backend log under `desktop/release/win-unpacked/resources/backend/logs/app.log`
shows repeated `POST /api/auth/login` requests returning 401 with
`INVALID_CREDENTIALS`.

This node is diagnosis-only. No fix code was written.

## Reproduction steps

### End-to-end reproduction from the current desktop data

1. Use the existing desktop install data at
   `%APPDATA%/ecliptrix-desktop/.env`.
2. Confirm the persisted root account config:

   ```powershell
   Select-String -Path $env:APPDATA/ecliptrix-desktop/.env -Pattern '^(ROOT_USERNAME|ROOT_PASSWORD)='
   ```

   Observed in this environment:

   ```text
   ROOT_USERNAME=admin
   ROOT_PASSWORD=change_me_on_first_run
   ```

3. Start the packaged desktop app from:

   ```powershell
   desktop/release/win-unpacked/Ecliptrix.exe
   ```

4. On the login screen, enter username `admin` and password `admin`.
5. Observe the login failure message. The backend log records:

   ```text
   2026-06-18 10:11:52 - app.services.auth_service - WARNING - authenticate_user:163 - Password verification failed
   2026-06-18 10:11:52 - app.main - WARNING - fastapi_http_exception_handler:417 - FastAPI HTTP exception: 401 - {'success': False, 'message': '用户名或密码错误', 'error_code': 'INVALID_CREDENTIALS'}
   ```

### Minimal local repro without launching Electron

Run this from the repository root:

```powershell
@'
import sqlite3, bcrypt
from pathlib import Path

db = Path.home() / 'AppData/Roaming/ecliptrix-desktop/data/ecliptrix.db'
con = sqlite3.connect(db)
row = con.execute("select password_hash from users where username='admin'").fetchone()

for candidate in ['admin', 'change_me_on_first_run']:
    print(candidate, bcrypt.checkpw(candidate.encode(), row[0].encode()))

con.close()
'@ | python -
```

Observed output:

```text
admin False
change_me_on_first_run True
```

This confirms the local root user state matches the stale factory password, not
the expected `admin` password.

## Root cause analysis

The immediate cause is an incomplete stale-password migration in
`desktop/main/envCheck.js`.

The packaged `app.asar` content confirms the desktop build advertises and
ships `admin` / `admin`:

- `desktop/release/win-unpacked/resources/app.asar:scripts/env.template.desktop`
  contains `ROOT_USERNAME=admin` and `ROOT_PASSWORD=admin`.
- The source template matches that packaged value:
  `desktop/scripts/env.template.desktop:58` sets `ROOT_USERNAME=admin` and
  `desktop/scripts/env.template.desktop:59` sets `ROOT_PASSWORD=admin`.

However, the existing user data `.env` is not recopied on upgrade. It is only
copied when absent:

- `desktop/main/config.js:35` to `desktop/main/config.js:37` copy the template
  only if the target `.env` does not exist.

The startup backfill is supposed to migrate stale factory root passwords, but it
currently recognizes only `adminjr`:

- `desktop/main/envCheck.js:15` defines
  `STALE_FACTORY_ROOT_PASSWORDS = new Set(['adminjr'])`.
- `desktop/main/envCheck.js:117` to `desktop/main/envCheck.js:133` rewrite
  `ROOT_PASSWORD` only when the current value is in that set.
- The packaged copy is the same: `app.asar:main/envCheck.js:15` has only
  `new Set(['adminjr'])`, and `app.asar:main/envCheck.js:118` to
  `app.asar:main/envCheck.js:128` gate the rewrite on membership in that set.

This code is on the failing packaged startup path, not dead code:

- `desktop/main/index.js:89` to `desktop/main/index.js:96` initialize
  userData and locate the copied `.env`.
- `desktop/main/index.js:135` calls `backfillUserEnv(envPath, envTemplatePath)`
  before `desktop/main/index.js:140` calls `loadUserEnv(envPath)`.
- `desktop/main/index.js:204` to `desktop/main/index.js:215` pass
  `state.userEnv` into `createBackendDescriptor()`.
- The packaged copy has the same sequence at `app.asar:main/index.js:135`,
  `app.asar:main/index.js:140`, and `app.asar:main/index.js:209` to
  `app.asar:main/index.js:214`.

The affected install has `ROOT_PASSWORD=change_me_on_first_run`, so it is
treated as a real user-edited value and is not migrated. That stale value then
propagates into the backend:

- `desktop/main/backendService.js:30` to `desktop/main/backendService.js:33`
  inject `userEnv` into the backend child process.
- `backend-services/basic-service/app/config.py:966` to
  `backend-services/basic-service/app/config.py:967` give `ROOT_USERNAME` and
  `ROOT_PASSWORD` priority over deprecated `ADMIN_*` values.
- `backend-services/basic-service/app/database.py:123` to
  `backend-services/basic-service/app/database.py:154` sync the root user from
  `settings.auth.root_username` and `***REMOVED***` at startup.
- `backend-services/basic-service/app/services/auth_service.py:151` to
  `backend-services/basic-service/app/services/auth_service.py:158` verify root
  logins directly against `***REMOVED***`.

The log evidence matches that flow:

- `desktop/release/win-unpacked/resources/backend/logs/app.log:164` says
  `Root user synced from .env configuration`.
- `desktop/release/win-unpacked/resources/backend/logs/app.log:181` says
  `User query successful`, which rules out a missing, inactive, or mistyped
  `admin` user for that request.
- `desktop/release/win-unpacked/resources/backend/logs/app.log:182` then says
  `Password verification failed`.
- `desktop/release/win-unpacked/resources/backend/logs/app.log:184` returns
  `401` with `INVALID_CREDENTIALS`.

Reviewer rerun of the local SQLite check confirms the same state:

```text
row_found= True
username= admin is_root= 1 is_active= 1
admin False
change_me_on_first_run True
adminjr False
```

This excludes two plausible alternatives:

- A frontend form or routing issue is unlikely to be the root cause because the
  backend log records real `POST /api/auth/login` requests reaching
  `authenticate_user`.
- A missing database user is not the root cause because the auth service logs
  `User query successful`, and the local DB row is root and active. The stored
  hash matching `change_me_on_first_run` is consistent with startup sync from
  the stale `.env`; root auth also compares directly against
  `***REMOVED***`, so the decisive password source is still the
  environment value.

Root-cause hypothesis: existing installs that still carry the older
`ROOT_PASSWORD=change_me_on_first_run` are not migrated by the current
`backfillUserEnv()` stale-password logic, so the backend remains configured to
expect `change_me_on_first_run` while the product/user expectation is
`admin/admin`.

## Impact surface

| Area | Impact |
|---|---|
| Existing desktop installs | Users with `%APPDATA%/ecliptrix-desktop/.env` containing `ROOT_PASSWORD=change_me_on_first_run` cannot log in with `admin/admin`. |
| Fresh installs from the current template | Likely unaffected because `desktop/scripts/env.template.desktop` now contains `ROOT_PASSWORD=admin`. |
| Backend auth | Root login follows the stale `.env` value by design, so this is a config migration bug rather than an auth bypass. |
| User data | A careless migration could overwrite intentional user-customized root passwords, so the fix must be narrowly scoped to known factory defaults. |

## Candidate fixes

| Fix | Description | Invasiveness | Risk | Effort |
|---|---|---:|---:|---:|
| A. Add `change_me_on_first_run` to the stale factory password set | Extend `STALE_FACTORY_ROOT_PASSWORDS` so `backfillUserEnv()` migrates both known old factory values to the current template value, only when `ROOT_USERNAME` still matches the template root username. | Low | Low-medium: must preserve the current guard so real user-edited passwords are not overwritten. | Low |
| B. Add versioned desktop `.env` migration metadata | Track a config/template version in userData and run named migrations for factory defaults. | Medium | Medium: more code paths and state to validate, but clearer for future changes. | Medium |
| C. Manual support workaround only | Tell users to edit `%APPDATA%/ecliptrix-desktop/.env` and set `ROOT_PASSWORD=admin`, then restart. | Very low | High: does not fix shipped upgrade behavior and leaves downstream users stuck. | Low |

## Recommended fix

Use fix A now, and consider fix B only if more desktop configuration migrations
are expected.

The current `backfillUserEnv()` already has the right shape: it rewrites only
known stale factory root passwords, checks that the root username still matches
the template, and refuses to write placeholders. The missing value is
`change_me_on_first_run`, which is the stale value present in this failing
desktop install. Adding it to `STALE_FACTORY_ROOT_PASSWORDS` is the smallest
change that makes existing installs converge to the current `admin/admin`
default without overwriting arbitrary custom passwords.

Add or update tests in `desktop/main/window-state.test.js` or a focused
`envCheck` test to cover:

1. `ROOT_PASSWORD=change_me_on_first_run` migrates to the template
   `ROOT_PASSWORD=admin` when `ROOT_USERNAME=admin`.
2. `ROOT_PASSWORD=adminjr` still migrates.
3. A non-factory custom root password is preserved.
4. A changed root username is preserved.

## 评审结论

结论：根因证据充分，最终推荐只采用修复 A：把
`change_me_on_first_run` 加入 `desktop/main/envCheck.js` 的
`STALE_FACTORY_ROOT_PASSWORDS`，并保持现有的 `ROOT_USERNAME` 必须匹配模板、
模板 `ROOT_PASSWORD` 必须是非空且非占位符、且模板值本身不能仍是旧工厂密码的
保护条件。

理由如下：

1. 失败路径闭环成立：打包启动时 `main/index.js` 先执行
   `backfillUserEnv()`，再执行 `loadUserEnv()`，随后把 `state.userEnv` 注入
   后端；后端配置优先读取 `ROOT_PASSWORD`，数据库初始化从该配置同步 root
   用户，root 登录又直接与 `***REMOVED***` 比较。
2. 现有打包产物与源码模板都已经是 `admin/admin`，但已有
   `%APPDATA%/ecliptrix-desktop/.env` 不会被重新复制；当前失败机器保留
   `ROOT_PASSWORD=change_me_on_first_run`，而当前迁移集合只包含 `adminjr`。
3. 日志和 DB 校验排除了主要反例：请求确实到达后端登录接口，`admin` 用户存在且
   root/active，失败发生在密码校验阶段；本地 hash 对 `admin` 为 false、对
   `change_me_on_first_run` 为 true。
4. 该修改是最小变更：它复用已有迁移结构，只补齐漏掉的旧工厂默认值；相比版本化
   迁移元数据，当前问题不需要引入新的状态机或配置版本字段。
5. 回归风险可控：不得无条件重置 `ROOT_PASSWORD`，否则会覆盖用户自定义 root
   密码；实现和测试必须覆盖 `change_me_on_first_run`、`adminjr`、自定义密码保留、
   root 用户名已改动时保留这四类边界。
