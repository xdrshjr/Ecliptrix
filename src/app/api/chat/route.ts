import { NextRequest, NextResponse } from 'next/server'
import { backendConfig } from '@/lib/config/backend'
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

const getConfig = async () => {
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

  if (!apiKey) {
    throw new Error('API key not configured. Please set LLM_API_KEY or OPENAI_API_KEY in environment variables.')
  }

  return { apiUrl, apiKey, model, temperature: 0.7, maxTokens: 2000 }
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

    const requestData = {
      model: config.model,
      messages: formatMessages(messages),
      stream: true,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    }

    console.log(`[Chat API] Calling LLM API: ${config.apiUrl}/chat/completions`)

    // SWEEP-EXCEPTION: third-party LLM stream — NOT a backend proxy call.
    const response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestData),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Chat API] LLM API error: ${response.status} - ${errorText}`)
      logResponse(false, `LLM API error: ${response.status}`)

      return NextResponse.json(
        { error: `LLM API error: ${response.status}` },
        { status: response.status },
      )
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log('[Chat API] 开始初始化流式传输连接')

          controller.enqueue(encoder.encode(`: stream-start\n\n`))
          console.log('[Chat API] 已发送流建立信号')

          const reader = response.body?.getReader()
          if (!reader) {
            throw new Error('No reader available')
          }

          let buffer = ''
          let totalChunks = 0
          let lastChunkTime = Date.now()
          const startTime = Date.now()

          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              const totalTime = Date.now() - startTime
              console.log(`[Chat API] 流式传输完成，总计 ${totalChunks} 个数据块，耗时 ${totalTime}ms，平均 ${totalChunks > 0 ? Math.round(totalTime / totalChunks) : 0}ms/块`)
              break
            }

            buffer += new TextDecoder().decode(value)
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmedLine = line.trim()
              if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue

              const data = trimmedLine.slice(6)
              if (data === '[DONE]') {
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
                console.log('[Chat API] 收到完成信号 [DONE]')
                continue
              }

              try {
                const parsed = JSON.parse(data)
                const delta = parsed.choices?.[0]?.delta
                const content = delta?.content
                const reasoning = delta?.reasoning_content

                if (content || reasoning) {
                  totalChunks++
                  const currentTime = Date.now()
                  const timeSinceLastChunk = currentTime - lastChunkTime
                  lastChunkTime = currentTime

                  const responseData: { content?: string; reasoning?: string } = {}
                  if (content) responseData.content = content
                  if (reasoning) responseData.reasoning = reasoning
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(responseData)}\n\n`),
                  )

                  if (totalChunks % 10 === 0 || totalChunks <= 3) {
                    const lens = `content:${content?.length || 0},reasoning:${reasoning?.length || 0}`
                    console.log(`[Chat API] 已发送第 ${totalChunks} 个数据块 (间隔 ${timeSinceLastChunk}ms, ${lens})`)
                  }
                }
              } catch (e) {
                console.error('[Chat API] Error parsing SSE data:', e)
              }
            }
          }

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

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
