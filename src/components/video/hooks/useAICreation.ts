/**
 * Hook for managing AI creation workflow operations
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { workflowService, WorkflowInfo, WorkflowParameter, WorkflowExecutionResult, WorkflowError } from '../services/workflowService';
import { VideoEditingLogger } from '../utils';
import { MaterialItem, MaterialType } from '@/types';
import { uploadVideoToSupabase, uploadFileToSupabase } from '@/lib/api/supabase';

export interface UseAICreationReturn {
  // Modal state
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;

  // Workflow data
  workflows: WorkflowInfo[];
  selectedWorkflow: WorkflowInfo | null;
  isLoadingWorkflows: boolean;
  workflowsError: string | null;

  // UI state
  isParameterMode: boolean;
  parameters: Record<string, any>;
  validationErrors: string[];

  // Actions
  handleWorkflowSelect: (workflow: WorkflowInfo) => void;
  handleBackToWorkflows: () => void;
  setParameter: (nodeId: string, value: any) => void;
  handleStartCreation: (addMaterial: (material: MaterialItem) => boolean) => Promise<void>;

  // Execution state
  isExecuting: boolean;
  executionResult: WorkflowExecutionResult | null;
  executionError: string | null;

  // Utility
  taskId: string;
}

// Helper function to determine material type from workflow type
const getMaterialTypeFromWorkflowType = (workflowType: string): MaterialType => {
  if (workflowType.endsWith('-VIDEO')) {
    return 'video';
  } else if (workflowType.endsWith('-IMG') || workflowType.endsWith('-IMAGE')) {
    return 'image';
  } else if (workflowType.endsWith('-AUDIO')) {
    return 'audio';
  } else {
    // Default to image for unknown types
    return 'image';
  }
};

export const useAICreation = (taskId: string): UseAICreationReturn => {
  const logger = new VideoEditingLogger({ taskId, component: 'useAICreation' });

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Workflow data
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowInfo | null>(null);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState<boolean>(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  // UI state
  const [isParameterMode, setIsParameterMode] = useState<boolean>(false);
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Execution state
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<WorkflowExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Task polling state
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTaskRef = useRef<{ runninghubTaskId: string; addMaterial: (material: MaterialItem) => boolean; startTime: number; pollCount: number; resultsProcessed: boolean } | null>(null);
  
  // Polling configuration
  const MAX_POLLING_TIME = 30 * 60 * 1000; // 30 minutes maximum
  const MAX_POLL_COUNT = 360; // 360 polls * 5 seconds = 30 minutes

  /**
   * Load available workflows
   */
  const loadWorkflows = useCallback(async () => {
    try {
      logger.info('Loading available workflows');
      setIsLoadingWorkflows(true);
      setWorkflowsError(null);

      const workflowList = await workflowService.getAvailableWorkflows();
      setWorkflows(workflowList);

      logger.info('Successfully loaded workflows', { count: workflowList.length });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load workflows';
      logger.error('Failed to load workflows', new Error(errorMessage));
      setWorkflowsError(errorMessage);
    } finally {
      setIsLoadingWorkflows(false);
    }
  }, [logger]);

  /**
   * Open modal and load workflows
   */
  const openModal = useCallback(() => {
    logger.info('Opening AI creation modal');
    setIsModalOpen(true);
    
    // Reset state
    setSelectedWorkflow(null);
    setIsParameterMode(false);
    setParameters({});
    setValidationErrors([]);
    setExecutionResult(null);
    setExecutionError(null);

    // Load workflows if not already loaded
    if (workflows.length === 0) {
      loadWorkflows();
    }
  }, [logger, workflows.length, loadWorkflows]);

  /**
   * Close modal
   */
  const closeModal = useCallback(() => {
    logger.info('Closing AI creation modal');
    setIsModalOpen(false);
    
    // Reset state
    setSelectedWorkflow(null);
    setIsParameterMode(false);
    setParameters({});
    setValidationErrors([]);
    setExecutionResult(null);
    setExecutionError(null);
  }, [logger]);

  /**
   * Handle workflow selection
   */
  const handleWorkflowSelect = useCallback((workflow: WorkflowInfo) => {
    logger.info('Workflow selected', { 
      workflowId: workflow.workflowId, 
      workflowName: workflow.workflowName 
    });

    setSelectedWorkflow(workflow);
    setIsParameterMode(true);

    // Initialize parameters with default values
    const defaultParams: Record<string, any> = {};
    workflow.nodeInfoList.forEach(nodeInfo => {
      defaultParams[nodeInfo.nodeId] = nodeInfo.fieldValue;
    });
    setParameters(defaultParams);

    // Clear validation errors
    setValidationErrors([]);
  }, [logger]);

  /**
   * Handle back to workflows list
   */
  const handleBackToWorkflows = useCallback(() => {
    logger.info('Returning to workflows list');
    setSelectedWorkflow(null);
    setIsParameterMode(false);
    setParameters({});
    setValidationErrors([]);
    setExecutionResult(null);
    setExecutionError(null);
  }, [logger]);

  /**
   * Set parameter value
   */
  const setParameter = useCallback((nodeId: string, value: any) => {
    logger.debug('Setting parameter', { nodeId, value });
    setParameters(prev => ({
      ...prev,
      [nodeId]: value
    }));

    // Clear validation errors when user changes parameters
    setValidationErrors([]);
  }, [logger]);

  /**
   * Stop task polling
   */
  const stopPolling = useCallback(() => {
    const currentTask = currentTaskRef.current;
    
    console.log('🛑 AI Creation - stopPolling() called', {
      hasInterval: !!pollingIntervalRef.current,
      intervalId: pollingIntervalRef.current,
      hasCurrentTask: !!currentTask,
      runninghubTaskId: currentTask?.runninghubTaskId,
      timestamp: new Date().toISOString()
    });
    
    if (pollingIntervalRef.current) {
      logger.info('Stopping task status polling', { 
        runninghubTaskId: currentTask?.runninghubTaskId,
        intervalId: pollingIntervalRef.current,
        stopTime: new Date().toISOString()
      });
      
      console.log('🛑 AI Creation - Clearing polling interval', {
        intervalId: pollingIntervalRef.current,
        runninghubTaskId: currentTask?.runninghubTaskId
      });
      
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      
      console.log('✅ AI Creation - Polling interval cleared successfully');
    } else {
      console.log('⚠️ AI Creation - No polling interval to clear');
    }
    
    if (currentTask) {
      logger.info('Clearing current task reference', { 
        runninghubTaskId: currentTask.runninghubTaskId 
      });
      
      console.log('🛑 AI Creation - Clearing current task reference', {
        runninghubTaskId: currentTask.runninghubTaskId
      });
    }
    
    currentTaskRef.current = null;
    
    console.log('✅ AI Creation - stopPolling() completed successfully');
  }, [logger]);

  /**
   * Upload AI creation result to Supabase
   */
  const uploadResultToSupabase = useCallback(async (
    result: any, 
    workflowType: string, 
    workflowName: string,
    runninghubTaskId: string,
    resultIndex: number = 0
  ) => {
    try {
      logger.info('开始上传AI创作结果到Supabase', {
        fileUrl: result.fileUrl,
        fileType: result.fileType,
        workflowType,
        workflowName,
        runninghubTaskId,
        resultIndex
      });

      // Download the file from the AI creation result URL
      const response = await fetch(result.fileUrl);
      if (!response.ok) {
        throw new Error(`下载AI创作结果失败: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const fileExtension = result.fileType || (workflowType.endsWith('-VIDEO') ? 'mp4' : 'png');
      const fileName = `ai_creation_${runninghubTaskId}_${resultIndex}.${fileExtension}`;
      const file = new File([blob], fileName, { 
        type: workflowType.endsWith('-VIDEO') ? 'video/mp4' : 'image/png' 
      });

      logger.info('AI创作结果文件下载完成，准备上传到Supabase', {
        fileName,
        fileSize: file.size,
        fileType: file.type
      });

      // Upload to Supabase based on workflow type suffix
      if (workflowType.endsWith('-VIDEO')) {
        // Upload video to Supabase for any *-VIDEO workflow type
        logger.info('检测到视频工作流类型，使用视频上传接口', {
          workflowType,
          uploadInterface: '/api/supabase/upload-video'
        });

        const uploadResult = await uploadVideoToSupabase({
          file,
          taskId,
          customFilename: `ai_creation_${runninghubTaskId}_${resultIndex}`,
          generateThumbnail: true
        });

        if (!uploadResult.success) {
          throw new Error(`视频上传Supabase失败: ${uploadResult.message}`);
        }

        logger.info('AI创作视频上传Supabase成功', {
          videoUrl: uploadResult.video_url,
          thumbnailUrl: uploadResult.thumbnail_url,
          fileSize: uploadResult.file_size,
          duration: uploadResult.duration,
          workflowType
        });

        return {
          url: uploadResult.video_url,
          thumbnailUrl: uploadResult.thumbnail_url,
          size: uploadResult.file_size,
          duration: uploadResult.duration,
          width: uploadResult.width,
          height: uploadResult.height,
          metadata: {
            supabaseUpload: true,
            originalUrl: result.fileUrl,
            uploadTime: uploadResult.upload_time,
            workflowType
          }
        };
      } else if (workflowType.endsWith('-IMG')) {
        // Upload image to Supabase for any *-IMG workflow type
        logger.info('检测到图片工作流类型，使用文件上传接口', {
          workflowType,
          uploadInterface: '/api/supabase/upload-file'
        });

        const now = new Date();
        const datePath = now.toISOString().slice(0, 10).replace(/-/g, '/'); // YYYY/MM/DD format
        const bucketPath = `dev/ai-creations/${datePath}/${taskId}/${fileName}`;
        
        const uploadResult = await uploadFileToSupabase(file, taskId, bucketPath);

        if (!uploadResult.success) {
          throw new Error(`图片上传Supabase失败: ${uploadResult.message}`);
        }

        logger.info('AI创作图片上传Supabase成功', {
          fileUrl: uploadResult.file_url,
          fileSize: uploadResult.file_size,
          bucketPath,
          workflowType
        });

        return {
          url: uploadResult.file_url,
          thumbnailUrl: uploadResult.file_url, // For images, use the same URL as thumbnail
          size: uploadResult.file_size,
          metadata: {
            supabaseUpload: true,
            originalUrl: result.fileUrl,
            uploadTime: uploadResult.upload_time,
            bucketPath,
            workflowType
          }
        };
      } else {
        // For other workflow types, default to image upload with warning
        logger.warn('未知工作流类型，默认使用图片上传接口', {
          workflowType,
          uploadInterface: '/api/supabase/upload-file',
          recommendation: '建议工作流类型使用-VIDEO或-IMG后缀'
        });

        const now = new Date();
        const datePath = now.toISOString().slice(0, 10).replace(/-/g, '/'); // YYYY/MM/DD format
        const bucketPath = `dev/ai-creations/${datePath}/${taskId}/${fileName}`;
        
        const uploadResult = await uploadFileToSupabase(file, taskId, bucketPath);

        if (!uploadResult.success) {
          throw new Error(`文件上传Supabase失败: ${uploadResult.message}`);
        }

        logger.info('AI创作文件上传Supabase成功（默认处理）', {
          fileUrl: uploadResult.file_url,
          fileSize: uploadResult.file_size,
          bucketPath,
          workflowType
        });

        return {
          url: uploadResult.file_url,
          thumbnailUrl: uploadResult.file_url, // Default to same URL as thumbnail
          size: uploadResult.file_size,
          metadata: {
            supabaseUpload: true,
            originalUrl: result.fileUrl,
            uploadTime: uploadResult.upload_time,
            bucketPath,
            workflowType,
            defaultHandling: true
          }
        };
      }
    } catch (error) {
      logger.error('AI创作结果上传Supabase失败', error instanceof Error ? error : new Error(String(error)), {
        fileUrl: result.fileUrl,
        workflowType,
        runninghubTaskId,
        resultIndex
      });
      
      // Return original data if upload fails
      return {
        url: result.fileUrl,
        thumbnailUrl: workflowType.endsWith('-VIDEO') ? undefined : result.fileUrl,
        size: 0,
        metadata: {
          supabaseUpload: false,
          originalUrl: result.fileUrl,
          uploadError: error instanceof Error ? error.message : String(error),
          workflowType
        }
      };
    }
  }, [logger, taskId]);

  /**
   * Poll task status until completion
   */
  const pollTaskStatus = useCallback(async (runninghubTaskId: string, addMaterial: (material: MaterialItem) => boolean) => {
    try {
      // Check if polling has been stopped
      if (!currentTaskRef.current || currentTaskRef.current.runninghubTaskId !== runninghubTaskId) {
        console.log('🛑 AI Creation - Polling stopped or task changed, aborting poll', {
          runninghubTaskId,
          hasCurrentTask: !!currentTaskRef.current,
          currentTaskId: currentTaskRef.current?.runninghubTaskId,
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      // Check polling timeout
      if (currentTaskRef.current) {
        const elapsedTime = Date.now() - currentTaskRef.current.startTime;
        const pollCount = currentTaskRef.current.pollCount;
        
        if (elapsedTime > MAX_POLLING_TIME || pollCount > MAX_POLL_COUNT) {
          logger.error('Polling timeout reached', new Error('Task polling timeout'), {
            runninghubTaskId,
            elapsedTime,
            pollCount,
            maxTime: MAX_POLLING_TIME,
            maxCount: MAX_POLL_COUNT
          });
          
          console.error('⏰ AI Creation - Polling timeout', {
            runninghubTaskId,
            elapsedTime,
            pollCount,
            timeoutMinutes: MAX_POLLING_TIME / 60000
          });
          
          // Update material to show timeout error
          const timeoutMaterial: MaterialItem = {
            id: `generating_${runninghubTaskId}`,
            name: `生成超时 - ${selectedWorkflow?.showNameCh || '未知工作流'}`,
            type: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'video' : 'image',
            format: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'mp4' : 'png',
            size: 0,
            url: '',
            downloadStatus: 'error',
            downloadError: `任务执行超时 (${Math.round(elapsedTime / 60000)}分钟)`,
            createdAt: new Date(),
            metadata: {
              workflowId: selectedWorkflow?.workflowId,
              workflowName: selectedWorkflow?.workflowName,
              runninghubTaskId: runninghubTaskId,
              isGenerating: false,
              generatingStatus: 'timeout',
              elapsedTime,
              pollCount,
              source: 'ai_creation'
            }
          };
          
          addMaterial(timeoutMaterial);
          stopPolling();
          return;
        }
        
        // Increment poll count
        currentTaskRef.current.pollCount++;
      }
      
      console.log('🔍 AI Creation - Polling task status', { 
        runninghubTaskId, 
        pollCount: currentTaskRef.current?.pollCount || 0,
        timestamp: new Date().toISOString() 
      });
      
      logger.info('Polling task status', { 
        runninghubTaskId, 
        pollCount: currentTaskRef.current?.pollCount || 0,
        timestamp: new Date().toISOString() 
      });

      const statusResult = await workflowService.checkTaskStatus(runninghubTaskId);
      
      console.log('🔍 AI Creation - Raw status result', {
        runninghubTaskId,
        statusResult,
        success: statusResult.success,
        status: statusResult.status,
        timestamp: new Date().toISOString()
      });
      
      if (!statusResult.success) {
        console.error('❌ AI Creation - Status check failed', {
          runninghubTaskId,
          message: statusResult.message,
          statusResult
        });
        logger.error('Failed to check task status during polling', new Error(statusResult.message), {
          runninghubTaskId,
          statusResult,
          pollAttempt: 'continuing_despite_error'
        });
        
        // Don't stop polling immediately on status check failure - it might be a temporary network issue
        // Only stop if we've had multiple consecutive failures
        return;
      }

      const status = statusResult.status;
      
      console.log('📊 AI Creation - Task status received', { 
        runninghubTaskId, 
        status, 
        timestamp: new Date().toISOString() 
      });
      
      logger.info('Task status polled', { runninghubTaskId, status, timestamp: new Date().toISOString() });

      // Check if task failed
      if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
        logger.error('Task failed during execution', new Error(`Task status: ${status}`), {
          runninghubTaskId,
          status,
          timestamp: new Date().toISOString()
        });
        
        console.error('❌ AI Creation - Task failed', {
          runninghubTaskId,
          status,
          timestamp: new Date().toISOString()
        });
        
        // Update the generating material to show error state
        const errorMaterial: MaterialItem = {
          id: `generating_${runninghubTaskId}`,
          name: `生成失败 - ${selectedWorkflow?.showNameCh || '未知工作流'}`,
          type: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'video' : 'image',
          format: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'mp4' : 'png',
          size: 0,
          url: '',
          downloadStatus: 'error',
          downloadError: `任务执行失败: ${status}`,
          createdAt: new Date(),
          metadata: {
            workflowId: selectedWorkflow?.workflowId,
            workflowName: selectedWorkflow?.workflowName,
            runninghubTaskId: runninghubTaskId,
            isGenerating: false,
            generatingStatus: 'failed',
            error: status,
            source: 'ai_creation'
          }
        };
        
        addMaterial(errorMaterial);
        stopPolling();
        return;
      }
      
      // Check if task is completed
      // According to RunningHub API documentation, successful completion status could be various values
      if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'FINISHED' || status === 'DONE') {
        // Check if results have already been processed to prevent duplicate uploads
        if (currentTaskRef.current?.resultsProcessed) {
          console.log('🔄 AI Creation - Results already processed, skipping', {
            runninghubTaskId,
            status,
            timestamp: new Date().toISOString()
          });
          
          logger.info('Task results already processed, skipping duplicate processing', { 
            runninghubTaskId, 
            status 
          });
          
          // Stop polling since results are already processed
          stopPolling();
          return;
        }
        
        // Immediately mark as being processed to prevent race conditions
        if (currentTaskRef.current) {
          currentTaskRef.current.resultsProcessed = true;
          console.log('🔒 AI Creation - Marked results as being processed to prevent race conditions', {
            runninghubTaskId,
            timestamp: new Date().toISOString()
          });
        }
        
        logger.info('Task completed successfully, fetching results', { runninghubTaskId });
        
        try {
          // Double-check that polling hasn't been stopped during the async operation
          if (!currentTaskRef.current || currentTaskRef.current.runninghubTaskId !== runninghubTaskId) {
            console.log('🛑 AI Creation - Polling stopped during results fetch, aborting', {
              runninghubTaskId,
              timestamp: new Date().toISOString()
            });
            return;
          }
          
          const resultsResponse = await workflowService.getTaskResults(runninghubTaskId);
          
          if (resultsResponse.success && resultsResponse.results.length > 0) {
            logger.info('Task results retrieved successfully', { 
              runninghubTaskId, 
              resultCount: resultsResponse.results.length 
            });

            console.log('🎯 AI Creation - Processing task results', {
              runninghubTaskId,
              resultCount: resultsResponse.results.length,
              results: resultsResponse.results,
              timestamp: new Date().toISOString()
            });

            // Process results and replace the generating material
            for (let i = 0; i < resultsResponse.results.length; i++) {
              const result = resultsResponse.results[i];
              
              console.log(`🔄 AI Creation - Processing result ${i + 1}/${resultsResponse.results.length}`, {
                runninghubTaskId,
                resultIndex: i,
                fileUrl: result.fileUrl,
                fileType: result.fileType,
                nodeId: result.nodeId,
                timestamp: new Date().toISOString()
              });

              // Upload result to Supabase and get the updated URLs
              let supabaseResult;
              try {
                console.log(`🔄 AI Creation - Starting Supabase upload for result ${i + 1}/${resultsResponse.results.length}`, {
                  runninghubTaskId,
                  resultIndex: i,
                  fileUrl: result.fileUrl,
                  fileType: result.fileType,
                  workflowType: selectedWorkflow?.workflowType,
                  pollCount: currentTaskRef.current?.pollCount,
                  resultsProcessed: currentTaskRef.current?.resultsProcessed,
                  timestamp: new Date().toISOString()
                });
                
                supabaseResult = await uploadResultToSupabase(
                  result,
                  selectedWorkflow?.workflowType || 'TEXT-2-IMAGE',
                  selectedWorkflow?.workflowName || '未知工作流',
                  runninghubTaskId,
                  i
                );
                
                console.log('✅ AI Creation - Supabase upload successful', {
                  runninghubTaskId,
                  resultIndex: i,
                  supabaseUrl: supabaseResult.url,
                  thumbnailUrl: supabaseResult.thumbnailUrl,
                  fileSize: supabaseResult.size,
                  uploadSuccess: true,
                  timestamp: new Date().toISOString()
                });
                
              } catch (uploadError) {
                logger.error('Failed to upload result to Supabase', uploadError instanceof Error ? uploadError : new Error(String(uploadError)), {
                  runninghubTaskId,
                  resultIndex: i,
                  originalFileUrl: result.fileUrl,
                  fileType: result.fileType
                });
                
                console.error('❌ AI Creation - Supabase upload failed', {
                  runninghubTaskId,
                  resultIndex: i,
                  error: uploadError,
                  originalFileUrl: result.fileUrl
                });
                
                // Use original URL as fallback if Supabase upload fails
                supabaseResult = {
                  url: result.fileUrl,
                  thumbnailUrl: result.fileUrl,
                  size: 0,
                  metadata: {
                    uploadError: uploadError instanceof Error ? uploadError.message : String(uploadError),
                    fallbackToOriginal: true
                  }
                };
              }
              
              // For the first result, replace the generating material (same ID)
              // For additional results, create new materials
              const materialId = i === 0 
                ? `generating_${runninghubTaskId}` // Use same ID as generating material to replace it
                : `ai_creation_${runninghubTaskId}_${result.nodeId || Date.now()}_${i}`;
              
              // Determine material type based on workflow type suffix
              const materialType = getMaterialTypeFromWorkflowType(selectedWorkflow?.workflowType || '');
              const defaultFormat = materialType === 'video' ? 'mp4' : materialType === 'audio' ? 'mp3' : 'png';

              // Log warning for unknown workflow types
              if (!selectedWorkflow?.workflowType || 
                  (!selectedWorkflow.workflowType.endsWith('-VIDEO') && 
                   !selectedWorkflow.workflowType.endsWith('-IMG') && 
                   !selectedWorkflow.workflowType.endsWith('-IMAGE') && 
                   !selectedWorkflow.workflowType.endsWith('-AUDIO'))) {
                logger.warn('未知工作流类型，默认设置为图片类型', {
                  workflowType: selectedWorkflow?.workflowType,
                  recommendation: '建议工作流类型使用-VIDEO、-IMG或-AUDIO后缀'
                });
              }

              logger.info('根据工作流类型确定素材类型', {
                workflowType: selectedWorkflow?.workflowType,
                detectedMaterialType: materialType,
                defaultFormat,
                resultIndex: i
              });

              const material: MaterialItem = {
                id: materialId,
                name: `AI创作结果_${selectedWorkflow?.showNameCh || '未知'}_${new Date().toLocaleString()}${i > 0 ? `_${i + 1}` : ''}`,
                type: materialType,
                format: result.fileType || defaultFormat,
                size: supabaseResult.size,
                url: supabaseResult.url, // Use Supabase URL
                serverUrl: result.fileUrl, // Keep original server URL for reference
                thumbnailUrl: supabaseResult.thumbnailUrl,
                downloadStatus: 'completed',
                createdAt: new Date(),
                duration: supabaseResult.duration,
                width: supabaseResult.width,
                height: supabaseResult.height,
                metadata: {
                  workflowId: selectedWorkflow?.workflowId,
                  workflowName: selectedWorkflow?.workflowName,
                  workflowType: selectedWorkflow?.workflowType,
                  detectedMaterialType: materialType,
                  runninghubTaskId: runninghubTaskId,
                  nodeId: result.nodeId,
                  taskCostTime: result.taskCostTime,
                  isAIGenerated: true,
                  isGenerating: false, // Mark as no longer generating
                  generatingStatus: 'completed',
                  originalGeneratingId: `generating_${runninghubTaskId}`,
                  resultIndex: i,
                  source: 'ai_creation',
                  ...supabaseResult.metadata // Include Supabase upload metadata
                }
              };

              // Add/replace material in the materials panel
              const added = addMaterial(material);
              
              console.log(`🎯 AI Creation - ${i === 0 ? 'Replaced generating' : 'Added additional'} material with Supabase URLs`, {
                materialId: material.id,
                materialName: material.name,
                materialType: material.type,
                supabaseUrl: supabaseResult.url,
                originalUrl: result.fileUrl,
                thumbnailUrl: supabaseResult.thumbnailUrl,
                fileSize: supabaseResult.size,
                taskCostTime: result.taskCostTime,
                added,
                isReplacement: i === 0,
                resultIndex: i,
                supabaseUpload: supabaseResult.metadata?.supabaseUpload
              });
              
              logger.info(`AI creation result ${i === 0 ? 'replaced generating' : 'added as additional'} material with Supabase upload`, {
                materialId: material.id,
                materialName: material.name,
                materialType: material.type,
                supabaseUrl: supabaseResult.url,
                originalUrl: result.fileUrl,
                thumbnailUrl: supabaseResult.thumbnailUrl,
                fileSize: supabaseResult.size,
                taskCostTime: result.taskCostTime,
                added,
                isReplacement: i === 0,
                resultIndex: i,
                supabaseUploadSuccess: supabaseResult.metadata?.supabaseUpload,
                uploadError: supabaseResult.metadata?.uploadError
              });
            }
            
            console.log('✅ AI Creation - Results processed successfully', {
              runninghubTaskId,
              resultCount: resultsResponse.results.length,
              timestamp: new Date().toISOString()
            });
            
          } else {
            logger.warn('Task completed but no results found');
          }
        } catch (error) {
          logger.error('Failed to fetch task results', error instanceof Error ? error : new Error(String(error)));
        }
        
        console.log('✅ AI Creation - Task SUCCESS detected, stopping polling', {
          runninghubTaskId,
          status,
          timestamp: new Date().toISOString()
        });
        
        logger.info('Task SUCCESS detected, stopping polling', {
          runninghubTaskId,
          status,
          timestamp: new Date().toISOString()
        });
        
        stopPolling();
      } else if (status === 'FAILED' || status === 'ERROR') {
        logger.error('Task failed', new Error(`Task failed with status: ${status}`), { runninghubTaskId, status });
        
        console.log('❌ AI Creation - Task failed, updating generating material', {
          runninghubTaskId,
          status,
          timestamp: new Date().toISOString()
        });
        
        // Update the generating material to show failed status
        const failedMaterial: MaterialItem = {
          id: `generating_${runninghubTaskId}`, // Use same ID to replace generating material
          name: `AI创作失败 - ${selectedWorkflow?.showNameCh || '未知'}`,
          type: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'video' : 'image',
          format: selectedWorkflow?.workflowType === 'TEXT-2-VIDEO' ? 'mp4' : 'png',
          size: 0,
          url: '', // Empty URL for failed state
          downloadStatus: 'error',
          createdAt: new Date(),
          metadata: {
            workflowId: selectedWorkflow?.workflowId,
            workflowName: selectedWorkflow?.workflowName,
            runninghubTaskId: runninghubTaskId,
            isAIGenerated: true,
            isGenerating: false,
            generatingStatus: 'failed',
            errorStatus: status,
            originalGeneratingId: `generating_${runninghubTaskId}`
          }
        };

        // Replace the generating material with failed status
        const updated = addMaterial(failedMaterial);
        
        console.log('❌ AI Creation - Updated generating material to failed status', {
          materialId: failedMaterial.id,
          materialName: failedMaterial.name,
          status,
          updated
        });
        
        logger.info('Updated generating material to failed status', {
          materialId: failedMaterial.id,
          materialName: failedMaterial.name,
          status,
          updated
        });
        
        stopPolling();
      } else {
        // Task is still running (RUNNING, PENDING, etc.)
        console.log('⏳ AI Creation - Task still in progress', {
          runninghubTaskId,
          status,
          timestamp: new Date().toISOString(),
          nextPollIn: '5 seconds'
        });
        
        logger.info('Task still in progress, continuing polling', { 
          runninghubTaskId, 
          status,
          timestamp: new Date().toISOString(),
          nextPollIn: '5 seconds'
        });
        // Continue polling - the interval will call this function again
      }
      
    } catch (error) {
      console.error('❌ AI Creation - Error during polling', {
        runninghubTaskId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      
      logger.error('Error during task status polling', error instanceof Error ? error : new Error(String(error)));
      // Don't stop polling on network errors, just log and continue
      logger.info('Continuing polling despite error - network issues may be temporary');
      
      console.log('⏳ AI Creation - Continuing polling despite error', {
        runninghubTaskId,
        nextPollIn: '5 seconds',
        timestamp: new Date().toISOString()
      });
    }
  }, [logger, selectedWorkflow, stopPolling, uploadResultToSupabase]);

  /**
   * Start task polling
   */
  const startPolling = useCallback((runninghubTaskId: string, addMaterial: (material: MaterialItem) => boolean) => {
    console.log('🔄 AI Creation - Starting task status polling', { 
      runninghubTaskId, 
      pollingInterval: '5 seconds',
      startTime: new Date().toISOString()
    });
    
    logger.info('Starting task status polling', { 
      runninghubTaskId, 
      pollingInterval: '5 seconds',
      startTime: new Date().toISOString()
    });
    
    currentTaskRef.current = { 
      runninghubTaskId, 
      addMaterial, 
      startTime: Date.now(), 
      pollCount: 0,
      resultsProcessed: false
    };
    
    // Poll immediately for the first time
    console.log('🔄 AI Creation - Polling immediately (first time)');
    pollTaskStatus(runninghubTaskId, addMaterial);
    
    // Then set up interval to poll every 5 seconds
    console.log('🔄 AI Creation - Setting up polling interval');
    pollingIntervalRef.current = setInterval(() => {
      console.log('🔄 AI Creation - Interval polling triggered', { 
        hasCurrentTask: !!currentTaskRef.current,
        currentTaskId: currentTaskRef.current?.runninghubTaskId,
        timestamp: new Date().toISOString()
      });
      
      if (currentTaskRef.current) {
        logger.debug('Interval polling triggered', { 
          runninghubTaskId: currentTaskRef.current.runninghubTaskId,
          pollCount: currentTaskRef.current.pollCount,
          resultsProcessed: currentTaskRef.current.resultsProcessed,
          timestamp: new Date().toISOString()
        });
        
        console.log('🔄 AI Creation - Interval polling about to call pollTaskStatus', {
          runninghubTaskId: currentTaskRef.current.runninghubTaskId,
          pollCount: currentTaskRef.current.pollCount,
          resultsProcessed: currentTaskRef.current.resultsProcessed,
          timestamp: new Date().toISOString()
        });
        
        pollTaskStatus(currentTaskRef.current.runninghubTaskId, currentTaskRef.current.addMaterial);
      } else {
        console.warn('⚠️ AI Creation - Polling interval triggered but no current task found');
        logger.warn('Polling interval triggered but no current task found');
      }
    }, 5000); // Poll every 5 seconds
    
    console.log('✅ AI Creation - Task polling interval established', { 
      runninghubTaskId, 
      intervalId: pollingIntervalRef.current 
    });
    
    logger.info('Task polling interval established', { 
      runninghubTaskId, 
      intervalId: pollingIntervalRef.current 
    });
  }, [logger, pollTaskStatus]);

  /**
   * Handle start creation
   */
  const handleStartCreation = useCallback(async (addMaterial: (material: MaterialItem) => boolean) => {
    if (!selectedWorkflow) {
      logger.error('No workflow selected for execution', new Error('No workflow selected'));
      return;
    }

    try {
      logger.info('Starting workflow creation', { 
        workflowId: selectedWorkflow.workflowId,
        workflowName: selectedWorkflow.workflowName
      });

      // Validate parameters
      const validation = workflowService.validateParameters(selectedWorkflow.nodeInfoList, parameters);
      if (!validation.isValid) {
        logger.warn('Parameter validation failed');
        setValidationErrors(validation.errors);
        return;
      }

      setIsExecuting(true);
      setExecutionError(null);
      setValidationErrors([]);

      // Convert parameters to API format
      const workflowParameters = workflowService.convertNodeInfoToParameters(
        selectedWorkflow.nodeInfoList,
        parameters
      );

      // Execute workflow
      const result = await workflowService.executeWorkflow({
        workflowId: selectedWorkflow.workflowId,
        parameters: workflowParameters,
        taskId: taskId
      });

      setExecutionResult(result);
      logger.info('Workflow execution started successfully', { 
        workflowId: selectedWorkflow.workflowId,
        status: result.status,
        resultTaskId: result.taskId,
        runninghubTaskId: result.runninghubTaskId
      });

      // Add detailed logging for debugging
      console.log('🚀 AI Creation - Workflow execution result:', {
        workflowId: selectedWorkflow.workflowId,
        workflowName: selectedWorkflow.workflowName,
        status: result.status,
        taskId: result.taskId,
        runninghubTaskId: result.runninghubTaskId,
        hasRunninghubTaskId: !!result.runninghubTaskId,
        timestamp: new Date().toISOString()
      });

      // Close modal immediately after starting the task
      setIsModalOpen(false);

      // Add a generating material to the materials panel
      // Determine generating material type based on workflow type suffix
      const generatingMaterialType = getMaterialTypeFromWorkflowType(selectedWorkflow.workflowType || '');
      const generatingFormat = generatingMaterialType === 'video' ? 'mp4' : generatingMaterialType === 'audio' ? 'mp3' : 'png';

      logger.info('创建正在生成的素材', {
        workflowType: selectedWorkflow.workflowType,
        detectedMaterialType: generatingMaterialType,
        format: generatingFormat
      });

      const generatingMaterial: MaterialItem = {
        id: `generating_${result.runninghubTaskId || Date.now()}`,
        name: `正在生成 - ${selectedWorkflow.showNameCh}`,
        type: generatingMaterialType,
        format: generatingFormat,
        size: 0,
        url: '', // Empty URL for generating state
        downloadStatus: 'generating',
        createdAt: new Date(),
        metadata: {
          workflowId: selectedWorkflow.workflowId,
          workflowName: selectedWorkflow.workflowName,
          runninghubTaskId: result.runninghubTaskId,
          isGenerating: true,
          parameters: parameters
        }
      };

      // Add generating material
      addMaterial(generatingMaterial);

      // Start polling for task completion if we have a RunningHub task ID
      if (result.runninghubTaskId) {
        console.log('✅ AI Creation - Starting task polling', {
          runninghubTaskId: result.runninghubTaskId,
          workflowId: selectedWorkflow.workflowId,
          workflowName: selectedWorkflow.workflowName,
          taskId: result.taskId,
          timestamp: new Date().toISOString()
        });
        
        logger.info('Starting task polling after successful workflow execution', {
          workflowId: selectedWorkflow.workflowId,
          workflowName: selectedWorkflow.workflowName,
          runninghubTaskId: result.runninghubTaskId,
          taskId: result.taskId
        });
        startPolling(result.runninghubTaskId, addMaterial);
      } else {
        console.error('❌ AI Creation - No RunningHub task ID received!', {
          workflowId: selectedWorkflow.workflowId,
          executionResult: result,
          resultKeys: Object.keys(result),
          timestamp: new Date().toISOString()
        });
        
        logger.error('No RunningHub task ID received, cannot start polling', new Error('Missing RunningHub task ID'), {
          workflowId: selectedWorkflow.workflowId,
          executionResult: result
        });
      }

    } catch (error) {
      let errorMessage = 'Failed to start creation';
      let isQueueError = false;

      if (error instanceof Error) {
        const workflowError = error as WorkflowError;
        
        // Check if this is a TASK_QUEUE_MAXED error
        if (workflowError.isTaskQueueMaxed) {
          isQueueError = true;
          errorMessage = '当前有用户正在生成内容，请稍后再试。系统正在处理其他任务，请等待几分钟后重新尝试。';
          
          logger.warn('TASK_QUEUE_MAXED error in AI creation', {
            workflowId: selectedWorkflow.workflowId,
            errorCode: workflowError.errorCode,
            timestamp: workflowError.timestamp,
            originalMessage: workflowError.message
          });
        } else {
          errorMessage = workflowError.message;
          
          logger.error('Failed to start workflow creation', workflowError, {
            workflowId: selectedWorkflow.workflowId,
            errorCode: workflowError.errorCode,
            errorDetails: workflowError.errorDetails,
            timestamp: workflowError.timestamp
          });
        }
      } else {
        logger.error('Failed to start workflow creation', new Error(errorMessage), {
          workflowId: selectedWorkflow.workflowId,
          unknownError: error
        });
      }

      // Log user-friendly message for queue errors
      if (isQueueError) {
        console.warn('🚦 AI Creation - Queue is full, user should try again later', {
          workflowId: selectedWorkflow.workflowId,
          userMessage: errorMessage,
          timestamp: new Date().toISOString()
        });
      }

      setExecutionError(errorMessage);
    } finally {
      setIsExecuting(false);
    }
  }, [selectedWorkflow, parameters, taskId, logger, startPolling]);

  // Load workflows when hook is first used
  useEffect(() => {
    if (isModalOpen && workflows.length === 0 && !isLoadingWorkflows) {
      loadWorkflows();
    }
  }, [isModalOpen, workflows.length, isLoadingWorkflows, loadWorkflows]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      // Clean up polling when component unmounts
      if (pollingIntervalRef.current) {
        console.log('🧹 AI Creation - Cleaning up polling on unmount', {
          intervalId: pollingIntervalRef.current,
          timestamp: new Date().toISOString()
        });
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      currentTaskRef.current = null;
    };
  }, []); // Empty dependency array - only run on mount/unmount

  return {
    // Modal state
    isModalOpen,
    openModal,
    closeModal,

    // Workflow data
    workflows,
    selectedWorkflow,
    isLoadingWorkflows,
    workflowsError,

    // UI state
    isParameterMode,
    parameters,
    validationErrors,

    // Actions
    handleWorkflowSelect,
    handleBackToWorkflows,
    setParameter,
    handleStartCreation,

    // Execution state
    isExecuting,
    executionResult,
    executionError,

    // Utility
    taskId
  };
};