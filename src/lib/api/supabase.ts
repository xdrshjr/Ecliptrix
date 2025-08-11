/**
 * Supabase API client functions
 * 用于与后端Supabase服务通信的客户端函数
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export interface VideoUploadRequest {
  file: File;
  taskId?: string;
  customFilename?: string;
  generateThumbnail?: boolean;
}

export interface VideoUploadResponse {
  success: boolean;
  message: string;
  video_url: string;
  file_path: string;
  file_size: number;
  duration?: number;
  width?: number;
  height?: number;
  thumbnail_url?: string;
  task_id?: string;
  upload_time: string;
  metadata?: Record<string, any>;
}

export interface VideoUploadErrorResponse {
  success: false;
  message: string;
  error_code: string;
  details?: Record<string, any>;
}

export interface FileUploadResponse {
  success: boolean;
  message: string;
  file_url: string;
  file_path: string;
  file_size: number;
  upload_time: string;
}

export interface FileUploadErrorResponse {
  success: false;
  message: string;
  error_code: string;
  details?: Record<string, any>;
}

/**
 * Upload video file to Supabase
 * 上传视频文件到Supabase存储桶
 */
export async function uploadVideoToSupabase(
  request: VideoUploadRequest
): Promise<VideoUploadResponse | VideoUploadErrorResponse> {
  try {
    console.log('[Supabase API] 发送视频上传请求', {
      fileName: request.file.name,
      fileSize: request.file.size,
      taskId: request.taskId,
      generateThumbnail: request.generateThumbnail
    });

    const formData = new FormData();
    formData.append('file', request.file);
    
    if (request.taskId) {
      formData.append('task_id', request.taskId);
    }
    
    if (request.customFilename) {
      formData.append('custom_filename', request.customFilename);
    }
    
    if (request.generateThumbnail !== undefined) {
      formData.append('generate_thumbnail', request.generateThumbnail.toString());
    }

    const response = await fetch(`${API_BASE_URL}/api/supabase/upload-video`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    console.log('[Supabase API] 视频上传响应', {
      success: result.success,
      video_url: result.success ? result.video_url : null,
      thumbnail_url: result.success ? result.thumbnail_url : null,
      file_size: result.success ? result.file_size : null,
      message: result.message
    });

    return result;
  } catch (error) {
    console.error('[Supabase API] 视频上传请求失败', {
      error: error instanceof Error ? error.message : String(error),
      fileName: request.file.name
    });
    
    return {
      success: false,
      message: `视频上传失败: ${error instanceof Error ? error.message : String(error)}`,
      error_code: 'NETWORK_ERROR'
    };
  }
}

/**
 * Upload file to Supabase (generic file upload)
 * 上传文件到Supabase存储桶（通用文件上传）
 */
export async function uploadFileToSupabase(
  file: File,
  taskId?: string,
  bucketPath?: string
): Promise<FileUploadResponse | FileUploadErrorResponse> {
  try {
    console.log('[Supabase API] 发送文件上传请求', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      taskId,
      bucketPath
    });

    const formData = new FormData();
    formData.append('file', file);
    
    if (taskId) {
      formData.append('task_id', taskId);
    }
    
    if (bucketPath) {
      formData.append('bucket_path', bucketPath);
    }

    const response = await fetch(`${API_BASE_URL}/api/supabase/upload-file`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    console.log('[Supabase API] 文件上传响应', {
      success: result.success,
      file_url: result.success ? result.file_url : null,
      file_size: result.success ? result.file_size : null,
      message: result.message
    });

    return result;
  } catch (error) {
    console.error('[Supabase API] 文件上传请求失败', {
      error: error instanceof Error ? error.message : String(error),
      fileName: file.name
    });
    
    return {
      success: false,
      message: `文件上传失败: ${error instanceof Error ? error.message : String(error)}`,
      error_code: 'NETWORK_ERROR'
    };
  }
}

/**
 * Download file from URL and return as Blob
 * 从URL下载文件并返回Blob对象
 */
export async function downloadFileFromUrl(url: string, filename?: string): Promise<Blob> {
  try {
    console.log('[Supabase API] 开始下载文件', {
      url: url.substring(0, 100) + (url.length > 100 ? '...' : ''),
      filename
    });

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    console.log('[Supabase API] 文件下载成功', {
      filename,
      blobSize: blob.size,
      blobType: blob.type
    });

    return blob;
  } catch (error) {
    console.error('[Supabase API] 文件下载失败', {
      error: error instanceof Error ? error.message : String(error),
      url: url.substring(0, 100) + (url.length > 100 ? '...' : ''),
      filename
    });
    throw error;
  }
} 