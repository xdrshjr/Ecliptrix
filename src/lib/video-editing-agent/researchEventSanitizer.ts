const SENSITIVE = /token|secret|password|signature|credential|authorization|api.?key|^key$|^sig$|^auth$|^x-amz-|^x-goog-/i;

export function isResearchTool(name: string): boolean {
  return /^(web_|browser_|extract_web_images$|fetch_web_image$|download_web_media$|read_research_artifact$)/.test(name);
}

function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return raw;
    url.username = '';
    url.password = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch { return raw; }
}

/** Apply before content, SSE, operations or persistent project serialization. */
export function sanitizeResearchValue<T>(value: T): T {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    return value.replace(/https?:\/\/[^\s"<>]+/g, safeUrl) as T;
  }
  if (Array.isArray(value)) return value.map(sanitizeResearchValue) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
      !SENSITIVE.test(key) && !['html', 'base64', 'local_path'].includes(key))
      .map(([key, nested]) => [key, sanitizeResearchValue(nested)])) as T;
  }
  return value;
}
