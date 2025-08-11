import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (requestData: any) => {
  console.log(`[TTS Batch Convert API] ${new Date().toISOString()} - Batch TTS conversion request`);
  console.log(`[TTS Batch Convert API] Segments count: ${requestData.segments?.length || 0}`);
  console.log(`[TTS Batch Convert API] Voice type: ${requestData.voice_type}`);
  console.log(`[TTS Batch Convert API] Speed ratio: ${requestData.speed_ratio}`);
  console.log(`[TTS Batch Convert API] Task ID: ${requestData.task_id || 'N/A'}`);
  console.log(`[TTS Batch Convert API] Concurrent threads: ${requestData.concurrent_threads || 'default'}`);
  console.log(`[TTS Batch Convert API] Total text length: ${requestData.segments?.reduce((sum: number, seg: any) => sum + (seg.text?.length || 0), 0) || 0} characters`);
};

const logResponse = (success: boolean, data?: any, error?: string) => {
  if (success) {
    console.log(`[TTS Batch Convert API] ${new Date().toISOString()} - Batch TTS conversion completed successfully`);
    console.log(`[TTS Batch Convert API] Total segments: ${data?.total_segments || 0}`);
    console.log(`[TTS Batch Convert API] Successful segments: ${data?.successful_segments || 0}`);
    console.log(`[TTS Batch Convert API] Failed segments: ${data?.failed_segments || 0}`);
    console.log(`[TTS Batch Convert API] Processing time: ${data?.total_processing_time || 'N/A'}s`);
  } else {
    console.error(`[TTS Batch Convert API] ${new Date().toISOString()} - Batch TTS conversion failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { segments, voice_type, speed_ratio = 1.0, task_id, concurrent_threads } = body;

    // 验证请求参数
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      console.error('[TTS Batch Convert API] Invalid request: segments array is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Segments array is required',
          data: {
            results: [],
            total_segments: 0,
            successful_segments: 0,
            failed_segments: 0
          }
        },
        { status: 400 }
      );
    }

    if (!voice_type || typeof voice_type !== 'string') {
      console.error('[TTS Batch Convert API] Invalid request: voice_type is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Voice type is required',
          data: {
            results: [],
            total_segments: 0,
            successful_segments: 0,
            failed_segments: 0
          }
        },
        { status: 400 }
      );
    }

    if (typeof speed_ratio !== 'number' || speed_ratio <= 0 || speed_ratio > 3) {
      console.error('[TTS Batch Convert API] Invalid request: invalid speed_ratio');
      return NextResponse.json(
        { 
          success: false,
          message: 'Speed ratio must be a number between 0 and 3',
          data: {
            results: [],
            total_segments: 0,
            successful_segments: 0,
            failed_segments: 0
          }
        },
        { status: 400 }
      );
    }

    // 验证segments格式
    for (const segment of segments) {
      if (!segment.segment_id || !segment.text || typeof segment.text !== 'string') {
        console.error('[TTS Batch Convert API] Invalid segment format');
        return NextResponse.json(
          { 
            success: false,
            message: 'Each segment must have segment_id and text',
            data: {
              results: [],
              total_segments: 0,
              successful_segments: 0,
              failed_segments: 0
            }
          },
          { status: 400 }
        );
      }
    }

    const requestData = { 
      segments, 
      voice_type, 
      speed_ratio,
      task_id,
      concurrent_threads
    };
    logRequest(requestData);

    // 调用后端服务
    console.log(`[TTS Batch Convert API] Calling backend service: ${BACKEND_URL}/api/tts/convert-batch`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/tts/convert-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[TTS Batch Convert API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[TTS Batch Convert API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Batch TTS service temporarily unavailable',
          data: {
            results: [],
            total_segments: 0,
            successful_segments: 0,
            failed_segments: 0
          }
        },
        { status: 500 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    if (result.success) {
      logResponse(true, result.data);
    } else {
      logResponse(false, undefined, result.message);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[TTS Batch Convert API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        data: {
          results: [],
          total_segments: 0,
          successful_segments: 0,
          failed_segments: 0
        }
      },
      { status: 500 }
    );
  }
} 