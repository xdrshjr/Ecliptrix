# TODO 01：源码废弃代码删除

> 对应 spec：`specs/01-source-dead-code-removal.md`

## Dependencies

- `depends_on: []` — 无前置，可立即开始
- `blocks: [04]` — Spec 04 的全量验证/提交需等本任务完成
- `parallel_group: A` — 与 TODO 02、03 可并行（触及文件集互不重叠）

> 为何并行安全：TODO 01 只动 `src/` 下源码；TODO 02 动 git 索引 + `.gitignore`；TODO 03 删 `ops/` 未跟踪文件。三者文件集不相交。**唯一约束**：三者均不得 `git commit`，提交统一由 TODO 04 串行执行，避免并发写 git index。

## 任务清单

### 准备
- [ ] 读 `master-plan.md`、`specs/01-source-dead-code-removal.md`
- [ ] 确认当前分支为 `feat/local-video-editing-refactor`

### C1：`src/lib/utils/formatConverter.ts`（0 引用）
- [ ] 五步零引用核验（符号名 `convertFormat`/`detectFormat`/`getFormatDisplayName`/`getFormatIcon` 等 + 文件路径 + barrel 再导出 + 动态引用）
- [ ] 确认全部命中为自身 → 删除整文件
- [ ] 记录核验依据

### C2：`src/components/video/services/timelineExportService.ts`（仅注释引用）
- [ ] 五步核验，确认仅 `TimelineRepository.ts` 有注释提及
- [ ] 删除整文件
- [ ] `grep -n timelineExportService src/components/video/timeline/infrastructure/TimelineRepository.ts` 复核行号（预期 line 8/13/110/208/209）
- [ ] 改写这些注释为不指向已删文件（保留"逻辑源自已移除的 timelineExportService，git 历史可查"的历史说明）

### C3：`src/components/video/services/VideoCache.ts`（`@deprecated`）
- [ ] 五步核验，确认唯一命中为文件内 `videoCache` 单例自引用（line 349）+ 纯注释，无外部 importer
- [ ] 确认 `VideoCacheAdapter`/`useVideoCache`/`VideoCacheState` 的真实引用全部指向新适配器/hook，而非本文件
- [ ] 删除整文件

### C4：`buildVideoEditingTools()` @ `src/lib/video-editing-agent/tools/index.ts`（`@deprecated` 函数）
- [ ] 五步核验，确认仅定义 + `categories.ts` 注释提及，无真实调用方
- [ ] 确认其内部调用的 `create*Tool` 依赖仍被 `buildAllAgentTools` 使用（删函数不孤立这些依赖）
- [ ] **仅删该函数**（保留文件其余导出）

### C5：`src/components/video/hooks/usePlaybackWaitState.ts` + 测试
- [ ] 五步核验，确认仅 `__tests__/usePlaybackWaitState.test.ts` 引用
- [ ] 删除 hook 文件
- [ ] 同删 `src/components/video/hooks/__tests__/usePlaybackWaitState.test.ts`

### 明确保留（不得碰）
- [ ] 确认未触碰 `src/lib/clipboard.ts`（被 MessageBubble 引用）
- [ ] 确认未触碰 `AgentMessageBubble.tsx` / `AgentToolCallCard.tsx`（仍被 import）

### 局部验证（最终全量在 TODO 04）
- [ ] `npm run type-check` 无新增「找不到模块/符号」错误
- [ ] `npm run lint` 无新增断引用
- [ ] 受影响 vitest：`npx vitest run src/components/video/hooks src/components/video/timeline src/lib/video-editing-agent`

### 收尾
- [ ] **不 commit**（交 TODO 04 串行提交）
- [ ] 写执行 summary：删了什么、每项核验依据、保留项与原因
