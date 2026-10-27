import { ApiError, http } from '@/lib/api/http-client';

/**
 * `POST /api/video-editing-agent/steer` 的类型化客户端。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.2.2 / §3.2.4。
 * 与其它客户端不同，这里**不对 404/409/429 抛错**：它们是状态机的正常输入
 * （服务端重启、回合已结束、待送达已满），调用方按语义结果分支即可。
 */

export type SteerOutcome =
  /** 202：已受理，等待当前工具结束后送达。重复提交（409 duplicate）也算已受理。 */
  | { kind: 'accepted'; position: number }
  /** 404 / 409 run_closed：这一轮已不存在或已结束，调用方降级为「回合结束后发送」。 */
  | { kind: 'run_gone' }
  /** 429：待送达已满。 */
  | { kind: 'queue_full' }
  /** 其它失败（校验/网络/5xx）：按排队处理，不丢文本。 */
  | { kind: 'failed'; message: string };

export interface SteerRequest {
  runId: string;
  steerId: string;
  text: string;
}

const STEER_PATH = '/api/video-editing-agent/steer';

function classify(error: unknown): SteerOutcome {
  if (!(error instanceof ApiError)) {
    return { kind: 'failed', message: error instanceof Error ? error.message : 'network' };
  }
  if (error.status === 429) return { kind: 'queue_full' };
  if (error.status === 404) return { kind: 'run_gone' };
  if (error.status === 409) {
    return error.code === 'duplicate_steer'
      ? { kind: 'accepted', position: 0 } : { kind: 'run_gone' };
  }
  return { kind: 'failed', message: error.message };
}

export async function sendSteer(request: SteerRequest): Promise<SteerOutcome> {
  try {
    const envelope = await http.post<{ data?: { position?: number } }>(
      STEER_PATH, request, { timeoutMs: 8_000 });
    return { kind: 'accepted', position: envelope.data?.position ?? 1 };
  } catch (error) {
    return classify(error);
  }
}
