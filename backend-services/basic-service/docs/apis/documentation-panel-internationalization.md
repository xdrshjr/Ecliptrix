# Documentation面板国际化功能文档

## 概述

Documentation面板国际化功能为视频编辑界面的Documentation面板提供多语言支持，包括默认内容、按钮提示文本和占位符的国际化。该功能基于项目的国际化框架实现，支持英文(en)和中文(zh-CN)两种语言。

## 基础信息

- **功能名称**: Documentation Panel Internationalization
- **版本**: 1.0.0
- **实现位置**: 
  - 前端组件: `src/components/video/components/DocumentPanel/DocumentPanel.tsx`
  - 国际化配置: `src/lib/i18n.ts`
  - 状态管理: `src/components/video/hooks/useDocumentState.ts`
- **语言支持**: 英文(en)、中文(zh-CN)

## 功能特性

### 1. 默认内容国际化

Documentation面板在创建新任务时会显示默认的Markdown内容，该内容根据用户选择的语言自动切换。

**英文默认内容**:
```markdown
# Video Editing Project

Start editing your video project documentation here...

## Notes
- Add your project notes
- Document your editing workflow
- Track your progress

## Resources
- List your video assets
- Note important timestamps
- Reference materials
```

**中文默认内容**:
```markdown
# 视频编辑项目

开始编辑您的视频项目文档...

## 笔记
- 添加您的项目笔记
- 记录您的编辑工作流程
- 跟踪您的进度

## 资源
- 列出您的视频素材
- 记录重要时间戳
- 参考资料
```

### 2. UI元素国际化

所有UI元素的文本都支持国际化，包括：

#### 面板标题
- 英文: "Documentation"
- 中文: "文档编辑"

#### 占位符文本
- 英文: "Start writing your video project documentation..."
- 中文: "开始编写您的视频项目文档..."

#### 按钮提示文本

**创意构思按钮**:
- 英文: "Brainstorming" / "Start creative brainstorming"
- 中文: "创意构思" / "开启创意构思"

**智能润色按钮**:
- 英文: "Polish current document content with AI" / "Polish document content"
- 中文: "智能润色当前文档内容" / "润色文档内容"

**生成脚本按钮**:
- 英文: "Generate video script from current document" / "Generating script..." / "Generate script"
- 中文: "根据当前文档内容生成视频脚本" / "脚本生成中..." / "生成脚本"

## 技术实现

### 1. 国际化配置结构

在 `src/lib/i18n.ts` 中定义的类型结构：

```typescript
interface Translations {
  // ... 其他配置
  documentPanel: {
    title: string;                        // 面板标题
    creativeBrainstorming: string;        // 创意构思按钮文本
    creativeBrainstormingAriaLabel: string; // 创意构思按钮无障碍标签
    polishContent: string;                // 润色按钮提示文本
    polishContentAriaLabel: string;       // 润色按钮无障碍标签
    generateScript: string;               // 生成脚本按钮提示文本
    generatingScript: string;             // 生成中状态文本
    generateScriptAriaLabel: string;      // 生成脚本按钮无障碍标签
    placeholder: string;                  // 编辑器占位符
  };
  defaultContent: {
    documentDefault: string;              // 默认Markdown内容
    scriptSegments: {
      // 脚本片段的默认内容
    };
  };
}
```

### 2. 组件使用方式

在 `DocumentPanel` 组件中使用国际化：

```typescript
import { useLocale } from '@/contexts/LocaleContext';

const DocumentPanel: React.FC<DocumentPanelProps> = ({...}) => {
  const { t } = useLocale();
  
  return (
    <div>
      <h3>{t.documentPanel.title}</h3>
      <button 
        title={t.documentPanel.polishContent}
        aria-label={t.documentPanel.polishContentAriaLabel}
      >
        {/* 按钮内容 */}
      </button>
      <MDEditor
        placeholder={t.documentPanel.placeholder}
        // ... 其他属性
      />
    </div>
  );
};
```

### 3. 默认内容加载

在 `useDocumentState` Hook中实现默认内容的加载：

```typescript
export const useDocumentState = (
  content: VideoEditingTaskContent | null,
  onUpdateContent: (content: VideoEditingTaskContent) => void,
  taskId: string
): UseDocumentStateReturn => {
  const { t } = useLocale();
  const defaultContent = t.defaultContent.documentDefault;
  
  const [markdownValue, setMarkdownValue] = useState<string>(
    content?.markdownContent || defaultContent
  );
  
  // ... 其他逻辑
};
```

## 数据流程

