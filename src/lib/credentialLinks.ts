import type { IntegrationId } from '@/lib/api/integrations';

/**
 * "Where do I get this key?" registry (setup-wizard-full-capability-coverage
 * spec §3.6). Static on purpose: links are presentation data, they must never
 * come from the backend or from user input, and they are only ever rendered
 * through `GetCredentialLink` (the packaged app opens them in the system
 * browser; a link without `target="_blank"` would navigate the app window).
 *
 * Reachability was spot-checked on 2026-11-01 (see link-audit.md §A). The
 * volcengine docs and the Anthropic console moved host, so the canonical
 * hosts are used here; a real person must still confirm that each console
 * page lands on the key page (most sit behind a login).
 */
export interface CredentialLink {
  /** The page where the key is created or viewed. */
  consoleUrl: string;
  /** Tutorial / official docs. */
  docsUrl?: string;
  /** An extra step without which a valid key still fails (ARK model opt-in). */
  activationUrl?: string;
}

export type LinkTarget = IntegrationId | 'tavily';

const VOLCANO_SPEECH_CONSOLE = 'https://console.volcengine.com/speech/app';
const VOLCANO_SPEECH_DOCS = 'https://docs.volcengine.com/docs/6561';

export const INTEGRATION_LINKS: Record<LinkTarget, CredentialLink> = {
  tavily: {
    consoleUrl: 'https://app.tavily.com/home',
    docsUrl: 'https://docs.tavily.com/',
  },
  pexels: {
    consoleUrl: 'https://www.pexels.com/api/',
    docsUrl: 'https://www.pexels.com/api/documentation/',
  },
  unsplash: {
    consoleUrl: 'https://unsplash.com/oauth/applications',
    docsUrl: 'https://unsplash.com/documentation',
  },
  freesound: {
    consoleUrl: 'https://freesound.org/apiv2/apply/',
    docsUrl: 'https://freesound.org/docs/api/authentication.html',
  },
  ark: {
    consoleUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
    docsUrl: 'https://docs.volcengine.com/docs/82379',
    activationUrl:
      'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement',
  },
  volcano_tts: { consoleUrl: VOLCANO_SPEECH_CONSOLE, docsUrl: VOLCANO_SPEECH_DOCS },
  volcano_asr: { consoleUrl: VOLCANO_SPEECH_CONSOLE, docsUrl: VOLCANO_SPEECH_DOCS },
  volcano_voice_clone: {
    consoleUrl: VOLCANO_SPEECH_CONSOLE,
    docsUrl: 'https://docs.volcengine.com/docs/6561/1167802',
  },
};

const ZHIPU: CredentialLink = { consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys' };
const OPENAI: CredentialLink = { consoleUrl: 'https://platform.openai.com/api-keys' };
const ANTHROPIC: CredentialLink = { consoleUrl: 'https://platform.claude.com/settings/keys' };

/** Keyed by the backend `ProviderInfo.id`; coding-plan ids share their vendor's page. */
export const PROVIDER_LINKS: Record<string, CredentialLink> = {
  deepseek: { consoleUrl: 'https://platform.deepseek.com/api_keys' },
  alibaba: { consoleUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key' },
  zhipu: ZHIPU,
  glm_coding: ZHIPU,
  openai: OPENAI,
  codex: OPENAI,
  anthropic: ANTHROPIC,
  claude_coding: ANTHROPIC,
  google: { consoleUrl: 'https://aistudio.google.com/apikey' },
  kimi_coding: { consoleUrl: 'https://www.kimi.com/code' },
};

/** Every host a credential link may point at (spec §3.6). */
export const ALLOWED_LINK_HOSTS: readonly string[] = [
  'app.tavily.com',
  'docs.tavily.com',
  'www.pexels.com',
  'unsplash.com',
  'freesound.org',
  'console.volcengine.com',
  'docs.volcengine.com',
  'platform.deepseek.com',
  'bailian.console.aliyun.com',
  'open.bigmodel.cn',
  'platform.openai.com',
  'platform.claude.com',
  'aistudio.google.com',
  'www.kimi.com',
];

/**
 * Normalised URL when `raw` is https on an allow-listed host, else `null`.
 * Rejects `javascript:` / `http:` / `file:` and look-alike hosts.
 */
export function safeExternalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return ALLOWED_LINK_HOSTS.includes(url.hostname) ? url.toString() : null;
}

/** Look an id up in the integration table first, then the provider table. */
export function findCredentialLink(id: string): CredentialLink | null {
  const own = Object.prototype.hasOwnProperty;
  if (own.call(INTEGRATION_LINKS, id)) return INTEGRATION_LINKS[id as LinkTarget];
  if (own.call(PROVIDER_LINKS, id)) return PROVIDER_LINKS[id];
  return null;
}
