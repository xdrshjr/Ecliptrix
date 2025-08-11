import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (filename: string) => {
  console.log(`[Audio Download API] ${new Date().toISOString()} - Audio file download request`);
  console.log(`[Audio Download API] Filename: ${filename}`);
};

const logResponse = (success: boolean, fileSize?: number, error?: string) => {
  if (success) {
    console.log(`[Audio Download API] ${new Date().toISOString()} - Audio file download completed successfully`);
    console.log(`[Audio Download API] File size: ${fileSize || 0} bytes`);
  } else {
    console.error(`[Audio Download API] ${new Date().toISOString()} - Audio file download failed: ${error}`);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    // 验证文件名
    if (!filename || typeof filename !== 'string') {
      console.error('[Audio Download API] Invalid request: filename is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Filename is required'
        },
        { status: 400 }
      );
    }

    // 基本的文件名安全检查
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      console.error('[Audio Download API] Invalid filename: contains unsafe characters');
      return NextResponse.json(
        { 
          success: false,
          message: 'Invalid filename'
        },
        { status: 400 }
      );
    }

    logRequest(filename);

    // 调用后端服务
    console.log(`[Audio Download API] Calling backend service: ${BACKEND_URL}/api/audio/generated/${filename}`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/audio/generated/${filename}`, {
      method: 'GET',
    });

    console.log(`[Audio Download API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Audio Download API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Audio file not found or service unavailable'
        },
        { status: backendResponse.status }
      );
    }

    // 获取文件内容
    const arrayBuffer = await backendResponse.arrayBuffer();
    const contentType = backendResponse.headers.get('content-type') || 'audio/mpeg';
    
    logResponse(true, arrayBuffer.byteLength);

    // 返回文件内容
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': arrayBuffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
      },
    });

  } catch (error) {
    console.error('[Audio Download API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error'
      },
      { status: 500 }
    );
  }
} 