'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import type { SilenceRemoveResult } from './ProcessingProgress';
import { http } from '@/lib/api/http-client';

// ---- Types ----

export interface MinimizedTaskState {
  taskId: string;
  videoName: string;
  progress: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: SilenceRemoveResult;
  error?: string;
}

interface MinimizedProgressIndicatorProps {
  task: MinimizedTaskState;
  onRestore: () => void;
  onTaskUpdate: (update: Partial<MinimizedTaskState>) => void;
}

const POLL_INTERVAL_MS = 1500;
const MAX_NETWORK_RETRIES = 3;

// ---- Component ----

const MinimizedProgressIndicator: React.FC<MinimizedProgressIndicatorProps> = ({
  task,
  onRestore,
  onTaskUpdate,
}) => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const json = await http.get<any>(`/api/silence/status/${task.taskId}`);

      if (!json.success) return;

      const data = json.data;
      retryCountRef.current = 0;

      const update: Partial<MinimizedTaskState> = {
        progress: data.progress ?? 0,
        status: data.status,
      };

      if (data.status === 'completed' && data.result) {
        clearPolling();
        update.result = data.result;
      } else if (data.status === 'failed') {
        clearPolling();
        update.error = data.error || '处理失败';
      }

      onTaskUpdate(update);
    } catch {
      retryCountRef.current += 1;
      if (retryCountRef.current >= MAX_NETWORK_RETRIES) {
        clearPolling();
      }
    }
  }, [task.taskId, clearPolling, onTaskUpdate]);

  // Start polling when the task is not terminal
  useEffect(() => {
    if (task.status === 'completed' || task.status === 'failed') {
      clearPolling();
      return;
    }

    retryCountRef.current = 0;
    pollStatus();
    intervalRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);

    return () => {
      clearPolling();
    };
  }, [task.taskId, task.status, pollStatus, clearPolling]);

  // Determine color scheme
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';

  const barColor = isCompleted
    ? 'bg-green-500'
    : isFailed
    ? 'bg-destructive'
    : 'bg-primary';

  const borderColor = isCompleted
    ? 'border-green-500/30'
    : isFailed
    ? 'border-destructive/30'
    : 'border-border';

  const statusText = isCompleted
    ? '处理完成'
    : isFailed
    ? '处理失败'
    : `${Math.round(task.progress)}%`;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 w-[260px] bg-card border ${borderColor} rounded-lg shadow-lg cursor-pointer hover:shadow-xl transition-shadow`}
      onClick={onRestore}
      title="点击恢复弹窗"
    >
      <div className="px-3 py-2.5">
        {/* Header row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Icon */}
            {isCompleted ? (
              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : isFailed ? (
              <svg className="w-4 h-4 text-destructive flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <div className="w-4 h-4 flex-shrink-0">
                <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {/* Video name */}
            <p className="text-xs font-medium text-foreground truncate" title={task.videoName}>
              {task.videoName}
            </p>
          </div>
          <span className={`text-xs font-medium flex-shrink-0 ml-2 ${
            isCompleted ? 'text-green-600 dark:text-green-400' : isFailed ? 'text-destructive' : 'text-muted-foreground'
          }`}>
            {statusText}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
            style={{ width: `${isCompleted ? 100 : isFailed ? 100 : Math.max(task.progress, 2)}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default MinimizedProgressIndicator;
