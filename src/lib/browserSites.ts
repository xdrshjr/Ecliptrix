/**
 * Static quick-start sites for the Dock's blank tab (spec §4.6.3).
 *
 * Same discipline as `credentialLinks.ts`: a closed, hand-written registry of
 * https entry points. Nothing is built at runtime from user input, and
 * `isAllowedBrowserSite` re-checks scheme + host so a bad edit fails a test, not
 * a user's session. Entries are login/home pages, never deep links.
 */

export type BrowserSiteCategory = 'news' | 'social' | 'video' | 'reference' | 'image';

export interface BrowserSite {
  id: string;
  name: string;
  url: string;
  category: BrowserSiteCategory;
}

export const BROWSER_SITES: readonly BrowserSite[] = [
  { id: 'weibo', name: '微博', url: 'https://weibo.com/login.php', category: 'social' },
  { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/signin', category: 'social' },
  { id: 'bilibili', name: 'Bilibili', url: 'https://passport.bilibili.com/login', category: 'video' },
  { id: 'douyin', name: '抖音', url: 'https://www.douyin.com/', category: 'video' },
  { id: 'xiaohongshu', name: '小红书', url: 'https://www.xiaohongshu.com/', category: 'social' },
  { id: 'x', name: 'X', url: 'https://x.com/i/flow/login', category: 'social' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', category: 'video' },
  { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/login', category: 'social' },
  { id: 'bbc', name: 'BBC News', url: 'https://www.bbc.com/news', category: 'news' },
  { id: 'reuters', name: 'Reuters', url: 'https://www.reuters.com/', category: 'news' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org/', category: 'reference' },
  { id: 'pexels', name: 'Pexels', url: 'https://www.pexels.com/', category: 'image' },
  { id: 'unsplash', name: 'Unsplash', url: 'https://unsplash.com/', category: 'image' },
];

const HOST_ALLOWLIST: readonly string[] = [
  'weibo.com', 'zhihu.com', 'bilibili.com', 'douyin.com', 'xiaohongshu.com', 'x.com',
  'youtube.com', 'reddit.com', 'bbc.com', 'reuters.com', 'wikipedia.org', 'pexels.com',
  'unsplash.com',
];

/** https only, and the host must be (a subdomain of) an allow-listed domain. */
export function isAllowedBrowserSite(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    return HOST_ALLOWLIST.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
