'use client';

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  isUser?: boolean;
  /** When true, incomplete markdown at the tail is sanitized before rendering. */
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// Streaming markdown sanitizer
// ---------------------------------------------------------------------------

/**
 * Sanitize incomplete markdown constructs at the tail of streaming content.
 * Only inspects the last ~200 characters for performance.
 *
 * Handles:
 * - Unclosed code fences (odd count of ```) → appends closing fence
 * - Trailing unclosed bold ** or italic * → strips the incomplete marker
 * - Incomplete links [text](url without closing ) → strips incomplete link
 * - Trailing incomplete inline code ` → strips it
 */
function sanitizeStreamingMarkdown(content: string): string {
  if (!content) return content;

  let result = content;

  // 1. Unclosed code fences: count occurrences of ``` (on their own line or inline)
  const fenceMatches = result.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    // Odd number of fences — close the open block
    result += '\n```';
  }

  // Only inspect the tail for inline constructs (last 200 chars)
  const tailStart = Math.max(0, result.length - 200);
  const tail = result.slice(tailStart);

  // 2. Incomplete link: [text](url  without closing )
  // Match a [ that has a ]( but no closing )
  const incompleteLinkMatch = tail.match(/\[[^\]]*\]\([^)]*$/);
  if (incompleteLinkMatch) {
    result = result.slice(0, tailStart + incompleteLinkMatch.index!);
  }

  // 3. Incomplete link text: [ without closing ]
  const incompleteLinkTextMatch = tail.match(/\[[^\]]*$/);
  if (incompleteLinkTextMatch && !tail.slice(incompleteLinkTextMatch.index!).includes(']')) {
    result = result.slice(0, tailStart + incompleteLinkTextMatch.index!);
  }

  // 4. Unclosed bold (**) — check if there's an unmatched ** in the tail
  const tailForBold = result.slice(Math.max(0, result.length - 200));
  const boldParts = tailForBold.split('**');
  if (boldParts.length % 2 === 0) {
    // Odd number of ** markers (split produces even parts) → unclosed bold
    const lastBoldIdx = result.lastIndexOf('**');
    if (lastBoldIdx >= 0) {
      result = result.slice(0, lastBoldIdx);
    }
  }

  // 5. Unclosed italic (*) — only single * not part of **
  // Check for trailing unmatched single *
  const tailForItalic = result.slice(Math.max(0, result.length - 100));
  // Replace ** to avoid false positives, then check for odd *
  const withoutBold = tailForItalic.replace(/\*\*/g, '');
  const singleStarCount = (withoutBold.match(/\*/g) || []).length;
  if (singleStarCount % 2 !== 0) {
    const lastStarIdx = result.lastIndexOf('*');
    if (lastStarIdx >= 0 && result[lastStarIdx - 1] !== '*' && result[lastStarIdx + 1] !== '*') {
      result = result.slice(0, lastStarIdx);
    }
  }

  // 6. Unclosed inline code ` (single backtick, not ```)
  const tailForCode = result.slice(Math.max(0, result.length - 100));
  const withoutFences = tailForCode.replace(/```/g, '');
  const backtickCount = (withoutFences.match(/`/g) || []).length;
  if (backtickCount % 2 !== 0) {
    const lastBacktickIdx = result.lastIndexOf('`');
    // Make sure it's not part of a fence
    if (lastBacktickIdx >= 0 && !(result[lastBacktickIdx - 1] === '`' || result[lastBacktickIdx + 1] === '`')) {
      result = result.slice(0, lastBacktickIdx);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Markdown渲染组件
 * 支持代码高亮、表格、列表等GitHub风格的Markdown语法
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isUser = false, isStreaming = false }) => {
  const sanitizedContent = useMemo(
    () => (isStreaming ? sanitizeStreamingMarkdown(content) : content),
    [content, isStreaming],
  );

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
        {sanitizedContent}
      </ReactMarkdown>
    </div>
  );
};

export default React.memo(MarkdownRenderer);
