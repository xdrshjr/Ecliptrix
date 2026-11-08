/**
 * Identifier normalisation — the single implementation of the rule that makes
 * unique indexes case-insensitive in SQLite (spec §5.4).
 *
 * `email_normalized` / `username_normalized` are written only through these two
 * functions; a lookup that skipped normalisation would silently miss the row.
 */

/** Trim, lower-case, and NFKC-fold so `Ａda@x.com` matches `ada@x.com`. */
export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLowerCase()
}

export function normalizeUsername(username: string): string {
  return username.trim().normalize('NFKC').toLowerCase()
}

/** Display form: preserve the caller's casing, strip surrounding whitespace. */
export function displayEmail(email: string): string {
  return email.trim().normalize('NFKC')
}

export function displayUsername(username: string): string {
  return username.trim().normalize('NFKC')
}
