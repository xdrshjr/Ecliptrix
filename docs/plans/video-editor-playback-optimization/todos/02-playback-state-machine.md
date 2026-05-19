# TODO 02：播放状态机与时间源

> Reference: [`specs/02-playback-state-machine.md`](../specs/02-playback-state-machine.md)

## Dependencies

- `depends_on`: [01]
- `blocks`: [04]
- `parallel_group`: B
- 说明：直接 block 04（AbBufferController 依赖 PlaybackEngine 的 prewarm / swap 协议与 tick）；07 通过 04 间接依赖本 spec。与 spec 03（Canvas Compositor）并行，因为本 spec 只调用 `ICanvasCompositor.drawFrame`，不依赖具体实现。

## Tasks

- [ ] 实现 `PlaybackClock`：rAF 主循环；`start(baseCompositionTime, baseWallTime, rate?)`、`stop()`、`setRate()`、`pauseForBackground()`、`resumeFromBackground()`、`subscribe(handler)`、`isRunning()`
- [ ] PlaybackClock 单测：墙钟推进、`setRate` 后 base 重置且 compositionTime 连续、`pauseForBackground`/`resumeFromBackground` 无大跳
- [ ] 监听 `document.visibilitychange`：`hidden → clock.pauseForBackground()`；`visible → clock.resumeFromBackground()`
- [ ] 实现 `PlayheadController`：节流 + 单调过滤 + `forceSet` / `reset`
- [ ] PlayheadController 单测：连续 report(1.0)→report(0.9) 第二次被丢弃；1ms 内 10 次 report 仅 1 次 store 写入；`forceSet` 越过单调过滤
- [ ] 在 `timeline/store/slices/timelineSlice.ts` 新增 state 字段 `cursorCompositionTime: number` 与 action `setCursorCompositionTime(t)`；selector `getCompositionDuration` / `getSequenceAt(t)`
- [ ] 添加 CI grep 检查（package.json script 或 prebuild）：除 `PlayheadController` 与 `TimelineRuler` 外，禁止任何源文件调用 `setCursorCompositionTime`
- [ ] 实现 `TimelineSelectors`（暴露 `getCursorCompositionTime` / `subscribeCursorChanges` / `subscribeUserSeekIntent`）
- [ ] 实现 `PlaybackEngine` 状态机：`EngineState` + 完整 phase 转移（idle/preparing/playing/seeking/paused/stalled/ended）
- [ ] PlaybackEngine 单测：完整生命周期 / sequence 边界自动 swap / stalled 检测（mock `waiting` 事件 > 300ms）/ error 重试与降级
- [ ] 集成测试 `integration.playheadNoRegression.test.tsx`：模拟 30s 播放 + 5 次 seek + 速率切换 → 断言光标 store 写入序列严格非降序
- [ ] 把 `useVideoPlayback.ts` mock 模拟实现替换为 PlaybackEngine 派生状态（保持 `UseVideoPlaybackReturn` 接口兼容）
- [ ] 删除现有 `setInterval(1000ms)` 模拟代码与 `mockVideoPreview` 引用（仅 v2 分支；legacy 路径不动）
- [ ] PR：附录测试覆盖率截图；type-check + lint + 全测试通过
