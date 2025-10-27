'use client';

import React, { useState, useCallback } from 'react';
import { Conversation, ChatMessage, ChatTaskContent } from '@/types';
import ConversationList from './ConversationList';
import ChatWindow from './ChatWindow';
import ChatTypeSelectionModal from './ChatTypeSelectionModal';

interface ChatInterfaceProps {
  taskId: string;
  content: ChatTaskContent | null;
  onUpdateContent: (content: ChatTaskContent) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  taskId,
  content,
  onUpdateContent,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isChatTypeModalOpen, setIsChatTypeModalOpen] = useState(false);

  // Initialize content if null
  const chatContent: ChatTaskContent = content || {
    conversations: [],
    activeConversationId: null,
  };

  const handleNewChatClick = useCallback(() => {
    console.log('[ChatInterface] New Chat button clicked, opening chat type selection modal');
    setIsChatTypeModalOpen(true);
  }, []);

  const handleCreateConversation = useCallback((
    chatType: 'chatbot' | 'workflow' | 'agent',
    workflowId?: string,
    workflowName?: string
  ) => {
    const now = new Date();
    const conversationId = `conv-${Date.now()}`;
    
    console.log('[ChatInterface] Creating new conversation:', {
      conversationId,
      chatType,
      workflowId,
      workflowName,
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
      workflowName
    });
  }, [chatContent, onUpdateContent]);

  const handleChatbotSelect = useCallback(() => {
    console.log('[ChatInterface] Chatbot type selected for new conversation');
    handleCreateConversation('chatbot');
    setIsChatTypeModalOpen(false);
  }, [handleCreateConversation]);

  const handleWorkflowSelect = useCallback((workflowId: string, workflowName: string) => {
    console.log('[ChatInterface] Workflow selected for new conversation:', {
      workflowId,
      workflowName
    });
    handleCreateConversation('workflow', workflowId, workflowName);
    setIsChatTypeModalOpen(false);
  }, [handleCreateConversation]);

  const handleAgentSelect = useCallback(() => {
    console.log('[ChatInterface] Agent type selected for new conversation (reserved for future)');
    handleCreateConversation('agent');
    setIsChatTypeModalOpen(false);
  }, [handleCreateConversation]);

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

      // Determine chat type and API endpoint
      const chatType = activeConversation.chatType || 'chatbot';
      const useWorkflow = chatType === 'workflow' && !!activeConversation.workflowId;
      
      console.log('[ChatInterface] Sending message:', {
        chatType,
        useWorkflow,
        workflowId: activeConversation.workflowId,
        workflowName: activeConversation.workflowName,
        messageLength: message.length
      });

      // Call appropriate API endpoint based on chat type
      const apiEndpoint = useWorkflow ? '/api/chat/workflow' : '/api/chat';
      const requestBody = useWorkflow ? {
        messages: messagesWithUser,
        workflowId: activeConversation.workflowId,
        userInput: message,
      } : {
        messages: messagesWithUser,
      };

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';
      let workflowExecutionState = useWorkflow ? {
        isRunning: true,
        currentNodeId: null,
        nodeStates: {},
        logs: [],
        startTime: new Date()
      } : undefined;
      
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
              
              if (useWorkflow) {
                // Handle workflow-specific streaming events
                if (parsed.type === 'node_update' && workflowExecutionState) {
                  // Update node execution state
                  workflowExecutionState.nodeStates[parsed.nodeId] = {
                    nodeId: parsed.nodeId,
                    status: parsed.status,
                    output: parsed.output,
                    startTime: parsed.startTime ? new Date(parsed.startTime) : new Date(),
                    endTime: parsed.endTime ? new Date(parsed.endTime) : undefined
                  };
                  
                  workflowExecutionState.currentNodeId = parsed.nodeId;
                  
                  // Add log entry
                  workflowExecutionState.logs.push({
                    id: `log-${Date.now()}-${Math.random()}`,
                    timestamp: new Date(),
                    level: 'info',
                    nodeId: parsed.nodeId,
                    nodeName: parsed.nodeName,
                    message: `${parsed.status === 'executing' ? 'Executing' : 'Completed'} node: ${parsed.nodeName}`
                  });
                  
                } else if (parsed.type === 'final_result') {
                  accumulatedContent = parsed.content;
                  if (workflowExecutionState) {
                    workflowExecutionState.isRunning = false;
                    workflowExecutionState.endTime = new Date();
                  }
                } else if (parsed.type === 'error') {
                  console.error('[ChatInterface] Workflow execution error:', parsed.error);
                  accumulatedContent = `Error: ${parsed.error}`;
                }
                
                // Update the assistant message with workflow execution state
                const updatedMessages = [...messagesWithUser, {
                  ...assistantMessage,
                  content: accumulatedContent,
                  isStreaming: true,
                  workflowExecution: {
                    workflowId: activeConversation.workflowId!,
                    workflowName: activeConversation.workflowName!,
                    executionState: { ...workflowExecutionState }
                  }
                }];
                
                updateConversationMessages(chatContent.activeConversationId!, updatedMessages);
                
              } else {
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
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      // Mark streaming as complete
      const finalMessages = [...messagesWithUser, {
        ...assistantMessage,
        content: accumulatedContent,
        isStreaming: false,
        ...(useWorkflow && workflowExecutionState ? {
          workflowExecution: {
            workflowId: activeConversation.workflowId!,
            workflowName: activeConversation.workflowName!,
            executionState: {
              ...workflowExecutionState,
              isRunning: false,
              endTime: new Date()
            }
          }
        } : {})
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
          onCreateConversation={handleCreateConversation}
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
        onClose={() => setIsChatTypeModalOpen(false)}
        onSelectChatbot={handleChatbotSelect}
        onSelectWorkflow={handleWorkflowSelect}
        onSelectAgent={handleAgentSelect}
      />
    </div>
  );
};

export default ChatInterface; 