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
 * @param taskId - 任务ID，用于日志记录
 * @param autoCheck - 是否在组件挂载时自动检查（默认true）
 * @returns ComfyUI健康检查相关的状态和方法
 */
export const useComfyUIHealth = (
  taskId: string,
  autoCheck: boolean = true
): UseComfyUIHealthReturn => {
  // 初始化日志器和服务
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useComfyUIHealth'
  }), [taskId]);

  const healthService = useMemo(() => createComfyUIHealthService(taskId), [taskId]);

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
    if (isChecking) {
      logger.warn('健康检查正在进行中，跳过重复请求');
      return;
    }

    logger.userAction('开始ComfyUI健康检查', 'healthCheck');
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
        error: result.error
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
      
      logger.error('ComfyUI健康检查异常', error as Error);
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, healthService, logger]);

  // 组件挂载时自动检查，之后每5分钟检查一次
  useEffect(() => {
    if (!autoCheck) return;

    logger.info('组件挂载，开始自动健康检查');
    
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
          error: result.error
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
        
        logger.error('初始ComfyUI健康检查异常', error as Error);
      }
    };
    
    performInitialCheck();
    
    // 设置定时器，每5分钟检查一次
    intervalRef.current = setInterval(async () => {
      logger.info('定时健康检查开始');
      try {
        const result = await healthService.checkHealth();
        setHealthStatus(result);
        setLastCheckTime(new Date());
        
        logger.info('定时ComfyUI健康检查完成', {
          status: result.status,
          comfyui_status: result.comfyui_status,
          isAvailable: result.status === 'healthy' && result.comfyui_status === 'healthy',
          error: result.error
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
        
        logger.error('定时ComfyUI健康检查异常', error as Error);
      }
    }, 5 * 60 * 1000); // 5分钟 = 5 * 60 * 1000 毫秒

    // 清理定时器
    return () => {
      if (intervalRef.current) {
        logger.info('清理健康检查定时器');
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoCheck, healthService, logger]); // 保留必要的依赖

  return {
    healthStatus,
    isChecking,
    isServiceAvailable,
    lastCheckTime,
    checkHealth,
    error
  };
}; 