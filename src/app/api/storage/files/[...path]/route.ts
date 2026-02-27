import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * GET /api/storage/files/[...path]
 *
 * Proxy static file requests to the backend storage service.
 * This allows browser-side code to access backend-served static files
 * via a same-origin URL (Next.js port), forwarding Range headers for
 * video seeking support.
 * 代理静态文件请求到后端存储服务，支持视频拖拽定位（Range头）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const filePath = path.join('/');
    const backendUrl = `${BACKEND_URL}/api/storage/files/${filePath}`;

    // Forward Range header to support video seeking
    const rangeHeader = request.headers.get('range');
    const fetchHeaders: HeadersInit = {};
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    const backendResponse = await fetch(backendUrl, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(30000),
    });

    if (!backendResponse.ok && backendResponse.status !== 206) {
      return new NextResponse(null, { status: backendResponse.status });
    }

    // Forward relevant response headers
    const responseHeaders = new Headers();
    const contentType = backendResponse.headers.get('content-type');
    const contentLength = backendResponse.headers.get('content-length');
    const acceptRanges = backendResponse.headers.get('accept-ranges');
    const contentRange = backendResponse.headers.get('content-range');

    if (contentType) responseHeaders.set('content-type', contentType);
    if (contentLength) responseHeaders.set('content-length', contentLength);
    if (acceptRanges) responseHeaders.set('accept-ranges', acceptRanges);
    if (contentRange) responseHeaders.set('content-range', contentRange);
    responseHeaders.set('cache-control', 'public, max-age=3600');

    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[Storage Files Proxy] 请求异常', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(null, { status: 500 });
  }
}