1. **语言选择**: 用户在Header中选择语言（英文/中文）
2. **Context更新**: LocaleContext更新当前语言设置
3. **组件响应**: DocumentPanel组件通过useLocale Hook获取新的翻译
4. **内容更新**: 
   - UI文本立即更新为新语言
   - 如果是新任务，默认内容使用新语言版本
   - 已有内容保持不变（用户已编辑的内容）

## 日志记录

在 `useDocumentState` Hook中记录了详细的日志信息：

```typescript
logger.info('Hook初始化', {
  hasContent: !!content,
  markdownLength: markdownValue.length,
  isDefaultContent: markdownValue === defaultContent,
  lastSaved: lastSaved?.toISOString()
});
```

日志记录内容包括：
- Hook初始化状态
- 内容是否为默认内容
- Markdown内容长度
- 最后保存时间
- 内容变更增量

## 使用场景

### 场景1: 创建新的视频编辑任务

1. 用户点击"新建任务" -> "视频编辑"
2. 系统加载VideoEditingInterface组件
3. useDocumentState Hook初始化，检测到无现有内容
4. 根据当前语言加载对应的默认Markdown内容
5. 用户看到本地化的默认文档模板

### 场景2: 切换语言

1. 用户在已有任务中切换系统语言
2. LocaleContext触发更新
3. DocumentPanel组件重新渲染
4. UI元素（按钮提示、标题、占位符）更新为新语言
5. 已编辑的文档内容保持不变

### 场景3: AI功能交互

1. 用户点击"创意构思"按钮
2. 系统检测到当前内容为默认占位符内容
3. 清除默认内容（在useAIAssistant Hook中）
4. 调用AI服务生成新内容
5. 返回的内容根据用户语言设置进行生成

## 可访问性支持

所有交互按钮都提供了aria-label属性，确保屏幕阅读器用户能够理解按钮功能：

```typescript
<button
  title={t.documentPanel.polishContent}
  aria-label={t.documentPanel.polishContentAriaLabel}
>
```

## 扩展支持

### 添加新语言

如需添加新语言支持，需要在以下位置添加翻译：

1. **src/lib/i18n.ts** - 添加新语言的翻译对象
```typescript
export const translations: Record<string, Translations> = {
  en: { /* 英文翻译 */ },
  'zh-CN': { /* 中文翻译 */ },
  'ja': { /* 日文翻译 - 新增 */ }
};
```

2. **LocaleContext** - 更新支持的语言列表
3. **Header组件** - 添加语言选择选项

### 自定义默认内容

项目可以通过修改 `defaultContent.documentDefault` 来自定义不同语言的默认文档模板：

```typescript
// 在 i18n.ts 中
defaultContent: {
  documentDefault: `
# 自定义项目模板

您的自定义内容...

## 自定义章节
- 自定义要点1
- 自定义要点2
  `.trim()
}
```

## 注意事项

1. **内容持久化**: 用户编辑的内容会保存到任务数据中，切换语言不会影响已保存的内容

2. **默认内容识别**: 系统通过比较当前内容与默认内容来判断是否为占位符，在AI功能中会自动清除默认占位符

3. **日志语言**: 代码中的日志消息保持中文（根据开发团队习惯），不影响用户界面的国际化

4. **响应式更新**: 语言切换时，所有文本会立即更新，无需刷新页面

5. **类型安全**: 使用TypeScript的类型系统确保所有翻译键都已定义，避免运行时错误

## 测试建议

### 功能测试

1. **默认内容测试**:
   - 创建新任务，验证显示正确语言的默认内容
   - 切换语言后创建新任务，验证使用新语言的默认内容

2. **UI元素测试**:
   - 切换语言，验证所有按钮提示文本更新
   - 验证占位符文本正确显示
   - 验证面板标题正确显示

3. **内容保持测试**:
   - 在文档中输入内容
   - 切换语言
   - 验证用户输入的内容未被改变

### 可访问性测试

1. 使用屏幕阅读器测试所有按钮的aria-label
2. 验证键盘导航功能正常
3. 验证焦点指示器清晰可见

### 兼容性测试

1. 在不同浏览器中测试语言切换功能
2. 测试移动端设备的显示效果
3. 验证字体渲染在不同语言下的效果

## 更新历史

- **v1.0.0** (2025-10-29): 
  - 初始版本
  - 实现Documentation面板的完整国际化
  - 支持英文和中文两种语言
  - 包含默认内容、UI元素和按钮提示文本的国际化
  - 添加详细的日志记录
  - 提供完整的可访问性支持

