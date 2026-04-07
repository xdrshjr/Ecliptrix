import { NextRequest, NextResponse } from 'next/server';
import { backendConfig } from '@/lib/config/backend';

// SWEEP-EXCEPTION: two-step upload-then-analyze with base64 thumbnail conversion
// ─────────────────────────────────────────────────────────────────────────
// Pattern E (counted toward the 5-route escape-hatch budget).
// This route does TWO sequential backend calls:
//   1. POST /api/storage/upload-video to put the video into backend storage
//   2. POST /api/video/analyze with the resulting URL
// Plus it converts an optional thumbnail file to a base64 data URI so it
// can cross the front/back container boundary. None of that fits the dumb
// `createPassthroughRoute` model. Both backend URLs use `backendConfig`.

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

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

      // Step 1: upload the video into backend storage so the analyze
      // endpoint can fetch it by URL.
      console.log('[Video Analyze API] Uploading video to storage first...');

      const uploadFormData = new FormData();
      uploadFormData.append('file', file);
      uploadFormData.append('task_id', `video_analysis_${Date.now()}`);
      uploadFormData.append('generate_thumbnail', 'false');

      // Forward Authorization on both backend calls
      const authHeader = request.headers.get('authorization');
      const authHeaders: Record<string, string> = {};
      if (authHeader) authHeaders['Authorization'] = authHeader;

      const uploadResponse = await fetch(
        backendConfig.joinPath('/api/storage/upload-video'),
        {
          method: 'POST',
          body: uploadFormData,
          headers: authHeaders,
        },
      );

      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.json();
        console.error('[Video Analyze API] Failed to upload video to storage:', uploadError);
        throw new Error(`Failed to upload video: ${uploadError.message || 'Unknown error'}`);
      }

      const uploadResult = await uploadResponse.json();
      const videoUrl = uploadResult.video_url;

      console.log('[Video Analyze API] Video uploaded to storage:', videoUrl);

      // Optional thumbnail → base64 data URI for cross-container transport.
      let finalThumbnailUrl = thumbnailUrl;
      if (thumbnailFile && useThumbnail === 'true') {
        console.log('[Video Analyze API] Processing thumbnail file:', {
          name: thumbnailFile.name,
          type: thumbnailFile.type,
          size: thumbnailFile.size
        });

        const thumbnailBytes = await thumbnailFile.arrayBuffer();
        const thumbnailBuffer = Buffer.from(thumbnailBytes);
        const thumbnailBase64 = thumbnailBuffer.toString('base64');

        const mimeType = thumbnailFile.type || 'image/jpeg';
        finalThumbnailUrl = `data:${mimeType};base64,${thumbnailBase64}`;

        console.log('[Video Analyze API] Thumbnail converted to base64:', {
          originalSize: thumbnailFile.size,
          base64Length: thumbnailBase64.length,
          mimeType
        });
      }

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

      // Step 2: actually analyze
      const response = await fetch(
        backendConfig.joinPath('/api/video/analyze'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify(requestBody),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          { error: data.detail || 'Video analysis failed' },
          { status: response.status }
        );
      }

      return NextResponse.json(data);

    } else {
      // JSON path — single backend call.
      console.log('[Video Analyze API] Processing JSON request');

      const body = await request.json();

      console.log('[Video Analyze API] Request body:', {
        video_url: body.video_url,
        frame_interval: body.frame_interval,
        has_custom_prompt: !!body.custom_prompt,
        use_thumbnail: body.use_thumbnail,
        has_thumbnail_url: !!body.thumbnail_url
      });

      const authHeader = request.headers.get('authorization');
      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) authHeaders['Authorization'] = authHeader;

      const response = await fetch(
        backendConfig.joinPath('/api/video/analyze'),
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(body),
        },
      );

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
