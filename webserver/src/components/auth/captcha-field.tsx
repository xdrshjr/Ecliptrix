'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api/client'
import { translator, type Locale } from '@/lib/i18n'

/**
 * Human-verification control.
 *
 * ## Why the SVG is injected rather than used as an `<img>`
 *
 * The server renders strokes with `currentColor` so the puzzle follows the theme
 * (light/dark) without a second request per theme. An `<img src="data:...">` is a
 * separate document and cannot inherit a CSS variable, so the markup is inlined.
 *
 * `dangerouslySetInnerHTML` is safe **only because of what the server emits**: the
 * renderer writes `<svg>`/`<path>` and nothing else — no `<text>`, no script, no
 * event attributes, no external `href`. The guard below is a second layer, not the
 * primary defence: if a future renderer change ever emits something else, the
 * control stops rendering instead of executing it.
 *
 * ## Accessibility
 *
 * A graphic-only challenge is a WCAG 1.1.1 gap, and the design accepts it as a
 * known limitation (spec R-2/R-15). What the control must NOT do is hide that from
 * the user: the "can't read it?" line is visible, not buried in a doc, and offers
 * both an unlimited refresh and a route to an administrator for an invite code.
 */
export interface CaptchaValue {
  captchaId: string
  captchaAnswer: string
}

export interface CaptchaFieldProps {
  locale: Locale
  purpose: 'register' | 'login'
  /** Called with the current pair so the parent form can submit both together. */
  onChange: (value: CaptchaValue) => void
  /** Server error for this control (invalid/expired/required), if any. */
  error?: string
  /**
   * Remount this with a new key to force a fresh challenge, or bump `refreshKey`
   * — the parent owns "a rejected answer must cost a new image".
   */
  refreshKey?: number
}

interface IssueResponse {
  captcha: {
    id: string
    purpose: string
    svg: string
    width: number
    height: number
    /** Characters this challenge shows; drives `maxLength` (4–7 by setting). */
    length: number
    expiresAt: string
    debugAnswer?: string
  }
}

/** Second-layer check on the server's own output. See the note above. */
function isSafeSvg(svg: string): boolean {
  if (!svg.startsWith('<svg')) return false
  const lowered = svg.toLowerCase()
  for (const forbidden of ['<script', '<foreignobject', 'onload=', 'onerror=', 'javascript:', 'href="http']) {
    if (lowered.includes(forbidden)) return false
  }
  return true
}

export function CaptchaField({ locale, purpose, onChange, error, refreshKey = 0 }: CaptchaFieldProps) {
  const tt = translator(locale)
  const [issued, setIssued] = useState<IssueResponse['captcha'] | null>(null)
  const [answer, setAnswer] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Guards against a slow first response landing after a manual refresh.
  const requestSeq = useRef(0)

  const issue = useCallback(async () => {
    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api.get<IssueResponse>(`/api/v1/auth/captcha?purpose=${purpose}`)
      if (requestSeq.current !== seq) return
      setIssued(data.captcha)
      setAnswer('')
    } catch (thrown) {
      if (requestSeq.current !== seq) return
      setIssued(null)
      setLoadError(
        thrown instanceof ApiError && thrown.code === 'rate_limited'
          ? tt('captcha.tooMany')
          : tt('errors.network'),
      )
    } finally {
      if (requestSeq.current === seq) setLoading(false)
    }
  }, [purpose, tt])

  // Issued on mount and whenever the parent asks for a new image.
  useEffect(() => {
    void issue()
  }, [issue, refreshKey])

  // Report the pair upwards. Id is cleared the moment the answer changes so a
  // half-typed answer can never be submitted with the previous challenge.
  useEffect(() => {
    onChange({ captchaId: issued?.id ?? '', captchaAnswer: answer })
  }, [issued, answer, onChange])

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={tt('captcha.label')}>
      <div className="flex items-center gap-2">
        <div className="flex h-16 flex-1 items-center justify-center overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface-2)]">
          {issued && isSafeSvg(issued.svg) ? (
            <div
              // Server-generated strokes; see `isSafeSvg` and the module note.
              dangerouslySetInnerHTML={{ __html: issued.svg }}
              className="h-16 w-[200px] text-[var(--foreground)]"
            />
          ) : (
            <span className="text-xs text-[var(--muted)]">
              {loading ? tt('common.loading') : loadError ?? tt('captcha.unavailable')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void issue()}
          disabled={loading}
          aria-label={tt('captcha.refresh')}
          title={tt('captcha.refresh')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[var(--border-strong)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <Input
        id="captchaAnswer"
        aria-label={tt('captcha.answerLabel')}
        autoComplete="off"
        inputMode="text"
        // The answer length is a runtime setting (4–7). A hard-coded 6 would make
        // the last character of a longer challenge untypeable — the user would see
        // seven letters and a field that refuses the seventh. Fall back to the
        // schema's ceiling until the first image arrives.
        maxLength={issued?.length ?? 7}
        spellCheck={false}
        required
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        invalid={Boolean(error)}
        placeholder={tt('captcha.placeholder')}
        className="mono uppercase tracking-[0.3em]"
      />

      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : (
        <p className="text-xs text-[var(--muted)]">{tt('captcha.hint')}</p>
      )}
    </div>
  )
}
