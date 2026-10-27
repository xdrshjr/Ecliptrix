import type { NextRequest } from 'next/server';
import { GET as proxyGet, POST as proxyPost } from './[...path]/route';

/**
 * `/api/agent-skills`（空路径）：管理列表与创建。
 *
 * 为什么单独一个文件：`[...path]` 是必选 catch-all，不匹配空路径，所以
 * `GET /api/agent-skills` 会 404。这里把请求以空 path 转进同一份白名单代理，
 * 守卫逻辑只有一份。
 */
const rootContext = () => ({ params: Promise.resolve({ path: [] as string[] }) });

export const GET = (request: NextRequest) => proxyGet(request, rootContext());
export const POST = (request: NextRequest) => proxyPost(request, rootContext());
