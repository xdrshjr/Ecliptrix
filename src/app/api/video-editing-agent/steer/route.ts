import { NextRequest } from 'next/server';
import { researchOriginAllowed, researchProxyError } from '@/lib/server/researchUiOrigin';
import { SteerError, getRun, type SteerErrorCode } from '@/lib/server/agentRunRegistry';

/**
 * `POST /api/video-editing-agent/steer` —— 向正在运行的 Agent 回合插话。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.2.2。
 * 插话在「当前工具执行完成后」才送达（pi-agent-core 的 `steer()` 语义），
 * 因此 202 只表示「已受理」。日志只记 runId 前 8 位、steerId 与字数，不记正文。
 */

const MAX_BODY_BYTES = 16 * 1024;

const STATUS_BY_CODE: Record<SteerErrorCode, number> = {
  run_not_found: 404,
  run_closed: 409,
  steer_queue_full: 429,
  invalid_steer: 422,
  duplicate_steer: 409,
};

interface SteerBody {
  runId?: unknown;
  steerId?: unknown;
  text?: unknown;
}

function failure(code: string, status: number) {
  return researchProxyError(code, status);
}

/** 先 Content-Type、再 Origin：`write=true` 会把缺 JSON 头误报成 403。 */
function guardRequest(request: NextRequest): Response | null {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/json')) {
    return failure('json_required', 415);
  }
  if (!request.headers.get('origin') || !researchOriginAllowed(request, false)) {
    return failure('origin_forbidden', 403);
  }
  return null;
}

async function readBody(request: NextRequest): Promise<SteerBody | null> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as SteerBody : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const denied = guardRequest(request);
  if (denied) return denied;
  const body = await readBody(request);
  if (!body || typeof body.runId !== 'string' || typeof body.steerId !== 'string'
    || typeof body.text !== 'string') {
    return failure('invalid_steer', 422);
  }
  const run = getRun(body.runId);
  if (!run) return failure('run_not_found', 404);
  try {
    const accepted = run.steer({ steerId: body.steerId, text: body.text });
    console.log(`[VideoEditingAgent] steer accepted run=${body.runId.slice(0, 8)} `
      + `steer=${accepted.steerId} chars=${Array.from(body.text).length}`);
    return Response.json({ success: true, data: accepted },
      { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SteerError) {
      return failure(error.code, STATUS_BY_CODE[error.code]);
    }
    console.error('[VideoEditingAgent] steer failed unexpectedly');
    return failure('internal_error', 500);
  }
}
