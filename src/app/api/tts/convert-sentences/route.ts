import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (requestData: any) => {
  console.log(`[Sentence TTS API] ${new Date().toISOString()} - Sentence-level TTS conversion request`);
  console.log(`[Sentence TTS API] Segment ID: ${requestData.segment_id}`);
  console.log(`[Sentence TTS API] Sentences count: ${requestData.sentences?.length || 0}`);
  console.log(`[Sentence TTS API] Voice type: ${requestData.voice_type}`);
  console.log(`[Sentence TTS API] Speed ratio: ${requestData.speed_ratio}`);
  console.log(`[Sentence TTS API] Task ID: ${requestData.task_id || 'N/A'}`);
  console.log(`[Sentence TTS API] Concurrent threads: ${requestData.concurrent_threads || 'default'}`);
};

const logResponse = (success: boolean, segmentId: string, concatenatedAudioUrl?: string, error?: string) => {
  if (success) {
    console.log(`[Sentence TTS API] ${new Date().toISOString()} - Sentence-level TTS conversion completed successfully`);
    console.log(`[Sentence TTS API] Segment ID: ${segmentId}`);
    console.log(`[Sentence TTS API] Concatenated Audio URL: ${concatenatedAudioUrl || 'N/A'}`);
  } else {
    console.error(`[Sentence TTS API] ${new Date().toISOString()} - Sentence-level TTS conversion failed: ${error}`);
    console.error(`[Sentence TTS API] Segment ID: ${segmentId}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      segment_id, 
      sentences, 
      voice_type, 
      speed_ratio = 1.0, 
      task_id, 
      concurrent_threads 
    } = body;

    // 验证请求参数
    if (!segment_id || typeof segment_id !== 'string') {
      console.error('[Sentence TTS API] Invalid request: segment_id is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Segment ID is required',
          data: null
        },
        { status: 400 }
      );
    }

    if (!sentences || !Array.isArray(sentences) || sentences.length === 0) {
      console.error('[Sentence TTS API] Invalid request: sentences array is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Sentences array is required and must not be empty',
          data: null
        },
        { status: 400 }
      );
    }

    // 验证句子结构
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if (!sentence.sentence_id || !sentence.text || typeof sentence.order !== 'number') {
        console.error(`[Sentence TTS API] Invalid sentence at index ${i}:`, sentence);
        return NextResponse.json(
          { 
            success: false,
            message: `Invalid sentence at index ${i}: sentence_id, text, and order are required`,
            data: null
          },
          { status: 400 }
        );
      }
    }

    if (!voice_type || typeof voice_type !== 'string') {
      console.error('[Sentence TTS API] Invalid request: voice_type is required');
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
      console.error('[Sentence TTS API] Invalid request: invalid speed_ratio');
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
      segment_id,
      sentences,
      voice_type, 
      speed_ratio,
      task_id,
      concurrent_threads
    };
    logRequest(requestData);

    // 调用后端服务
    console.log(`[Sentence TTS API] Calling backend service: ${BACKEND_URL}/api/tts/convert-sentences`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/tts/convert-sentences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[Sentence TTS API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Sentence TTS API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, segment_id, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Sentence-level TTS service temporarily unavailable',
          data: null
        },
        { status: 500 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    if (result.success) {
      logResponse(true, result.segment_id, result.concatenated_audio_url);
    } else {
      logResponse(false, result.segment_id, undefined, result.message);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[Sentence TTS API] Request processing error:', error);
    logResponse(false, 'unknown', undefined, String(error));
    
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