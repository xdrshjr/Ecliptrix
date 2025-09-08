'use client';

import React, { useState, useRef, useCallback } from 'react';
import { fileUploadService, FileUploadResult, UploadProgress, UploadType } from '../../services/fileUploadService';
import { VideoEditingLogger } from '../../utils';

interface FileUploadComponentProps {
  uploadType: UploadType;
  taskId?: string;
  onUploadComplete: (result: FileUploadResult) => void;
  onUploadError?: (error: string) => void;
  disabled?: boolean;
  className?: string;
}

const FileUploadComponent: React.FC<FileUploadComponentProps> = ({
  uploadType,
  taskId,
  onUploadComplete,
  onUploadError,
  disabled = false,
  className = ''
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadedFile, setUploadedFile] = useState<FileUploadResult | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logger = new VideoEditingLogger({ taskId: taskId || 'file-upload', component: 'FileUploadComponent' });

  const allowedTypes = fileUploadService.getAllowedFileTypes(uploadType);
  const displayName = fileUploadService.getUploadTypeDisplayName(uploadType);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return;

    const file = files[0];
    logger.info('File selected for upload', {
      filename: file.name,
      size: file.size,
      type: file.type,
      uploadType
    });

    // Validate file type
    if (!fileUploadService.isValidFileType(file, uploadType)) {
      const errorMessage = `请选择有效的${displayName}文件。支持的格式：${allowedTypes.join(', ')}`;
      logger.error('Invalid file type selected', new Error(errorMessage), {
        filename: file.name,
        fileType: file.type,
        allowedTypes
      });
      
      if (onUploadError) {
        onUploadError(errorMessage);
      }
      return;
    }

    setIsUploading(true);
    setUploadProgress(null);
    setUploadedFile(null);

    try {
      const result = await fileUploadService.uploadFile(
        file,
        uploadType,
        taskId,
        (progress) => {
          setUploadProgress(progress);
        }
      );

      if (result.success) {
        logger.info('File upload completed successfully', {
          filename: result.data?.filename,
          fileUrl: result.data?.file_url
        });
        
        setUploadedFile(result);
        onUploadComplete(result);
      } else {
        logger.error('File upload failed', new Error(result.message), {
          errorCode: result.error_code
        });
        
        if (onUploadError) {
          onUploadError(result.message);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传失败，请重试';
      logger.error('File upload error', error instanceof Error ? error : new Error(String(error)));
      
      if (onUploadError) {
        onUploadError(errorMessage);
      }
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  }, [uploadType, taskId, disabled, displayName, allowedTypes, onUploadComplete, onUploadError, logger]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isUploading) {
      setIsDragging(true);
    }
  }, [disabled, isUploading]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (!disabled && !isUploading) {
      handleFileSelect(e.dataTransfer.files);
    }
  }, [disabled, isUploading, handleFileSelect]);

  const handleClick = useCallback(() => {
    if (!disabled && !isUploading && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled, isUploading]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    // Reset input value to allow selecting the same file again
    e.target.value = '';
  }, [handleFileSelect]);


  const renderUploadArea = () => {
    if (uploadedFile && uploadedFile.success) {
      return (
        <div className="text-center p-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">上传成功</h3>
          <p className="text-sm text-gray-600 mb-4">
            文件名：<span className="font-mono text-blue-600">{uploadedFile.data?.filename}</span>
          </p>
          <p className="text-xs text-gray-500 mb-4">
            请将此文件名复制到相应的输入框中使用
          </p>
          <button
            onClick={handleClick}
            disabled={disabled}
            className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            重新上传
          </button>
        </div>
      );
    }

    if (isUploading) {
      return (
        <div className="text-center p-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">正在上传</h3>
          {uploadProgress && (
            <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress.percentage}%` }}
              ></div>
            </div>
          )}
          <p className="text-sm text-gray-600">
            {uploadProgress 
              ? `${uploadProgress.percentage}% (${fileUploadService.formatFileSize(uploadProgress.loaded)} / ${fileUploadService.formatFileSize(uploadProgress.total)})`
              : '准备上传...'}
          </p>
        </div>
      );
    }

    return (
      <div className="text-center p-6">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">上传{displayName}文件</h3>
        <p className="text-sm text-gray-600 mb-4">
          点击选择文件或拖拽文件到此区域
        </p>
        <p className="text-xs text-gray-500">
          支持格式：{allowedTypes.join(', ')}
        </p>
      </div>
    );
  };

  return (
    <div className={`file-upload-component ${className}`}>
      <div
        className={`
          relative border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200
          ${isDragging 
            ? 'border-blue-400 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${isUploading ? 'pointer-events-none' : ''}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        {renderUploadArea()}
        
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={allowedTypes.map(type => `.${type}`).join(',')}
          onChange={handleInputChange}
          disabled={disabled || isUploading}
        />
      </div>
    </div>
  );
};

export default FileUploadComponent;