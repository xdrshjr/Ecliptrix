'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Conversation, ChatMessage, ChatTaskContent, WorkflowExecutionState } from '@/types';
import ConversationList from './ConversationList';
import ChatWindow from './ChatWindow';
import ChatTypeSelectionModal from './ChatTypeSelectionModal';
import { WorkflowExecutor } from '@/components/workflow/WorkflowExecutor';
import { http, ApiError } from '@/lib/api/http-client';
import { useLocale } from '@/contexts/LocaleContext';
import { dlog } from '@/lib/utils/debugLog';

interface ChatInterfaceProps {
  taskId: string;
  content: ChatTaskContent | null;
  onUpdateContent: (content: ChatTaskContent) => void;
  onModalStateChange?: (isOpen: boolean) => void;
  onNavigateToVideoEditing?: (materials: any[]) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  taskId,
  content,
  onUpdateContent,
  onModalStateChange,
  onNavigateToVideoEditing,
}) => {
  const { t } = useLocale();
  // Initialize content if null
  const chatContent: ChatTaskContent = content || {
    conversations: [],
    activeConversationId: null,
    uiState: {},
  };

  // Restore UI state from content or use defaults
  const [isLoading, setIsLoading] = useState(chatContent.uiState?.isLoading ?? false);
  const [isChatTypeModalOpen, setIsChatTypeModalOpen] = useState(chatContent.uiState?.isChatTypeModalOpen ?? false);
  const hasAutoInitialized = useRef(chatContent.uiState?.hasAutoInitialized ?? false);

  // Mount/restore log — moved out of the render path into a [taskId] effect
  // so it doesn't fire on every parent re-render. (Previously triggered noisy
  // log spam on every keystroke in the chat input.)
  useEffect(() => {
    dlog('[ChatInterface] Mount/restore state', {
      taskId,
      hasContent: !!content,
      conversationsCount: chatContent.conversations.length,
      activeConversationId: chatContent.activeConversationId,
      hasAutoInitialized: hasAutoInitialized.current,
      timestamp: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Persist UI state to content whenever it changes.
  //
  // The deps array is intentionally narrow ([isLoading, isChatTypeModalOpen,
  // taskId]). Adding `chatContent` / `onUpdateContent` would cause re-render
  // storms — onUpdateContent updates chatContent in the parent, which makes a
  // new chatContent reference, which re-runs this effect. The hasStateChanged
  // guard already prevents the infinite-loop class of bug.
  useEffect(() => {
    const updatedContent: ChatTaskContent = {
      ...chatContent,
      uiState: {
        isLoading,
        isChatTypeModalOpen,
        hasAutoInitialized: hasAutoInitialized.current,
      },
    };

    const hasStateChanged =
      chatContent.uiState?.isLoading !== isLoading ||
      chatContent.uiState?.isChatTypeModalOpen !== isChatTypeModalOpen ||
      chatContent.uiState?.hasAutoInitialized !== hasAutoInitialized.current;

    if (hasStateChanged) {
      dlog('[ChatInterface] Persisting UI state', {
        taskId,
        isLoading,
        isChatTypeModalOpen,
        hasAutoInitialized: hasAutoInitialized.current,
        timestamp: new Date().toISOString(),
      });
      onUpdateContent(updatedContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isChatTypeModalOpen, taskId]);

  const handleNewChatClick = useCallback(() => {
    dlog('[ChatInterface] New Chat button clicked, opening chat type selection modal');
    setIsChatTypeModalOpen(true);
    onModalStateChange?.(true);
  }, [onModalStateChange]);

  const handleCreateConversation = useCallback((
    chatType: 'chatbot' | 'workflow' | 'agent',
    workflowId?: string,
    workflowName?: string,
    workflowNodes?: any[],
    workflowConnections?: any[]
  ) => {
    const now = new Date();
    const conversationId = `conv-${Date.now()}`;
    
    dlog('[ChatInterface] Creating new conversation:', {
      conversationId,
      chatType,
      workflowId,
      workflowName,
      hasNodes: !!workflowNodes,
      hasConnections: !!workflowConnections,
      nodesCount: workflowNodes?.length || 0,
      connectionsCount: workflowConnections?.length || 0,
      timestamp: now.toISOString()
    });
    
    // Determine conversation title based on chat type
    let title = t.aiChat.conversationList.newChat;
    if (chatType === 'workflow' && workflowName) {
      title = `${workflowName} Chat`;
    } else if (chatType === 'chatbot') {
      title = t.aiChat.conversationList.chatbot;
    } else if (chatType === 'agent') {
      title = t.aiChat.conversationList.aiAgent;
    }
    
    const newConversation: Conversation = {
      id: conversationId,
      title,
      messages: [],
      createdAt: now,
      updatedAt: now,
      chatType,
      workflowId,
      workflowName,
      workflowNodes,
      workflowConnections,
    };

    const updatedContent: ChatTaskContent = {
      conversations: [...chatContent.conversations, newConversation],
      activeConversationId: conversationId,
    };

    onUpdateContent(updatedContent);
    dlog(`[ChatInterface] Created new conversation:`, {
      conversationId,
      chatType,
      workflowId,
      workflowName,
      nodesCount: workflowNodes?.length || 0,
      connectionsCount: workflowConnections?.length || 0
    });
  }, [chatContent, onUpdateContent]);

  const handleCloseModal = useCallback(() => {
    dlog('[ChatInterface] Closing chat type selection modal');
    setIsChatTypeModalOpen(false);
    onModalStateChange?.(false);
  }, [onModalStateChange]);

  const handleChatbotSelect = useCallback(() => {
    dlog('[ChatInterface] Chatbot type selected for new conversation');
    handleCreateConversation('chatbot');
    handleCloseModal();
  }, [handleCreateConversation, handleCloseModal]);

  const handleWorkflowSelect = useCallback((workflowId: string, workflowName: string, nodes: any[], connections: any[]) => {
    dlog('[ChatInterface] Workflow selected for new conversation:', {
      workflowId,
      workflowName,
      nodesCount: nodes?.length || 0,
      connectionsCount: connections?.length || 0
    });
    handleCreateConversation('workflow', workflowId, workflowName, nodes, connections);
    handleCloseModal();
  }, [handleCreateConversation, handleCloseModal]);

  const handleAgentSelect = useCallback(() => {
    dlog('[ChatInterface] Agent type selected for new conversation (reserved for future)');
    handleCreateConversation('agent');
    handleCloseModal();
  }, [handleCreateConversation, handleCloseModal]);

  // Auto-initialize: Create a default "Basic Chatbot" conversation when task is first opened
  useEffect(() => {
    // Only auto-initialize once and only if there are no existing conversations
    if (!hasAutoInitialized.current && chatContent.conversations.length === 0) {
      hasAutoInitialized.current = true;
      
      dlog('[ChatInterface] Auto-initializing with default Basic Chatbot conversation:', {
        taskId,
        timestamp: new Date().toISOString()
      });

      const now = new Date();
      const conversationId = `conv-${Date.now()}`;
      
      const defaultConversation: Conversation = {
        id: conversationId,
        title: t.aiChat.conversationList.chatbot,
        messages: [],
        createdAt: now,
        updatedAt: now,
        chatType: 'chatbot',
      };

      const initialContent: ChatTaskContent = {
        conversations: [defaultConversation],
        activeConversationId: conversationId,
        uiState: {
          isLoading: false,
          isChatTypeModalOpen: false,
          hasAutoInitialized: true, // Mark as initialized
        },
      };

      onUpdateContent(initialContent);
      
      dlog('[ChatInterface] Default Basic Chatbot conversation created successfully:', {
        conversationId,
        chatType: 'chatbot',
        timestamp: now.toISOString()
      });
    }
  }, []); // Empty dependency array - only run once on mount

  const handleSelectConversation = useCallback((conversationId: string) => {
    const updatedContent: ChatTaskContent = {
      ...chatContent,
      activeConversationId: conversationId,
    };
    onUpdateContent(updatedContent);
    console.log(`Selected conversation: ${conversationId}`);
  }, [chatContent, onUpdateContent]);

  const handleDeleteConversation = useCallback((conversationId: string) => {
    const updatedConversations = chatContent.conversations.filter(
      conv => conv.id !== conversationId
    );
    
    let newActiveId = chatContent.activeConversationId;
    if (chatContent.activeConversationId === conversationId) {
      newActiveId = updatedConversations.length > 0 ? updatedConversations[0].id : null;
    }

    const updatedContent: ChatTaskContent = {
      conversations: updatedConversations,
      activeConversationId: newActiveId,
    };

    onUpdateContent(updatedContent);
    console.log(`Deleted conversation: ${conversationId}`);
  }, [chatContent, onUpdateContent]);

  const updateConversationMessages = useCallback((conversationId: string, messages: ChatMessage[]) => {
    dlog(`[Chat] Updating messages for conversation ${conversationId}, message count: ${messages.length}`);
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      dlog(`[Chat] Last message - role: ${lastMessage.role}, content length: ${lastMessage.content.length}, isStreaming: ${lastMessage.isStreaming}`);
    }
    
    const updatedConversations = chatContent.conversations.map(conv => {
      if (conv.id === conversationId) {
        return {
          ...conv,
          messages,
          updatedAt: new Date(),
        };
      }
      return conv;
    });

    const updatedContent: ChatTaskContent = {
      ...chatContent,
      conversations: updatedConversations,
    };

    onUpdateContent(updatedContent);
  }, [chatContent, onUpdateContent]);

  const handleClearMessages = useCallback(() => {
    if (!chatContent.activeConversationId) {
      console.warn('[Chat] No active conversation to clear');
      return;
    }

    dlog(`[Chat] Clearing messages for conversation: ${chatContent.activeConversationId}`);
    
    const updatedConversations = chatContent.conversations.map(conv => {
      if (conv.id === chatContent.activeConversationId) {
        dlog(`[Chat] Cleared ${conv.messages.length} messages from conversation: ${conv.id}`);
        return {
          ...conv,
          messages: [],
          updatedAt: new Date(),
        };
      }
      return conv;
    });

    const updatedContent: ChatTaskContent = {
      ...chatContent,
      conversations: updatedConversations,
    };

    onUpdateContent(updatedContent);
    dlog('[Chat] Chat history cleared successfully, context cache reset');
  }, [chatContent, onUpdateContent]);

  const handleSendMessage = useCallback(async (message: string) => {
    if (!chatContent.activeConversationId || isLoading) return;

    const activeConversation = chatContent.conversations.find(
      conv => conv.id === chatContent.activeConversationId
    );
    
    if (!activeConversation) return;

    setIsLoading(true);
    
    try {
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };

      // Update conversation title if it's the first message
      const updatedTitle = activeConversation.messages.length === 0 
        ? message.slice(0, 30) + (message.length > 30 ? '...' : '')
        : activeConversation.title;

      // Add user message
      const messagesWithUser = [...activeConversation.messages, userMessage];
      
      // Update conversation with user message
      const updatedConversations = chatContent.conversations.map(conv => {
        if (conv.id === chatContent.activeConversationId) {
          return {
            ...conv,
            title: updatedTitle,
            messages: messagesWithUser,
            updatedAt: new Date(),
          };
        }
        return conv;
      });

      onUpdateContent({
        ...chatContent,
        conversations: updatedConversations,
      });

      // Create assistant message placeholder
      const assistantMessageId = `msg-${Date.now()}-assistant`;
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };

      // Add assistant message placeholder
      const messagesWithAssistant = [...messagesWithUser, assistantMessage];
      updateConversationMessages(chatContent.activeConversationId, messagesWithAssistant);

      // Determine chat type and execution method
      const chatType = activeConversation.chatType || 'chatbot';
      const useWorkflow = chatType === 'workflow' && !!activeConversation.workflowId;
      
      dlog('[ChatInterface] Sending message:', {
        chatType,
        useWorkflow,
        workflowId: activeConversation.workflowId,
        workflowName: activeConversation.workflowName,
        hasNodes: !!activeConversation.workflowNodes,
        hasConnections: !!activeConversation.workflowConnections,
        nodesCount: activeConversation.workflowNodes?.length || 0,
        connectionsCount: activeConversation.workflowConnections?.length || 0,
        messageLength: message.length
      });

      // Handle workflow execution with client-side executor (like Workflows task)
      if (useWorkflow && activeConversation.workflowNodes && activeConversation.workflowConnections) {
        dlog('[ChatInterface] Executing workflow with client-side WorkflowExecutor');
        
        let accumulatedContent = '';
        let workflowExecutionState: WorkflowExecutionState = {
          isRunning: true,
          currentNodeId: null,
          nodeStates: {},
          logs: [],
          startTime: new Date()
        };

        // Create workflow executor with real-time callback
        const executor = new WorkflowExecutor(
          activeConversation.workflowNodes,
          activeConversation.workflowConnections,
          (newState: WorkflowExecutionState) => {
            dlog('[ChatInterface] Workflow execution state updated:', {
              isRunning: newState.isRunning,
              currentNodeId: newState.currentNodeId,
              logsCount: newState.logs.length,
              timestamp: new Date().toISOString()
            });
            
            // Update workflow execution state
            workflowExecutionState = { ...newState };
            
            // Extract final result from logs when execution completes
            if (!newState.isRunning && newState.endTime) {
              const finalResultLog = newState.logs.find(
                log => log.level === 'success' && log.message.includes('Workflow execution completed')
              );
              
              const finalOutput = finalResultLog?.details?.output;
              
              if (finalOutput) {
                // Format the output
                if (typeof finalOutput === 'string') {
                  accumulatedContent = finalOutput;
                } else if (finalOutput.finalResult) {
                  const result = finalOutput.finalResult;
                  if (typeof result === 'string') {
                    accumulatedContent = result;
                  } else if (result?.text) {
                    accumulatedContent = result.text;
                  } else if (result?.llmResponse) {
                    accumulatedContent = result.llmResponse;
                  } else {
                    accumulatedContent = JSON.stringify(result, null, 2);
                  }
                } else if (finalOutput.text) {
                  accumulatedContent = finalOutput.text;
                } else if (finalOutput.llmResponse) {
                  accumulatedContent = finalOutput.llmResponse;
                } else {
                  accumulatedContent = JSON.stringify(finalOutput, null, 2);
                }
              }
            }
            
            // Update the assistant message with workflow execution state
            const updatedMessages = [...messagesWithUser, {
              ...assistantMessage,
              content: accumulatedContent,
              isStreaming: newState.isRunning,
              workflowExecution: {
                workflowId: activeConversation.workflowId!,
                workflowName: activeConversation.workflowName!,
                executionState: { ...newState }
              }
            }];
            
            updateConversationMessages(chatContent.activeConversationId!, updatedMessages);
          },
          message // Pass user input to executor
        );

        // Execute the workflow
        try {
          dlog('[ChatInterface] Starting workflow execution');
          await executor.execute();
          dlog('[ChatInterface] Workflow execution completed successfully');
        } catch (error) {
          console.error('[ChatInterface] Workflow execution error:', error);
          accumulatedContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          
          // Update with error message
          const errorMessages = [...messagesWithUser, {
            ...assistantMessage,
            content: accumulatedContent,
            isStreaming: false,
            workflowExecution: {
              workflowId: activeConversation.workflowId!,
              workflowName: activeConversation.workflowName!,
              executionState: {
                ...workflowExecutionState,
                isRunning: false,
                endTime: new Date()
              }
            }
          }];
          
          updateConversationMessages(chatContent.activeConversationId!, errorMessages);
        }
        
        return; // Exit early for workflow execution
      }

      // Handle regular chatbot conversation with API
      dlog('[ChatInterface] Using regular chat API for chatbot conversation');
      
      let response: Response;
      try {
        response = await http.stream('/api/chat', {
          messages: messagesWithUser,
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(`HTTP error! status: ${httpError.status}`);
        }
        throw httpError;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(data);

              // Regular chat streaming
              if (parsed.content) {
                accumulatedContent += parsed.content;
                chunkCount += 1;

                const updatedMessages = [...messagesWithUser, {
                  ...assistantMessage,
                  content: accumulatedContent,
                  isStreaming: true
                }];

                // Throttle: log once every 50 chunks (plus the final-summary
                // entry below covers the end-of-stream state).
                if (chunkCount % 50 === 0) {
                  dlog('[Chat] streaming progress', {
                    chunks: chunkCount,
                    totalLength: accumulatedContent.length,
                  });
                }
                updateConversationMessages(chatContent.activeConversationId!, updatedMessages);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      // Mark streaming as complete for regular chatbot
      const finalMessages = [...messagesWithUser, {
        ...assistantMessage,
        content: accumulatedContent,
        isStreaming: false
      }];
      
      dlog(`[Chat] Streaming complete - final content length: ${accumulatedContent.length}`);
      dlog(`[Chat] Final content preview: ${accumulatedContent.slice(0, 100)}...`);
      updateConversationMessages(chatContent.activeConversationId!, finalMessages);

      dlog(`[Chat] Sent message and received response for conversation: ${chatContent.activeConversationId}`);
      
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Remove the assistant message placeholder on error
      const messagesWithoutAssistant = activeConversation.messages.concat([{
        id: `msg-${Date.now()}-user`,
        role: 'user' as const,
        content: message,
        timestamp: new Date(),
      }]);
      
      updateConversationMessages(chatContent.activeConversationId!, messagesWithoutAssistant);
      
    } finally {
      setIsLoading(false);
    }
  }, [chatContent, onUpdateContent, isLoading, updateConversationMessages]);

  const activeConversation = chatContent.conversations.find(
    conv => conv.id === chatContent.activeConversationId
  );

  // 聊天界面渲染

  return (
    <div className="flex h-full bg-background min-h-0 relative">
      {/* Left Sidebar - Conversation List (15% width) */}
      <div style={{ width: '15%', minWidth: '200px' }} className="bg-card border-r border-border flex flex-col">
        <ConversationList
          conversations={chatContent.conversations}
          activeConversationId={chatContent.activeConversationId}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          onNewChatClick={handleNewChatClick}
        />
      </div>

      {/* Right Side - Chat Window (85% width) */}
      <div style={{ width: '85%' }} className="flex flex-col min-h-0">
        <ChatWindow
          conversation={activeConversation}
          onSendMessage={handleSendMessage}
          onClearMessages={handleClearMessages}
          isLoading={isLoading}
          onNavigateToVideoEditing={onNavigateToVideoEditing}
        />
      </div>

      {/* Chat Type Selection Modal - Rendered at top level for full-screen centering */}
      <ChatTypeSelectionModal
        isOpen={isChatTypeModalOpen}
        onClose={handleCloseModal}
        onSelectChatbot={handleChatbotSelect}
        onSelectWorkflow={handleWorkflowSelect}
        onSelectAgent={handleAgentSelect}
      />
    </div>
  );
};

export default ChatInterface; 