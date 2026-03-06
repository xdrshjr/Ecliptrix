'use client';

import React from 'react';
import { BaseWorkflowNode, BaseNodeProps } from './BaseWorkflowNode';
import { VideoExportNodeConfig } from '@/types';

/**
 * Video Export Node Component
 * Exports video URLs to Materials Management format for Video Editing
 * Features elegant blue color scheme following Apple design principles
 * Memoized to prevent unnecessary re-renders during drag operations
 */
const VideoExportNode: React.FC<BaseNodeProps> = React.memo((props) => {
  const { id, data, selected, onDelete, onPortMouseDown, executionStatus } = props;
  
  const config = data.config as VideoExportNodeConfig | undefined;
  const isConfigured = !!(config?.videoUrls);
  
  // Parse video URLs from config
  let videoUrlsArray: string[] = [];
  if (config?.videoUrls) {
    if (typeof config.videoUrls === 'string') {
      try {
        // Try to parse as JSON array first
        const parsed = JSON.parse(config.videoUrls);
        if (Array.isArray(parsed)) {
          videoUrlsArray = parsed;
        } else {
          // Single URL string
          videoUrlsArray = [config.videoUrls];
        }
      } catch {
        // Not JSON, treat as single URL
        videoUrlsArray = [config.videoUrls];
      }
    } else if (Array.isArray(config.videoUrls)) {
      videoUrlsArray = config.videoUrls;
    }
  }
  
  const videoCount = videoUrlsArray.length;
  
  console.log('[VideoExportNode] Rendering node:', { 
    id, 
    label: data.label, 
    selected,
    hasConfig: !!config,
    videoCount,
    executionStatus
  });

  return (
    <BaseWorkflowNode
      {...props}
      config={{
        icon: (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        ),
        gradientColors: isConfigured 
          ? 'bg-gradient-to-r from-blue-500 to-blue-600' 
          : 'bg-gradient-to-r from-blue-400 to-blue-500',
        hasInputPort: true,
        hasOutputPort: true,
        inputPortLabel: 'Videos',
        outputPortLabel: 'Materials',
        isConfigured,
        renderContent: () => (
          isConfigured ? (
            <div className="text-xs space-y-1.5">
              {/* Video Count Badge */}
              <div className="pt-1">
                <div className="flex items-center justify-center">
                  <div className="inline-flex items-center px-3 py-1.5 bg-blue-100 border border-blue-300 rounded-md">
                    <svg className="w-4 h-4 text-blue-700 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-semibold text-blue-700">
                      {videoCount} {videoCount === 1 ? 'Video' : 'Videos'}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Input Format */}
              <div className="flex items-center justify-between pt-1 border-t border-border">
                <span className="text-muted-foreground font-medium">Format:</span>
                <span className="text-foreground text-xs capitalize">
                  {config?.inputFormat || 'auto'}
                </span>
              </div>
              
              {/* Export Info */}
              <div className="pt-1 border-t border-border">
                <div className="text-center">
                  <div className="inline-flex items-center px-2 py-1 bg-blue-50 border border-blue-200 rounded-md">
                    <svg className="w-3 h-3 text-blue-600 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-medium text-blue-600">Export to Materials</span>
                  </div>
                </div>
              </div>
              
              {/* Video URLs Preview */}
              {videoCount > 0 && (
                <div className="pt-1 border-t border-border">
                  <div className="text-muted-foreground font-medium mb-0.5">Video URLs:</div>
                  <div className="text-foreground text-xs bg-muted p-1.5 rounded max-h-16 overflow-y-auto">
                    {videoUrlsArray.slice(0, 3).map((url, index) => (
                      <div key={index} className="truncate" title={url}>
                        {index + 1}. {url.substring(0, 40)}...
                      </div>
                    ))}
                    {videoCount > 3 && (
                      <div className="text-muted-foreground italic mt-0.5">
                        +{videoCount - 3} more...
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Last Execution Info */}
              {config?.lastExecutionTime && (
                <div className="pt-1 border-t border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium">Status:</span>
                    <span className={`text-xs font-semibold ${
                      config.lastExecutionSuccess ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {config.lastExecutionSuccess ? '✓ Success' : '✗ Failed'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-center py-1">
              <div className="text-muted-foreground italic">Not configured</div>
              <div className="text-xs text-muted-foreground mt-0.5">Double click to configure</div>
              <div className="mt-2 flex items-center justify-center">
                <div className="inline-flex items-center px-2 py-1 bg-blue-50 border border-blue-200 rounded-md">
                  <svg className="w-3 h-3 text-blue-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="text-xs font-medium text-blue-500">Export Videos</span>
                </div>
              </div>
            </div>
          )
        ),
      }}
    />
  );
});

VideoExportNode.displayName = 'VideoExportNode';

export default VideoExportNode;

