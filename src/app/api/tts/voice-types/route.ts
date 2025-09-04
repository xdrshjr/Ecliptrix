import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = () => {
  console.log(`[TTS Voice Types API] ${new Date().toISOString()} - Voice types request`);
};

const logResponse = (success: boolean, voiceCount?: number, error?: string) => {
  if (success) {
    console.log(`[TTS Voice Types API] ${new Date().toISOString()} - Voice types retrieved successfully`);
    console.log(`[TTS Voice Types API] Available voice types: ${voiceCount || 0}`);
  } else {
    console.error(`[TTS Voice Types API] ${new Date().toISOString()} - Voice types retrieval failed: ${error}`);
  }
};

export async function GET(request: NextRequest) {
  try {
    logRequest();

    // 获取语言参数
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get('locale') || 'zh-CN';
    
    console.log(`[TTS Voice Types API] Request with locale: ${locale}`);

    // 调用后端服务
    console.log(`[TTS Voice Types API] Calling backend service: ${BACKEND_URL}/api/tts/voice-types?locale=${locale}`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/tts/voice-types?locale=${locale}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`[TTS Voice Types API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[TTS Voice Types API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Voice types service temporarily unavailable',
          data: {}
        },
        { status: 500 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    if (result.success) {
      const voiceCount = result.data ? Object.keys(result.data).length : 0;
      logResponse(true, voiceCount);
    } else {
      logResponse(false, undefined, result.message);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[TTS Voice Types API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        data: {}
      },
      { status: 500 }
    );
  }
} 