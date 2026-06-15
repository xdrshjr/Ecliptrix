import { NextRequest, NextResponse } from 'next/server'
import { backendConfig } from '@/lib/config/backend'
import { normalizeApiType, streamLlmChat, type LlmApiType } from '@/lib/llm/streamLlmChat'
import { ChatMessage } from '@/types'

// SWEEP-EXCEPTION: third-party LLM streaming, not a backend proxy
// ─────────────────────────────────────────────────────────────────
// This route is a Pattern E escape hatch (counted toward the 5-route budget).
//
// Two reasons it does not use `createPassthroughRoute`:
//   1. It first hits the FastAPI backend at `/api/model-settings/resolve/chat`
//      to RESOLVE the LLM credentials (api_url, api_key, model, etc.).
//      That single backend call DOES go through `backendConfig.baseUrl`
//      (no more raw env-var reads for the backend URL).
//   2. The actual chat completion is then streamed from a THIRD-PARTY LLM
//      provider (OpenAI-compatible API), not from the FastAPI backend. The
//      streaming logic is the OpenAI SSE format and lives client-of-the-LLM,
//      not server-of-the-backend, so the proxy helper doesn't apply.
//
// Out of scope for this PR per master plan §3 (third-party LLM streaming
// stays as-is). Only the BACKEND_URL read was migrated.

type ResolvedConfig = {
  apiUrl: string
  apiKey: string
  model: string
  apiType: LlmApiType
  temperature: number
  maxTokens: number
}

// Actionable copy: the chat UI surfaces this message verbatim, so point the
// user at the in-app fix instead of an env-var stack trace.
const LLM_NOT_CONFIGURED_MESSAGE =
  '尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置 (AI model not configured — open Settings → Model Settings)'

// Distinguishable error so the outer catch can return a structured, actionable
// 503 (rather than burying it in a generic 500). Identified by a stable `code`,
// never by fuzzy-matching the message string.
class LlmNotConfiguredError extends Error {
  readonly code = 'LLM_NOT_CONFIGURED'
  constructor(message: string = LLM_NOT_CONFIGURED_MESSAGE) {
    super(message)
    this.name = 'LlmNotConfiguredError'
  }
}

const getConfig = async (): Promise<ResolvedConfig> => {
  // Try to resolve LLM settings from the FastAPI backend.
  try {
    const res = await fetch(
      backendConfig.joinPath('/api/model-settings/resolve/chat'),
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    )
    if (res.ok) {
      const data = await res.json()
      if (data.success && data.api_key) {
        return {
          apiUrl: data.api_url,
          apiKey: data.api_key,
          model: data.model_name,
          apiType: normalizeApiType(data.api_type),
          temperature: data.temperature ?? 0.7,
          maxTokens: data.max_tokens ?? 2000,
        }
      }
    }
  } catch (e) {
    console.warn('[Chat API] Failed to fetch model settings from backend, falling back to env vars')
  }

  // Fallback to environment variables for the third-party LLM.
  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1'
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo'
  const apiType = normalizeApiType(process.env.LLM_API_TYPE)

  if (!apiKey) {
    throw new LlmNotConfiguredError()
  }

  return { apiUrl, apiKey, model, apiType, temperature: 0.7, maxTokens: 2000 }
}

const formatMessages = (messages: ChatMessage[]) => {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }))
}

const logRequest = (messages: ChatMessage[], config: any) => {
  console.log(`[Chat API] ${new Date().toISOString()} - Incoming chat request`)
  console.log(`[Chat API] Model: ${config.model}`)
  console.log(`[Chat API] Messages count: ${messages.length}`)
  console.log(`[Chat API] Last message: ${messages[messages.length - 1]?.content?.slice(0, 100)}...`)
}

const logResponse = (success: boolean, error?: string) => {
  if (success) {
    console.log(`[Chat API] ${new Date().toISOString()} - Response completed successfully`)
  } else {
    console.error(`[Chat API] ${new Date().toISOString()} - Response failed: ${error}`)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { messages } = body as { messages: ChatMessage[] }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error('[Chat API] Invalid request: messages array is required')
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 },
      )
    }

    const config = await getConfig()
    logRequest(messages, config)

    console.log(`[Chat API] Calling LLM API (api_type=${config.apiType}) base=${config.apiUrl}`)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log('[Chat API] 开始初始化流式传输连接')

          controller.enqueue(encoder.encode(`: stream-start\n\n`))
          console.log('[Chat API] 已发送流建立信号')

          let totalChunks = 0
          let lastChunkTime = Date.now()
          const startTime = Date.now()
          let upstreamError: { status: number; message: string } | null = null

          for await (const event of streamLlmChat({
            config: {
              apiUrl: config.apiUrl,
              apiKey: config.apiKey,
              model: config.model,
              apiType: config.apiType,
            },
            messages: formatMessages(messages),
            temperature: config.temperature,
            maxTokens: config.maxTokens,
          })) {
            if (event.kind === 'error') {
              upstreamError = { status: event.status, message: event.message }
              break
            }
            totalChunks++
            const currentTime = Date.now()
            const timeSinceLastChunk = currentTime - lastChunkTime
            lastChunkTime = currentTime

            const payload: { content?: string; reasoning?: string } = {}
            if (event.kind === 'content') payload.content = event.text
            else if (event.kind === 'reasoning') payload.reasoning = event.text

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

            if (totalChunks % 10 === 0 || totalChunks <= 3) {
              const len = event.kind === 'content'
                ? `content:${event.text.length}`
                : `reasoning:${event.text.length}`
              console.log(`[Chat API] 已发送第 ${totalChunks} 个数据块 (间隔 ${timeSinceLastChunk}ms, ${len})`)
            }
          }

          if (upstreamError) {
            console.error(`[Chat API] LLM upstream error: ${upstreamError.status} - ${upstreamError.message}`)
            logResponse(false, `LLM upstream error: ${upstreamError.status}`)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: `LLM upstream error: ${upstreamError.status}`, message: upstreamError.message })}\n\n`,
              ),
            )
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
            controller.close()
            return
          }

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
          const totalTime = Date.now() - startTime
          console.log(`[Chat API] 流式传输完成，总计 ${totalChunks} 个数据块，耗时 ${totalTime}ms`)
          logResponse(true)
          controller.close()
        } catch (error) {
          console.error('[Chat API] Stream error:', error)
          logResponse(false, String(error))
          controller.error(error)
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error) {
    console.error('[Chat API] Unexpected error:', error)
    logResponse(false, String(error))

    // 「未配置 AI 模型凭证」是设计内的可操作失败（桌面端按设计不随包发 LLM key），
    // 而非服务器内部错误。返回可识别的结构化 503，让前端如实呈现引导文案，不再
    // 被吞成无信息量的 500；其余未知错误维持原有 500 契约不变。
    if (error instanceof LlmNotConfiguredError) {
      return NextResponse.json(
        { success: false, error_code: error.code, message: error.message },
        { status: 503 },
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
