import { DEFAULT_CREW_SETTINGS, type CrewSettings } from './types';

const CREW_SETTINGS_TIMEOUT_MS = 2_500;

const clamp = (value: unknown, low: number, high: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), low), high) : fallback;

/**
 * 研究小队设置（评审 R-06）：来自 `agent_toolkit` 类别的能力响应，**不在**
 * `webCapabilities` 快照里。与 route 里其余前置读取并行执行；超时/失败/畸形
 * 响应一律取出厂默认，绝不阻塞或失败本回合。
 */
export async function loadCrewSettings(apiBaseUrl: string): Promise<CrewSettings> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/agent-toolkit/capabilities`, {
      cache: 'no-store', signal: AbortSignal.timeout(CREW_SETTINGS_TIMEOUT_MS),
      headers: { Origin: apiBaseUrl, 'x-tool-call-id': 'crew-settings' },
    });
    if (!response.ok) return DEFAULT_CREW_SETTINGS;
    const envelope = await response.json() as {
      data?: { crew?: { enabled?: unknown; max_parallel?: unknown; member_timeout_s?: unknown } };
    };
    const crew = envelope.data?.crew;
    if (!crew) return DEFAULT_CREW_SETTINGS;
    return {
      enabled: crew.enabled !== false,
      maxParallel: clamp(crew.max_parallel, 1, 3, DEFAULT_CREW_SETTINGS.maxParallel),
      memberTimeoutSeconds: clamp(crew.member_timeout_s, 30, 180,
        DEFAULT_CREW_SETTINGS.memberTimeoutSeconds),
    };
  } catch {
    return DEFAULT_CREW_SETTINGS;
  }
}
