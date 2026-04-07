/**
 * Test user fixture for integration tests.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/07-testing-suite.md section 2.4
 *
 * Each call to `createTestUser` registers a fresh user against the running
 * backend, captures the session token from the subsequent login, and returns
 * a handle that the test can use for authenticated calls. After the suite
 * runs, callers should `cleanup()` to clear any local state — the backend
 * row remains because the test backend is in-memory and resets on next boot.
 */

export interface TestUserHandle {
  username: string
  password: string
  email: string
  userId: string | null
  sessionToken: string | null
  authHeaders: Record<string, string>
  cleanup: () => Promise<void>
}

let userCounter = 0
function uniqueUsername(): string {
  userCounter += 1
  // Avoid hyphens in case the backend has username validation regex.
  const stamp = Date.now().toString(36)
  return `intuser${stamp}${userCounter}`
}

interface RegisterResponse {
  success?: boolean
  user?: { id?: string }
  message?: string
  error_code?: string
}

interface LoginResponse {
  success?: boolean
  session_token?: string
  user?: { id?: string }
  message?: string
}

/**
 * Register + log in a fresh user. The backend's `/api/auth/register` and
 * `/api/auth/login` endpoints are in the auth allowlist (T01) so no prior
 * token is needed.
 *
 * @param backendUrl  Base URL of the backend (NOT the Next.js frontend).
 *                    Integration tests pass `stack.backendUrl` here.
 * @param overrides   Optional username/password overrides for tests that
 *                    need to control credentials (e.g. duplicate-login I11).
 */
export async function createTestUser(
  backendUrl: string,
  overrides: Partial<{ username: string; password: string }> = {},
): Promise<TestUserHandle> {
  const username = overrides.username ?? uniqueUsername()
  const password = overrides.password ?? 'TestPassword!23'
  const email = `${username}@integration.test`

  // 1. Register
  const registerRes = await fetch(`${backendUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      email,
      full_name: `Integration User ${username}`,
    }),
  })

  let registerJson: RegisterResponse = {}
  try {
    registerJson = (await registerRes.json()) as RegisterResponse
  } catch {
    // ignore parse failures — we'll surface via status check
  }

  if (!registerRes.ok || registerJson.success === false) {
    throw new Error(
      `Test user registration failed: status=${registerRes.status} ` +
        `body=${JSON.stringify(registerJson)}`,
    )
  }

  // 2. Log in
  const loginRes = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  let loginJson: LoginResponse = {}
  try {
    loginJson = (await loginRes.json()) as LoginResponse
  } catch {
    // ignore
  }

  if (!loginRes.ok || loginJson.success === false || !loginJson.session_token) {
    throw new Error(
      `Test user login failed: status=${loginRes.status} ` +
        `body=${JSON.stringify(loginJson)}`,
    )
  }

  const sessionToken = loginJson.session_token
  const userId = loginJson.user?.id ?? null

  return {
    username,
    password,
    email,
    userId,
    sessionToken,
    authHeaders: {
      Authorization: `Bearer ${sessionToken}`,
    },
    cleanup: async () => {
      // Best-effort logout — ignore failures since the test backend is
      // in-memory and gets thrown away on next boot anyway.
      try {
        await fetch(`${backendUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionToken}` },
        })
      } catch {
        // ignore
      }
    },
  }
}
