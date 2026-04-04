# 05 - 前端设置面板设计

## 概述

扩展现有 `AdminSettingsPage` 侧边栏，为每类功能配置新增独立的表单式编辑面板。

## 侧边栏扩展

### 现有结构 (`SettingsSidebar.tsx`)

```
现有菜单项:
- 模型设置 (ModelSettingsPanel)
- Coding Plan (CodingPlanPanel)
- 用户管理 (UserManagement)

新增菜单项:
- TTS 设置 (TTSSettingsPanel)
- YouTube 设置 (YouTubeSettingsPanel)
- 上传设置 (UploadSettingsPanel)
- 水印移除设置 (WatermarkSettingsPanel)
- 视频分析设置 (VideoAnalysisSettingsPanel)
```

## 通用面板架构

每个面板遵循统一模式：

```
组件结构:
  <SettingsPanel category="tts">
    <SettingsSectionCard title="并发配置" settingKey="concurrency">
      <NumberInput label="并发线程数" field="concurrent_threads" min={1} max={10} />
      <NumberInput label="请求超时(秒)" field="request_timeout" min={5} max={120} />
      ...
    </SettingsSectionCard>
    <SettingsSectionCard title="声音列表" settingKey="voices">
      <VoiceListEditor />
    </SettingsSectionCard>
    <ResetDefaultsButton category="tts" />
  </SettingsPanel>
```

**数据流：**

```
1. 面板加载 -> GET /api/system-settings/{category} -> 填充表单
2. 用户修改 -> 本地 state 更新
3. 点击保存 -> PUT /api/system-settings/{category} -> 刷新数据
4. 点击恢复默认 -> POST /api/system-settings/{category}/reset -> 刷新数据
```

## 各面板详细设计

### TTS 设置面板 (`TTSSettingsPanel.tsx`)

**Section 1: 并发与超时** (key: `concurrency`)
- 并发线程数: NumberInput (1-10)
- 最大并发线程数: NumberInput (1-20)
- 单请求超时(秒): NumberInput (5-120)
- 批处理总超时(秒): NumberInput (60-600)

**Section 2: 重试配置** (key: `retry`)
- 最大重试次数: NumberInput (0-10)
- 重试间隔(秒): NumberInput (1-30)
- 退避因子: NumberInput (1-5)

**Section 3: 资源限制** (key: `limits`)
- 每批最大段数: NumberInput (10-200)
- 每段最大字符数: NumberInput (1000-10000)
- 总最大字符数: NumberInput (10000-500000)

**Section 4: 日志配置** (key: `logging`)
- 启用详细日志: Switch
- 进度记录间隔: NumberInput
- 日志级别: Select (DEBUG/INFO/WARNING/ERROR)

**Section 5: 声音列表管理** (key: `voices`)

这是最复杂的部分，需要专门的组件：

```
<VoiceListEditor>
  - 按 category 分组展示（通用场景/方言/角色扮演/旁白/有声书）
  - 每个声音项：可编辑 label, value, category, gender, language, description
  - 添加声音: 弹出表单，填写全部字段
  - 删除声音: 确认后删除
  - 拖拽排序（同分组内）
  - 搜索/筛选: 按名称、性别、分类过滤
  - 批量操作: 全选/删除选中
</VoiceListEditor>
```

声音项数据结构：
```
{
  value: string,       // 引擎声音 ID
  label: string,       // 显示名称
  category: string,    // 分类
  gender: 'male' | 'female',
  language: string,    // 'zh-CN', 'en-US' 等
  description: string  // 描述
}
```

### YouTube 设置面板 (`YouTubeSettingsPanel.tsx`)

**Section 1: 下载配置** (key: `download`)
- 最大并发下载数: NumberInput (1-50)
- 下载超时(秒): NumberInput (60-600)
- 最大重试次数: NumberInput (0-10)
- 重试间隔(秒): NumberInput (1-30)

**Section 2: 上传配置** (key: `upload`)
- 上传超时(秒): NumberInput (60-1200)
- 最大重试次数: NumberInput (0-10)
- 重试间隔(秒): NumberInput (1-30)

**Section 3: 视频质量** (key: `quality`)
- 默认视频质量: Select (360p/480p/720p/1080p/best)
- 默认音频质量: Select (worst/128k/256k/best)
- 默认输出格式: Select (mp4/webm/mkv)

**Section 4: 文件管理** (key: `file_management`)
- 自动清理临时文件: Switch
- 临时文件保留时间(小时): NumberInput (1-168)
- 生成缩略图: Switch

