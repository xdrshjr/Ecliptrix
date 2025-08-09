import { NextRequest, NextResponse } from 'next/server';
import { TimelineState, MaterialItem } from '@/types';

interface VideoSequenceItem {
  id: string;
  name: string;
  url: string;
  startTime: number;
  duration: number;
  thumbnailUrl?: string;
  materialId?: string;
  trackId: string;
}

interface CompositionInfo {
  totalDuration: number;
  videoSequencesCount: number;
  videoSequences: VideoSequenceItem[];
}

/**
 * 从时间轴状态提取视频序列
 */
function extractVideoSequencesFromTimeline(
  timelineState: TimelineState,
  materials: MaterialItem[]
): VideoSequenceItem[] {
  console.log(`[VideoCompositionAPI] 提取视频序列`, {
    tracksCount: timelineState.tracks.length,
    materialsCount: materials.length,
    totalDuration: timelineState.totalDuration,
    timestamp: new Date().toISOString()
  });

  const allVideoItems: VideoSequenceItem[] = [];
  
  timelineState.tracks.forEach(track => {
    if (track.type === 'video' && track.isVisible && !track.isLocked) {
      track.items.forEach(item => {
        if (item.type === 'video' && item.materialId) {
          // 找到对应的素材
          const material = materials.find(m => m.id === item.materialId);
          if (material && material.type === 'video') {
            const videoSequence: VideoSequenceItem = {
              id: item.id,
              name: item.name,
              url: material.url,
              startTime: item.startTime,
              duration: item.duration,
              thumbnailUrl: item.thumbnailUrl || material.thumbnailUrl,
              materialId: item.materialId,
              trackId: item.trackId
            };
            allVideoItems.push(videoSequence);
            
            console.log(`[VideoCompositionAPI] 添加视频序列`, {
              itemId: item.id,
              itemName: item.name,
              startTime: item.startTime,
              duration: item.duration,
              materialUrl: material.url,
              trackId: item.trackId
            });
          }
        }
      });
    }
  });

  // 按开始时间排序
  const sortedVideoItems = allVideoItems.sort((a, b) => a.startTime - b.startTime);
  
  console.log(`[VideoCompositionAPI] 视频序列提取完成`, {
    totalVideoSequences: sortedVideoItems.length,
    sequences: sortedVideoItems.map(seq => ({
      id: seq.id,
      name: seq.name,
      startTime: seq.startTime,
      duration: seq.duration
    }))
  });

  return sortedVideoItems;
}

/**
 * POST /api/video-composition
 * 更新时间轴组合数据并返回视频序列信息
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    console.log(`[VideoCompositionAPI] 接收POST请求`, {
      method: 'POST',
      url: request.url,
      timestamp: new Date().toISOString()
    });

    const body = await request.json();
    const { taskId, timelineState, materials } = body;

    // 参数验证
    if (!taskId || typeof taskId !== 'string') {
      console.warn(`[VideoCompositionAPI] 缺少或无效的taskId`, { taskId });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing or invalid taskId',
            details: { field: 'taskId', received: taskId }
          },
          timestamp: new Date().toISOString()
        },
        { status: 400 }
      );
    }

    if (!timelineState || !timelineState.tracks) {
      console.warn(`[VideoCompositionAPI] 缺少或无效的时间轴数据`, { 
        hasTimelineState: !!timelineState,
        hasTracks: !!timelineState?.tracks 
      });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing or invalid timeline state',
            details: { field: 'timelineState.tracks' }
          },
          timestamp: new Date().toISOString()
        },
        { status: 400 }
      );
    }

    if (!materials || !Array.isArray(materials)) {
      console.warn(`[VideoCompositionAPI] 缺少或无效的素材数据`, { 
        hasMaterials: !!materials,
        isArray: Array.isArray(materials) 
      });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing or invalid materials array',
            details: { field: 'materials' }
          },
          timestamp: new Date().toISOString()
        },
        { status: 400 }
      );
    }

    // 提取视频序列
    const videoSequences = extractVideoSequencesFromTimeline(timelineState, materials);
    const totalDuration = videoSequences.reduce((total, seq) => total + seq.duration, 0);

    const compositionInfo: CompositionInfo = {
      totalDuration,
      videoSequencesCount: videoSequences.length,
      videoSequences
    };

    const processingTime = Date.now() - startTime;

    console.log(`[VideoCompositionAPI] 组合处理完成`, {
      taskId,
      videoSequencesCount: videoSequences.length,
      totalDuration,
      processingTime,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        compositionInfo,
        processingTime,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    console.error(`[VideoCompositionAPI] 处理请求时发生错误`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      processingTime,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error occurred',
          details: {
            errorId: `err_${Date.now()}`,
            processingTime
          }
        },
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/video-composition?taskId=xxx
 * 获取指定任务的视频组合信息（示例实现）
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    console.log(`[VideoCompositionAPI] 接收GET请求`, {
      method: 'GET',
      taskId,
      timestamp: new Date().toISOString()
    });

    if (!taskId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing taskId parameter',
            details: { field: 'taskId' }
          },
          timestamp: new Date().toISOString()
        },
        { status: 400 }
      );
    }

    // 这里应该从数据库或缓存中获取任务的组合信息
    // 目前返回示例数据
    const mockCompositionInfo: CompositionInfo = {
      totalDuration: 0,
      videoSequencesCount: 0,
      videoSequences: []
    };

    const processingTime = Date.now() - startTime;

    console.log(`[VideoCompositionAPI] GET请求处理完成`, {
      taskId,
      processingTime,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        compositionInfo: mockCompositionInfo,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    console.error(`[VideoCompositionAPI] GET请求处理错误`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      processingTime,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error occurred',
          details: {
            errorId: `err_${Date.now()}`,
            processingTime
          }
        },
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 