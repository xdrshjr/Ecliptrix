# TODO 05: 交互增强与动画系统

**对应 Spec:** `specs/05-interaction-enhancement.md`

## Dependencies

- `depends_on: [03, 04]` — 基于时间轴 UI 组件和执行引擎的状态接口
- `blocks: []` — 最终模块，不阻塞其他任务
- `parallel_group: C`

**依赖说明:** 动画和交互增强是在已实现的时间轴 UI 组件（TODO 03）上添加视觉层。需要 TODO 04 的 executionState 来驱动执行中的动画状态。

## Tasks

- [ ] 5.1 创建共享动画配置 (`animations.ts`)
  - framer-motion variants: nodeEnter, nodeExit, expand, collapse
  - CSS keyframes 定义: spin, pulse, flow, shake
  - 时长和缓动常量统一管理

- [ ] 5.2 实现节点入场动画
  - AnimatePresence 包裹 TimelineNode 列表
  - 新节点: opacity 0→1, translateY 10→0, 200ms ease-out
  - 确保列表中间插入节点（如 ThinkingNode 被 ExecutionNode 替换）时动画平滑

- [ ] 5.3 实现节点图标状态动画
  - ThinkingNode: spin 动画（1s linear infinite）
  - ExecutionNode 执行中: pulse 缩放（1→1.2→1, 1.5s）
  - 完成: 对勾图标 scale-in（spring）
  - 失败: 叉号图标 + shake
  - 撤销: 褪色（200ms）

- [ ] 5.4 实现连接线流动效果
  - 执行中区间: gradient flow 动画（2s infinite）
  - 已撤销区间: 变为灰色虚线
  - 暗色模式颜色适配

- [ ] 5.5 实现 ToolStep 展开/收起动画
  - 高度过渡: 200ms ease-out
  - 内容淡入: 150ms, 延迟 50ms
  - 箭头旋转: 180°, 200ms
  - 使用 framer-motion AnimatePresence + layout

- [ ] 5.6 实现 ToolStep 执行中视觉反馈
  - 旋转加载图标（animate-spin）
  - 背景脉冲（opacity 波动）
  - 实时耗时计时器（setInterval 100ms）
  - IntersectionObserver: 不可见时暂停计时器

- [ ] 5.7 实现完成/失败转换动画
  - executing → completed: 对勾 scale-in + 背景闪绿
  - executing → error: 叉号 + 背景闪红 + shake + 错误信息滑入
  - 持续状态: completed 保持绿色，error 保持浅红背景

- [ ] 5.8 实现撤销交互
  - 撤销按钮组: "撤销全部" + 单操作下拉菜单
  - 撤销动画: 背景变灰 + 删除线 + opacity 0.5
  - 连接线撤销区间变灰色虚线

- [ ] 5.9 实现取消执行 UI
  - 执行中显示"取消执行"按钮
  - 取消后: 当前步骤变灰、后续步骤不显示
  - 提示文本: "执行已取消，已完成的操作已保留"

- [ ] 5.10 实现流式文本光标
  - streaming 中最后字符后显示闪烁光标 `|`
  - 脉冲: opacity 0→1→0, 800ms
  - streaming 结束后光标消失（200ms 淡出）

- [ ] 5.11 创建空状态欢迎引导 (`WelcomeGuide.tsx`)
  - 标题 + 建议操作卡片
  - 卡片可点击，填入输入框
  - 建议内容根据项目状态动态调整（有素材/无素材）

- [ ] 5.12 实现错误状态展示
  - Agent 级别错误卡片（重连中/超时/失败）
  - 重连进度指示
  - 操作按钮: 取消/手动重试

- [ ] 5.13 暗色模式全面适配
  - 检查所有组件在暗色模式下的颜色
  - 确保动画颜色变量使用 CSS 变量或 dark: 前缀
  - 测试所有状态转换的暗色模式效果

- [ ] 5.14 性能优化
  - 确认动画使用 transform/opacity（GPU 合成层）
  - 长列表中已完成节点停止持续动画
  - 验证 60fps 流畅性（Chrome DevTools Performance）
  - 确保 framer-motion layout 属性仅用于必要元素
