/**
 * Shared streaming LLM client that dispatches between OpenAI- and Anthropic-
 * compatible SSE formats. Consumers (src/app/api/chat/route.ts,
 * src/app/api/video-editing-agent/chat/route.ts) pass in the resolved config
 * (including api_type from /api/model-settings/resolve/chat) and receive a
 * flat async iterator of normalized events. They wrap those events in
 * whatever outer SSE envelope their client expects, so the public contract
 * with the browser stays unchanged.
 *
 * Why dispatch at this layer: OpenAI emits `data: {choices:[{delta:{content}}]}`
 * terminated by `data: [DONE]`, while Anthropic emits event-named SSE with
 * payloads like `data: {type:"content_block_delta", delta:{type:"text_delta",
 * text}}` terminated by `event: message_stop`. Doing the branch once, in one
 * place, keeps every caller's SSE parser trivial.
 */

export type LlmApiType = 'openai' | 'anthropic'

export interface StreamLlmConfig {
  apiUrl: string
  apiKey: string
  model: string
  apiType: LlmApiType
}

export interface StreamLlmOptions {
  config: StreamLlmConfig
  messages: { role: string; content: string | unknown }[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export type StreamLlmEvent =
  | { kind: 'content'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'error'; status: number; message: string; code?: string }

export function normalizeApiType(value: string | null | undefined): LlmApiType {
  const v = (value ?? '').trim().toLowerCase()
  return v === 'anthropic' ? 'anthropic' : 'openai'
}

/**
 * Partition system-role messages out of the flat message list — Anthropic's
 * `/v1/messages` wants system prompts at the top level rather than inline.
 */
function splitSystemMessages(
  messages: StreamLlmOptions['messages'],
): { system: string | undefined; rest: StreamLlmOptions['messages'] } {
  const systemChunks: string[] = []
  const rest: StreamLlmOptions['messages'] = []
  for (const m of messages) {
    if (m.role === 'system' && typeof m.content === 'string' && m.content.length > 0) {
      systemChunks.push(m.content)
    } else {
      rest.push(m)
    }
  }
  return {
    system: systemChunks.length > 0 ? systemChunks.join('\n\n') : undefined,
    rest,
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

export async function* streamLlmChat(opts: StreamLlmOptions): AsyncGenerator<StreamLlmEvent> {
  const { config, messages, temperature = 0.7, maxTokens } = opts
  const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 120_000), ...(opts.signal ? [opts.signal] : [])])
  if (!config.apiKey || !config.apiUrl) {
    throw new Error('streamLlmChat: apiKey and apiUrl are required')
  }

  try {
    if (config.apiType === 'anthropic') {
      yield* streamAnthropic({ config, messages, temperature, maxTokens, signal })
    } else {
      yield* streamOpenAI({ config, messages, temperature, maxTokens, signal })
    }
  } catch {
    const code = signal.aborted ? (signal.reason?.name === 'TimeoutError' ? 'LLM_TIMEOUT' : 'LLM_CANCELLED') : 'LLM_NETWORK_ERROR'
    yield { kind: 'error', code, status: code === 'LLM_TIMEOUT' ? 504 : code === 'LLM_CANCELLED' ? 499 : 502, message: code }
  }
}

async function* streamOpenAI(opts: StreamLlmOptions): AsyncGenerator<StreamLlmEvent> {
  const { config, messages, temperature, maxTokens, signal } = opts
  const url = `${stripTrailingSlash(config.apiUrl)}/chat/completions`
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
    temperature,
  }
  if (maxTokens) body.max_tokens = maxTokens

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  yield* readStream(response, 'openai', signal)
}

async function* streamAnthropic(opts: StreamLlmOptions): AsyncGenerator<StreamLlmEvent> {
  const { config, messages, temperature, maxTokens, signal } = opts
  const url = `${stripTrailingSlash(config.apiUrl)}/v1/messages`
  const { system, rest } = splitSystemMessages(messages)
  const body: Record<string, unknown> = {
    model: config.model,
    messages: rest,
    stream: true,
    temperature,
    max_tokens: maxTokens ?? 4096,
  }
  if (system) body.system = system

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Dual-header: native Anthropic uses x-api-key; Zhipu's compat endpoint
      // uses `Authorization: Bearer`. Sending both is safe — each server
      // consumes the one it knows and ignores the other.
      'x-api-key': config.apiKey,
      Authorization: `Bearer ${config.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  })

  yield* readStream(response, 'anthropic', signal)
}

function streamError(status: number, code?: string): StreamLlmEvent {
  code ??= status === 401 || status === 403 ? 'LLM_AUTHENTICATION_ERROR'
    : status === 429 ? 'LLM_RATE_LIMITED' : 'LLM_UPSTREAM_ERROR'
  return { kind: 'error', status, code, message: code }
}

async function* readStream(response: Response, apiType: LlmApiType, signal?: AbortSignal): AsyncGenerator<StreamLlmEvent> {
  if (!response.ok) {
    await response.body?.cancel()
    yield streamError(response.status)
    return
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    await response.body?.cancel()
    yield streamError(502, 'LLM_PROTOCOL_ERROR')
    return
  }
  if (!response.body) { yield streamError(502, 'LLM_EMPTY_OUTPUT'); return }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawText = false
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })

  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) { yield streamError(502, 'LLM_INCOMPLETE_STREAM'); return }
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > 2_000_000) { yield streamError(502, 'LLM_PROTOCOL_ERROR'); return }
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (apiType === 'openai' && data === '[DONE]') {
          if (!sawText) yield streamError(502, 'LLM_EMPTY_OUTPUT')
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          yield streamError(502, 'LLM_PROTOCOL_ERROR')
          return
        }
        if (!parsed || typeof parsed !== 'object') { yield streamError(502, 'LLM_PROTOCOL_ERROR'); return }
        const p = parsed as {
          type?: string
          delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string }
          error?: { type?: string; code?: string; status?: number }
          choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }>
        }
        if (apiType === 'anthropic' && p.type === 'message_delta' && p.delta?.stop_reason === 'max_tokens') {
          yield streamError(502, 'LLM_INCOMPLETE_STREAM')
          return
        }
        if (p.error || p.type === 'error') {
          const type = p.error?.type ?? p.error?.code ?? ''
          const status = /rate_limit|quota/.test(type) ? 429 : /authentication|permission/.test(type) ? 401
            : /overloaded/.test(type) ? 503 : p.error?.status ?? 502
          yield streamError(status)
          return
        }
        if (apiType === 'openai') {
          const choice = p.choices?.[0]
          if (choice?.delta?.content) { sawText = true; yield { kind: 'content', text: choice.delta.content } }
          if (choice?.delta?.reasoning_content) yield { kind: 'reasoning', text: choice.delta.reasoning_content }
          if (choice?.finish_reason === 'length') { yield streamError(502, 'LLM_INCOMPLETE_STREAM'); return }
          continue
        }
        if (p.type === 'content_block_delta') {
          if (p.delta?.type === 'text_delta' && p.delta.text) {
            sawText = true
            yield { kind: 'content', text: p.delta.text }
          } else if (p.delta?.type === 'thinking_delta' && p.delta.thinking) {
            yield { kind: 'reasoning', text: p.delta.thinking }
          }
        } else if (p.type === 'message_stop') {
          if (!sawText) yield streamError(502, 'LLM_EMPTY_OUTPUT')
          return
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    try {
      reader.releaseLock()
    } catch {
      // reader already released
    }
  }
}
