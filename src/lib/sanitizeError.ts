const SENSITIVE_PATTERNS: RegExp[] = [
  /sqlalche\.me/i,
  /greenlet_spawn/i,
  /SQLAlchemy/i,
  /asyncpg/i,
  /psycopg2?/i,
  /at 0x[0-9a-fA-F]+/,
  /Traceback \(most recent call last\)/,
];

export function sanitizeErrorMessage(raw: unknown, fallback: string): string {
  const msg =
    typeof raw === 'string'
      ? raw
      : raw instanceof Error
        ? raw.message
        : '';
  if (!msg) return fallback;
  if (SENSITIVE_PATTERNS.some((p) => p.test(msg))) return fallback;
  if (msg.length > 240) return fallback;
  return msg;
}
