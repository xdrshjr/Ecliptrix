'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  isUser?: boolean;
}

/**
 * Markdown渲染组件
 * 支持代码高亮、表格、列表等GitHub风格的Markdown语法
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isUser = false }) => {
  console.log('[MarkdownRenderer] 渲染Markdown内容', { 
    contentLength: content.length, 
    isUser,
    preview: content.substring(0, 100) 
  });

  return (
    <div className={`markdown-content ${isUser ? 'user-markdown' : 'assistant-markdown'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 代码块渲染
          code(props: any) {
            const { inline, className, children, ...rest } = props;
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            
            if (!inline && language) {
              console.log('[MarkdownRenderer] 渲染代码块', { language });
              return (
                <div className="relative group my-4">
                  {/* 语言标签 */}
                  {language && (
                    <div className="absolute top-0 left-0 px-3 py-1 text-xs font-medium text-muted-foreground bg-card rounded-tl-lg rounded-br-lg z-10">
                      {language}
                    </div>
                  )}
                  <SyntaxHighlighter
                    style={oneDark as any}
                    language={language}
                    PreTag="div"
                    className="rounded-lg !mt-0 !mb-0"
                    customStyle={{
                      margin: 0,
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                      lineHeight: '1.5',
                    }}
                    {...rest}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </div>
              );
            }
            
            // 行内代码
            return (
              <code 
                className={`px-1.5 py-0.5 rounded text-sm font-mono ${
                  isUser
                    ? 'bg-primary/20 text-primary-foreground/90'
                    : 'bg-muted text-foreground'
                }`}
                {...rest}
              >
                {children}
              </code>
            );
          },
          
          // 标题渲染
          h1: ({ children }) => (
            <h1 className={`text-xl font-bold mb-3 mt-4 first:mt-0 ${
              isUser ? 'text-primary-foreground/90' : 'text-foreground'
            }`}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className={`text-lg font-semibold mb-2 mt-3 first:mt-0 ${
              isUser ? 'text-primary-foreground/90' : 'text-foreground'
            }`}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className={`text-base font-medium mb-2 mt-3 first:mt-0 ${
              isUser ? 'text-primary-foreground/90' : 'text-foreground'
            }`}>
              {children}
            </h3>
          ),
          
          // 段落渲染
          p: ({ children }) => (
            <p className="mb-3 last:mb-0 leading-relaxed">
              {children}
            </p>
          ),
          
          // 列表渲染
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-3 space-y-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-3 space-y-1">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">
              {children}
            </li>
          ),
          
          // 链接渲染
          a: ({ href, children }) => (
            <a 
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline hover:no-underline transition-colors ${
                isUser
                  ? 'text-primary-foreground/70 hover:text-primary-foreground'
                  : 'text-primary hover:text-primary'
              }`}
            >
              {children}
            </a>
          ),
          
          // 强调文本
          strong: ({ children }) => (
            <strong className={`font-semibold ${
              isUser ? 'text-primary-foreground/90' : 'text-foreground'
            }`}>
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className={`italic ${
              isUser ? 'text-primary-foreground/90' : 'text-foreground'
            }`}>
              {children}
            </em>
          ),
          
          // 引用块
          blockquote: ({ children }) => (
            <blockquote className={`border-l-4 pl-4 py-2 my-3 italic ${
              isUser
                ? 'border-primary-foreground/30 bg-primary/15'
                : 'border-border bg-muted'
            }`}>
              {children}
            </blockquote>
          ),
          
          // 表格渲染
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className={`min-w-full border-collapse border ${
                isUser ? 'border-primary-foreground/30' : 'border-border'
              }`}>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className={`border px-3 py-2 font-semibold text-left ${
              isUser
                ? 'border-primary-foreground/30 bg-primary/20 text-primary-foreground/90'
                : 'border-border bg-accent text-foreground'
            }`}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className={`border px-3 py-2 ${
              isUser ? 'border-primary-foreground/30' : 'border-border'
            }`}>
              {children}
            </td>
          ),
          
          // 水平分割线
          hr: () => (
            <hr className={`my-4 border-t ${
              isUser ? 'border-primary-foreground/30' : 'border-border'
            }`} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer; 