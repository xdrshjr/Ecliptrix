import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (requestData: any) => {
  console.log(`[TTS Convert API] ${new Date().toISOString()} - TTS conversion request`);
  console.log(`[TTS Convert API] Text length: ${requestData.text?.length || 0}`);
  console.log(`[TTS Convert API] Voice type: ${requestData.voice_type}`);
  console.log(`[TTS Convert API] Speed ratio: ${requestData.speed_ratio}`);
  console.log(`[TTS Convert API] Segment ID: ${requestData.segment_id || 'N/A'}`);
  console.log(`[TTS Convert API] Task ID: ${requestData.task_id || 'N/A'}`);
};

const logResponse = (success: boolean, audioUrl?: string, error?: string) => {
  if (success) {
    console.log(`[TTS Convert API] ${new Date().toISOString()} - TTS conversion completed successfully`);
    console.log(`[TTS Convert API] Audio URL: ${audioUrl || 'N/A'}`);
  } else {
    console.error(`[TTS Convert API] ${new Date().toISOString()} - TTS conversion failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, voice_type, speed_ratio = 1.0, segment_id, task_id } = body;

    // 验证请求参数
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.error('[TTS Convert API] Invalid request: text is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Text content is required',
          data: null
        },
        { status: 400 }
      );
    }

    if (!voice_type || typeof voice_type !== 'string') {
      console.error('[TTS Convert API] Invalid request: voice_type is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Voice type is required',
          data: null
        },
        { status: 400 }
      );
    }

    if (typeof speed_ratio !== 'number' || speed_ratio <= 0 || speed_ratio > 3) {
      console.error('[TTS Convert API] Invalid request: invalid speed_ratio');
      return NextResponse.json(
        { 
          success: false,
          message: 'Speed ratio must be a number between 0 and 3',
          data: null
        },
        { status: 400 }
      );
    }

    const requestData = { 
      text: text.trim(), 
      voice_type, 
      speed_ratio,
      segment_id,
      task_id
    };
    logRequest(requestData);

    // 调用后端服务
    console.log(`[TTS Convert API] Calling backend service: ${BACKEND_URL}/api/tts/convert`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/tts/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[TTS Convert API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[TTS Convert API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'TTS service temporarily unavailable',
          data: null
        },
        { status: 500 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    if (result.success) {
      logResponse(true, result.data?.audio_url);
    } else {
      logResponse(false, undefined, result.message);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[TTS Convert API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        data: null
      },
      { status: 500 }
    );
  }
} 