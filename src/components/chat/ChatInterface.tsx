'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Conversation, ChatMessage, ChatTaskContent, WorkflowExecutionState } from '@/types';
import ConversationList from './ConversationList';
import ChatWindow from './ChatWindow';
import ChatTypeSelectionModal from './ChatTypeSelectionModal';
import { WorkflowExecutor } from '@/components/workflow/WorkflowExecutor';

interface ChatInterfaceProps {
  taskId: string;
  content: ChatTaskContent | null;
  onUpdateContent: (content: ChatTaskContent) => void;
  onModalStateChange?: (isOpen: boolean) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  taskId,
  content,
  onUpdateContent,
  onModalStateChange,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isChatTypeModalOpen, setIsChatTypeModalOpen] = useState(false);
  const hasAutoInitialized = useRef(false);

  // Initialize content if null
  const chatContent: ChatTaskContent = content || {
    conversations: [],
    activeConversationId: null,
  };

  const handleNewChatClick = useCallback(() => {
    console.log('[ChatInterface] New Chat button clicked, opening chat type selection modal');
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
    
    console.log('[ChatInterface] Creating new conversation:', {
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
    let title = 'New Chat';
    if (chatType === 'workflow' && workflowName) {
      title = `${workflowName} Chat`;
    } else if (chatType === 'chatbot') {
      title = 'Chatbot';
    } else if (chatType === 'agent') {
      title = 'AI Agent';
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
    console.log(`[ChatInterface] Created new conversation:`, {
      conversationId,
      chatType,
      workflowId,
      workflowName,
      nodesCount: workflowNodes?.length || 0,
      connectionsCount: workflowConnections?.length || 0
    });
  }, [chatContent, onUpdateContent]);

  const handleCloseModal = useCallback(() => {
    console.log('[ChatInterface] Closing chat type selection modal');
    setIsChatTypeModalOpen(false);
    onModalStateChange?.(false);
  }, [onModalStateChange]);

  const handleChatbotSelect = useCallback(() => {
    console.log('[ChatInterface] Chatbot type selected for new conversation');
    handleCreateConversation('chatbot');
    handleCloseModal();
  }, [handleCreateConversation, handleCloseModal]);

  const handleWorkflowSelect = useCallback((workflowId: string, workflowName: string, nodes: any[], connections: any[]) => {
    console.log('[ChatInterface] Workflow selected for new conversation:', {
      workflowId,
      workflowName,
      nodesCount: nodes?.length || 0,
      connectionsCount: connections?.length || 0
    });
    handleCreateConversation('workflow', workflowId, workflowName, nodes, connections);
    handleCloseModal();
  }, [handleCreateConversation, handleCloseModal]);

  const handleAgentSelect = useCallback(() => {
    console.log('[ChatInterface] Agent type selected for new conversation (reserved for future)');
    handleCreateConversation('agent');
    handleCloseModal();
  }, [handleCreateConversation, handleCloseModal]);

  // Auto-initialize: Create a default "Basic Chatbot" conversation when task is first opened
  useEffect(() => {
    // Only auto-initialize once and only if there are no existing conversations
    if (!hasAutoInitialized.current && chatContent.conversations.length === 0) {
      hasAutoInitialized.current = true;
      
      console.log('[ChatInterface] Auto-initializing with default Basic Chatbot conversation:', {
        taskId,
        timestamp: new Date().toISOString()
      });

      const now = new Date();
      const conversationId = `conv-${Date.now()}`;
      
      const defaultConversation: Conversation = {
        id: conversationId,
        title: 'Chatbot',
        messages: [],
        createdAt: now,
        updatedAt: now,
        chatType: 'chatbot',
      };

      const initialContent: ChatTaskContent = {
        conversations: [defaultConversation],
        activeConversationId: conversationId,
      };

      onUpdateContent(initialContent);
      
      console.log('[ChatInterface] Default Basic Chatbot conversation created successfully:', {
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
    console.log(`[Chat] Updating messages for conversation ${conversationId}, message count: ${messages.length}`);
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      console.log(`[Chat] Last message - role: ${lastMessage.role}, content length: ${lastMessage.content.length}, isStreaming: ${lastMessage.isStreaming}`);
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

    console.log(`[Chat] Clearing messages for conversation: ${chatContent.activeConversationId}`);
    
    const updatedConversations = chatContent.conversations.map(conv => {
      if (conv.id === chatContent.activeConversationId) {
        console.log(`[Chat] Cleared ${conv.messages.length} messages from conversation: ${conv.id}`);
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
    console.log('[Chat] Chat history cleared successfully, context cache reset');
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
      
      console.log('[ChatInterface] Sending message:', {
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
        console.log('[ChatInterface] Executing workflow with client-side WorkflowExecutor');
        
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
            console.log('[ChatInterface] Workflow execution state updated:', {
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
          console.log('[ChatInterface] Starting workflow execution');
          await executor.execute();
          console.log('[ChatInterface] Workflow execution completed successfully');
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
      console.log('[ChatInterface] Using regular chat API for chatbot conversation');
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesWithUser,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';
      
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
                
                // Update the assistant message with accumulated content
                const updatedMessages = [...messagesWithUser, {
                  ...assistantMessage,
                  content: accumulatedContent,
                  isStreaming: true
                }];
                
                console.log(`[Chat] Streaming update - accumulated content length: ${accumulatedContent.length}`);
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
      
      console.log(`[Chat] Streaming complete - final content length: ${accumulatedContent.length}`);
      console.log(`[Chat] Final content preview: ${accumulatedContent.slice(0, 100)}...`);
      updateConversationMessages(chatContent.activeConversationId!, finalMessages);

      console.log(`Sent message and received response for conversation: ${chatContent.activeConversationId}`);
      
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
    <div className="flex h-full bg-gradient-to-br from-gray-50 to-gray-100/30 min-h-0 relative">
      {/* Left Sidebar - Conversation List (15% width) */}
      <div style={{ width: '15%', minWidth: '200px' }} className="bg-white/80 backdrop-blur-sm border-r border-gray-200/80 flex flex-col">
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