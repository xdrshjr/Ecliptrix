# 多会话页签与输入区：最终代码审查

日期：2026-11-05。审查基线：`6ac965952a1cb8ff2b1561f511d14bfb2d59a2ac`。

本次对照 spec v2 审查覆盖、相邻功能回归和命名风格，完成发现问题的修复。
源码沿用项目的 React hooks、局部 CSS、主题变量、中英文翻译和单执行器设计，
不新增依赖、会话 API 或数据库迁移。共享工作区内媒体生成、后端和桌面修改不纳入提交。

## 已修复问题

| 编号 | 问题及影响 | 修复与验证 |
|---|---|---|
| CR-01 | 删除有内容会话使用通知 toast，不符合模态确认要求，菜单关闭后键盘焦点丢失 | 复用 ConfirmationDialog，portal 到 body，默认聚焦取消；Escape 只取消，关闭后焦点回活动页签；先失败再通过的实际 Dock 回归与浏览器复核 |
| CR-02 | textarea 只在文本改变时调整高度，窗口变窄可裁掉已输入的换行文本 | 监听尺寸及紧凑模式变化；回归先失败再通过；真实 DOM 宽度 476→276px 时输入高度 60→100px |
| CR-03 | 会话菜单的 Tab 顺序和失焦关闭不完整 | menuitem 不加入普通 Tab 顺序，离开菜单关闭；Shift+Tab 返回触发按钮，重复点击按钮正常收起；专项回归通过 |
| CR-04 | 复用 composer 实例切换会话时，旧发送的延迟接纳可清空新会话输入 | 草稿作用域使用递增代次，过期接纳或异常不能写新作用域；失败用例复现新草稿被清空，修复后通过 |
| CR-05 | 未提供外部缓存的兼容调用者切换项目后仍使用旧项目缓存 | 本地缓存按 projectKey 创建，旧作用域 cleanup 仍刷新原键；相同 conversationId 跨项目测试先失败再通过 |
| CR-06 | 用户消息和助手占位同时写入时，YOLO 只检查数组末尾导致后续用户回合无法获得续跑额度 | 追踪最近的非自动用户消息 ID，自动续跑本身不重置额度；保留每轮至多一次，回归先失败再通过 |
| CR-07 | AgentComposer 测试夹具把 onCancel 推断为 Mock，合法普通回调导致 TS2322 | 按组件公开 props 显式约束夹具，独立快照 type-check 通过 |

补充两会话保存失败验证：503 自动重试、409 手动重试均保留内存列表，
失败后重命名和切换页签，重试请求包含最新标题及 active ID，成功后不重复 PUT。

## 逐项覆盖核对

下列分组覆盖 spec §6 的全部条目；逐文件清单见 [files.json](files.json)。
原计划及开发阶段补充共 47 项，本轮再加删除确认回归，共 48 项（含 spec）。

| 计划分组 | 核对结果 |
|---|---|
| VideoEditingInterface、content bridge、sessions、session model | 统一会话字段写入，父级确认、默认初始化、增删改、同步守卫和来源 scope 均接入；纯函数、桥、sessions 与组合接线测试通过 |
| conversationViewCache、useComposer、useComposerStorage | 结构化草稿、v1 迁移、空标记、立即刷新、删除墓碑、回填幂等、发送接纳和修订检查已实现，新增作用域修复已验证 |
| AgentChatDock、ConversationTabs 及 CSS | 页签/面板关联、只挂活动聊天、键盘导航、命名校验、确认删除、焦点和最小化生命周期已实现 |
| VideoChatWindow、AgentComposer、AgentModeToolbar 及 CSS | 一体化输入、32px 操作行、上传令牌、状态禁用、picker、停止及输入快捷键继续复用既有链路 |
| YoloNotice、YoloToggle、video-editing.css | 浮层不占布局、6px 间距、可见计时、暂停与关闭焦点；深浅色及紧凑布局证据保留 |
| TimelineChatPanel 及 types | 可选阅读位置缓存，隐藏/卸载前保存，返回尊重 follow=false |
| useAgentExecution、useAgentExecutionState、useAgentExecutionSteering | 同步忙碌、终态交接、来源 writer、瞬态 owner、回填消费与旧回调失效已接线；原 ordering/thinking 等回归通过 |
| useContextMemory、useYoloAutoContinue | 选择代次/消息代次校验、压缩取消、一次续跑及终态确认；新增 YOLO 用户回合回归通过 |
| i18n | 仅暂存 agentConversations 类型及两种语言的三个差异块；媒体生成翻译留在工作区 |
| 所有计划测试及三个开发阶段兼容夹具 | 均存在且参与完整定向回归；新增删除确认测试不替代原生命周期测试 |
| 项目保存测试及 normalise 测试 | 会话顺序、active ID、删除、结构保留、失败后最新内容重试已验证；真实服务往返未执行 |

