import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError, RateLimitError } from '@/lib/api/http-client';
import { SETUP_CONFIG_UPDATED_EVENT } from '@/lib/setupEvents';
import { translations } from '@/lib/i18n';
import {
  ROUTED_CAPABILITIES,
  ROUTER_ERROR_ACTIONS,
  clearSkillRouterKey,
  describeRouterError,
  describeRouterFailure,
  getSkillRouter,
  getSkillRouterCatalog,
  isCapabilityRouted,
  routerErrorCodeOf,
  updateSkillRouter,
  verifySkillRouter,
  type SkillRouterStatus,
} from '../skillrouter';

const LOCALES = ['en', 'zh-CN'] as const;

function status(overrides: Partial<SkillRouterStatus> = {}): SkillRouterStatus {
  return {
    mode: 'router',
    modeState: 'router',
    baseUrl: 'https://www.skillrouter.net',
    keyConfigured: true,
    keyHint: 'ar-…****abcd',
    enabled: true,
    manualCapabilities: [],
    slotModels: {},
    defaults: {},
    lastVerified: null,
    revision: 'r1',
    ...overrides,
  };
}

const wireStatus = {
  mode: 'router',
  modeState: 'router',
  baseUrl: 'https://www.skillrouter.net',
  keyConfigured: true,
  keyHint: 'ar-…****abcd',
  enabled: true,
  manualCapabilities: ['tts', 'not_a_capability'],
  slotModels: { chat: 'ecliptrix-chat', bogus: 'x' },
  defaults: { chat: 'ecliptrix-chat' },
  lastVerified: { ok: true, at: 1700000000000, outcome: 'ok', stale: false },
  revision: 'abc',
};

afterEach(() => vi.restoreAllMocks());

describe.each(LOCALES)('describeRouterError (%s)', (locale) => {
  const t = translations[locale];

  it.each(Object.keys(ROUTER_ERROR_ACTIONS))('describes %s with wording and the next step', (code) => {
    const description = describeRouterError(
      code,
      { resets_at: Date.UTC(2026, 0, 1, 3, 4), retry_after_seconds: 7 },
      t,
    );
    expect(description.title.length).toBeGreaterThan(0);
    expect(description.hint.length).toBeGreaterThan(0);
    expect(description.hint).not.toMatch(/\{\w+\}/);
    expect(description.action).toBe(ROUTER_ERROR_ACTIONS[code]);
  });

  it('turns a quota reset into a local HH:mm and keeps the raw instant', () => {
    const resetsAt = new Date(2026, 5, 1, 8, 5).getTime();
    const description = describeRouterError('router_quota_exceeded', { resets_at: resetsAt }, t);
    expect(description.hint).toContain('08:05');
    expect(description.resetsAt).toBe(resetsAt);
    expect(description.action).toBe('wait');
  });

  it('falls back to wording without a number when the reset time is missing', () => {
    const description = describeRouterError('router_quota_exceeded', undefined, t);
    expect(description.hint).toBe(t.routerErrors.router_quota_exceeded.hintFallback);
    expect(description.resetsAt).toBeUndefined();
  });

  it('shows the retry-after seconds for a busy relay', () => {
    expect(describeRouterError('router_busy', { retry_after_seconds: 2.2 }, t).hint).toContain('3');
    expect(describeRouterError('router_busy', {}, t).hint).toBe(t.routerErrors.router_busy.hintFallback);
  });

  it('appends the server reason for invalid requests only', () => {
    const invalid = describeRouterError('router_invalid_request', undefined, t, 'size 99x99');
    expect(invalid.hint).toContain('size 99x99');
    expect(describeRouterError('content_rejected', undefined, t, 'size 99x99').hint).not.toContain('size');
  });

  it('degrades an unknown code to a generic retry description', () => {
    const description = describeRouterError('brand_new_code', undefined, t);
    expect(description.title).toBe(t.routerErrors.unknown.title);
    expect(description.action).toBe('retry');
  });

  it('has wording for every code in both locales', () => {
    for (const code of Object.keys(ROUTER_ERROR_ACTIONS)) {
      expect(t.routerErrors[code], code).toBeDefined();
    }
  });
});

