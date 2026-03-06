'use client';

import React, { useState, useEffect } from 'react';
import { WorkflowNode } from '@/types';

interface WorkflowEditModalProps {
  isOpen: boolean;
  workflowId: string;
  workflowName: string;
  workflowDescription: string;
  nodes: WorkflowNode[];
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
}

/**
 * Workflow Edit Modal Component
 * 
 * Displays a modal for editing workflow details including:
 * - Workflow name (editable)
 * - Workflow description (editable)
 * - List of all nodes in the workflow (read-only)
 * 
 * Design: Apple-style light, clean and elegant
 */
const WorkflowEditModal: React.FC<WorkflowEditModalProps> = ({
  isOpen,
  workflowId,
  workflowName,
  workflowDescription,
  nodes,
  onClose,
  onSave,
}) => {
  const [editedName, setEditedName] = useState(workflowName);
  const [editedDescription, setEditedDescription] = useState(workflowDescription);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  console.log('[WorkflowEditModal] Rendering modal:', {
    isOpen,
    workflowId,
    workflowName,
    nodesCount: nodes.length,
    timestamp: new Date().toISOString()
  });

  // Reset form when modal opens or workflow changes
  useEffect(() => {
    if (isOpen) {
      console.log('[WorkflowEditModal] Modal opened, resetting form state');
      setEditedName(workflowName);
      setEditedDescription(workflowDescription);
      setHasChanges(false);
    }
  }, [isOpen, workflowName, workflowDescription, workflowId]);

  // Check if there are changes
  useEffect(() => {
    const nameChanged = editedName !== workflowName;
    const descriptionChanged = editedDescription !== workflowDescription;
    setHasChanges(nameChanged || descriptionChanged);
  }, [editedName, editedDescription, workflowName, workflowDescription]);

  // Handle save
  const handleSave = async () => {
    if (!hasChanges) {
      console.log('[WorkflowEditModal] No changes to save');
      onClose();
      return;
    }

    if (!editedName.trim()) {
      console.warn('[WorkflowEditModal] Cannot save: workflow name is empty');
      return;
    }

    try {
      setIsSaving(true);
      console.log('[WorkflowEditModal] Saving workflow changes:', {
        workflowId,
        oldName: workflowName,
        newName: editedName,
        oldDescription: workflowDescription,
        newDescription: editedDescription
      });

      await onSave(editedName.trim(), editedDescription.trim());

      console.log('[WorkflowEditModal] Workflow saved successfully');
      onClose();
    } catch (error) {
      console.error('[WorkflowEditModal] Error saving workflow:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle cancel
  const handleCancel = () => {
    console.log('[WorkflowEditModal] Cancelling edit, hasChanges:', hasChanges);
    onClose();
  };

  // Get node type display name
  const getNodeTypeDisplayName = (type: string): string => {
    const typeMap: Record<string, string> = {
      'start': 'Start',
      'end': 'End',
      'chat-llm': 'Chat LLM',
      'text-input': 'Text Input',
      'pexels-video-search': 'Pexels Video Search',
      'tavily-search': 'Tavily Search',
      'volcano-tts': 'Volcano TTS',
      'to-array': 'To Array',
      'results-combine': 'Results Combine',
      'ai-video-generate': 'AI Video Generate',
      'video-export': 'Video Export',
    };
    return typeMap[type] || type;
  };

  // Get node type icon
  const getNodeTypeIcon = (type: string): React.ReactNode => {
    switch (type) {
      case 'start':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'end':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
        );
      case 'chat-llm':
      case 'to-array':
      case 'results-combine':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        );
      case 'text-input':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      case 'pexels-video-search':
      case 'video-export':
      case 'ai-video-generate':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case 'tavily-search':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        );
      case 'volcano-tts':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
          </svg>
        );
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
      {/* Backdrop - covers only the right panel, leaving sidebar visible */}
      <div 
        className="absolute inset-0 bg-black/50 transition-opacity pointer-events-auto"
        onClick={handleCancel}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-md w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden pointer-events-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  Edit Workflow
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Modify workflow details and view nodes
                </p>
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-accent rounded-md transition-colors"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-6">
            {/* Workflow Name */}
            <div>
              <label htmlFor="workflow-name" className="block text-sm font-medium text-foreground mb-2">
                Workflow Name <span className="text-red-500">*</span>
              </label>
              <input
                id="workflow-name"
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                className="w-full px-4 py-2.5 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors text-foreground placeholder-muted-foreground"
                placeholder="Enter workflow name"
              />
              {!editedName.trim() && (
                <p className="text-xs text-red-500 mt-1.5">
                  Workflow name is required
                </p>
              )}
            </div>

            {/* Workflow Description */}
            <div>
              <label htmlFor="workflow-description" className="block text-sm font-medium text-foreground mb-2">
                Description
              </label>
              <textarea
                id="workflow-description"
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-2.5 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors text-foreground placeholder-muted-foreground resize-none"
                placeholder="Enter workflow description (optional)"
              />
            </div>

            {/* Nodes List */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-foreground">
                  Workflow Nodes
                </label>
                <span className="text-xs text-muted-foreground bg-accent px-2 py-1 rounded-full">
                  {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
                </span>
              </div>
              
              {nodes.length === 0 ? (
                <div className="bg-muted rounded-md p-6 text-center">
                  <div className="w-12 h-12 bg-secondary rounded-md mx-auto mb-3 flex items-center justify-center">
                    <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No nodes in this workflow yet
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Add nodes in the workflow canvas
                  </p>
                </div>
              ) : (
                <div className="bg-muted rounded-md border border-border divide-y divide-border max-h-80 overflow-y-auto">
                  {nodes.map((node, index) => (
                    <div 
                      key={node.id}
                      className="px-4 py-3 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-card border border-border rounded-md flex items-center justify-center text-primary">
                            {getNodeTypeIcon(node.type)}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <p className="text-sm font-medium text-foreground truncate">
                              {node.data.label}
                            </p>
                            <span className="text-xs text-muted-foreground bg-card px-2 py-0.5 rounded border border-border flex-shrink-0">
                              {getNodeTypeDisplayName(node.type)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            ID: {node.id}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          <span className="text-xs text-muted-foreground font-mono">
                            #{index + 1}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {hasChanges ? (
                <span className="flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                  <span>Unsaved changes</span>
                </span>
              ) : (
                <span>No changes</span>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !hasChanges || !editedName.trim()}
                className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-[var(--primary-hover)] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring"
              >
                {isSaving ? (
                  <span className="flex items-center space-x-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Saving...</span>
                  </span>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowEditModal;

