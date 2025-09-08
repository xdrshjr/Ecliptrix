import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';

/**
 * POST /api/files/upload
 * 
 * Proxy endpoint to upload files to the backend service for RunningHub integration
 */
export async function POST(request: NextRequest) {
  try {
    console.log('Processing file upload request');
    
    // Get the form data from the request
    const formData = await request.formData();
    
    // Log upload details (without logging file content)
    const file = formData.get('file') as File;
    const taskId = formData.get('task_id') as string;
    const uploadType = formData.get('upload_type') as string;
    
    console.log('File upload details:', {
      filename: file?.name,
      size: file?.size,
      type: file?.type,
      taskId,
      uploadType
    });
    
    // Validate that we have a file
    if (!file) {
      console.error('No file provided in upload request');
      return NextResponse.json(
        {
          success: false,
          message: 'No file provided',
          error: 'FILE_REQUIRED'
        },
        { status: 400 }
      );
    }
    
    // Forward the form data to the backend service
    const backendFormData = new FormData();
    backendFormData.append('file', file);
    if (taskId) backendFormData.append('task_id', taskId);
    if (uploadType) backendFormData.append('upload_type', uploadType);
    
    const response = await fetch(`${BACKEND_BASE_URL}/api/files/upload`, {
      method: 'POST',
      body: backendFormData,
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(60000), // 60 seconds timeout for file uploads
    });

    if (!response.ok) {
      console.error(`Backend file upload request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to upload file to backend service',
          error: `Backend service returned ${response.status}: ${response.statusText}`,
          error_details: errorText
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Log successful upload
    if (data.success) {
      console.log(`File uploaded successfully: ${data.data?.filename}`, {
        filename: data.data?.filename,
        fileUrl: data.data?.file_url,
        taskId: data.data?.task_id
      });
    }

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    
    // Handle timeout errors specifically
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        {
          success: false,
          message: 'File upload timeout - please try again with a smaller file',
          error: 'UPLOAD_TIMEOUT'
        },
        { status: 408 }
      );
    }
    
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error while uploading file',
        error: error instanceof Error ? error.message : 'Unknown error',
        error_code: 'PROXY_ERROR'
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}