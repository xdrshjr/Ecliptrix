'use client';

import React, { useEffect, useRef, useState } from 'react';
import { WorkflowExecutionLog, WorkflowNodeExecutionState } from '@/types';

interface WorkflowLogPanelProps {
  logs: WorkflowExecutionLog[];
  nodeStates: Record<string, WorkflowNodeExecutionState>;
  isRunning: boolean;
  currentNodeId: string | null;
}

/**
 * Workflow Log Panel Component
 * Displays execution logs and node input/output information in real-time
 */
const WorkflowLogPanel: React.FC<WorkflowLogPanelProps> = ({
  logs,
  nodeStates,
  isRunning,
  currentNodeId,
}) => {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logsEndRef.current && isExpanded) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isExpanded]);

  // Get icon for log level (Apple-style light colors)
  const getLogIcon = (level: string) => {
    switch (level) {
      case 'info':
        return (
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'success':
        return (
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  // Format timestamp
  const formatTime = (date: Date) => {
    const d = new Date(date);
    const time = d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${time}.${ms}`;
  };

  // Format log details for display
  const formatDetails = (details: any) => {
    if (!details) return null;
    
    try {
      // Handle common patterns
      if (details.input !== undefined) {
        const inputStr = JSON.stringify(details.input, null, 2);
        return (
          <div className="mt-1 text-xs">
            <span className="font-semibold text-foreground">Input:</span>
            <pre className="inline-block text-muted-foreground whitespace-pre-wrap break-words font-mono max-w-full overflow-hidden">
              {inputStr}
            </pre>
          </div>
        );
      }
      if (details.output !== undefined) {
        const outputStr = JSON.stringify(details.output, null, 2);
        return (
          <div className="mt-1 text-xs">
            <span className="font-semibold text-foreground">Output:</span>
            <pre className="inline-block text-muted-foreground whitespace-pre-wrap break-words font-mono max-w-full overflow-hidden">
              {outputStr}
            </pre>
          </div>
        );
      }
      
      // Default: show all details
      const detailsStr = JSON.stringify(details, null, 2);
      if (detailsStr.length > 200) {
        return (
          <details className="mt-1 group">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground font-medium transition-colors select-none">
              View details
            </summary>
            <pre className="mt-2 text-xs bg-card p-3 rounded-md border border-border overflow-x-auto max-h-40 overflow-y-auto font-mono break-words max-w-full">
              {detailsStr}
            </pre>
          </details>
        );
      }
      return (
        <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono max-w-full overflow-hidden">
          {detailsStr}
        </pre>
      );
    } catch (e) {
      return null;
    }
  };

  return (
    <div
      className="flex flex-col bg-card transition-colors duration-300 ease-in-out"
      style={{ height: isExpanded ? '320px' : 'auto' }}
    >
      {/* Header - Apple style light */}
      <div className="px-4 py-3 bg-muted border-b border-border flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-accent rounded-md transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <svg 
              className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-sm font-semibold text-foreground">Execution Logs</h3>
        </div>
        
        <div className="flex items-center space-x-3">
          {isRunning && (
            <div className="flex items-center space-x-2 px-3 py-1 bg-primary/10 border border-primary/30 rounded-full">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
              <span className="text-xs text-primary font-medium">Running</span>
            </div>
          )}
          {currentNodeId && (
            <div className="text-xs text-muted-foreground">
              Current: <span className="text-foreground font-medium">{nodeStates[currentNodeId]?.nodeId}</span>
            </div>
          )}
        </div>
      </div>

      {/* Logs Content - Collapsible */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-sans text-xs bg-muted">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto mb-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm text-muted-foreground font-medium">No logs yet</p>
                <p className="text-xs mt-1 text-muted-foreground">Click Run to start workflow execution</p>
              </div>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className={`
                  p-3 rounded-md border transition-colors duration-200
                  ${log.level === 'error' ? 'bg-red-50/80 border-red-200' : ''}
                  ${log.level === 'warning' ? 'bg-orange-50/80 border-orange-200' : ''}
                  ${log.level === 'success' ? 'bg-green-50/80 border-green-200' : ''}
                  ${log.level === 'info' ? 'bg-card border-border' : ''}
                `}
              >
                <div className="flex items-start space-x-2 min-w-0">
                  <div className="flex-shrink-0 mt-0.5">
                    {getLogIcon(log.level)}
                  </div>
                  
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-baseline space-x-2 flex-wrap">
                      <span className="text-muted-foreground text-xs font-mono">
                        {formatTime(log.timestamp)}
                      </span>
                      {log.nodeName && (
                        <span className="px-2 py-0.5 bg-primary/15 text-primary rounded-md text-xs font-medium">
                          {log.nodeName}
                        </span>
                      )}
                    </div>
                    
                    <div className="mt-1 text-sm text-foreground leading-relaxed break-words">
                      {log.message}
                    </div>
                    
                    {log.details && (
                      <div className="mt-2">
                        {formatDetails(log.details)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Footer Stats - Apple style */}
      {logs.length > 0 && isExpanded && (
        <div className="px-4 py-2 bg-muted border-t border-border text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span className="font-medium">Total logs: {logs.length}</span>
            <div className="flex items-center space-x-4">
              <span className="flex items-center space-x-1.5">
                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                <span>{logs.filter(l => l.level === 'error').length} errors</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                <span>{logs.filter(l => l.level === 'warning').length} warnings</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>{logs.filter(l => l.level === 'success').length} success</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowLogPanel;

