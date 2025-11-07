import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const contentType = request.headers.get('content-type') || '';
    
    // 处理文件上传 (multipart/form-data)
    if (contentType.includes('multipart/form-data')) {
      console.log('[Video Analyze API] Processing file upload');
      
      const formData = await request.formData();
      const file = formData.get('video') as File | null;
      const frameInterval = formData.get('frame_interval') as string | null;
      const customPrompt = formData.get('custom_prompt') as string | null;
      
      if (!file) {
        return NextResponse.json(
          { error: 'No video file provided' },
          { status: 400 }
        );
      }

      console.log('[Video Analyze API] File received:', {
        name: file.name,
        type: file.type,
        size: file.size
      });

      // 保存文件到临时目录
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      
      // 使用时间戳和随机数生成唯一文件名
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 15);
      const fileExtension = file.name.split('.').pop() || 'mp4';
      const fileName = `video_${timestamp}_${randomStr}.${fileExtension}`;
      tempFilePath = join(tmpdir(), fileName);
      
      await writeFile(tempFilePath, buffer);
      console.log('[Video Analyze API] File saved to temp:', tempFilePath);

      // 准备发送到 Python 后端的请求体
      const requestBody = {
        video_url: tempFilePath,
        frame_interval: frameInterval ? parseInt(frameInterval) : undefined,
        custom_prompt: customPrompt || undefined
      };

      console.log('[Video Analyze API] Sending request to backend:', {
        video_url: tempFilePath,
        frame_interval: requestBody.frame_interval,
        has_custom_prompt: !!customPrompt
      });

      // 代理请求到 Python 后台服务
      const response = await fetch(`${BACKEND_URL}/api/video/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      // 清理临时文件
      if (tempFilePath) {
        try {
          await unlink(tempFilePath);
          console.log('[Video Analyze API] Temp file cleaned up:', tempFilePath);
        } catch (cleanupError) {
          console.error('[Video Analyze API] Failed to cleanup temp file:', cleanupError);
        }
      }

      if (!response.ok) {
        return NextResponse.json(
          { error: data.detail || 'Video analysis failed' },
          { status: response.status }
        );
      }

      return NextResponse.json(data);
      
    } else {
      // 处理 JSON 请求 (用于 URL)
      console.log('[Video Analyze API] Processing JSON request');
      
      const body = await request.json();
      
      console.log('[Video Analyze API] Request body:', {
        video_url: body.video_url,
        frame_interval: body.frame_interval,
        has_custom_prompt: !!body.custom_prompt
      });
      
      // 代理请求到后台服务
      const response = await fetch(`${BACKEND_URL}/api/video/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          { error: data.detail || 'Video analysis failed' },
          { status: response.status }
        );
      }

      return NextResponse.json(data);
    }
    
  } catch (error) {
    console.error('[Video Analyze API] Error:', error);
    
    // 清理临时文件（如果存在）
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
        console.log('[Video Analyze API] Temp file cleaned up after error:', tempFilePath);
      } catch (cleanupError) {
        console.error('[Video Analyze API] Failed to cleanup temp file after error:', cleanupError);
      }
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 