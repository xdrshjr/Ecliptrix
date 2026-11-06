# 多会话页签与输入区实施验收

日期：2026-11-05（America/New_York）

本文保留开发节点的历史验收记录。最终审查修复及独立快照验证见
[最终审查报告](review.md)，其结果优先于下述开发阶段状态。
原始日志仅保留在本地运行目录，不随源码提交。

已完成 v2 方案中的会话页签、一体化输入卡片、YOLO 非占位浮层及运行接线。
未执行 git commit，未改动依赖。实现阶段的方案补充见 [spec.md](../spec.md#实施过程发现的方案缺陷)。

## 交付范围

- 新项目默认一个会话；支持创建、选择、重命名、删除、清空和键盘导航。
  仅活动会话挂载聊天组件，其余页签保留空 tabpanel 外壳。
- 会话字段通过统一桥接写入，避免旧项目快照覆盖新会话；父级确认后解除结构锁。
  Agent、普通聊天、上传、压缩、收尾交接均查询同步守卫。
- 异步写入携带实例、会话与消息代次；清空、删除或卸载后的旧结果不能复活消息。
  AskUser、润色、执行错误、用量、研究小队和回填均按来源隔离。
- v2 草稿保存文本、技能与素材引用，切换时同步 flush，支持 v1 前向读取、空标记、
  存储异常降级和一次性回填；发送被拒绝或期间继续输入时保留草稿。
- 输入卡片统一边框与底部操作行，按钮 32×32；运行时支持插话和停止。
  修复停止按钮同步变成发送按钮时的默认表单提交，停止后草稿保留。
- YOLO 说明在模式工具栏上方悬浮，累计可见 8 秒，悬停、焦点、隐藏或忙碌时暂停。
  空间不足时延后显示，关闭后恢复焦点。颜色沿用项目深浅主题 token。

## 实际执行的检查

| 检查 | 结果与证据 |
|---|---|
| `npm run type-check` | 最新执行退出码 0。初次复查遇到并行任务的 AsyncTaskPoller Set/Map 迭代错误，随后该任务更新后通过。 |
| `npm run build` | 最新执行退出码 0；见 `build-final.log`（本地日志）。生产编译、类型检查、静态页面生成和产物跟踪完成。 |
| `npm run dev -- --port 4179` | Ready；首页编译 6369 modules，实际 GET `/` 返回 200（13081 bytes）。验收后关闭本次服务。 |
| 方案 §8.3 全部定向测试目录与文件，合并一次执行 | 最新 104 文件：103 通过、1 失败；907 项：899 通过、8 失败；见 `tests-final.log`（本地日志）。失败均来自另一任务新增的 `useStoryboardScriptGeneration.test.tsx`，详见下文。 |
| `AgentComposer.test.tsx` | 停止误发送回归先复现失败，修复后 4 项通过；最终完整测试也包含该项。 |
| 独立只读复核 | sessions、bridge、runtime sessions、useComposer、AgentComposer、VideoChatWindow.contextMemory 六文件 42 项通过；未发现剩余 P0/P1。 |
| `npm run lint` | 退出码 1：4 个未改动文件中的 5 个既有错误；见 `lint.log`（本地日志）。 |
| 计划文件与差异检查 | 方案表格及已记录例外共 47 文件均存在且有改动，见 [files.json](files.json)。新增源码模块均少于 800 行；VideoEditingInterface 净减少 2 行。相关路径 `git diff --check` 通过。 |

完整定向回归命令：

```powershell
npm run test -- src/components/video/components/VideoChatWindow src/components/video/components/AgentChatDock src/components/video/hooks src/components/video/__tests__/VideoEditingInterface.chatSessions.test.tsx src/components/video/projects/__tests__/projectPersistence.integration.test.tsx src/lib/api/__tests__/videoProjects.normalise.test.ts
```

该命令实际覆盖原有 execution ordering、thinking、YOLO、上下文压缩、输入快捷键、
浮窗生命周期及新增会话测试。没有跳过 hooks 目录。

共享工作区的无关失败没有在本任务内修改：

- 最新 8 项测试失败：`src/components/video/hooks/__tests__/useStoryboardScriptGeneration.test.tsx`，
  属于同时进行的 AI 媒体任务新增测试，涉及视频完成元数据、轮询互斥和取消。
  上一轮 `useAIVideoScriptGeneration.test.tsx` 的 4 项失败在该任务继续修改后已通过。
- lint 既有错误：`AudioSearchModal/AudioSearchModal.tsx:9`、
  `ImageSearchModal/ImageSearchModal.tsx:8`、`VideoSearchModal/VideoSearchModal.tsx:8`
  的空 interface，以及 `WatermarkRemovalModal/WatermarkRemovalModal.tsx:629`
  两处未转义双引号。上述四文件相对 HEAD 无差异。
- 工作区原有 desktop 修改，以及并行任务的 backend、集成设置、视频生成等修改均保留；
  它们不属于本节点交付。后续提交节点应按本功能明确路径暂存，不使用 `git add -A`。

## 浏览器证据

使用 ego-browser Chromium 直接渲染生产 Dock、会话 hooks、VideoChatWindow 和 composer，
页面入口为本目录的 `harness.tsx`。运行状态、材料、能力和技能 API 使用本地夹具，
没有真实 LLM 或付费请求。该入口验证真实 DOM/CSS 与组件交互，不等同完整编辑器后端联调。

| 项目 | 实测 |
|---|---|
| YOLO 显示前／中／后 | toolbar.top = composer.top = 833.1875；消息 clientHeight = 522；三态差值均 0px。 |
| 浮层位置 | notice.bottom = 827.1875，距工具栏 6px；notice.top = 777.1875，位于 tabpanel.top = 311.1875 下方。 |
| 输入按钮 | 单行和多行均 32×32，同一底部操作行；浅色主按钮 #0C8CE9、深色 #0D99FF，停止 #F24822。 |
| 窄窗 | 320、360、520px 紧凑面板均无输入区横向溢出，按钮完整且中心点不被浮球遮挡。 |
| 多页签 | 50 个 tab、50 个 panel 外壳、1 个可见 panel、1 个聊天实例；创建后焦点在输入框。 |
| 对比度 | 输入正文／输入背景：深色 10.58:1，浅色 11.09:1，均超过 4.5:1。 |
| 缩放与语言 | 中文、英文、深浅色截图；200% 使用 CSS zoom=2 模拟，未宣称完成 OS 级显示缩放验收。 |
| reduced-motion | 浏览器媒体仿真为 reduce 时，主按钮 transitionDuration = 0s。 |
| 停止交互 | 点击停止后文本仍为“停止后保留的草稿”，消息区域未新增消息；单测也覆盖同步重渲染。 |

测量数据：[geometry.json](geometry.json)、[responsive.json](responsive.json)、
[colors.json](colors.json)、[stop-regression.json](stop-regression.json)。

截图：

| 状态 | 文件 |
|---|---|
| 默认会话 | [01-default.png](01-default.png) |
| 多会话 | [02-three-tabs.png](02-three-tabs.png) |
| YOLO 说明 | [03-yolo-notice.png](03-yolo-notice.png) |
| 运行中插话与停止 | [04-running.png](04-running.png) |
| 多行与选择器 | [05-multiline-picker.png](05-multiline-picker.png) |
| 浅色紧凑面板 | [06-light-compact.png](06-light-compact.png) |
| 英文 200% 放大 | [07-english-zoom.png](07-english-zoom.png) |
| 启用的发送按钮 | [08-send-enabled.png](08-send-enabled.png) |

最后四张相关截图在按钮背景优先级修复后更新。开发阶段 `browser-*.mjs` 轮次记录
已保留在 `.agentmesh/review-chat-20261105/development-browser-records/`，不纳入提交；
它们包含环境专用任务空间 ID 和诊断步骤，并非可从头顺序执行的单一测试。
重新人工验收可运行下列命令，再用新建的浏览器任务空间打开 `http://127.0.0.1:4178/`：

```powershell
npx --no-install vite --config docs/plans/agent-chat-tabs-and-composer/verification/vite.config.ts
```

## 验收边界与后续交接

- AC-15 的 mock 持久化保存、恢复、删除、失败后重试测试通过；真实后端 GET/PUT 往返
  未执行。完整编辑器真实上传、真实模型续跑和系统级缩放未执行，不能用上述夹具替代。
- 旧版可读取原 conversations；v2 结构化草稿仅由新版读取，不做反向迁移或双写。
  如需回退旧版继续编辑，先复制尚未发送的草稿；不要批量清除 v1/v2 缓存或回滚数据库。
- 并行任务测试失败与既有 lint 错误是全局检查的已知限制；本功能实现、类型检查、生产构建
  和浏览器组件验收已完成。未修改任何真实项目数据，未执行提交。
- 任务工具缺少 `TASK_SERVER_URL`。最终上报按任务提示重试三次，失败时仅回退更新
  Subtask #2，并读取本地看板核验；服务器状态无法在此环境确认。
