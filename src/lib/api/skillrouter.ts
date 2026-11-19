import { ApiError, RateLimitError, http } from '@/lib/api/http-client';
import type { CapabilityId } from '@/lib/api/setupStatus';
import type { Translations } from '@/lib/i18n';
import { notifySetupConfigUpdated } from '@/lib/setupEvents';

/**
 * Typed client for `/api/skillrouter` (skillrouter-capability-gateway spec
 * §5). Nothing here ever sees, stores or echoes the gateway key beyond the
 * one request that submits it: responses only report `keyConfigured` and a
 * masked `keyHint`, and the key is never written to any browser storage.
 */

export type ModeState = 'unset' | 'manual' | 'router';
export type RouterMode = 'manual' | 'router';
export type RouterProtocol = 'openai' | 'anthropic';

export type RouterLlmSlot = 'chat' | 'fast' | 'video_cut' | 'vision' | 'research';
export type RoutedCapabilityId =
  | RouterLlmSlot
  | 'tts'
  | 'ai_image'
  | 'ai_video'
  | 'video_library'
  | 'image_library'
  | 'audio_library';
export type ManualOnlyCapabilityId = 'web_search' | 'asr' | 'voice_clone';

export const ROUTER_LLM_SLOTS: readonly RouterLlmSlot[] = [
  'chat',
  'fast',
  'video_cut',
  'vision',
  'research',
];

/** Capabilities the gateway can serve (spec §2.1), in display order. */
export const ROUTED_CAPABILITIES: readonly RoutedCapabilityId[] = [
  ...ROUTER_LLM_SLOTS,
  'tts',
  'ai_image',
  'ai_video',
  'video_library',
  'image_library',
  'audio_library',
];

/** Capabilities that always stay on the user's own configuration. */
export const MANUAL_ONLY_CAPABILITIES: readonly ManualOnlyCapabilityId[] = [
  'web_search',
  'asr',
  'voice_clone',
];

/** Ecliptrix capability -> the gateway's own capability id (quota lives there). */
export const GATEWAY_CAPABILITY_OF: Partial<Record<RoutedCapabilityId, string>> = {
  tts: 'tts',
  ai_image: 'ai_image',
  ai_video: 'ai_video',
  video_library: 'video_search',
  image_library: 'image_search',
  audio_library: 'audio_search',
};

export interface RouterQuota {
  unit: string;
  dailyLimit: number | null;
  used: number | null;
  remaining: number | null;
  /** Epoch milliseconds. */
  resetsAt: number | null;
}

export interface RouterCapabilityStatus {
  id: string;
  available: boolean;
  unavailableReason: string | null;
  quota: RouterQuota | null;
}

export interface SkillRouterLastVerified {
  ok: boolean;
  at: number;
  outcome: string;
}

export interface SkillRouterStatus {
  mode: RouterMode;
  modeState: ModeState;
  baseUrl: string;
  keyConfigured: boolean;
  /** `ar-…****abcd`; the only trace of the key the backend ever returns. */
  keyHint: string | null;
  enabled: boolean;
  manualCapabilities: RoutedCapabilityId[];
  slotModels: Partial<Record<RouterLlmSlot, string>>;
  defaults: Partial<Record<RouterLlmSlot, string>>;
  lastVerified: SkillRouterLastVerified | null;
  revision: string;
}

export type VerifyOutcome =
  | 'ok'
  | 'invalid_credentials'
  | 'unreachable'
  | 'upstream_error'
  | 'unverifiable';

export interface SkillRouterVerifyResult {
  outcome: VerifyOutcome;
  latencyMs: number;
  capabilities: RouterCapabilityStatus[];
  coverage: { routed: string[]; manualOnly: string[] };
}

export interface RouterModel {
  id: string;
  label: string;
  protocol: RouterProtocol | 'route';
  /** Operator-defined virtual model: callable over both protocols. */
  isRoute: boolean;
}

export interface SkillRouterCatalog {
  models: RouterModel[];
  capabilities: RouterCapabilityStatus[];
  defaults: Partial<Record<RouterLlmSlot, string>>;
  stale: boolean;
  fetchedAt: number | null;
  error: string | null;
}

export interface SkillRouterSlotTestResult {
  ok: boolean;
  message: string;
  latencyMs: number | null;
  model: string | null;
}

/** Partial update (`omitted` = unchanged). The key travels only in `apiKey`. */
export interface SkillRouterPatch {
  mode?: RouterMode;
  apiKey?: string;
  baseUrl?: string;
  manualCapabilities?: RoutedCapabilityId[];
  slotModels?: Partial<Record<RouterLlmSlot, string>>;
  slotProtocols?: Partial<Record<RouterLlmSlot, RouterProtocol>>;
}

