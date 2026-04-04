# Spec 03: 前端弹窗 + 波形预览 + 交互

## 1. 概述

实现视频处理弹窗（VideoProcessingModal）和切气口页签（SilenceRemovalTab），包含视频选择、参数面板、wavesurfer.js 波形可视化、静音段标注和交互编辑（勾选/拖拽/试听）。

## 2. 数据类型

```
SilenceSegment:
  id: string              # 段落唯一标识（由后端 detect 返回的 uuid）
  start: float            # 起始时间（秒）
  end: float              # 结束时间（秒）
  duration: float         # 时长（秒）

DetectionParams:
  preset: "loose" | "standard" | "aggressive" | "custom"
  noiseThreshold: number  # dB，UI 展示/操作单位
  minSilenceDuration: number  # ms，UI 展示/操作单位（调用 API 时转换为秒）
  preservedGap: number    # ms，UI 展示/操作单位（调用 API 时转换为秒）
```

注意：前端 UI 中 `minSilenceDuration` 和 `preservedGap` 使用毫秒（ms）单位以便用户理解。调用后端 API 时需转换为秒：`min_silence_duration = minSilenceDuration / 1000`，`preserved_gap = preservedGap / 1000`。

## 3. 组件结构

### 3.1 VideoProcessingModal

弹窗主组件，管理页签状态。

```
Props:
  isOpen: boolean                  # 弹窗是否打开
  onClose: () => void              # 关闭回调
  materials: MaterialItem[]        # 可选择的视频素材列表
  onMaterialUpdate: (id, newData) => void  # 素材更新回调（替换原素材时调用）

State:
  activeTab: string = "silence-removal"    # 当前活跃页签

UI 结构:
  - Dialog/Modal 容器（参考项目 shadcn Dialog）
  - 顶部：标题 "视频处理" + 关闭按钮
  - Tab 栏：目前仅 "切气口" 一个 tab
  - Tab 内容区：渲染 SilenceRemovalTab
  - 弹窗尺寸：宽度 900px，高度 auto（最大 80vh），可内部滚动
```

### 3.2 SilenceRemovalTab

切气口页签，编排整个处理流程。

```
Props:
  materials: MaterialItem[]
  onMaterialUpdate: (id, newData) => void

State:
  selectedVideo: MaterialItem | null       # 选中的视频
  detectionParams: DetectionParams         # 检测参数
  silenceSegments: SilenceSegment[]        # 检测到的静音段
  selectedSegmentIds: Set<string>          # 用户勾选要移除的段
  audioUrl: string | null                  # 后端返回的音频 URL
  phase: "select" | "configure" | "preview" | "processing" | "completed"
  isDetecting: boolean                     # 正在检测中
  error: string | null

流程阶段:
  1. select: 用户从素材列表选择一个视频
  2. configure: 设置检测参数（预设/自定义），点击"检测静音段"
  3. preview: 波形可视化 + 静音段编辑，确认后点击"开始处理"
  4. processing: 显示处理进度（此阶段由 ProcessingProgress 接管）
  5. completed: 显示处理结果，关闭弹窗
```

### 3.3 VideoSelector

视频选择子组件，嵌入在 SilenceRemovalTab 的 select 阶段。

```
Props:
  materials: MaterialItem[]        # 仅过滤 type="video" 的素材
  selectedVideo: MaterialItem | null
  onSelect: (video: MaterialItem) => void

UI:
  - 网格布局展示视频缩略图
  - 每个卡片显示：缩略图、名称、时长、分辨率
  - 超过30分钟的视频标记为不可选（灰色 + 提示文字）
  - 点击选中，高亮边框
  - 选中后显示"下一步"按钮
```

### 3.4 ParameterPanel

参数设置面板。

```
Props:
  params: DetectionParams
  onChange: (params: DetectionParams) => void

默认值:
  noiseThreshold: -30 dB
  minSilenceDuration: 500 ms
  preservedGap: 200 ms

预设方案映射:
  loose     → { noiseThreshold: -40, minSilenceDuration: 800, preservedGap: 300 }
  standard  → { noiseThreshold: -30, minSilenceDuration: 500, preservedGap: 200 }
  aggressive→ { noiseThreshold: -25, minSilenceDuration: 300, preservedGap: 100 }
  custom    → 用户自定义

UI 布局:
  - 预设按钮组：宽松 / 标准(默认选中) / 激进 / 自定义
  - 自定义参数区（默认折叠，选"自定义"时展开）：
    - 音量阈值滑块：-60 ~ -10 dB，步长 1
    - 最小静音时长滑块：100 ~ 3000 ms，步长 50
    - 保留间隔滑块：0 ~ 1000 ms，步长 50
  - 每个参数旁有简短说明文字
  - "检测静音段"按钮（主按钮样式）
```

## 4. WaveformPreview 组件

核心交互组件，使用 wavesurfer.js。

### 4.1 初始化

```
依赖:
  - wavesurfer.js (npm: wavesurfer.js)
  - wavesurfer.js regions plugin (npm: wavesurfer.js 内置 regions)

初始化流程:
  1. 创建 wavesurfer 实例
     - container: ref 指向的 div
     - waveColor: 根据 dark mode 切换颜色
     - progressColor: 播放进度颜色
     - url: audioUrl（后端提取的音频 URL）
     - height: 120px
     - barWidth: 2
     - barGap: 1
  2. 加载 Regions 插件
  3. 音频加载完成后，根据 silenceSegments 创建 region
```

