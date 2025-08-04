/**
 * 复制文本到剪贴板的工具函数
 * 支持现代浏览器的Clipboard API和旧版浏览器的fallback方案
 */

interface CopyResult {
  success: boolean;
  error?: string;
}

/**
 * 复制文本到剪贴板
 * @param text 要复制的文本内容
 * @returns Promise<CopyResult> 复制结果
 */
export const copyToClipboard = async (text: string): Promise<CopyResult> => {
  console.log('[Clipboard] 开始复制文本到剪贴板', { textLength: text.length });
  
  try {
    // 优先使用现代浏览器的Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      console.log('[Clipboard] 使用Clipboard API复制成功');
      return { success: true };
    }
    
    // Fallback方案：使用传统的document.execCommand
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    
    textArea.focus();
    textArea.select();
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    if (successful) {
      console.log('[Clipboard] 使用execCommand复制成功');
      return { success: true };
    } else {
      console.warn('[Clipboard] execCommand复制失败');
      return { success: false, error: 'execCommand failed' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Clipboard] 复制失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
};

/**
 * 显示复制结果的用户反馈
 * @param success 是否复制成功
 * @param error 错误信息（如果有）
 */
export const showCopyFeedback = (success: boolean, error?: string): void => {
  if (success) {
    console.log('[Clipboard] 显示复制成功反馈');
    // 这里可以集成toast通知系统，目前使用console.log
    // 在实际应用中，可以显示一个临时的成功提示
  } else {
    console.error('[Clipboard] 显示复制失败反馈:', error);
    // 这里可以显示错误提示给用户
  }
}; 