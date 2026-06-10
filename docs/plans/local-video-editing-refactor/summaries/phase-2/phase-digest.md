# Phase 2 Digest — TODO 02 统一本地预览合成器

执行模式：单 dev（google-dev-01）分 4 个子阶段（S1→S4）顺序推进，每阶段过
reviewer-01 + tester-01 三权审/测；orchestrator 兼任 inspector 结算。治理：三权分立 + Token 经济。

## Completed Tasks

| 子阶段 | Dev | Review | Test | 关键产出 |
|---|---|---|---|---|
| S1 数据/接线层 | google-dev-01 PASS | PASS | ALL PASS | ImageOverlayLayer、AudioSyncPool（纯 planner）、症状① RC-A/RC-B 接线、subtitleSequences 抽取；**修复了上阶段遗留的 RED 构建**（subtitleSequences 必填却未接线） |
| S2 合成器核心 | google-dev-01 PASS | PASS（采纳偏差） | ALL PASS（mutation-proven） | VideoSourcePool（每轨 A/B + RC-B 比对键==赋值）、MultiTrackPlaybackEngine、assembleLayers、CanvasCompositor.renderFrame 多源合成 |
| S3 宿主+编排钩子+接线 | google-dev-01 PASS（rework 后） | PASS（rework 后） | ALL PASS（rework 后） | PreviewCanvas、useCompositionPlayback；按 v2 flag 与 v1 并存。**rework 修复**：scrub-while-paused 死守卫、transport 未驱动新引擎、embedded 音频静音 |
| S4 删 v1+flag+拆分 | google-dev-01 PASS | PASS WITH FIXES（仅延后清理） | ALL PASS | 删 PlaybackEngine/PreviewSurface/killswitchMonitor/PlaybackVariantSwitcher/useVideoPlayback + ~12 测试；playbackFlags 只剩 preview-proxy/local-preview；VideoPlayerPanel 3412→697 行拆分；新合成器成唯一预览路径 |

## Key Decisions
- **S2 引擎为新建 `MultiTrackPlaybackEngine.ts` 而非原地改 `PlaybackEngine.ts`**（旧引擎 983 行 + 195 耦合测试，原地改会破 800 行上限并扰动测试）。reviewer 裁定满足 spec 意图（去单序列假设、可被 S3 挂载、并存后于 S4 删）。S4 已按裁定删除旧引擎。
- **S3 embedded 音频路由修正**：非 detach 的视频轨由其解码 `<video>`（unmute）出声；detach/idle 则 mute，独立音频轨出声 → 不重复。`AudioSyncPool` 只管独立音频轨（`embeddedVideoAudio` 组弃用）。
- **S4 删除时序**：先让新合成器 S1–S3 全绿并存，再在 S4 一次性删 v1/flag/死代码 + 拆分，便于回退（独立变更组：Phase A 删除+接线 / Phase B 纯拆分）。

## Interfaces Established
- `ClipTimeMapping`（spec01）→ 被 TrackScheduler / VideoSourcePool / AudioSyncPool 全程复用，无下游各自换算（项目第一不变量，已 mutation-verify）。
- `CompositorLayer[]`（video/subtitle/image 判别联合）→ CanvasCompositor.renderFrame 的逐帧入口；05 导出共享 z-order/opacity/transition 语义。
- `MultiTrackPlaybackEngine` 挂载 API（attach/play/pause/seek/dispose + MultiTrackAttachDeps DOM 契约）→ PreviewCanvas/useCompositionPlayback 消费；现为唯一预览路径。
- RC-B「比对键==赋值」黑屏根因修复落于 VideoSourcePool（needsSrcSwap 的 key == 实际赋的 src），有 mutation 回归守卫。

## Issues Resolved（governance 起效）
- S1：上阶段遗留 RED 构建被 dev-01 修复（我最初误读基线为绿——那条后台命令以 echo 收尾，吞掉了 tsc 真实退出码）。
- S3：tester 抓出 reviewer 漏过的 scrub-while-paused 死守卫 + embedded 音频静音；dev rework 用独立 `lastSeekedTimeRef` 守卫 + 逐帧 mute 路由修复，re-review/re-test 全绿。Token：dev -20 rework、reviewer -15 漏检、tester +10 抓获。

## Quality Gates（Phase 2 末，已独立复核）
- `npm run type-check`：clean。
- 全量 `npx vitest run src`：1213 passed / 2 failed；**2 个失败均为 `backend-proxy.test.ts`（BFF query-string），经 `git diff main...HEAD` 证实该目录 vs main 零改动 → 先于本期、与预览无关**。
- `src/components/video`：825 passed / 0 failed。
- `grep isPlaybackV2Enabled src/`：仅剩 solePath 测试里的反向断言 → 运行时零引用（spec §6 case 11）。

## 已知遗留（Phase 3 / 06 收尾）
- **死常量残留（非阻断）**：`playback/internal/constants.ts` 中 `KILL_SWITCH_LS_KEY='ecliptrix-playback-v2-killswitch'` 等 ~8 个 v1/v2 死常量 + `types.ts`/`index.ts` 中 4 个 type-only 孤儿，零运行时引用。reviewer+tester 均判定可延后；06 清理。
- **CLAUDE.md playback-v2 段落**已随本期更新（flag 已删，改述为唯一合成器路径）。

## Context for Next Phase（Phase 3：05 导出 / 06 持久化）
新预览合成器（canvas 多源 + 转场/字幕/图片 + 音频同步）已是唯一路径并全单测通过，但 **canvas/音频实际运行行为无法在 jsdom 验证、且已无 v1 safe-mode 回退** → **用户桌面走查为强制门**（8 项清单见 S4 dev summary）。05 导出须用 ffmpeg filtergraph 复现 02 的 z-order/opacity/transition 语义并与预览对拍；06 持久化须保存 trackZ/opacity/transition/audioDetached 字段并验证重载可预览，并联动清理派生文件。`TimelineAggregate.moveItem` 跨轨非原子 latent bug 仍在；`TimelineItem.tsx`(859) D10 拆分仍待排期。
