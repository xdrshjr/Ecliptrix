import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/digital-human-generation/upload
 * 
 * Upload files (video and audio) for digital human generation
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Digital Human Upload API] Upload request received');
    
    const formData = await request.formData();
    const videoFile = formData.get('video') as File | null;
    const audioFile = formData.get('audio') as File | null;
    
    if (!videoFile && !audioFile) {
      console.error('[Digital Human Upload API] Missing files:', {
        hasVideo: !!videoFile,
        hasAudio: !!audioFile
      });
      return NextResponse.json(
        { error: 'At least one file (video or audio) must be provided' },
        { status: 400 }
      );
    }

    console.log('[Digital Human Upload API] Files received:', {
      videoName: videoFile?.name,
      videoSize: videoFile?.size,
      audioName: audioFile?.name,
      audioSize: audioFile?.size
    });

    // 创建新的FormData用于转发到ComfyUI服务
    const comfyuiFormData = new FormData();
    const timestamp = Date.now();
    let videoFilename = '';
    let audioFilename = '';

    // 处理视频文件
    if (videoFile) {
      videoFilename = `${timestamp}_${videoFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      comfyuiFormData.append('video', videoFile, videoFilename);
    }

    // 处理音频文件
    if (audioFile) {
      audioFilename = `${timestamp}_${audioFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      comfyuiFormData.append('audio', audioFile, audioFilename);
    }

    console.log('[Digital Human Upload API] Generated filenames:', {
      videoFilename: videoFilename || 'none',
      audioFilename: audioFilename || 'none'
    });

    // 上传到ComfyUI服务
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8001';

    console.log(`[Digital Human Upload API] Uploading to ComfyUI service: ${comfyuiServiceUrl}/api/v1/upload-files`);

    const uploadResponse = await fetch(`${comfyuiServiceUrl}/api/v1/upload-files`, {
      method: 'POST',
      body: comfyuiFormData,
    });

    console.log(`[Digital Human Upload API] ComfyUI upload response status: ${uploadResponse.status}`);

    if (!uploadResponse.ok) {
      let errorMessage = `ComfyUI upload error: ${uploadResponse.status}`;
      try {
        const errorData = await uploadResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[Digital Human Upload API] Failed to parse error response:', parseError);
      }

      console.error(`[Digital Human Upload API] Upload failed: ${errorMessage}`);
      return NextResponse.json(
        {
          error: 'File upload failed',
          message: errorMessage
        },
        { status: uploadResponse.status }
      );
    }

    const uploadResult = await uploadResponse.json();
    console.log('[Digital Human Upload API] Upload successful:', uploadResult);

    // 构建响应，只包含实际上传的文件信息
    const response: any = {
      success: true,
      message: 'Files uploaded successfully'
    };

    if (uploadResult.video_filename) {
      response.video_filename = uploadResult.video_filename;
    }
    if (uploadResult.audio_filename) {
      response.audio_filename = uploadResult.audio_filename;
    }

    return NextResponse.json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Digital Human Upload API] Unexpected error:', error);

    return NextResponse.json(
      { error: 'Internal server error', message: errorMessage },
      { status: 500 }
    );
  }
} 