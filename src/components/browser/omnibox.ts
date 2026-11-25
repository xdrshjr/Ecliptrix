/**
 * Address-bar input → navigation or search (spec §4.6.3). Pure.
 *
 * Anything that is not a plain http(s) address — `javascript:`, `file:`,
 * `data:`, `chrome:` … — is treated as a SEARCH TERM, never navigated (B2: a
 * pasted `javascript:` string must not run in a tab that holds the user's
 * sign-ins). The main process re-checks every URL; this only keeps the UX honest.
 */

export type SearchEngine = 'bing' | 'google' | 'baidu' | 'duckduckgo';

export const SEARCH_URLS: Record<SearchEngine, string> = {
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  duckduckgo: 'https://duckduckgo.com/?q=',
};

export type OmniboxResult =
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string; query: string };

const MAX_INPUT = 2048;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HOST_PORT = /^[^\s/:]+:\d+([/?#]\S*)?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/;
const HOST_LIKE = /^[^\s/?#]+\.[^\s/?#]{2,}([/?#]\S*)?$/;
const LOCALHOST = /^localhost(:\d+)?([/?#]\S*)?$/i;
const PLAIN_HTTP_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3})$/i;

function search(query: string, engine: SearchEngine): OmniboxResult {
  return { kind: 'search', query, url: SEARCH_URLS[engine] + encodeURIComponent(query) };
}

function addressOrSearch(
  candidate: string,
  original: string,
  engine: SearchEngine,
): OmniboxResult {
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return search(original, engine);
    // Local development servers rarely speak TLS: bare localhost / IP → http.
    if (candidate === `https://${original}` && PLAIN_HTTP_HOST.test(parsed.hostname)) {
      return { kind: 'url', url: `http://${original}` };
    }
    return { kind: 'url', url: parsed.toString() };
  } catch {
    return search(original, engine);
  }
}

export function resolveOmnibox(
  input: string,
  engine: SearchEngine = 'bing',
): OmniboxResult | null {
  const text = input.trim().slice(0, MAX_INPUT);
  if (!text) return null;
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  // `host:port` also matches SCHEME; a port means an address, not a scheme.
  const isHostPort = HOST_PORT.test(text);
  if (scheme && !isHostPort) {
    return scheme === 'http' || scheme === 'https'
      ? addressOrSearch(text, text, engine)
      : search(text, engine);
  }
  if (/\s/.test(text)) return search(text, engine);
  if (LOCALHOST.test(text) || IPV4.test(text) || HOST_LIKE.test(text) || isHostPort) {
    return addressOrSearch(`https://${text}`, text, engine);
  }
  return search(text, engine);
}

/** Host + path for tab strips and the address bar; never the query (R-16). */
export function displayUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return '';
  }
}