describe('routerErrorCodeOf', () => {
  it('recognises gateway codes on an ApiError', () => {
    expect(routerErrorCodeOf(new ApiError(409, 'router_key_invalid', 'x'))).toBe('router_key_invalid');
    expect(routerErrorCodeOf(new ApiError(500, 'HTTP_500', 'x'))).toBeNull();
    expect(routerErrorCodeOf(new Error('boom'))).toBeNull();
  });

  it('tells the two 429 flavours apart, since http-client erases their code', () => {
    expect(routerErrorCodeOf(new RateLimitError(5, 'x', { resets_at: 1790000000000 }))).toBe(
      'router_quota_exceeded',
    );
    expect(routerErrorCodeOf(new RateLimitError(5, 'x', { errorCode: 'router_busy' }))).toBe(
      'router_busy',
    );
  });

  it('does not label an unmarked 429 (media-proxy per-IP limiter) as a gateway failure', () => {
    expect(routerErrorCodeOf(new RateLimitError(5, 'x', { retry_after_seconds: 3 }))).toBeNull();
    expect(routerErrorCodeOf(new RateLimitError(5, 'x'))).toBeNull();
  });

  it('describes a non-gateway failure as the generic one', () => {
    const description = describeRouterFailure(new Error('network'), translations.en);
    expect(description.title).toBe(translations.en.routerErrors.unknown.title);
  });
});

describe('isCapabilityRouted', () => {
  it('is true only for routed capabilities that are not overridden', () => {
    const s = status({ manualCapabilities: ['tts'] });
    expect(isCapabilityRouted(s, 'chat')).toBe(true);
    expect(isCapabilityRouted(s, 'tts')).toBe(false);
    expect(isCapabilityRouted(s, 'web_search')).toBe(false);
    expect(isCapabilityRouted(s, 'asr')).toBe(false);
    expect(isCapabilityRouted(s, 'voice_clone')).toBe(false);
  });

  it('is false in manual mode, when the valve is off, or without a status', () => {
    expect(isCapabilityRouted(status({ mode: 'manual', modeState: 'manual' }), 'chat')).toBe(false);
    expect(isCapabilityRouted(status({ enabled: false }), 'chat')).toBe(false);
    expect(isCapabilityRouted(null, 'chat')).toBe(false);
  });

  it('covers exactly the eleven routed capabilities', () => {
    expect(ROUTED_CAPABILITIES).toHaveLength(11);
  });
});

