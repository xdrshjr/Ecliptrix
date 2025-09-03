import { NextRequest, NextResponse } from 'next/server';

/**
 * Logging functions
 */
const logRequest = (filename: string) => {
  console.log(`[Digital Human Download API] Download requested for file: ${filename}`);
};

const logResponse = (success: boolean, filename: string, error?: string) => {
  if (success) {
    console.log(`[Digital Human Download API] File served successfully: ${filename}`);
  } else {
    console.error(`[Digital Human Download API] Download failed for ${filename}: ${error}`);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  let filename: string | undefined;
  
  try {
    const resolvedParams = await params;
    filename = resolvedParams.filename;

    if (!filename) {
      console.error('[Digital Human Download API] Invalid request: filename is required');
      return NextResponse.json(
        { error: 'Filename is required' },
        { status: 400 }
      );
    }

    logRequest(filename);

    // 调用ComfyUI API服务下载接口
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8001';
    console.log(`[Digital Human Download API] Calling ComfyUI service: ${comfyuiServiceUrl}/static/generated/${filename}`);
    
    const comfyuiResponse = await fetch(`${comfyuiServiceUrl}/static/generated/${filename}`, {
      method: 'GET',
    });

    console.log(`[Digital Human Download API] ComfyUI response status: ${comfyuiResponse.status}`);

    if (!comfyuiResponse.ok) {
      let errorMessage = `File not found or ComfyUI service error: ${comfyuiResponse.status}`;
      
      console.error(`[Digital Human Download API] ComfyUI error: ${errorMessage}`);
      logResponse(false, filename, errorMessage);

      if (comfyuiResponse.status === 404) {
        return NextResponse.json(
          { error: 'Video file not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          error: 'Digital human download service unavailable',
          message: errorMessage
        },
        { status: comfyuiResponse.status }
      );
    }

    // Get the file data
    const fileBuffer = await comfyuiResponse.arrayBuffer();
    const contentType = comfyuiResponse.headers.get('content-type') || 'video/mp4';
    
    console.log(`[Digital Human Download API] File retrieved successfully:`, {
      filename,
      size: fileBuffer.byteLength,
      contentType
    });

    logResponse(true, filename);

    // Return the file with appropriate headers
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileBuffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Digital Human Download API] Unexpected error:', error);
    logResponse(false, filename || 'unknown', errorMessage);

    return NextResponse.json(
      { error: 'Internal server error', message: errorMessage },
      { status: 500 }
    );
  }
} 