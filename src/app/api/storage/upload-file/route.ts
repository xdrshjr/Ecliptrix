import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/storage/upload-file
 *
 * Proxy endpoint to upload files through the backend storage service
 * 代理端点，通过后端存储服务上传文件
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Storage Upload File API] 接收到文件上传请求', {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent')?.slice(0, 100)
    });

    // Get the form data from the request
    const formData = await request.formData();

    // Log request details (without file content)
    const file = formData.get('file') as File;
    const taskId = formData.get('task_id') as string;
    const bucketPath = formData.get('bucket_path') as string;
    const segmentId = formData.get('segment_id') as string;

    console.log('[Storage Upload File API] 请求参数', {
      fileName: file?.name,
      fileSize: file?.size,
      fileType: file?.type,
      taskId,
      bucketPath,
      segmentId
    });

    if (!file) {
      console.error('[Storage Upload File API] 缺少文件参数');
      return NextResponse.json(
        {
          success: false,
          message: '缺少文件参数',
          error_code: 'MISSING_FILE'
        },
        { status: 400 }
      );
    }

    // Forward the request to the backend service
    console.log(`[Storage Upload File API] 转发请求到后端服务: ${BACKEND_URL}/api/storage/upload-file`);

    const backendResponse = await fetch(`${BACKEND_URL}/api/storage/upload-file`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type header, let fetch handle it for FormData
      signal: AbortSignal.timeout(60000), // 60 seconds timeout for file uploads
    });

    console.log(`[Storage Upload File API] 后端响应状态: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Storage Upload File API] 后端服务错误: ${backendResponse.status} - ${errorText}`);

      return NextResponse.json(
        {
          success: false,
          message: '文件上传服务暂时不可用',
          error_code: 'BACKEND_ERROR',
          details: {
            status: backendResponse.status,
            statusText: backendResponse.statusText
          }
        },
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();

    // Log successful response
    if (result.success) {
      console.log('[Storage Upload File API] 文件上传成功', {
        fileName: file.name,
        fileUrl: result.file_url,
        fileSize: result.file_size,
        taskId,
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('[Storage Upload File API] 文件上传失败', {
        fileName: file.name,
        error: result.message,
        errorCode: result.error_code,
        taskId
      });
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[Storage Upload File API] 请求处理错误:', error);

    return NextResponse.json(
      {
        success: false,
        message: '内部服务器错误',
        error_code: 'INTERNAL_ERROR',
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      },
      { status: 500 }
    );
  }
}
