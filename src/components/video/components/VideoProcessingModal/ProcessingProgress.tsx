'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ---- Types ----

export interface SilenceRemoveResult {
  video_url: string;
  original_duration: number;
  new_duration: number;
  removed_count: number;
  time_saved: number;
}

interface ProcessingProgressProps {
  taskId: string;
  videoName: string;
  onComplete: (result: SilenceRemoveResult) => void;
  onError: (error: string) => void;
  onMinimize: (taskId: string, videoName: string) => void;
  onCancel: () => void;
  /** Logging task ID from MaterialsPanel */
  loggingTaskId?: string;
  /** Whether the parent modal is currently visible (used to resume polling after restore from minimized) */
  isVisible?: boolean;
}

// ---- Helpers ----

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) return `${mins}分${secs}秒`;
  return `${secs}秒`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_NETWORK_RETRIES = 3;

// ---- Component ----

const ProcessingProgress: React.FC<ProcessingProgressProps> = ({
  taskId,
  videoName,
  onComplete,
  onError,
  onMinimize,
  onCancel,
  isVisible = true,
}) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'pending' | 'processing' | 'completed' | 'failed'>('pending');
  const [stageMessage, setStageMessage] = useState('准备中...');
  const [result, setResult] = useState<SilenceRemoveResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const startTimeRef = useRef(Date.now());
  const hasCompletedRef = useRef(false);

  // Store callbacks in refs to avoid recreating pollStatus when parent re-renders
  // with new inline function references. This prevents the polling useEffect from
  // restarting (which would reset startTime, hasCompleted, and retryCount).
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    // Check timeout
    if (Date.now() - startTimeRef.current > TIMEOUT_MS) {
      setIsTimedOut(true);
      clearPolling();
      return;
    }

    try {
      const res = await fetch(`/api/silence/status/${taskId}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || `查询进度失败 (${res.status})`);
      }

      const data = json.data;
      retryCountRef.current = 0;
      setNetworkError(false);

      setProgress(data.progress ?? 0);
      setStatus(data.status);
      setStageMessage(data.stage_message || '处理中...');

      if (data.status === 'completed' && data.result && !hasCompletedRef.current) {
        hasCompletedRef.current = true;
        clearPolling();
        setResult(data.result);
        onCompleteRef.current(data.result);
      } else if (data.status === 'failed') {
        clearPolling();
        const errMsg = data.error || '处理失败';
        setErrorMessage(errMsg);
        onErrorRef.current(errMsg);
      }
    } catch (err) {
      retryCountRef.current += 1;
      if (retryCountRef.current >= MAX_NETWORK_RETRIES) {
        setNetworkError(true);
        clearPolling();
      }
    }
  }, [taskId, clearPolling]);

  // Start polling on mount
  useEffect(() => {
    startTimeRef.current = Date.now();
    hasCompletedRef.current = false;
    retryCountRef.current = 0;

    // Initial poll
    pollStatus();

    intervalRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);

    return () => {
      clearPolling();
    };
  }, [taskId, pollStatus, clearPolling]);

  // Resume polling when modal becomes visible again (after restore from minimized state).
  // The initial mount effect handles the first start; this handles subsequent restores.
  const prevVisibleRef = useRef(isVisible);
  useEffect(() => {
    const wasHidden = !prevVisibleRef.current;
    prevVisibleRef.current = isVisible;

    if (isVisible && wasHidden && !intervalRef.current) {
      // Only resume if task is still in a non-terminal state
      if (status !== 'completed' && status !== 'failed' && !isTimedOut && !networkError) {
        retryCountRef.current = 0;
        pollStatus();
        intervalRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
      }
    }
  }, [isVisible, status, isTimedOut, networkError, pollStatus]);

  // Retry handler for network errors
  const handleRetry = useCallback(() => {
    retryCountRef.current = 0;
    setNetworkError(false);
    pollStatus();
    intervalRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
  }, [pollStatus]);

  // Handle cancel (stop polling only — backend task continues)
  const handleCancel = useCallback(() => {
    clearPolling();
    onCancel();
  }, [clearPolling, onCancel]);

  // Handle minimize
  const handleMinimize = useCallback(() => {
    // Stop polling in this component — the MinimizedProgressIndicator will take over
    clearPolling();
    onMinimize(taskId, videoName);
  }, [clearPolling, onMinimize, taskId, videoName]);

  // Estimated remaining time
  const elapsed = (Date.now() - startTimeRef.current) / 1000;
  const estimatedTotal = progress > 5 ? (elapsed / progress) * 100 : 0;
  const estimatedRemaining = Math.max(0, estimatedTotal - elapsed);

  // ---- COMPLETED STATE ----
  if (status === 'completed' && result) {
    const savingPct = result.original_duration > 0
      ? ((result.time_saved / result.original_duration) * 100).toFixed(1)
      : '0';

    return (
      <div className="flex flex-col items-center py-8 px-6">
        {/* Success icon */}
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">处理完成</h3>
        <p className="text-sm text-muted-foreground mb-6">{videoName}</p>

        {/* Stats card */}
        <div className="w-full max-w-sm bg-muted/50 rounded-lg border border-border p-4 space-y-3 mb-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">原时长</span>
            <span className="font-medium text-foreground">{formatDuration(result.original_duration)}</span>
          </div>
          <div className="flex items-center justify-center">
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">新时长</span>
            <span className="font-medium text-green-600 dark:text-green-400">{formatDuration(result.new_duration)}</span>
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">移除静音段</span>
              <span className="font-medium text-foreground">{result.removed_count} 段</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">节省时间</span>
              <span className="font-medium text-green-600 dark:text-green-400">
                {result.time_saved.toFixed(1)}秒 ({savingPct}%)
              </span>
            </div>
          </div>
        </div>

        {/* Note: "完成" button is handled by the parent (SilenceRemovalTab) action bar */}
      </div>
    );
  }

  // ---- FAILED STATE ----
  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center py-12 px-6">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">处理失败</h3>
        <p className="text-sm text-destructive mb-4">{errorMessage || '未知错误'}</p>
      </div>
    );
  }

  // ---- NETWORK ERROR STATE ----
  if (networkError) {
    return (
      <div className="flex flex-col items-center py-12 px-6">
        <div className="w-16 h-16 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">网络异常</h3>
        <p className="text-sm text-muted-foreground mb-4">无法连接服务器，请检查网络后重试</p>
        <button
          type="button"
          onClick={handleRetry}
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  // ---- TIMEOUT STATE ----
  if (isTimedOut) {
    return (
      <div className="flex flex-col items-center py-12 px-6">
        <div className="w-16 h-16 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">处理超时</h3>
        <p className="text-sm text-muted-foreground mb-4">
          已等待超过30分钟，后端任务可能仍在运行。请稍后检查素材面板。
        </p>
      </div>
    );
  }

  // ---- PROCESSING / PENDING STATE ----
  return (
    <div className="flex flex-col items-center py-10 px-6">
      {/* Video name */}
      <p className="text-sm font-medium text-foreground mb-6 truncate max-w-full" title={videoName}>
        {videoName}
      </p>

      {/* Animated progress bar */}
      <div className="w-full max-w-md mb-3">
        <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>
      </div>

      {/* Progress percentage + stage message */}
      <div className="flex items-center justify-between w-full max-w-md mb-2">
        <p className="text-xs text-muted-foreground truncate flex-1">{stageMessage}</p>
        <span className="text-sm font-medium text-foreground ml-3">{Math.round(progress)}%</span>
      </div>

      {/* Estimated remaining time */}
      {estimatedRemaining > 0 && progress > 5 && (
        <p className="text-xs text-muted-foreground mb-6">
          预计剩余 {formatTime(estimatedRemaining)}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={handleMinimize}
          className="px-3 py-1.5 text-xs rounded-md bg-muted text-foreground border border-border hover:bg-accent transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          最小化
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
};

export default ProcessingProgress;