export interface SkillRouterVerifyInput {
  apiKey?: string;
  baseUrl?: string;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
}

export const DEFAULT_ROUTER_BASE_URL = 'https://www.skillrouter.net';

const BASE = '/api/skillrouter';
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const REQUEST_TIMEOUT_MS = 8000;
const VERIFY_TIMEOUT_MS = 20000;

const ROUTED_SET: ReadonlySet<string> = new Set(ROUTED_CAPABILITIES);
const SLOT_SET: ReadonlySet<string> = new Set(ROUTER_LLM_SLOTS);

function requireData<T>(body: Envelope<T> | null): T {
  if (!body || body.success !== true || body.data == null) {
    throw new Error('skillrouter_unavailable');
  }
  return body.data;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The catalogue timestamp is epoch SECONDS (everything else is milliseconds). */
function secondsToMs(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000);
}

function normalizeQuota(raw: unknown): RouterQuota | null {
  if (!raw || typeof raw !== 'object') return null;
  const quota = raw as Record<string, unknown>;
  return {
    unit: typeof quota.unit === 'string' ? quota.unit : '',
    dailyLimit: asNumberOrNull(quota.dailyLimit),
    used: asNumberOrNull(quota.used),
    remaining: asNumberOrNull(quota.remaining),
    resetsAt: asNumberOrNull(quota.resetsAt),
  };
}

/** A capability the client does not know yet is kept as-is (never throws). */
function normalizeCapability(raw: unknown): RouterCapabilityStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== 'string') return null;
  return {
    id: entry.id,
    available: entry.available !== false,
    unavailableReason: asStringOrNull(entry.unavailableReason),
    quota: normalizeQuota(entry.quota),
  };
}

function normalizeCapabilities(raw: unknown): RouterCapabilityStatus[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeCapability)
    .filter((entry): entry is RouterCapabilityStatus => entry !== null);
}

function normalizeSlotMap(raw: unknown): Partial<Record<RouterLlmSlot, string>> {
  const result: Partial<Record<RouterLlmSlot, string>> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [slot, model] of Object.entries(raw as Record<string, unknown>)) {
    if (SLOT_SET.has(slot) && typeof model === 'string' && model) {
      result[slot as RouterLlmSlot] = model;
    }
  }
  return result;
}

function normalizeStatus(raw: Record<string, unknown>): SkillRouterStatus {
  const modeState: ModeState =
    raw.modeState === 'router' || raw.modeState === 'manual' ? raw.modeState : 'unset';
  const verified = raw.lastVerified as Partial<SkillRouterLastVerified> | null | undefined;
  return {
    mode: raw.mode === 'router' ? 'router' : 'manual',
    modeState,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    keyConfigured: raw.keyConfigured === true,
    keyHint: asStringOrNull(raw.keyHint),
    enabled: raw.enabled !== false,
    manualCapabilities: Array.isArray(raw.manualCapabilities)
      ? raw.manualCapabilities.filter(
          (id): id is RoutedCapabilityId => typeof id === 'string' && ROUTED_SET.has(id),
        )
      : [],
    slotModels: normalizeSlotMap(raw.slotModels),
    defaults: normalizeSlotMap(raw.defaults),
    lastVerified:
      verified && typeof verified.at === 'number'
        ? { ok: verified.ok === true, at: verified.at, outcome: String(verified.outcome ?? '') }
        : null,
    revision: typeof raw.revision === 'string' ? raw.revision : '',
  };
}

function normalizeModel(raw: unknown): RouterModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const model = raw as Record<string, unknown>;
  if (typeof model.id !== 'string' || !model.id) return null;
  const protocol = model.protocol === 'anthropic' || model.protocol === 'route' ? model.protocol : 'openai';
  return {
    id: model.id,
    label: typeof model.label === 'string' && model.label ? model.label : model.id,
    protocol,
    isRoute: model.isRoute === true || protocol === 'route',
  };
}

const VERIFY_OUTCOMES: readonly VerifyOutcome[] = [
  'ok',
  'invalid_credentials',
  'unreachable',
  'upstream_error',
  'unverifiable',
];

function normalizeVerify(raw: Record<string, unknown>): SkillRouterVerifyResult {
  const coverage = (raw.coverage ?? {}) as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    // Fail-closed: an outcome we do not know is never shown as "connected".
    outcome: VERIFY_OUTCOMES.includes(raw.outcome as VerifyOutcome)
      ? (raw.outcome as VerifyOutcome)
      : 'unverifiable',
    latencyMs: asNumberOrNull(raw.latencyMs) ?? 0,
    capabilities: normalizeCapabilities(raw.capabilities),
    coverage: { routed: strings(coverage.routed), manualOnly: strings(coverage.manualOnly) },
  };
}

