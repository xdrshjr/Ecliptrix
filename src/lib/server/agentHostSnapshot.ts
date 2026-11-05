import 'server-only';
import { backendConfig } from '@/lib/config/backend';
import type {
  AgentHostEgressCapability,
  AgentHostEgressMode,
  AgentHostFsCapability,
  AgentHostProxySummary,
  AgentHostScope,
  AgentHostShellCapability,
  HostCapabilitySnapshot,
} from '@/types/agentHost';

/**
 * Agent host 能力探测（服务端）。
 *
 * 设计基线：docs/plans/agent-general-assistant/spec.md §5.2 / §6。
 * 形状与 `researchSnapshot()`（`lib/server/researchRunClient.ts`）同构：
 * **一次**探测、有硬上限、失败即降级，绝不阻塞本回合。
 *
 * 后端说 snake_case（`timeout_s`、`max_output_kb`、`read_roots`…），这里做
 * 唯一的归一化，返回 `@/types/agentHost` 的 camelCase 视图。
 */

/** 1.5 s：探测只是「本轮提示词怎么写」的输入，慢后端不该拖住回合。 */
const CAPABILITIES_TIMEOUT_MS = 1500;

type RawFields = Record<string, unknown>;

function isRecord(value: unknown): value is RawFields {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): RawFields {
  return isRecord(value) ? value : {};
}

function readBoolean(source: RawFields, key: string, fallback: boolean) {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(source: RawFields, key: string, fallback: number) {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value : fallback;
}

function readString(source: RawFields, key: string, fallback: string) {
  const value = source[key];
  return typeof value === 'string' && value ? value : fallback;
}

function readStringArray(source: RawFields, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** 未知作用域一律按最保守的 `workspace` 解释，绝不放宽。 */
function readScope(source: RawFields, key: string): AgentHostScope {
  return source[key] === 'host' ? 'host' : 'workspace';
}

/** 未知档位按出厂值 `balanced` 解释（`strict` 是可选加严档）。 */
function readMode(source: RawFields, key: string): AgentHostEgressMode {
  const value = source[key];
  return value === 'strict' || value === 'open' ? value : 'balanced';
}

/** 数值缺省值沿用后端出厂值（`agent-host-config.yaml` §4.9）。 */
function normalizeShell(raw: unknown): AgentHostShellCapability {
  const source = asRecord(raw);
  return {
    enabled: readBoolean(source, 'enabled', false),
    scope: readScope(source, 'scope'),
    timeoutSeconds: readNumber(source, 'timeout_s', 120),
    maxOutputKb: readNumber(source, 'max_output_kb', 64),
  };
}

function normalizeFs(raw: unknown): AgentHostFsCapability {
  const source = asRecord(raw);
  return {
    enabled: readBoolean(source, 'enabled', false),
    maxBytes: readNumber(source, 'max_bytes', 32768),
    readRoots: readStringArray(source, 'read_roots'),
    writeRoots: readStringArray(source, 'write_roots'),
  };
}

function normalizeProxy(raw: unknown): AgentHostProxySummary {
  const source = asRecord(raw);
  return {
    mode: readString(source, 'mode', 'auto'),
    resolvedFrom: readString(source, 'resolved_from', 'direct'),
    target: readString(source, 'target', ''),
  };
}

function normalizeEgress(raw: unknown): AgentHostEgressCapability {
  const source = asRecord(raw);
  return {
    enabled: readBoolean(source, 'enabled', false),
    mode: readMode(source, 'mode'),
    proxy: normalizeProxy(source.proxy),
    // 缺省必须是出厂值而不是 0：`hostToolAdapter` 用 `maxPerTurn` 记账，
    // 0 会让本回合每一次出口调用都判 `egress_budget_exceeded`。
    maxBytes: readNumber(source, 'max_bytes', 8_388_608),
    maxPerTurn: readNumber(source, 'max_per_turn', 60),
    maxPerMinute: readNumber(source, 'max_per_minute', 120),
  };
}

/**
 * `GET /capabilities` 的 `data` 归一化。
 *
 * `enabled: false` 是**正常快照**（总开关关闭），照原样返回；只有 `data`
 * 不是对象、缺 `enabled`，或三个能力段不是对象时才判「形状坏掉」→ `null`。
 *
 * @param raw 后端 `data` 字段（snake_case）
 * @returns camelCase 快照，形状不可用时 `null`
 */
export function normalizeCapabilitySnapshot(
  raw: unknown,
): HostCapabilitySnapshot | null {
  if (!isRecord(raw) || typeof raw.enabled !== 'boolean') return null;
  if (!isRecord(raw.shell) || !isRecord(raw.fs) || !isRecord(raw.egress)) {
    return null;
  }
  const snapshot: HostCapabilitySnapshot = {
    enabled: raw.enabled,
    shell: normalizeShell(raw.shell),
    fs: normalizeFs(raw.fs),
    egress: normalizeEgress(raw.egress),
  };
  if (isRecord(raw.limits)) {
    snapshot.limits = {
      maxConcurrency: readNumber(raw.limits, 'max_concurrency', 0),
    };
  }
  return snapshot;
}

/**
 * 探测 agent host 能力，1.5 s 上限。
 *
 * @returns 归一化快照；传输失败、非 2xx 或形状坏掉时 `null`
 *   （工具层按「能力未知」降级，宿主不可用不能拖垮编辑）
 */
export async function agentHostSnapshot(): Promise<
  HostCapabilitySnapshot | null
> {
  try {
    const response = await fetch(
      backendConfig.joinPath('/api/agent-host/capabilities'),
      {
        signal: AbortSignal.timeout(CAPABILITIES_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
    if (!response.ok) return null;
    const result: unknown = await response.json();
    return normalizeCapabilitySnapshot(asRecord(result).data);
  } catch {
    // 静态编辑必须在宿主不可用时照常工作（spec §5.2）。
    return null;
  }
}
