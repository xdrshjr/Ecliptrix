# TODO 03: 前端弹窗 + 波形预览 + 交互

**对应 Spec:** `specs/03-frontend-modal-waveform.md`

## Dependencies

- `depends_on: [01]` — 需要检测 API 返回静音段数据和音频 URL
- `blocks: [04]` — 前端集成需要弹窗组件就绪
- `parallel_group: A` — 弹窗骨架和 UI 组件可与 TODO 01 并行开发；波形交互需等 API 就绪后联调

## Tasks

- [ ] 安装 wavesurfer.js 依赖
  - [ ] `npm install wavesurfer.js`

- [ ] 创建 `src/components/video/components/VideoProcessingModal/` 目录
  - [ ] 创建 `index.ts` 导出文件

- [ ] 实现 `VideoProcessingModal.tsx`
  - [ ] 使用 shadcn Dialog 组件
  - [ ] Props: isOpen, onClose, materials, onSilenceRemoved, taskId
  - [ ] Tab 栏（目前仅"切气口"一个 tab）
  - [ ] 弹窗尺寸：宽度 900px，最大高度 80vh
  - [ ] 渲染 SilenceRemovalTab

- [ ] 实现 `SilenceRemovalTab.tsx`
  - [ ] 流程阶段管理：select → configure → preview → processing → completed
  - [ ] State 管理：selectedVideo, detectionParams, silenceSegments, selectedSegmentIds, audioUrl, phase, isDetecting, error
  - [ ] 阶段切换逻辑和按钮控制（注：processing/completed 阶段渲染 ProcessingProgress 组件，该组件在 TODO 04 中实现；此处先预留阶段判断和占位）
  - [ ] API 调用封装：detectSilence, removeSilence, checkProgress（Spec 04 第 6 节）
  - [ ] ms → seconds 单位转换（调用 API 时）

- [ ] 实现 VideoSelector 子组件（内联在 SilenceRemovalTab 或独立）
  - [ ] 网格布局展示视频缩略图
  - [ ] 卡片：缩略图、名称、时长、分辨率
  - [ ] 超过 30 分钟视频灰色不可选
  - [ ] 点击选中高亮

- [ ] 实现 ParameterPanel 子组件
  - [ ] 预设按钮组：宽松 / 标准(默认) / 激进 / 自定义
  - [ ] 预设映射：loose(-40dB/800ms/300ms), standard(-30dB/500ms/200ms), aggressive(-25dB/300ms/100ms)
  - [ ] 自定义参数区（折叠/展开）
  - [ ] 滑块：音量阈值(-60~-10 dB), 最小静音时长(100~3000 ms), 保留间隔(0~1000 ms)
  - [ ] "检测静音段"按钮

- [ ] 实现 `WaveformPreview.tsx`
  - [ ] wavesurfer.js 实例初始化（useEffect + useRef）
  - [ ] Regions 插件加载
  - [ ] 加载后端返回的音频 URL
  - [ ] 根据 silenceSegments 创建 region（红色半透明标注）
  - [ ] 取消勾选的段改为灰色
  - [ ] Region 事件：region-updated（拖拽同步）、region-clicked（跳转播放）
  - [ ] 播放控制：全局播放/暂停、点击跳转
  - [ ] 试听静音段：从段前 1 秒播放到段后 1 秒
  - [ ] 试听整体效果：timeupdate 事件跳过选中的静音段
  - [ ] 缩放：鼠标滚轮缩放、底部滚动条、双击区域自适应缩放（计算目标 minPxPerSec 并调用 zoom()）
  - [ ] 深色模式颜色适配（waveColor, progressColor）
  - [ ] 组件销毁时清理 wavesurfer 实例
  - [ ] wavesurfer.js v7+ API

- [ ] 实现 `SilenceSegmentList.tsx`
  - [ ] 列表布局：每行 checkbox + 序号 + 时间范围 + 时长 + 播放按钮
  - [ ] 全选 / 全不选 / 反选 快捷按钮
  - [ ] 统计栏：共 N 个，已选 M 个，可节省 X 秒
  - [ ] 点击行 → 波形滚动到对应位置
  - [ ] 波形拖拽 → 列表时间实时更新
  - [ ] 固定高度 200px 可滚动
