# TODO 01：架构重构与模块拆分

> Reference: [`specs/01-architecture-refactor.md`](../specs/01-architecture-refactor.md)

## Dependencies

- `depends_on`: []
- `blocks`: [02, 03, 08]
- `parallel_group`: A
- 说明：是整个 v2 栈的基础骨架，必须先落地。02 / 03 / 08 直接依赖本 spec 暴露的接口、目录结构与 Feature flag 工具；04 / 07 通过 02、03 间接依赖。

## Tasks

- [ ] 创建 `src/components/video/playback/` 目录骨架（types.ts、PlaybackEngine.ts、PlaybackClock.ts、AbBufferController.ts、CanvasCompositor.ts、PlayheadController.ts、index.ts），所有类均为 stub 实现 + 接口声明
- [ ] 在 `playback/types.ts` 定义 `PlaybackPhase`、`PlaybackIntent`、`PreviewFrame` 等类型（与 spec 01 §4.1 一致）
- [ ] 实现 `src/lib/playbackFlags.ts`，导出 `isPlaybackV2Enabled()`；解析顺序：localStorage `ecliptrix-playback-v2` → `process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED`
- [ ] 单测 `src/lib/__tests__/playbackFlags.test.ts`：覆盖 localStorage 优先级、env fallback、缺省 false
- [ ] 把 `VideoPlayerPanel.tsx` 当前内联的"播放控件 UI"（按钮、滑块、比例、封面 CoverButton 等）抽出到新文件 `components/VideoPlayerPanel/PlayerControls.tsx`
- [ ] 把 `VideoPlayerPanel.tsx` 中的图片叠加、字幕、cover 模态等抽出到 `PlayerOverlays.tsx`
- [ ] 创建 `PreviewSurface.tsx`：内含 `variant: 'v2' | 'legacy'` 分支；`legacy` 完全保留现状（单 `<video>` + canvas 帧缓冲 + seek 锁）；`v2` 渲染 `<canvas>` + 两个隐藏 `<video>` ref（A、B）
- [ ] `VideoPlayerPanel.tsx` 内根据 `isPlaybackV2Enabled()` 选择 `<PreviewSurface variant=...>`；用 `useMemo` 锁定生命周期，避免热切换
- [ ] 保证 `VideoPlayerPanelRef`（`handleCompositionSeek` / `seekAndPlayFromTimeline` / `pauseFromTimeline` / `isPlaying` / `handlePlayPauseFromTimeline`）签名不变；v2 分支内部委派 stub PlaybackEngine（先代理回旧逻辑保证不破坏）
- [ ] 验证 `VideoPlayerPanel.tsx` 行数 ≤ 600
- [ ] 新增 `playback/__tests__/PlaybackEngine.smoke.test.ts`：构造 stub 实例、dispatch、subscribe 不抛错
- [ ] 新增 `components/VideoPlayerPanel/__tests__/featureFlagBranch.test.tsx`：mock flag on/off，断言渲染分支正确
- [ ] 跑全部前端测试（`npm run type-check && npm test`），现有 `playheadResume.test.tsx` 等回归测试在 flag off 路径下仍 100% 通过
- [ ] 在 `CLAUDE.md` 的 "Project Index" 之外的位置添加一行 Feature flag 使用说明（不修改 cleancode markers）
- [ ] PR 自查：未引入 `__pycache__`、`.next/`、`tsconfig.tsbuildinfo`、`.idea/`、`.env*` 等（CLAUDE.md 提醒）
