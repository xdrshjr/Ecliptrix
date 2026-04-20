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
}

export type StreamLlmEvent =
  | { kind: 'content'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'error'; status: number; message: string }

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
  const { config, messages, temperature = 0.7, maxTokens, signal } = opts
  if (!config.apiKey || !config.apiUrl) {
    throw new Error('streamLlmChat: apiKey and apiUrl are required')
  }

  if (config.apiType === 'anthropic') {
    yield* streamAnthropic({ config, messages, temperature, maxTokens, signal })
    return
  }
  yield* streamOpenAI({ config, messages, temperature, maxTokens, signal })
}

async function* streamOpenAI(opts: Required<Omit<StreamLlmOptions, 'signal' | 'maxTokens'>> & Pick<StreamLlmOptions, 'signal' | 'maxTokens'>): AsyncGenerator<StreamLlmEvent> {
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

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    yield { kind: 'error', status: response.status, message: text.slice(0, 500) || `HTTP ${response.status}` }
    return
  }
  if (!response.body) {
    yield { kind: 'error', status: 0, message: 'No response body' }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') return
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }
        const p = parsed as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> }
        const delta = p.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) yield { kind: 'content', text: delta.content }
        if (delta.reasoning_content) yield { kind: 'reasoning', text: delta.reasoning_content }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // reader already released
    }
  }
}

async function* streamAnthropic(opts: Required<Omit<StreamLlmOptions, 'signal' | 'maxTokens'>> & Pick<StreamLlmOptions, 'signal' | 'maxTokens'>): AsyncGenerator<StreamLlmEvent> {
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

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    yield { kind: 'error', status: response.status, message: text.slice(0, 500) || `HTTP ${response.status}` }
    return
  }
  if (!response.body) {
    yield { kind: 'error', status: 0, message: 'No response body' }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }
        const p = parsed as {
          type?: string
          delta?: { type?: string; text?: string; thinking?: string }
        }
        if (p.type === 'content_block_delta') {
          if (p.delta?.type === 'text_delta' && p.delta.text) {
            yield { kind: 'content', text: p.delta.text }
          } else if (p.delta?.type === 'thinking_delta' && p.delta.thinking) {
            yield { kind: 'reasoning', text: p.delta.thinking }
          }
        } else if (p.type === 'message_stop') {
          return
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // reader already released
    }
  }
}
