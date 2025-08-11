# 脚本生成配置功能更新

## 功能概述

为Video Editing任务的"生成脚本"功能添加了配置弹窗，允许用户在生成脚本前进行详细配置。

## 实现的功能

### 1. 用户界面
- **配置弹窗**：点击"生成脚本"按钮后弹出配置弹窗
- **苹果浅色风格设计**：简洁、优雅、美观的UI设计
- **配置选项**：
  - 脚本语言选择（中文、英语、中英混杂）
  - 原文保持程度（高度一致、略微修改、大幅修改）
  - 生成段落数（1-10，滑动条选择）
  - 自定义要求（可选文本输入）

### 2. 技术实现

#### 前端修改
1. **类型定义** (`src/types/index.ts`)
   - 添加 `ScriptGenerationConfig` 接口

2. **新组件** (`src/components/video/components/ScriptGenerationModal/`)
   - `ScriptGenerationModal.tsx` - 主要弹窗组件
   - `index.ts` - 导出文件

3. **状态管理** (`src/components/video/VideoEditingInterface.tsx`)
   - 添加弹窗显示状态
   - 添加配置处理函数
   - 集成弹窗组件

4. **Hook更新** (`src/components/video/hooks/useScriptGeneration.ts`)
   - 添加 `handleGenerateScriptWithConfig` 方法
   - 支持配置参数的脚本生成

5. **服务层更新** (`src/components/video/services/scriptService.ts`)
   - 添加 `generateScriptWithConfig` 方法
   - 支持配置参数的API调用

#### 后端修改
6. **API路由** (`src/app/api/video-script-generation/route.ts`)
   - 支持可选的 `scriptConfig` 参数
   - 更新提示词构建函数以应用配置
   - 增强日志记录

7. **API文档** (`backend-services/basic-service/docs/apis/video-script-generation.md`)
   - 更新请求参数文档
   - 添加配置选项说明
   - 提供示例请求

## 配置选项详解

### 脚本语言 (language)
- `chinese`: 生成中文脚本
- `english`: 生成英文脚本  
- `mixed`: 根据内容智能选择中英混杂

### 保持程度 (consistency)
- `high`: 高度保持原文表达方式
- `moderate`: 适度调整以适合视频表达
- `low`: 大幅优化以提升视频效果

### 段落数量 (segmentCount)
- 范围：1-10
- 默认：5
- 通过滑动条选择

### 自定义要求 (customRequirements)
- 可选文本输入
- 最大长度：500字符
- 支持风格、语调、重点等特殊要求

## 日志记录

### 前端日志
- 弹窗打开/关闭事件
- 配置选项变更
- 脚本生成请求发起
- 详细的用户操作追踪

### 后端日志
- 配置参数记录
- API调用详情
- 生成过程统计
- 错误和异常处理

## 向后兼容性

- 保持原有的无配置脚本生成功能
- 未提供配置时使用默认设置
- 不影响现有的脚本生成流程

## 文件变更清单

### 新增文件
- `src/components/video/components/ScriptGenerationModal/ScriptGenerationModal.tsx`
- `src/components/video/components/ScriptGenerationModal/index.ts`

### 修改文件
- `src/types/index.ts` - 添加配置接口
- `src/components/video/VideoEditingInterface.tsx` - 集成弹窗
- `src/components/video/hooks/useScriptGeneration.ts` - 支持配置
- `src/components/video/services/scriptService.ts` - API服务更新
- `src/components/video/types/videoEditingTypes.ts` - Hook返回类型更新
- `src/components/video/components/index.ts` - 导出新组件
- `src/app/api/video-script-generation/route.ts` - API路由更新
- `backend-services/basic-service/docs/apis/video-script-generation.md` - 文档更新

## 使用流程

1. 用户点击"生成脚本"按钮
2. 弹出配置弹窗
3. 用户选择配置选项
4. 点击"开始生成"
5. 弹窗关闭，开始生成脚本
6. 显示生成进度
7. 生成完成后更新脚本内容

## 技术特点

- **TypeScript严格类型检查**
- **详细的错误处理和日志记录**
- **响应式设计和用户友好的交互**
- **模块化的代码结构**
- **完整的API文档**

## 测试建议

建议测试以下场景：
1. 不同配置组合的脚本生成
2. 边界值测试（最小/最大段落数）
3. 长文本自定义要求
4. 网络异常情况处理
5. 弹窗交互和状态管理 