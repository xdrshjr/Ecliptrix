import { NextRequest, NextResponse } from 'next/server';

// 日志记录函数
const logRequest = (filename: string) => {
  console.log(`[AI Image Download API] Download requested for filename: ${filename}`, {
    timestamp: new Date().toISOString()
  });
};

const logResponse = (success: boolean, filename: string, size?: number, error?: string) => {
  if (success) {
    console.log(`[AI Image Download API] Download success: filename=${filename}, size=${size} bytes`);
  } else {
    console.error(`[AI Image Download API] Download failed: filename=${filename}, error=${error}`);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  let filename: string | undefined;
  
  try {
    const resolvedParams = await params;
    filename = resolvedParams.filename;

    if (!filename) {
      console.error('[AI Image Download API] Invalid request: filename is required');
      return NextResponse.json(
        { error: 'Filename is required' },
        { status: 400 }
      );
    }

    // 验证文件名安全性
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      console.error('[AI Image Download API] Invalid filename:', filename);
      return NextResponse.json(
        { error: 'Invalid filename' },
        { status: 400 }
      );
    }

    logRequest(filename);

    // 调用ComfyUI API服务图片下载接口
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8001';
    console.log(`[AI Image Download API] Calling ComfyUI service: ${comfyuiServiceUrl}/api/v1/download/${filename}`);
    
    const comfyuiResponse = await fetch(`${comfyuiServiceUrl}/api/v1/download/${filename}`, {
      method: 'GET',
    });

    console.log(`[AI Image Download API] ComfyUI response status: ${comfyuiResponse.status}`);

    if (!comfyuiResponse.ok) {
      let errorMessage = `ComfyUI service error: ${comfyuiResponse.status}`;
      try {
        const errorData = await comfyuiResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[AI Image Download API] Failed to parse error response:', parseError);
      }

      console.error(`[AI Image Download API] ComfyUI error: ${errorMessage}`);
      logResponse(false, filename, undefined, errorMessage);

      return NextResponse.json(
        {
          error: 'AI image download service unavailable',
          message: errorMessage
        },
        { status: comfyuiResponse.status }
      );
    }

    // 获取图片数据
    const imageBuffer = await comfyuiResponse.arrayBuffer();
    const contentType = comfyuiResponse.headers.get('content-type') || 'image/png';
    
    console.log(`[AI Image Download API] Image received:`, {
      filename,
      size: imageBuffer.byteLength,
      contentType
    });

    logResponse(true, filename, imageBuffer.byteLength);

    // 返回图片数据
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000', // 缓存1年
      },
    });

  } catch (error) {
    console.error('[AI Image Download API] Unexpected error:', error);
    logResponse(false, filename || 'unknown', undefined, error instanceof Error ? error.message : 'Unknown error');
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 