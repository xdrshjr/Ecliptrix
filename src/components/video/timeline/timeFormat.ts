// Formats a duration in seconds.
//  - Omits the hours segment when the duration is under 1h (0:05, 1:30).
//  - Left-pads minutes to 2 digits only when hours are present (1:01:05).
//  - Optional 2-digit hundredths suffix for the ruler.
// Treats non-finite or negative input as 0 for resilience under store-reset
// states where totalDuration can briefly be NaN/negative.
export function formatTimelineTime(
  seconds: number,
  opts: { showMs?: boolean } = {}
): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 100);

  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  const base = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  return opts.showMs
    ? `${base}.${String(ms).padStart(2, '0')}`
    : base;
}
