import * as captchaService from '@/server/services/captchaService'
import type { CaptchaPurpose } from '@/server/db/types'

/**
 * Human-verification fixtures for the test suite.
 *
 * Registration is gated unconditionally (spec §3.2), so every test that creates
 * an account has to present a real challenge. The only sanctioned way to obtain
 * one is the same path a browser uses plus the e2e debug answer — `e2eMode` is
 * on under `NODE_ENV=test` and the issue address is loopback, so
 * `captchaService.issue` returns the plaintext in `debugAnswer`
 * (`captchaService.debugAnswerAllowed`).
 *
 * What must NOT be done: turning the gate off for tests. That would make AC-01
 * ("no captcha → 400 captcha_required") unassertable and hide exactly the class
 * of regression this feature exists to prevent (review R-V3-02 / RV-2).
 */

/** Loopback address — always inside the debug-answer gate. */
const LOOPBACK = '127.0.0.1'

export interface IssuedCaptchaSubmission {
  captchaId: string
  captchaAnswer: string
}

/**
 * Issue one challenge and return the pair a client would submit.
 *
 * @param purpose which gate the challenge is for; `register` by default.
 * @param ip      the address recorded on the challenge row. Audit-only, so it
 *                does not have to match the caller's later `context.ip`.
 * @throws when `debugAnswer` is absent — a sign that the suite is not running
 *         under `NODE_ENV=test`, which would otherwise produce a confusing
 *         400 from the business call rather than a pointed failure here.
 */
export function issueCaptcha(
  purpose: CaptchaPurpose = 'register',
  ip: string = LOOPBACK,
): IssuedCaptchaSubmission {
  const issued = captchaService.issue(purpose, {
    ip,
    userAgent: 'vitest',
    requestId: 'req-captcha-fixture',
  })
  if (!issued.debugAnswer) {
    throw new Error(
      'captcha fixture: debugAnswer unavailable — tests must run with NODE_ENV=test ' +
        'and a loopback issue address',
    )
  }
  return { captchaId: issued.id, captchaAnswer: issued.debugAnswer }
}

/**
 * A deliberately wrong answer for the given challenge.
 *
 * Flips every character to one that is never itself, so the failure is a genuine
 * hash mismatch rather than an accidentally-correct guess.
 */
export function wrongAnswerFor(submission: IssuedCaptchaSubmission): string {
  const swapped = submission.captchaAnswer
    .split('')
    .map((character) => (character === 'A' ? 'B' : 'A'))
    .join('')
  return swapped
}
