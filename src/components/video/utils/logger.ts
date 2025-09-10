import { LoggerConfig, LogEntry } from '../types';

/**
 * 统一的视频编辑日志工具类
 * 提供结构化的日志记录功能，支持不同日志级别和详细的上下文信息
 */
export class VideoEditingLogger {
  private config: LoggerConfig;

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  /**
   * 记录信息级别日志
   */
  info(action: string, data?: Record<string, any>) {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      taskId: this.config.taskId,
      component: this.config.component,
      action,
      data
    };

    console.log(`[${this.config.component}] ${action}`, {
      taskId: this.config.taskId,
      ...data,
      timestamp: logEntry.timestamp
    });
  }

  /**
   * 记录调试级别日志
   */
  debug(action: string, data?: Record<string, any>) {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      taskId: this.config.taskId,
      component: this.config.component,
      action,
      data
    };

    console.debug(`[${this.config.component}] ${action}`, {
      taskId: this.config.taskId,
      ...data,
      timestamp: logEntry.timestamp
    });
  }

  /**
   * 记录警告级别日志
   */
  warn(action: string, data?: Record<string, any>) {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      taskId: this.config.taskId,
      component: this.config.component,
      action,
      data
    };

    console.warn(`[${this.config.component}] ${action}`, {
      taskId: this.config.taskId,
      ...data,
      timestamp: logEntry.timestamp
    });
  }

  /**
   * 记录错误级别日志
   */
  error(action: string, error: Error, data?: Record<string, any>): void;
  error(action: string, data: Record<string, any>): void;
  error(action: string, errorOrData: Error | Record<string, any>, data?: Record<string, any>) {
    let error: Error | undefined;
    let actualData: Record<string, any> | undefined;

    if (errorOrData instanceof Error) {
      error = errorOrData;
      actualData = data;
    } else {
      actualData = errorOrData;
    }

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      taskId: this.config.taskId,
      component: this.config.component,
      action,
      error,
      data: actualData
    };

    console.error(`[${this.config.component}] ${action}`, {
      taskId: this.config.taskId,
      error: error?.message,
      stack: error?.stack,
      ...actualData,
      timestamp: logEntry.timestamp
    });
  }

  /**
   * 记录性能指标
   */
  performance(action: string, startTime: number, endTime: number, data?: Record<string, any>) {
    const duration = endTime - startTime;
    
    this.info(`性能指标 - ${action}`, {
      duration: `${duration}ms`,
      startTime,
      endTime,
      ...data
    });
  }

  /**
   * 记录用户操作
   */
  userAction(action: string, target?: string, context?: Record<string, any>) {
    this.info('用户操作', {
      action,
      target,
      context,
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'server'
    });
  }

  /**
   * 记录状态变化
   */
  stateChange(action: string, previousState: any, newState: any, context?: Record<string, any>) {
    this.info('状态变化', {
      action,
      previousState,
      newState,
      context
    });
  }

  /**
   * 记录API调用
   */
  apiCall(action: string, endpoint: string, params?: any, context?: Record<string, any>) {
    this.info('API调用开始', {
      action,
      endpoint,
      params,
      context
    });
  }

  /**
   * 记录API调用完成
   */
  apiComplete(action: string, endpoint: string, success: boolean, responseTime?: number, context?: Record<string, any>) {
    this.info('API调用完成', {
      action,
      endpoint,
      success,
      responseTime: responseTime ? `${responseTime}ms` : undefined,
      context
    });
  }

  /**
   * 记录API调用错误
   */
  apiError(action: string, endpoint: string, error: Error, context?: Record<string, any>) {
    this.error('API调用失败', error, {
      action,
      endpoint,
      context
    });
  }
} 