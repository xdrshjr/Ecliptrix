import 'server-only';
import { backendConfig } from '@/lib/config/backend';
import type { WebResearchCapabilities } from '@/types/webResearch';

interface RunCredentials { run_id: string; run_token: string }

/**
 * Statuses that prove the run itself no longer exists, so cancelling one call
 * must retire the client (spec v2 §4.8). Anything else is inconclusive.
 */
const RUN_GONE_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 410]);
interface RunOptions {
  projectId?: string; signal?: AbortSignal; remainingMs?: number;
  /** UI locale (Accept-Language) so the research brief matches the product. */
  locale?: string;
}

/** A network sub-run is lazy, single-flight and independent from editing. */
export class ResearchRunClient {
  private registration?: Promise<RunCredentials>;
  private credentials?: RunCredentials;
  private lease?: ReturnType<typeof setInterval>;
  private closed = false;
  private lost = false;
  private lostCode = 'run_closed';
  private closing?: Promise<void>;
  private deadline: number;
  readonly controller = new AbortController();

  constructor(private options: RunOptions) {
    this.deadline = Date.now() + Math.min(options.remainingMs ?? 7200000, 7200000);
    options.signal?.addEventListener('abort', () => { void this.close(); }, { once: true });
    if (options.signal?.aborted) this.closed = true;
  }

  private async request(path: string, method: string, body?: unknown, timeout = 3000) {
    return fetch(backendConfig.joinPath(`/api/web-research${path}`), {
      method, headers: { 'Content-Type': 'application/json',
        ...(this.credentials ? {
          'X-Research-Run': this.credentials.run_id,
          'X-Research-Token': this.credentials.run_token,
        } : {}) },
      signal: AbortSignal.timeout(timeout),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private async register(): Promise<RunCredentials> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new Error('cancelled');
    const response = await this.request('/runs', 'POST', {
      ...(this.options.projectId ? { project_id: this.options.projectId } : {}),
      remaining_ms: remaining,
    });
    const result = await response.json();
    if (!response.ok || !result.success || typeof result.data?.run_token !== 'string' ||
      !result.data.run_token || typeof result.data.run_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(result.data.run_id)) {
      throw new Error('research_unavailable');
    }
    this.credentials = result.data;
    if (this.closed) throw new Error('cancelled');
    this.lease = setInterval(() => {
      void this.request(`/runs/${this.credentials!.run_id}/lease`, 'PUT', {})
        .then(response => { if (!response.ok) void this.close(); })
        .catch(() => { void this.close(); });
    }, 15000);
    return result.data;
  }

  /**
   * The backend lost this run (restart). Later calls in this turn must not
   * send HTTP again; the next message registers a fresh run (AC-41).
   */
  get lostReason(): string | null {
    return this.lost ? this.lostCode : null;
  }

  /**
   * Turn-scoped degradation, **not** run death (spec v2 §4.8).
   *
   * Later *research* (tier-1) calls in the same turn see `lostReason` and stop
   * sending HTTP, but the run itself stays alive: the 15 s lease keeps renewing
   * until the backend expires it naturally, and the tier-2 egress tools
   * (`http_request` / `download_url` / `diagnose_url`) never read this flag
   * because they need no run at all.
   */
  markLost(code = 'run_closed'): void {
    this.lost = true;
    this.lostCode = code;
  }

  async headers(toolCallId: string): Promise<Record<string, string>> {
    if (this.closed || this.options.signal?.aborted) throw new Error('cancelled');
    this.registration ??= this.register();
    const credentials = await this.registration;
    if (this.closed) throw new Error('cancelled');
    return { 'X-Research-Run': credentials.run_id,
      'X-Research-Token': credentials.run_token, 'X-Tool-Call-Id': toolCallId,
      ...(this.options.locale ? { 'Accept-Language': this.options.locale } : {}) };
  }

  /**
   * Best-effort cancellation of one backend call id — non-fatal by design
   * (spec v2 §4.8, fixes root cause C-3).
   *
   * Only an answer that proves the run is gone (`401/403/404/410`) closes the
   * client. Any other non-2xx status (e.g. `research_busy` close to the call
   * quota) or a network error merely calls `markLost('cancel_unconfirmed')`:
   * the run keeps renewing its lease and expires naturally, so one failed
   * cleanup can no longer tear down every later research call of the turn.
   */
  async cancelCall(toolCallId: string): Promise<void> {
    if (!this.credentials) return;
    let response: Response;
    try {
      response = await this.request(
        `/runs/${this.credentials.run_id}/calls/${encodeURIComponent(toolCallId)}`,
        'DELETE', undefined, 2000);
    } catch {
      this.markLost('cancel_unconfirmed');
      return;
    }
    if (response.ok) return;
    if (RUN_GONE_STATUSES.has(response.status)) {
      await this.close();
      return;
    }
    this.markLost('cancel_unconfirmed');
  }

  close(): Promise<void> {
    this.closed = true;
    this.controller.abort();
    if (this.lease) clearInterval(this.lease);
    this.closing ??= this.finishClose();
    return this.closing;
  }

  private async finishClose(): Promise<void> {
    await this.registration?.catch(() => undefined);
    if (this.credentials) {
      await this.request(`/runs/${this.credentials.run_id}`, 'DELETE', undefined, 2000)
        .catch(() => undefined); // Lease expiry reclaims a disconnected backend.
    }
  }
}

/** One probe answers both the window and which network segments exist (§13). */
export interface ResearchSnapshot {
  contextWindow: number;
  capabilities: WebResearchCapabilities | null;
}

export async function researchSnapshot(): Promise<ResearchSnapshot> {
  try {
    const response = await fetch(backendConfig.joinPath('/api/web-research/capabilities'),
      { signal: AbortSignal.timeout(2500), cache: 'no-store' });
    const result = await response.json();
    const value = result.data?.limits?.context_window_tokens;
    const capabilities = result.data;
    return {
      contextWindow: Number.isInteger(value) && value >= 16384 && value <= 1048576
        ? value : 128000,
      capabilities: capabilities?.search ? capabilities : null,
    };
  } catch {
    // Static editing must work when research is unavailable.
    return { contextWindow: 128000, capabilities: null };
  }
}
