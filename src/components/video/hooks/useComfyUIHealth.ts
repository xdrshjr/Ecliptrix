import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { VideoEditingLogger } from '../utils';
import { createComfyUIHealthService, ComfyUIHealthStatus, ComfyUIHealthService } from '../services/comfyuiHealthService';

export interface UseComfyUIHealthReturn {
  healthStatus: ComfyUIHealthStatus | null;
  isChecking: boolean;
  isServiceAvailable: boolean;
  lastCheckTime: Date | null;
  checkHealth: () => Promise<void>;
  error: string | null;
}

/**
 * useComfyUIHealth Hook
 * 管理ComfyUI服务健康检查状态
 * 
 * 根据NEXT_PUBLIC_AI_MATERIAL_SERVICE环境变量的配置：
 * - local: 执行实际的ComfyUI健康检查
 * - runninghub: 跳过健康检查，返回mock健康状态
 * 
 * @param taskId - 任务ID，用于日志记录
 * @param autoCheck - 是否在组件挂载时自动检查（默认true）
 * @returns ComfyUI健康检查相关的状态和方法
 */
export const useComfyUIHealth = (
  taskId: string,
  autoCheck: boolean = true
): UseComfyUIHealthReturn => {
  // 获取AI素材服务配置
  const aiMaterialService = process.env.NEXT_PUBLIC_AI_MATERIAL_SERVICE || 'local';
  
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useComfyUIHealth'
  }), [taskId]);

  // 只有在使用local模式时才创建健康检查服务
  const healthService = useMemo(() => {
    if (aiMaterialService === 'local') {
      return createComfyUIHealthService(taskId);
    }
    return null;
  }, [taskId, aiMaterialService]);

  // 状态管理
  const [healthStatus, setHealthStatus] = useState<ComfyUIHealthStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // 使用ref来存储定时器，避免依赖问题
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // 计算服务是否可用
  const isServiceAvailable = useMemo(() => {
    if (!healthStatus) return false;
    return healthStatus.status === 'healthy' && healthStatus.comfyui_status === 'healthy';
  }, [healthStatus]);

  // 执行健康检查
  const checkHealth = useCallback(async () => {
    // 如果使用runninghub模式，跳过健康检查
    if (aiMaterialService === 'runninghub') {
      logger.info('使用RunningHub模式，跳过ComfyUI健康检查', {
        aiMaterialService,
        reason: 'RunningHub模式下不需要本地ComfyUI服务'
      });
      return;
    }

    if (isChecking) {
      logger.warn('健康检查正在进行中，跳过重复请求');
      return;
    }

    if (!healthService) {
      logger.error('健康检查服务未初始化', new Error('Health service not initialized'));
      return;
    }

    logger.userAction('开始ComfyUI健康检查', 'healthCheck', {
      aiMaterialService,
      mode: 'local'
    });
    setIsChecking(true);
    setError(null);

    try {
      const result = await healthService.checkHealth();
      setHealthStatus(result);
      setLastCheckTime(new Date());
      
      logger.info('ComfyUI健康检查完成', {
        status: result.status,
        comfyui_status: result.comfyui_status,
        isAvailable: result.status === 'healthy' && result.comfyui_status === 'healthy',
        error: result.error,
        aiMaterialService
      });

      // 如果有错误，设置错误状态
      if (result.error) {
        setError(result.error);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '健康检查失败';
      setError(errorMessage);
      
      // 设置错误状态
      setHealthStatus({
        status: 'error',
        comfyui_status: 'error',
        timestamp: new Date().toISOString(),
        error: errorMessage
      });
      setLastCheckTime(new Date());
      
      logger.error('ComfyUI健康检查异常', error as Error, {
        aiMaterialService
      });
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, healthService, logger, aiMaterialService]);

  // 组件挂载时自动检查，之后每5分钟检查一次
  useEffect(() => {
    if (!autoCheck) return;

    // 如果使用runninghub模式，设置mock健康状态并跳过所有健康检查逻辑
    if (aiMaterialService === 'runninghub') {
      logger.info('使用RunningHub模式，设置mock健康状态', {
        aiMaterialService,
        reason: 'RunningHub模式下不需要本地ComfyUI服务，直接返回健康状态'
      });
      
      // 设置mock健康状态
      const mockHealthStatus: ComfyUIHealthStatus = {
        status: 'healthy',
        comfyui_status: 'healthy',
        timestamp: new Date().toISOString(),
        version: 'runninghub-mode'
      };
      
      setHealthStatus(mockHealthStatus);
      setLastCheckTime(new Date());
      setError(null);
      setIsChecking(false);
      
      return; // 直接返回，不设置定时器
    }

    if (!healthService) {
      logger.error('健康检查服务未初始化，无法进行自动检查', new Error('Health service not initialized for auto check'), {
        aiMaterialService
      });
      return;
    }

    logger.info('组件挂载，开始自动健康检查', {
      aiMaterialService,
      mode: 'local'
    });
    
    // 立即执行第一次检查
    const performInitialCheck = async () => {
      try {
        const result = await healthService.checkHealth();
        setHealthStatus(result);
        setLastCheckTime(new Date());
        
        logger.info('初始ComfyUI健康检查完成', {
          status: result.status,
          comfyui_status: result.comfyui_status,
          isAvailable: result.status === 'healthy' && result.comfyui_status === 'healthy',
          error: result.error,
          aiMaterialService
        });

        if (result.error) {
          setError(result.error);
        } else {
          setError(null);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '健康检查失败';
        setError(errorMessage);
        
        setHealthStatus({
          status: 'error',
          comfyui_status: 'error',
          timestamp: new Date().toISOString(),
          error: errorMessage
        });
        setLastCheckTime(new Date());
        
        logger.error('初始ComfyUI健康检查异常', error as Error, {
          aiMaterialService
        });
      }
    };
    
    performInitialCheck();
    
    // 设置定时器，每5分钟检查一次
    intervalRef.current = setInterval(async () => {
      logger.info('定时健康检查开始', {
        aiMaterialService
      });
      try {
        const result = await healthService.checkHealth();
        setHealthStatus(result);
        setLastCheckTime(new Date());
        
        logger.info('定时ComfyUI健康检查完成', {
          status: result.status,
          comfyui_status: result.comfyui_status,
          isAvailable: result.status === 'healthy' && result.comfyui_status === 'healthy',
          error: result.error,
          aiMaterialService
        });

        if (result.error) {
          setError(result.error);
        } else {
          setError(null);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '健康检查失败';
        setError(errorMessage);
        
        setHealthStatus({
          status: 'error',
          comfyui_status: 'error',
          timestamp: new Date().toISOString(),
          error: errorMessage
        });
        setLastCheckTime(new Date());
        
        logger.error('定时ComfyUI健康检查异常', error as Error, {
          aiMaterialService
        });
      }
    }, 5 * 60 * 1000); // 5分钟 = 5 * 60 * 1000 毫秒

    // 清理定时器
    return () => {
      if (intervalRef.current) {
        logger.info('清理健康检查定时器', {
          aiMaterialService
        });
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoCheck, healthService, logger, aiMaterialService]); // 添加aiMaterialService到依赖

  return {
    healthStatus,
    isChecking,
    isServiceAvailable,
    lastCheckTime,
    checkHealth,
    error
  };
}; 