describe('client', () => {
  let events = 0;
  const onEvent = () => {
    events += 1;
  };
  beforeEach(() => {
    events = 0;
    window.addEventListener(SETUP_CONFIG_UPDATED_EVENT, onEvent);
  });
  afterEach(() => window.removeEventListener(SETUP_CONFIG_UPDATED_EVENT, onEvent));

  it('normalises the status and drops unknown capabilities and slots', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, data: wireStatus } as never);
    const result = await getSkillRouter();
    expect(result.manualCapabilities).toEqual(['tts']);
    expect(result.slotModels).toEqual({ chat: 'ecliptrix-chat' });
    expect(result.lastVerified).toEqual({ ok: true, at: 1700000000000, outcome: 'ok', stale: false });
  });

  it('carries the stale flag of an old verification', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      data: { ...wireStatus, lastVerified: { ok: true, at: 5, outcome: 'ok', stale: true } },
    } as never);
    expect((await getSkillRouter()).lastVerified?.stale).toBe(true);
  });

  it('rejects an envelope that is not a success', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: false } as never);
    await expect(getSkillRouter()).rejects.toThrow('skillrouter_unavailable');
  });

  it('sends the patch as given and announces the change', async () => {
    const put = vi
      .spyOn(httpModule.http, 'put')
      .mockResolvedValue({ success: true, data: wireStatus } as never);
    await updateSkillRouter({ mode: 'router', apiKey: 'ar-secret-key-1234' });
    expect(put.mock.calls[0][0]).toBe('/api/skillrouter');
    expect(put.mock.calls[0][1]).toEqual({ mode: 'router', apiKey: 'ar-secret-key-1234' });
    expect(events).toBe(1);
  });

  it('does not announce a failed write', async () => {
    vi.spyOn(httpModule.http, 'put').mockRejectedValue(
      new ApiError(422, 'router_key_required', 'x'),
    );
    await expect(updateSkillRouter({ mode: 'router' })).rejects.toBeInstanceOf(ApiError);
    expect(events).toBe(0);
  });

  it('never leaves the key in browser storage or in the returned status', async () => {
    const secret = 'ar-very-secret-key-9999';
    vi.spyOn(httpModule.http, 'put').mockResolvedValue({ success: true, data: wireStatus } as never);
    const saved = await updateSkillRouter({ apiKey: secret });
    expect(JSON.stringify(saved)).not.toContain(secret);
    const stored = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(stored).not.toContain(secret);
  });

  it('clears the key with a JSON content type (the backend rejects DELETE without one)', async () => {
    const del = vi
      .spyOn(httpModule.http, 'del')
      .mockResolvedValue({ success: true, data: wireStatus } as never);
    await clearSkillRouterKey();
    const options = del.mock.calls[0][1] as { headers: Record<string, string> };
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(events).toBe(1);
  });

  it('never reports an unknown verification outcome as connected', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      data: {
        outcome: 'great',
        latencyMs: 4,
        capabilities: [{ id: 'tts', available: true }],
        coverage: {},
      },
    } as never);
    const result = await verifySkillRouter({ apiKey: 'ar-aaaaaaaaaa' });
    expect(result.outcome).toBe('unverifiable');
    expect(result.capabilities[0].id).toBe('tts');
  });

  it('asks for a forced refresh and converts the catalogue timestamp to milliseconds', async () => {
    const get = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      data: {
        models: [{ id: 'm1', label: 'M1', protocol: 'anthropic', isRoute: false }, { nope: 1 }],
        capabilities: [
          { id: 'tts', available: false, unavailableReason: 'off', quota: { dailyLimit: 10 } },
        ],
        defaults: { chat: 'm1' },
        stale: true,
        fetchedAt: 1700000000.5,
        error: null,
      },
    } as never);
    const catalog = await getSkillRouterCatalog(true);
    expect(get.mock.calls[0][0]).toBe('/api/skillrouter/catalog?refresh=1');
    expect(catalog.models).toHaveLength(1);
    expect(catalog.fetchedAt).toBe(1700000000500);
    expect(catalog.capabilities[0].quota?.dailyLimit).toBe(10);
  });

  it('prefers the millisecond catalogue timestamp when the backend sends it', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      data: { models: [], capabilities: [], defaults: {}, stale: false, fetchedAt: 5, fetchedAtMs: 1700000000500 },
    } as never);
    expect((await getSkillRouterCatalog()).fetchedAt).toBe(1700000000500);
  });
});

describe('shared status read', () => {
  it('lets simultaneous callers share one request', async () => {
    const get = vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, data: wireStatus } as never);
    await Promise.all([getSkillRouter(), getSkillRouter(), getSkillRouter()]);
    expect(get).toHaveBeenCalledTimes(1);
    await getSkillRouter();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not hand a read that began before a write to callers after it', async () => {
    const get = vi.spyOn(httpModule.http, 'get').mockResolvedValue({ success: true, data: wireStatus } as never);
    vi.spyOn(httpModule.http, 'put').mockResolvedValue({ success: true, data: wireStatus } as never);
    const before = getSkillRouter();
    await updateSkillRouter({ mode: 'manual' });
    await getSkillRouter();
    await before;
    expect(get).toHaveBeenCalledTimes(2);
  });
});
