import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET, POST } = createPassthroughRoute('/api/youtube/preview/prepare')

// 取消返回 204；直接透传空 body，避免缓冲为空字符串后 Response 构造失败。
export const { DELETE } = createPassthroughRoute(
  '/api/youtube/preview/prepare', { streaming: true },
)