let sharedRead: Promise<SkillRouterStatus> | null = null;

function dropSharedRead(): void {
  sharedRead = null;
}

/** Public routing state: mode, masked key hint, overrides and slot models. */
export function getSkillRouter(): Promise<SkillRouterStatus> {
  // Several panels mount a notice at once; they share one request. A write
  // drops the shared read (see `dropSharedRead`) so nobody gets a stale answer.
  if (sharedRead) return sharedRead;
  const read = http
    .get<Envelope<Record<string, unknown>>>(BASE, { timeoutMs: REQUEST_TIMEOUT_MS })
    .then((body) => normalizeStatus(requireData(body)))
    .finally(() => {
      if (sharedRead === read) sharedRead = null;
    });
  sharedRead = read;
  return read;
}

/**
 * Patch the routing configuration. `mode: 'router'` needs a saved or submitted
 * key (422 `router_key_required` otherwise). Notifies the setup listeners.
 */
export async function updateSkillRouter(patch: SkillRouterPatch): Promise<SkillRouterStatus> {
  dropSharedRead();
  const body = await http.put<Envelope<Record<string, unknown>>>(BASE, patch, {
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const status = normalizeStatus(requireData(body));
  notifySetupConfigUpdated();
  return status;
}

/** Clear the key and fall back to manual mode (other fields are kept). */
export async function clearSkillRouterKey(): Promise<SkillRouterStatus> {
  dropSharedRead();
  const body = await http.del<Envelope<Record<string, unknown>>>(BASE, {
    headers: JSON_HEADERS,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const status = normalizeStatus(requireData(body));
  notifySetupConfigUpdated();
  return status;
}

/**
 * Zero-cost check of the saved key, or of a submitted one (which is never
 * stored). `success` only means the check ran — read `outcome` for the verdict.
 */
export async function verifySkillRouter(
  input: SkillRouterVerifyInput = {},
): Promise<SkillRouterVerifyResult> {
  const body = await http.post<Envelope<Record<string, unknown>>>(
    `${BASE}/verify`,
    input,
    { timeoutMs: VERIFY_TIMEOUT_MS },
  );
  return normalizeVerify(requireData(body));
}

/** Models, gateway capabilities and per-slot defaults (cached 60 s server-side). */
export async function getSkillRouterCatalog(refresh = false): Promise<SkillRouterCatalog> {
  const body = await http.get<Envelope<Record<string, unknown>>>(
    `${BASE}/catalog${refresh ? '?refresh=1' : ''}`,
    { timeoutMs: VERIFY_TIMEOUT_MS },
  );
  const data = requireData(body);
  const models = Array.isArray(data.models) ? data.models : [];
  return {
    models: models.map(normalizeModel).filter((m): m is RouterModel => m !== null),
    capabilities: normalizeCapabilities(data.capabilities),
    defaults: normalizeSlotMap(data.defaults),
    stale: data.stale === true,
    fetchedAt: secondsToMs(asNumberOrNull(data.fetchedAt)),
    error: asStringOrNull(data.error),
  };
}

/** Send a minimal chat request for one LLM slot through the gateway. */
export async function testSkillRouterSlot(
  slot: RouterLlmSlot,
): Promise<SkillRouterSlotTestResult> {
  const body = await http.post<Envelope<Record<string, unknown>>>(
    `${BASE}/test-slot`,
    { slot },
    { timeoutMs: VERIFY_TIMEOUT_MS * 2 },
  );
  const data = requireData(body);
  return {
    ok: data.ok === true,
    message: typeof data.message === 'string' ? data.message : '',
    latencyMs: asNumberOrNull(data.latencyMs),
    model: asStringOrNull(data.model),
  };
}

/** Quota per gateway capability id (thin view of the catalogue). */
export async function getSkillRouterUsage(): Promise<{
  capabilities: Record<string, RouterQuota | null>;
  stale: boolean;
}> {
  const body = await http.get<Envelope<Record<string, unknown>>>(`${BASE}/usage`, {
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const data = requireData(body);
  const capabilities: Record<string, RouterQuota | null> = {};
  const raw = (data.capabilities ?? {}) as Record<string, unknown>;
  for (const [id, quota] of Object.entries(raw)) capabilities[id] = normalizeQuota(quota);
  return { capabilities, stale: data.stale === true };
}

/** Whether `capabilityId` is currently served by the gateway (spec D4). */
export function isCapabilityRouted(
  status: SkillRouterStatus | null | undefined,
  capabilityId: CapabilityId | string,
): boolean {
  if (!status || status.mode !== 'router' || !status.enabled) return false;
  if (!ROUTED_SET.has(capabilityId)) return false;
  return !status.manualCapabilities.includes(capabilityId as RoutedCapabilityId);
}

// ───────────────────────────────────────────────────────────────────────────
// Error descriptions (spec §5.3)
// ───────────────────────────────────────────────────────────────────────────

export type RouterErrorAction =
  | 'open-router-step'
  | 'switch-capability-manual'
  | 'retry'
  | 'wait'
  | 'none';

export interface RouterErrorDescription {
  title: string;
  hint: string;
  action: RouterErrorAction;
  /** Epoch ms at which a spent quota resets (`router_quota_exceeded`). */
  resetsAt?: number;
}

/** Every stable error code the gateway integration can surface. */
export const ROUTER_ERROR_ACTIONS: Readonly<Record<string, RouterErrorAction>> = {
  credential_not_configured: 'open-router-step',
  router_key_required: 'open-router-step',
  router_key_invalid: 'open-router-step',
  router_capability_denied: 'switch-capability-manual',
  router_capability_unavailable: 'switch-capability-manual',
  router_quota_exceeded: 'wait',
  router_busy: 'wait',
  content_rejected: 'none',
  router_invalid_request: 'none',
  router_upstream_error: 'retry',
  router_unreachable: 'retry',
  router_models_unavailable: 'retry',
  generation_submission_unknown: 'none',
  invalid_base_url: 'none',
  credential_malformed: 'none',
  unknown_capability: 'none',
  unknown_slot: 'none',
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local-time `HH:mm` (quota resets are shown in the user's time zone). */
export function formatLocalClock(epochMs: number): string {
  const date = new Date(epochMs);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The stable gateway error code behind a failed call, or `null` when the
 * failure is not a gateway one. The shared http-client turns every 429 into a
 * `RateLimitError` whose own code is `RATE_LIMITED`, so the two 429 flavours
 * are told apart by the details the backend attaches.
 */
export function routerErrorCodeOf(error: unknown): string | null {
  if (error instanceof RateLimitError) {
    const details = error.details ?? {};
    if (positiveNumber(details.resets_at)) return 'router_quota_exceeded';
    return 'router_busy';
  }
  if (!(error instanceof ApiError)) return null;
  return Object.prototype.hasOwnProperty.call(ROUTER_ERROR_ACTIONS, error.code) ? error.code : null;
}

/**
 * Human wording + next step for a gateway error code. Unknown codes degrade to
 * a generic "try again" description rather than throwing.
 *
 * @param code Stable `error_code` (see {@link ROUTER_ERROR_ACTIONS}).
 * @param details The envelope's `error_details` (may carry `resets_at`,
 *   `retry_after_seconds`).
 * @param t Active translations.
 * @param serverMessage Sanitised backend message, appended for
 *   `router_invalid_request` where the reason (size, text length) matters.
 */
export function describeRouterError(
  code: string,
  details: Record<string, unknown> | undefined,
  t: Translations,
  serverMessage?: string,
): RouterErrorDescription {
  const known = Object.prototype.hasOwnProperty.call(ROUTER_ERROR_ACTIONS, code);
  const copy = t.routerErrors[known ? code : 'unknown'] ?? t.routerErrors.unknown;
  const action = known ? ROUTER_ERROR_ACTIONS[code] : 'retry';
  const resetsAt = positiveNumber(details?.resets_at);
  const seconds = positiveNumber(details?.retry_after_seconds);
  // A `{time}` / `{seconds}` template without its value would read as broken
  // copy, so the entry's `hintFallback` is used instead.
  const missingValue =
    (copy.hint.includes('{time}') && !resetsAt) || (copy.hint.includes('{seconds}') && !seconds);
  let hint =
    missingValue && copy.hintFallback
      ? copy.hintFallback
      : fillTemplate(copy.hint, {
          time: resetsAt ? formatLocalClock(resetsAt) : '',
          seconds: seconds ? String(Math.ceil(seconds)) : '',
        });
  if (code === 'router_invalid_request' && serverMessage) hint = `${hint} ${serverMessage}`.trim();
  const description: RouterErrorDescription = { title: copy.title, hint, action };
  if (code === 'router_quota_exceeded' && resetsAt) description.resetsAt = resetsAt;
  return description;
}

/**
 * {@link describeRouterError} for a caught failure. A failure that is not a
 * gateway code (network fault, malformed envelope) is described as "unknown",
 * whose wording is generic and whose action is "retry".
 */
export function describeRouterFailure(error: unknown, t: Translations): RouterErrorDescription {
  const code = routerErrorCodeOf(error) ?? 'unknown';
  const details = error instanceof ApiError ? error.details : undefined;
  const message = error instanceof ApiError ? error.message : undefined;
  return describeRouterError(code, details, t, message);
}
