import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {

  try {
    const contentType = request.headers.get('content-type') || '';
    
    // 处理文件上传 (multipart/form-data)
    if (contentType.includes('multipart/form-data')) {
      console.log('[Video Analyze API] Processing file upload');
      
      const formData = await request.formData();
      const file = formData.get('video') as File | null;
      const frameInterval = formData.get('frame_interval') as string | null;
      const customPrompt = formData.get('custom_prompt') as string | null;
      const useThumbnail = formData.get('use_thumbnail') as string | null;
      const thumbnailUrl = formData.get('thumbnail_url') as string | null;
      const thumbnailFile = formData.get('thumbnail') as File | null;
      
      if (!file) {
        return NextResponse.json(
          { error: 'No video file provided' },
          { status: 400 }
        );
      }

      console.log('[Video Analyze API] File received:', {
        name: file.name,
        type: file.type,
        size: file.size,
        useThumbnail: useThumbnail === 'true',
        hasThumbnailUrl: !!thumbnailUrl
      });

      // 在服务器环境中，前端和后端可能运行在不同的容器中
      // 需要先将视频上传到 Supabase 以便后端可以访问
      console.log('[Video Analyze API] Uploading video to Supabase first...');
      
      // 创建上传请求的 FormData
      const uploadFormData = new FormData();
      uploadFormData.append('file', file);
      uploadFormData.append('task_id', `video_analysis_${Date.now()}`);
      uploadFormData.append('generate_thumbnail', 'false'); // 我们已经有缩略图了
      
      // 上传到 Supabase
      const uploadResponse = await fetch(`${BACKEND_URL}/api/supabase/upload-video`, {
        method: 'POST',
        body: uploadFormData,
      });
      
      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.json();
        console.error('[Video Analyze API] Failed to upload video to Supabase:', uploadError);
        throw new Error(`Failed to upload video: ${uploadError.message || 'Unknown error'}`);
      }
      
      const uploadResult = await uploadResponse.json();
      const videoUrl = uploadResult.video_url;
      
      console.log('[Video Analyze API] Video uploaded to Supabase:', videoUrl);

      // 处理缩略图文件（如果存在）
      let finalThumbnailUrl = thumbnailUrl;
      if (thumbnailFile && useThumbnail === 'true') {
        console.log('[Video Analyze API] Processing thumbnail file:', {
          name: thumbnailFile.name,
          type: thumbnailFile.type,
          size: thumbnailFile.size
        });
        
        // 将缩略图转换为 base64 以支持跨容器/服务器传输
        // 在服务器环境中，前端和后端可能在不同的容器/环境中运行
        // 它们的文件系统是隔离的，所以不能通过文件路径传递
        const thumbnailBytes = await thumbnailFile.arrayBuffer();
        const thumbnailBuffer = Buffer.from(thumbnailBytes);
        const thumbnailBase64 = thumbnailBuffer.toString('base64');
        
        // 使用 data URI 格式，后端已支持解析 base64 图片
        const mimeType = thumbnailFile.type || 'image/jpeg';
        finalThumbnailUrl = `data:${mimeType};base64,${thumbnailBase64}`;
        
        console.log('[Video Analyze API] Thumbnail converted to base64:', {
          originalSize: thumbnailFile.size,
          base64Length: thumbnailBase64.length,
          mimeType
        });
      }

      // 准备发送到 Python 后端的请求体
      const requestBody = {
        video_url: videoUrl,
        frame_interval: frameInterval ? parseInt(frameInterval) : undefined,
        custom_prompt: customPrompt || undefined,
        use_thumbnail: useThumbnail === 'true',
        thumbnail_url: finalThumbnailUrl || undefined
      };

      console.log('[Video Analyze API] Sending request to backend:', {
        video_url: videoUrl,
        frame_interval: requestBody.frame_interval,
        has_custom_prompt: !!customPrompt,
        use_thumbnail: requestBody.use_thumbnail,
        has_thumbnail_url: !!finalThumbnailUrl
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

      // 视频已上传到 Supabase，缩略图已转换为 base64
      // 不需要清理本地临时文件

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
        has_custom_prompt: !!body.custom_prompt,
        use_thumbnail: body.use_thumbnail,
        has_thumbnail_url: !!body.thumbnail_url
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
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 