## 最新验证

为防止其他任务的修改掩盖依赖，使用 `git checkout-index` 导出暂存区完整快照，
复用现有 node_modules，在该快照执行检查。快照源码来自 HEAD 加本功能的 47 个源码/测试文件，
不包含媒体生成任务的未提交内容；源码文件与暂存区逐一核对。

| 检查 | 结果 |
|---|---|
| 完整定向 Vitest 回归 | 102 个文件、902 项全部通过；含全部 hooks、Dock、VideoChatWindow、组合会话测试、项目保存及 normalise |
| npm run type-check | 通过，退出 0 |
| npm run build | 注入本机 BACKEND_URL 后通过，退出 0；编译、类型校验、静态页面和产物跟踪完成 |
| npm run lint | 退出 1；四个未改动文件中五个既有错误，见下文 |
| git diff --cached --check | 通过 |
| 浏览器实际 DOM | 删除确认焦点、Escape、草稿保留、YOLO 几何、变窄输入及按钮尺寸复核通过；见 [review-browser.json](review-browser.json) |

测试命令：

```powershell
npm run test -- src/components/video/components/VideoChatWindow src/components/video/components/AgentChatDock src/components/video/hooks src/components/video/__tests__/VideoEditingInterface.chatSessions.test.tsx src/components/video/projects/__tests__/projectPersistence.integration.test.tsx src/lib/api/__tests__/videoProjects.normalise.test.ts
```

lint 既有错误来自 AudioSearchModal:9、ImageSearchModal:8、VideoSearchModal:8 的空 interface，
以及 WatermarkRemovalModal:629 的两处未转义双引号。四文件相对审查基线均无差异，未扩展修改范围。

首次隔离构建缺少未跟踪 `.env` 中的 BACKEND_URL，已完成编译与类型检查，
但在收集路由时按既有配置规则失败。后续构建仅注入 `BACKEND_URL=http://127.0.0.1:8000`，
不复制真实密钥，不更改应用配置或绕过检查。

## 浏览器证据与限制

本轮以 ego-browser 加载独立快照的生产组件夹具。YOLO 三态 toolbar/composer 顶边均为
833.1875px，显示时浮层下边界 827.1875px，布局位移 0px、间距 6px。
320px 面板中 textarea 宽度 276px、高度及 scrollHeight 均 100px，文本未裁切，按钮均 32×32px。
确认框位于 Dock 裁剪层外，初始焦点在取消；Escape 后草稿完整、焦点回 tab、模态数量为 0。

八张开发阶段真实截图及深浅色、50 页签等测量仍保留，见 [开发验收记录](report.md)。
本轮截图工具返回“窗口已最小化”，因此不冒充获得新的截图；复核使用实际 DOM 与几何数据。
开发阶段环境专用浏览器脚本、构建产物及原始日志留在本地任务目录，不纳入提交。

真实后端 GET/PUT、付费模型生成、实际上传和操作系统显示缩放未在本轮执行。
VideoEditingInterface.chatSessions 测试是 hook/组件组合夹具，不是完整编辑器挂载测试。
v2 草稿仅向前迁移；旧版不能读取新版结构化草稿，回退前应保留未发送内容，不能批量删除缓存。

## 提交范围

源码及测试按具体路径逐个 `git add`；i18n 只应用本功能差异块到索引。
审查期间并行任务又修改 VideoEditingInterface 的媒体生成 Promise 返回值，
该一行差异经检查保留在工作区，未纳入已验证的暂存快照。
文档仅纳入本 feature 的 spec、报告、可运行夹具和真实验收证据。
未使用 `git add -A`、`git add .` 或 `--no-verify`。
后台/媒体凭证/桌面修改、临时脚本、`.next`、缓存与构建输出均排除。