### 4.2 静音段区域标注

```
对每个 silenceSegment 创建 region:
  - id: segment.id
  - start: segment.start
  - end: segment.end
  - color: rgba(255, 0, 0, 0.15)  # 红色半透明（表示将被移除）
  - drag: true                     # 可拖拽移动
  - resize: true                   # 可拖拽调整边界
  - minLength: 0.05                # 最小 50ms

用户取消勾选的段:
  - color 改为 rgba(128, 128, 128, 0.1)  # 灰色（表示保留）
  - 或移除 region

Region 事件监听（通过 regionsPlugin 实例注册，非 wavesurfer 实例）:
  - region-updated: 用户拖拽/调整后，同步更新 silenceSegments 中对应段的 start/end
  - region-clicked: 跳转播放到该区域
```

### 4.3 播放试听

```
功能:
  - 全局播放/暂停按钮
  - 点击波形某位置跳转播放
  - 点击某个静音段 region → 从该段前 1 秒开始播放到该段后 1 秒
  - 播放时 progress cursor 实时移动

试听控制:
  - 试听整体效果按钮：跳过所有勾选的静音段进行播放
    实现方式：监听 wavesurfer 的 timeupdate 事件，
    当播放位置进入被选中移除的静音段时，自动跳到该段结束位置
    注意：timeupdate 触发频率约 ~250ms，跳转时机为近似预览效果，非精确裁剪
```

### 4.4 缩放与滚动

```
- 鼠标滚轮缩放波形（需自定义 wheel 事件处理器，调用 wavesurfer.zoom() 方法）
- 底部滚动条浏览长音频（wavesurfer v7 容器默认支持水平滚动）
- 缩放级别指示器
- 双击某区域自适应缩放到该区域（需自定义 dblclick 事件，计算目标 minPxPerSec 并调用 zoom()）
```

## 5. SilenceSegmentList 组件

静音段列表面板，与波形同步。

```
Props:
  segments: SilenceSegment[]
  selectedIds: Set<string>
  onToggle: (id: string) => void      # 切换勾选状态
  onFocus: (id: string) => void       # 点击跳转到波形对应位置
  onPlaySegment: (id: string) => void # 试听该段前后上下文（由父组件通过 wavesurfer 实例播放）

UI:
  - 列表形式，每行一个静音段
  - 每行包含：
    - Checkbox（勾选 = 要移除）
    - 序号
    - 起始时间 ~ 结束时间（格式 mm:ss.ms）
    - 时长
    - 播放按钮（试听该段前后上下文）
  - 顶部："全选" / "全不选" / "反选" 快捷按钮
  - 顶部显示统计：共 N 个静音段，已选 M 个，可节省 X 秒
  - 列表可滚动（固定高度 200px）
  - 点击某行 → 波形自动滚动并高亮到对应位置
  - 波形区域的拖拽更新 → 列表中对应行的时间实时更新
```

## 6. 操作按钮区

```
位于 SilenceRemovalTab 底部:

preview 阶段:
  - "重新检测" 按钮（次要样式）→ 回到 configure 阶段
  - "开始处理" 按钮（主要样式）→ 进入 processing 阶段
    - 按钮旁显示预计结果：原时长 → 新时长（节省 X 秒）

configure 阶段:
  - "上一步" 按钮 → 回到 select 阶段
  - "检测静音段" 按钮（主要样式，检测中显示 loading）

select 阶段:
  - "下一步" 按钮（选中视频后可点击）
```

## 7. 深色模式支持

```
波形颜色适配:
  - waveColor: light mode = #4a90d9, dark mode = #6bb5ff
  - progressColor: light mode = #2563eb, dark mode = #3b82f6
  - region 颜色保持一致（半透明红色/灰色在两种模式下均清晰可见）

组件样式:
  - 使用 Tailwind CSS 的 dark: 前缀
  - 使用项目 CSS 变量（与现有组件一致）
```

## 8. 状态管理

```
SilenceRemovalTab 内部使用 useState 管理所有状态。
不需要 Context 或全局状态，因为：
  - 所有状态局限在弹窗生命周期内
  - 唯一需要向外传递的是 onMaterialUpdate（处理完成时调用）

对外通信:
  - 检测完成 → 无需对外通知
  - 处理完成 → 调用 onMaterialUpdate(video.id, { url: newUrl, duration: newDuration })
  - 弹窗关闭 → 清理 wavesurfer 实例和所有状态
```

## 9. wavesurfer.js 集成注意事项

```
- React 生命周期管理：在 useEffect 中创建 wavesurfer 实例，返回清理函数销毁
- audioUrl 变化时重新加载（销毁旧实例，创建新实例）
- ref 管理：使用 useRef 持有 wavesurfer 实例和 regions 插件引用
- 性能优化：
  - 波形渲染使用 WebAudio decoder（wavesurfer 默认）
  - 避免在 region 更新时频繁 re-render 组件
  - 使用 useCallback 包裹事件回调
- 注意 wavesurfer.js v7+ API（不是 v6 的旧 API）
```
