'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Conversation, ChatMessage, ChatTaskContent } from '@/types';
import ConversationList from './ConversationList';
import ChatWindow from './ChatWindow';
import ChatTypeSelectionModal from './ChatTypeSelectionModal';
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
  const { t, locale } = useLocale();
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
    chatType: 'chatbot' | 'agent',
  ) => {
    const now = new Date();
    const conversationId = `conv-${Date.now()}`;

    dlog('[ChatInterface] Creating new conversation:', {
      conversationId,
      chatType,
      timestamp: now.toISOString()
    });

    // Determine conversation title based on chat type
    let title = t.aiChat.conversationList.newChat;
    if (chatType === 'chatbot') {
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
    };

    const updatedContent: ChatTaskContent = {
      conversations: [...chatContent.conversations, newConversation],
      activeConversationId: conversationId,
    };

    onUpdateContent(updatedContent);
    dlog(`[ChatInterface] Created new conversation:`, {
      conversationId,
      chatType,
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

      dlog('[ChatInterface] Sending message:', {
        chatType: activeConversation.chatType || 'chatbot',
        messageLength: message.length
      });

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
      // 上游错误以 data:{error,message} 形式下发（route.ts:176-186），该块只有 error/message
      // 字段、无 content。须在此识别并置 streamError，收尾时如实显示，否则会被吞成空气泡。
      let streamError: string | null = null;

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

              // 上游错误块：识别后置 streamError 并跳出，避免被当成"无内容"。
              if (typeof parsed.error === 'string' && parsed.error) {
                const detail =
                  typeof parsed.message === 'string' && parsed.message.trim()
                    ? `（${parsed.message.trim()}）`
                    : '';
                streamError = `${parsed.error}${detail}`;
                break;
              }

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
        if (streamError) break;
      }

      // Mark streaming as complete for regular chatbot. On an upstream error,
      // surface it to the user instead of leaving an empty assistant bubble.
      const finalContent = streamError
        ? `${locale === 'en' ? 'Request failed: ' : '对话失败：'}${streamError}`
        : accumulatedContent;
      const finalMessages = [...messagesWithUser, {
        ...assistantMessage,
        content: finalContent,
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
  }, [chatContent, onUpdateContent, isLoading, updateConversationMessages, locale]);

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
        onSelectAgent={handleAgentSelect}
      />
    </div>
  );
};

export default ChatInterface; 