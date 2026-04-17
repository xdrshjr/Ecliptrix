'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { loadAgentWorkflows, WorkflowRecord } from '@/lib/api/workflow';

interface ChatTypeSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectChatbot: () => void;
  onSelectWorkflow: (workflowId: string, workflowName: string, nodes: any[], connections: any[]) => void;
  onSelectAgent: () => void;
}

/**
 * Chat Type Selection Modal Component
 * 
 * Apple light design style: clean, elegant, minimalist
 * Features:
 * - Three sections: Chatbot, Workflow, Agent
 * - Allows user to select chat type for new conversation
 * - Beautiful animations and hover effects
 * - Responsive layout
 */
const ChatTypeSelectionModal: React.FC<ChatTypeSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelectChatbot,
  onSelectWorkflow,
  onSelectAgent,
}) => {
  const { user, isAuthenticated } = useAuth();
  const { t } = useLocale();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<'chatbot' | 'workflow' | 'agent'>('chatbot');

  // Load workflows when modal opens and workflow section is selected
  useEffect(() => {
    const fetchWorkflows = async () => {
      if (!isOpen || !isAuthenticated || !user || selectedSection !== 'workflow') {
        console.log('[ChatTypeSelectionModal] Skipping workflow load:', {
          isOpen,
          isAuthenticated,
          hasUser: !!user,
          selectedSection
        });
        return;
      }

      setIsLoadingWorkflows(true);
      setWorkflowError(null);

      try {
        console.log('[ChatTypeSelectionModal] Loading workflows for user:', user.id);
        
        const response = await loadAgentWorkflows(user.id);
        
        if (response.success && response.data) {
          console.log('[ChatTypeSelectionModal] Workflows loaded successfully:', {
            count: response.data.length
          });
          setWorkflows(response.data);
        } else {
          throw new Error(response.message || 'Failed to load workflows');
        }
      } catch (err) {
        console.error('[ChatTypeSelectionModal] Error loading workflows:', err);
        setWorkflowError(err instanceof Error ? err.message : 'Failed to load workflows');
      } finally {
        setIsLoadingWorkflows(false);
      }
    };

    fetchWorkflows();
  }, [isOpen, isAuthenticated, user, selectedSection]);

  // Handle chatbot selection
  const handleSelectChatbot = () => {
    console.log('[ChatTypeSelectionModal] Chatbot type selected');
    onSelectChatbot();
    onClose();
  };

  // Handle workflow selection
  const handleSelectWorkflow = (workflow: WorkflowRecord) => {
    console.log('[ChatTypeSelectionModal] Workflow selected:', {
      workflow_id: workflow.workflow_id,
      workflow_name: workflow.workflow_name,
      nodesCount: workflow.nodes?.length || 0,
      connectionsCount: workflow.connections?.length || 0
    });
    onSelectWorkflow(
      workflow.workflow_id, 
      workflow.workflow_name,
      workflow.nodes || [],
      workflow.connections || []
    );
    onClose();
  };

  // Handle agent selection (reserved for future)
  const handleSelectAgent = () => {
    console.log('[ChatTypeSelectionModal] Agent type selected (reserved for future)');
    onSelectAgent();
    onClose();
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      console.log('[ChatTypeSelectionModal] Backdrop clicked, closing modal');
      onClose();
    }
  };

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-colors"
      onClick={handleBackdropClick}
    >
      {/* Modal Container */}
      <div className="relative w-full max-w-5xl mx-4 bg-card rounded-md shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="px-8 py-6 bg-card border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-primary rounded-md flex items-center justify-center">
                <svg className="w-6 h-6 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-foreground">{t.aiChat.chatTypeModal.title}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{t.aiChat.chatTypeModal.subtitle}</p>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="px-8 pt-6 pb-4 bg-card border-b border-border">
          <div className="flex space-x-2">
            <button
              onClick={() => setSelectedSection('chatbot')}
              className={`flex-1 px-6 py-3 rounded-md font-medium transition-colors ${
                selectedSection === 'chatbot'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent text-muted-foreground hover:bg-accent'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <span>{t.aiChat.chatTypeModal.chatbotTab}</span>
              </div>
            </button>
            
            <button
              onClick={() => setSelectedSection('workflow')}
              className={`flex-1 px-6 py-3 rounded-md font-medium transition-colors ${
                selectedSection === 'workflow'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-accent text-muted-foreground hover:bg-accent'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                </svg>
                <span>{t.aiChat.chatTypeModal.workflowTab}</span>
              </div>
            </button>
            
            <button
              onClick={() => setSelectedSection('agent')}
              className={`flex-1 px-6 py-3 rounded-md font-medium transition-colors ${
                selectedSection === 'agent'
                  ? 'bg-green-600 text-primary-foreground'
                  : 'bg-accent text-muted-foreground hover:bg-accent'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span>{t.aiChat.chatTypeModal.agentTab}</span>
              </div>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6 max-h-[60vh] overflow-y-auto">
          {/* Chatbot Section */}
          {selectedSection === 'chatbot' && (
            <div className="space-y-4">
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-primary/15 rounded-md flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">{t.aiChat.chatTypeModal.basicChatbot}</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
                  {t.aiChat.chatTypeModal.chatbotDesc}
                </p>
                <button
                  onClick={handleSelectChatbot}
                  className="px-8 py-3 bg-primary text-primary-foreground rounded-md hover:bg-[var(--primary-hover)] transition-colors font-medium"
                >
                  {t.aiChat.chatTypeModal.startChatbot}
                </button>
              </div>
              
              {/* Features */}
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
                <div className="text-center p-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-md flex items-center justify-center mx-auto mb-2">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-foreground">{t.aiChat.chatTypeModal.fastResponse}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.aiChat.chatTypeModal.quickAnswers}</p>
                </div>

                <div className="text-center p-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-md flex items-center justify-center mx-auto mb-2">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-foreground">{t.aiChat.chatTypeModal.naturalChat}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.aiChat.chatTypeModal.conversational}</p>
                </div>

                <div className="text-center p-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-md flex items-center justify-center mx-auto mb-2">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-foreground">{t.aiChat.chatTypeModal.easyToUse}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.aiChat.chatTypeModal.noSetupNeeded}</p>
                </div>
              </div>
            </div>
          )}

          {/* Workflow Section */}
          {selectedSection === 'workflow' && (
            <div>
              {isLoadingWorkflows ? (
                // Loading State
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 bg-primary rounded-md flex items-center justify-center mb-4 animate-pulse">
                    <svg className="w-8 h-8 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                    </svg>
                  </div>
                  <p className="text-sm text-muted-foreground">{t.aiChat.chatTypeModal.loadingWorkflows}</p>
                </div>
              ) : workflowError ? (
                // Error State
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 bg-destructive/15 rounded-md flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-foreground mb-2">{t.aiChat.chatTypeModal.failedToLoadWorkflows}</p>
                  <p className="text-sm text-muted-foreground text-center max-w-md">{workflowError}</p>
                  <button
                    onClick={() => {
                      setWorkflowError(null);
                      setIsLoadingWorkflows(true);
                      setTimeout(() => setIsLoadingWorkflows(false), 100);
                    }}
                    className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-[var(--primary-hover)] transition-colors text-sm font-medium"
                  >
                    {t.aiChat.chatTypeModal.retry}
                  </button>
                </div>
              ) : workflows.length === 0 ? (
                // Empty State
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 bg-accent rounded-md flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-foreground mb-2">{t.aiChat.chatTypeModal.noWorkflows}</p>
                  <p className="text-sm text-muted-foreground text-center max-w-md">
                    {t.aiChat.chatTypeModal.createWorkflowFirst}
                  </p>
                </div>
              ) : (
                // Workflows Grid
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {workflows.map((workflow) => (
                    <button
                      key={workflow.workflow_id}
                      onClick={() => handleSelectWorkflow(workflow)}
                      className="group relative p-5 bg-card border border-border rounded-md hover:border-primary/40 transition-colors duration-200 text-left"
                    >
                      {/* Workflow Icon */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-12 h-12 bg-primary/15 rounded-md flex items-center justify-center transition-transform">
                          <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                        
                        {/* Active Badge */}
                        {workflow.is_active && (
                          <span className="px-2 py-1 bg-green-500/15 text-green-500 text-xs font-medium rounded-lg">
                            {t.aiChat.chatTypeModal.active}
                          </span>
                        )}
                      </div>
                      
                      {/* Workflow Info */}
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                          {workflow.workflow_name}
                        </h3>
                        
                        {workflow.workflow_description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {workflow.workflow_description}
                          </p>
                        )}

                        {/* Workflow Stats */}
                        <div className="flex items-center space-x-3 text-xs text-muted-foreground pt-2">
                          <div className="flex items-center space-x-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                            </svg>
                            <span>{workflow.nodes?.length || 0} {t.aiChat.chatTypeModal.nodes}</span>
                          </div>
                          
                          <div className="flex items-center space-x-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            <span>v{workflow.version}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Hover Indicator */}
                      <div className="absolute inset-0 rounded-md ring-2 ring-ring ring-opacity-0 group-hover:ring-opacity-100 transition-colors pointer-events-none" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Agent Section */}
          {selectedSection === 'agent' && (
            <div className="space-y-4">
              <div className="text-center py-8">
                <div className="w-20 h-20 bg-green-500/15 rounded-md flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">{t.aiChat.chatTypeModal.aiAgentTitle}</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
                  {t.aiChat.chatTypeModal.agentDesc}
                </p>
                
                {/* Coming Soon Badge */}
                <div className="inline-flex items-center space-x-2 px-4 py-2 bg-accent rounded-md">
                  <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-foreground">{t.aiChat.chatTypeModal.comingSoon}</span>
                </div>
              </div>
              
              {/* Planned Features */}
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
                <div className="text-center p-4">
                  <div className="w-12 h-12 bg-green-500/10 rounded-md flex items-center justify-center mx-auto mb-2">
                    <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-foreground">{t.aiChat.chatTypeModal.taskPlanning}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.aiChat.chatTypeModal.multiStepTasks}</p>
                </div>

                <div className="text-center p-4">
                  <div className="w-12 h-12 bg-green-500/10 rounded-md flex items-center justify-center mx-auto mb-2">
                    <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-foreground">{t.aiChat.chatTypeModal.webSearch}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.aiChat.chatTypeModal.realtimeInfo}</p>
                </div>

                <div className="text-center p-4">
                  <div className="w-12 h-12 bg-green-500/10 rounded-md flex items-center justify-center mx-auto mb-2">
                    <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-foreground">{t.aiChat.chatTypeModal.codeExecution}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.aiChat.chatTypeModal.runCodeSafely}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-4 bg-muted border-t border-border">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {selectedSection === 'workflow' && !isLoadingWorkflows && !workflowError && workflows.length > 0 && (
                t.aiChat.chatTypeModal.workflowsAvailable.replace('{count}', String(workflows.length))
              )}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-card border border-border text-foreground rounded-md hover:bg-accent transition-colors text-sm font-medium"
            >
              {t.aiChat.chatTypeModal.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatTypeSelectionModal;

