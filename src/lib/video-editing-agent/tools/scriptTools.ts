import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext, ScriptOperation } from '../types';
import { scriptHash, scriptWriteSegments } from '../editorContextPrompt';

type ScriptWrite = Extract<ScriptOperation, { type: 'set_script_with_narration' }>;
const result = (details: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(details) }], details });

/** 只透出稳定错误码和分类，不把供应商正文或凭据写入工具历史。 */
export async function scriptApiFailure(response: Response) {
  const body = await response.json().catch(() => null);
  const supplied = body?.error_code;
  const code = typeof supplied === 'string' && /^(?:LLM_|MODEL_|models_|credential_)[a-zA-Z0-9_]{1,70}$/.test(supplied)
    ? supplied : response.status === 401 || response.status === 403 ? 'LLM_AUTHENTICATION_ERROR'
      : response.status === 429 ? 'LLM_RATE_LIMITED' : response.status === 504 ? 'LLM_TIMEOUT' : 'SCRIPT_API_ERROR';
  const failureClass = code === 'LLM_CANCELLED' ? 'cancelled'
    : /AUTHENTICATION|MODEL_|models_|credential_/.test(code) ? 'configuration' : 'transient';
  return { success: false, error: code, error_code: code,
    error_details: { failure_class: failureClass, retryable: false, local_status: response.status },
    next_step: failureClass === 'configuration' ? '停止此模型分支，检查模型设置；保留原稿，不切换旧密钥。'
      : code === 'LLM_CANCELLED' ? '停止执行，保留原稿。' : '保留原稿，报告错误类别；不要把失败结果写入脚本。' };
}

/** 单次同步发布，服务端同轮快照与客户端操作使用同一份稳定身份。 */
export function publishScript(context: ToolContext, callId: string, segments: ScriptWrite['segments'], baselineHash: string) {
  context.abortSignal?.throwIfAborted();
  if (scriptHash(context.scriptSegments) !== baselineHash) throw new Error('SCRIPT_CONFLICT');
  segments = segments.map(s => {
    const old = context.scriptSegments?.find(x => x.id === s.id);
    return { ...s, voiceId: s.voiceId ?? old?.voiceId, voiceSpeed: s.voiceSpeed ?? old?.voiceSpeed };
  });
  const snapshot = segments.map(s => ({ id: s.id!, title: s.title, narrationText: s.narrationText,
    sentences: s.sentences ?? s.scriptText.split(/(?<=[。！？.!?])\s*/).filter(x => x.trim()).map((text, i) => ({ id: `${s.id}-s-${i}`, text: text.trim() })),
    ...(s.voiceId ? { voiceId: s.voiceId } : {}), ...(s.voiceSpeed !== undefined ? { voiceSpeed: s.voiceSpeed } : {}),
  }));
  context.recordOperation(callId, { type: 'set_script_with_narration', segments: segments.map((s, i) => ({ ...s, sentences: snapshot[i].sentences })),
    scriptType: 'ai_generated', baselineHash, projectId: context.projectId });
  context.scriptSegments = snapshot;
  return scriptHash(snapshot);
}

export function createScriptTools(context: ToolContext): AgentTool[] {
  return [{
    name: 'get_video_script', label: '读取解说脚本', description: '读取本轮服务端脚本快照、完整旁白、稳定段 ID 及内容哈希。不是客户端保存回执；实际保存以工程回执为准。',
    parameters: Type.Object({}),
    execute: async () => result({ success: true, source: 'server_snapshot', persisted: false,
      project_id: context.projectId ?? null, hash: scriptHash(context.scriptSegments), segments: scriptWriteSegments(context.scriptSegments) }),
  }, {
    name: 'set_video_script', label: '写入解说脚本', description: '将已有原稿逐字写入解说脚本，无需 LLM。整段 content 保留开场钩子；结构化 segments 可保留稳定 ID 和独立旁白。先用 get_video_script 读取；不要用扩写代替原稿写入。返回服务端快照，客户端应用和保存尚需工程确认。',
    parameters: Type.Object({
      content: Type.Optional(Type.String({ maxLength: 30000, description: '完整原稿，包含开场钩子。与 segments 二选一。' })),
      segments: Type.Optional(Type.Array(Type.Object({ id: Type.Optional(Type.String()), title: Type.String(), scriptText: Type.String(), narrationText: Type.String() }), { maxItems: 50 })),
      expected_hash: Type.Optional(Type.String({ description: 'get_video_script 返回的基线哈希；冲突时拒绝写入。' })),
    }),
    execute: async (callId, raw, signal) => {
      const params = raw as { content?: string; expected_hash?: string;
        segments?: Array<{ id?: string; title: string; scriptText: string; narrationText: string }> };
      const baseline = scriptHash(context.scriptSegments);
      if (params.expected_hash && params.expected_hash !== baseline) return result({ success: false, error_code: 'SCRIPT_CONFLICT' });
      if ((typeof params.content === 'string') === Array.isArray(params.segments)) return result({ success: false, error_code: 'SCRIPT_INVALID_INPUT' });
      const segments = typeof params.content === 'string'
        ? [{ id: context.scriptSegments?.length === 1 ? context.scriptSegments[0].id : undefined, title: '解说脚本', scriptText: params.content, narrationText: params.content }]
        : params.segments ?? [];
      if (!segments.length || segments.some(s => !(s.narrationText.trim() || s.scriptText.trim()))) return result({ success: false, error_code: 'SCRIPT_EMPTY_INPUT' });
      const normalized = segments.map(s => ({ ...s, id: s.id?.trim() || `agent-segment-${crypto.randomUUID()}` }));
      if (new Set(normalized.map(s => s.id)).size !== normalized.length) return result({ success: false, error_code: 'SCRIPT_INVALID_INPUT' });
      try {
        signal?.throwIfAborted();
        const hash = publishScript(context, callId, normalized, baseline);
        return result({ success: true, source: 'server_snapshot', persisted: false, application: 'pending_client', hash,
          segments: scriptWriteSegments(context.scriptSegments), message: '原稿已发布给客户端；此回执不证明工程已保存。' });
      } catch {
        return result({ success: false, error_code: context.abortSignal?.aborted || signal?.aborted ? 'SCRIPT_CANCELLED' : 'SCRIPT_CONFLICT' });
      }
    },
  }];
}
