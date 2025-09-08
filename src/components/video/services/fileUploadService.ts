/**
 * File upload service for RunningHub integration
 */

import { VideoEditingLogger } from '../utils';

export interface FileUploadResult {
  success: boolean;
  message: string;
  data?: {
    filename: string;
    file_url?: string;
    file_size?: number;
    content_type?: string;
    task_id?: string;
  };
  error?: string;
  error_code?: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export type UploadType = 'img' | 'video' | 'audio';

class FileUploadService {
  private baseUrl: string;
  private logger: VideoEditingLogger;

  constructor() {
    // Use Next.js frontend URL to route through proxy API routes
    this.baseUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
    this.logger = new VideoEditingLogger({ 
      taskId: 'file-upload-service',
      component: 'FileUploadService' 
    });
  }

  /**
   * Upload a file to RunningHub through the backend proxy
   */
  async uploadFile(
    file: File,
    uploadType?: UploadType,
    taskId?: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<FileUploadResult> {
    try {
      this.logger.info('Starting file upload', {
        filename: file.name,
        size: file.size,
        type: file.type,
        uploadType,
        taskId
      });

      // Validate file type if uploadType is specified
      if (uploadType && !this.isValidFileType(file, uploadType)) {
        const allowedTypes = this.getAllowedFileTypes(uploadType);
        const errorMessage = `Invalid file type. Allowed types for ${uploadType}: ${allowedTypes.join(', ')}`;
        
        this.logger.error('File type validation failed', new Error(errorMessage), {
          filename: file.name,
          fileType: file.type,
          uploadType,
          allowedTypes
        });

        return {
          success: false,
          message: errorMessage,
          error_code: 'INVALID_FILE_TYPE'
        };
      }

      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      if (uploadType) formData.append('upload_type', uploadType);
      if (taskId) formData.append('task_id', taskId);

      // Create XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      
      return new Promise<FileUploadResult>((resolve, reject) => {
        // Set up progress handler
        if (onProgress) {
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const progress: UploadProgress = {
                loaded: event.loaded,
                total: event.total,
                percentage: Math.round((event.loaded / event.total) * 100)
              };
              onProgress(progress);
            }
          });
        }

        // Set up completion handler
        xhr.addEventListener('load', () => {
          try {
            if (xhr.status >= 200 && xhr.status < 300) {
              const result: FileUploadResult = JSON.parse(xhr.responseText);
              
              if (result.success) {
                this.logger.info('File uploaded successfully', {
                  filename: result.data?.filename,
                  fileUrl: result.data?.file_url,
                  taskId: result.data?.task_id
                });
              } else {
                this.logger.error('Upload failed', new Error(result.message), {
                  filename: file.name,
                  errorCode: result.error_code
                });
              }
              
              resolve(result);
            } else {
              let errorResult: FileUploadResult;
              try {
                errorResult = JSON.parse(xhr.responseText);
              } catch {
                errorResult = {
                  success: false,
                  message: `Upload failed with status ${xhr.status}`,
                  error_code: 'HTTP_ERROR'
                };
              }
              
              this.logger.error('Upload HTTP error', new Error(`${xhr.status} ${xhr.statusText}`), {
                filename: file.name,
                status: xhr.status,
                statusText: xhr.statusText
              });
              
              resolve(errorResult);
            }
          } catch (error) {
            this.logger.error('Error parsing upload response', error instanceof Error ? error : new Error(String(error)), {
              filename: file.name,
              responseText: xhr.responseText
            });
            
            reject(error);
          }
        });

        // Set up error handler
        xhr.addEventListener('error', () => {
          const error = new Error('Network error during file upload');
          this.logger.error('Upload network error', error, {
            filename: file.name
          });
          reject(error);
        });

        // Set up timeout handler
        xhr.addEventListener('timeout', () => {
          const error = new Error('File upload timeout');
          this.logger.error('Upload timeout', error, {
            filename: file.name
          });
          reject(error);
        });

        // Configure request
        xhr.timeout = 60000; // 60 seconds timeout
        xhr.open('POST', `${this.baseUrl}/api/files/upload`);

        // Start upload
        xhr.send(formData);
      });

    } catch (error) {
      this.logger.error('Error uploading file', error instanceof Error ? error : new Error(String(error)), {
        filename: file.name,
        uploadType,
        taskId
      });
      
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown upload error',
        error_code: 'UPLOAD_ERROR'
      };
    }
  }

  /**
   * Get allowed file types for upload type
   */
  getAllowedFileTypes(uploadType: UploadType): string[] {
    const typeMap = {
      img: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'],
      video: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'],
      audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg']
    };
    return typeMap[uploadType] || [];
  }

  /**
   * Check if file type is valid for upload type
   */
  isValidFileType(file: File, uploadType: UploadType): boolean {
    if (!file.name) return false;
    
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension) return false;
    
    const allowedTypes = this.getAllowedFileTypes(uploadType);
    return allowedTypes.includes(extension);
  }

  /**
   * Get human-readable file size
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Check if workflow requires file upload
   */
  getRequiredUploadTypes(workflow: { needUploadImg?: string; needUploadVideo?: string; needUploadAudio?: string }): UploadType[] {
    const requiredTypes: UploadType[] = [];
    
    if (workflow.needUploadImg === 'True') requiredTypes.push('img');
    if (workflow.needUploadVideo === 'True') requiredTypes.push('video');
    if (workflow.needUploadAudio === 'True') requiredTypes.push('audio');
    
    return requiredTypes;
  }

  /**
   * Get upload type display name
   */
  getUploadTypeDisplayName(uploadType: UploadType): string {
    const displayNames = {
      img: '图片',
      video: '视频',
      audio: '音频'
    };
    return displayNames[uploadType] || uploadType;
  }
}

// Export singleton instance
export const fileUploadService = new FileUploadService();