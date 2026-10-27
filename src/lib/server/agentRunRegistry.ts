/**
 * 进程内的「运行登记表」：让 `POST /api/video-editing-agent/steer` 能找到
 * 正在跑的那一次 Agent 回合并向它插话。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.2.2。
 *
 * 挂在 `globalThis` 上：Next 开发模式下各路由可能是互相独立的模块实例，模块级
 * 变量会让 chat 路由与 steer 路由看到两张不同的表；打包后的 standalone 是
 * 单进程，同样适用。**不支持多进程/集群**（产品形态是单进程桌面应用）：进程
 * 重启后登记表清空，客户端对 404 降级为「回合结束后发送」。
 */

/** 同一回合最多同时等待送达的插话条数（与客户端总量上限对齐）。 */
export const MAX_PENDING_STEERS = 3;
/** 单条插话的最大长度，按 Unicode 码点计。 */
export const STEER_MAX_CHARS = 2000;
/**
 * 运行结束（`close()`）后登记项保留的时长：让迟到的请求拿到明确的
 * `run_closed`，而不是含糊的 404。
 */
export const STEER_TTL_MS = 30_000;

const STEER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type SteerErrorCode =
  | 'run_not_found'
  | 'run_closed'
  | 'steer_queue_full'
  | 'invalid_steer'
  | 'duplicate_steer';

export class SteerError extends Error {
  constructor(readonly code: SteerErrorCode) {
    super(code);
    this.name = 'SteerError';
  }
}

export interface SteerAcceptance {
  steerId: string;
  /** 1-based，当前待送达队列中的位置。 */
  position: number;
}

export interface SteerInput {
  steerId: string;
  text: string;
}

export interface AgentRunHandle {
  /** `crypto.randomUUID()`，仅在本次 SSE 连接生命期内有效。 */
  readonly runId: string;
  /** @throws SteerError */
  steer(input: SteerInput): SteerAcceptance;
  pendingCount(): number;
  /** 回合结束或被中止时调用；幂等。之后 `steer` 一律 `run_closed`。 */
  close(): void;
}

/** 校验一条插话的形状，返回去空白后的文本。@throws SteerError('invalid_steer') */
export function validateSteerInput(input: SteerInput): string {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || Array.from(text).length > STEER_MAX_CHARS) {
    throw new SteerError('invalid_steer');
  }
  if (typeof input.steerId !== 'string' || !STEER_ID_PATTERN.test(input.steerId)) {
    throw new SteerError('invalid_steer');
  }
  return text;
}

interface RegistryEntry {
  handle: AgentRunHandle;
  closedAt: number | null;
}

type Registry = Map<string, RegistryEntry>;

const REGISTRY_KEY = Symbol.for('ecliptrix.agentRuns');

function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>;
  let table = holder[REGISTRY_KEY];
  if (!table) {
    table = new Map();
    holder[REGISTRY_KEY] = table;
  }
  return table;
}

function sweepExpired(table: Registry, now: number): void {
  table.forEach((entry, runId) => {
    if (entry.closedAt !== null && now - entry.closedAt >= STEER_TTL_MS) {
      table.delete(runId);
    }
  });
}

export function registerRun(handle: AgentRunHandle): void {
  const table = registry();
  sweepExpired(table, Date.now());
  table.set(handle.runId, { handle, closedAt: null });
}

/**
 * 标记运行已结束：保留 `STEER_TTL_MS` 供迟到请求拿到 `run_closed`，随后由
 * 下一次登记/查询顺带清除（不另起定时器，避免挂住进程退出）。
 */
export function unregisterRun(runId: string): void {
  const entry = registry().get(runId);
  if (entry && entry.closedAt === null) entry.closedAt = Date.now();
}

export function getRun(runId: string): AgentRunHandle | undefined {
  const table = registry();
  const now = Date.now();
  sweepExpired(table, now);
  return table.get(runId)?.handle;
}

/** 仅供测试：清空登记表。 */
export function resetRunRegistryForTests(): void {
  registry().clear();
}
