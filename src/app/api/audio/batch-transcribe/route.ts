import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (data: any) => {
  console.log(`[Audio Batch Transcribe API] Request received:`, {
    audioItemsCount: data.audio_items?.length || 0,
    language: data.language,
    timestamp: new Date().toISOString()
  });
};

const logResponse = (success: boolean, data?: any, error?: string) => {
  if (success) {
    console.log(`[Audio Batch Transcribe API] Request successful:`, {
      totalItems: data?.total_items,
      successfulItems: data?.successful_items,
      failedItems: data?.failed_items,
      processingTime: data?.total_processing_time
    });
  } else {
    console.error(`[Audio Batch Transcribe API] Request failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      audio_items, 
      language = 'zh-CN', 
      use_itn = true, 
      use_punc = false, 
      max_lines = 2, 
      words_per_line = 15, 
      generate_srt_file = true 
    } = body;

    // 验证请求参数
    if (!audio_items || !Array.isArray(audio_items) || audio_items.length === 0) {
      console.error('[Audio Batch Transcribe API] Invalid request: audio_items is required and must be a non-empty array');
      return NextResponse.json(
        { 
          success: false,
          error: 'Audio items are required and must be a non-empty array',
          error_code: 'INVALID_REQUEST'
        },
        { status: 400 }
      );
    }

    // 验证每个音频项目的格式
    for (const item of audio_items) {
      if (!item.id || !item.name || !item.url || typeof item.start_time !== 'number' || typeof item.duration !== 'number' || !item.track_id) {
        console.error('[Audio Batch Transcribe API] Invalid audio item format:', item);
        return NextResponse.json(
          { 
            success: false,
            error: 'Each audio item must have id, name, url, start_time, duration, and track_id',
            error_code: 'INVALID_AUDIO_ITEM'
          },
          { status: 400 }
        );
      }
    }

    const requestData = { 
      audio_items,
      language,
      use_itn,
      use_punc,
      max_lines,
      words_per_line,
      generate_srt_file
    };
    logRequest(requestData);

    // 调用后端服务
    console.log(`[Audio Batch Transcribe API] Calling backend service: ${BACKEND_URL}/api/audio/batch-transcribe`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/audio/batch-transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[Audio Batch Transcribe API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Audio Batch Transcribe API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          error: 'Audio batch transcription service temporarily unavailable',
          error_code: 'BACKEND_ERROR'
        },
        { status: 500 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    if (result.success) {
      logResponse(true, result);
    } else {
      logResponse(false, undefined, result.error);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[Audio Batch Transcribe API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error',
        error_code: 'INTERNAL_ERROR'
      },
      { status: 500 }
    );
  }
} 