**Section 5: 日志配置** (key: `logging`)
- 启用详细日志: Switch
- 记录下载进度: Switch
- 进度日志间隔(秒): NumberInput (1-60)

### 上传设置面板 (`UploadSettingsPanel.tsx`)

**Section 1: 并发上传** (key: `concurrent_upload`)
- 最大并发上传数: NumberInput (1-10)
- 队列最大长度: NumberInput (0=无限)
- 上传超时(秒): NumberInput (60-600)
- 启用上传队列: Switch

**Section 2: 文件大小限制** (key: `file_size_limits`)
- 视频最大大小(MB): NumberInput (100-2000)
- 音频最大大小(MB): NumberInput (50-500)
- 图片最大大小(MB): NumberInput (10-200)

**Section 3: 重试配置** (key: `retry`)
- 最大重试次数: NumberInput (0-10)
- 重试间隔(秒): NumberInput (1-30)
- 指数退避: Switch

**Section 4: 缩略图** (key: `thumbnail`)
- 自动生成视频缩略图: Switch
- 缩略图质量(1-31): NumberInput
- 最大宽度(px): NumberInput
- 最大高度(px): NumberInput

**Section 5: 临时文件** (key: `temp_file_management`)
- 自动清理: Switch
- 保留时间(小时): NumberInput (1-168)
- 临时文件目录: TextInput (只读展示)

**Section 6: 日志** (key: `logging`)
- 同上模式

### 水印移除设置面板 (`WatermarkSettingsPanel.tsx`)

较简单，只有两个 section：

**Section 1: 处理配置** (key: `removal`)
- 并发线程数: NumberInput (1-20)
- 最大并发线程数: NumberInput (1-30)
- 批处理帧数: NumberInput (10-200)
- 批处理超时(秒): NumberInput (10-300)

**Section 2: 日志** (key: `logging`)
- 启用详细日志: Switch
- 进度记录间隔(帧): NumberInput
- 日志级别: Select
- 启用线程日志: Switch

### 视频分析设置面板 (`VideoAnalysisSettingsPanel.tsx`)

**Section 1: 队列管理** (key: `queue_management`)
- 最大并发分析数: NumberInput (1-10)
- 启用单视频队列: Switch

**Section 2: VLM 处理** (key: `vlm_processing`)
- 并发线程数: NumberInput (1-10)
- API 超时(秒): NumberInput (10-120)
- 最大重试次数: NumberInput (0-5)

**Section 3: 帧提取** (key: `frame_extraction`)
- 默认帧间隔(秒): NumberInput (1-30)
- 每视频最大帧数: NumberInput (1-20)
- 支持的格式: TagInput (可增删格式)
- **时长策略子表单:**
  - 短视频阈值(秒), 帧间隔, 最大帧数
  - 中视频阈值(秒), 帧间隔, 最大帧数
  - 长视频帧间隔, 最大帧数

**Section 4: 性能** (key: `performance`)
- 启用性能日志: Switch
- 记录并发统计: Switch
- 最大视频时长(秒): NumberInput (60-7200)

**Section 5: 临时文件** (key: `temp_files`)
- 视频下载目录: TextInput
- 帧提取目录前缀: TextInput
- 自动清理: Switch
- 清理超时(秒): NumberInput

**Section 6: 日志** (key: `logging`)
- 同上模式

## 通用 UI 组件

### `SettingsSectionCard`

```
Props:
  title: string
  description?: string
  children: ReactNode
  isDirty: boolean      // 是否有未保存的修改
  onSave: () => void
  onReset: () => void   // 恢复此 section 的默认值
```

显示为 shadcn Card，右上角有 保存/重置 按钮，未保存时显示修改提示。

### `ResetDefaultsButton`

```
Props:
  category: string
  onReset: () => void
```

"恢复全部默认值" 按钮，带确认对话框。

## 文件位置

所有新面板放在 `src/components/AdminSettings/` 目录下：

```
src/components/AdminSettings/
  TTSSettingsPanel.tsx
  YouTubeSettingsPanel.tsx
  UploadSettingsPanel.tsx
  WatermarkSettingsPanel.tsx
  VideoAnalysisSettingsPanel.tsx
  components/
    SettingsSectionCard.tsx
    VoiceListEditor.tsx
    ResetDefaultsButton.tsx
```

## 国际化

所有面板标签和描述通过 `src/lib/i18n.ts` 提供中英文翻译。新增的翻译 key 以 `settings.` 前缀组织。
