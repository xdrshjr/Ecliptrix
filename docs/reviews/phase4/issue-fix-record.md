# Phase 4 Issue Fix Record

> **Date**: 2026-04-25
> **Scope**: Fixes applied to Phase 3 deliverables (AI 分镜 2×2 链式重构) during Phase 4 code review.

总计：**1 项 minor 已修复**。无 critical / major 修复。

---

## Issue #1 — `AiImageModal.resetForm` 仍重置为旧默认 `frameCount: 9`

- **File / Line**: `src/components/video/components/AiImageModal/AiImageModal.tsx:73`
- **Category**: Correctness / UX regression
- **Severity**: minor
- **Found during**: Code review of 前端 Phase 3 改动对比

### 问题描述

Phase 3 T8 将 `AiImageModal` 初始 `storyboardState.frameCount` 从 9 调整为 4（单批 2×2），并在 `src/types/index.ts` 中新增 `STORYBOARD_BATCH_SIZE=4` 作为后端单批大小的 UI 侧镜像。

但同文件 `resetForm()`（line 73）仍硬编码了 `frameCount: 9`：

```ts
// before
setStoryboardState({ prompt: '', frameCount: 9, aspectRatio: '16:9', referenceImages: [] });
```

后果：用户第一次打开弹窗会看到 4（正确），关闭再打开后被 `resetForm` 重置为 9，触发 2 批串行生成、耗时翻倍，并与"默认一次一批"的产品直觉相悖。该路径是"默认值漂移"类回归，ESLint / tsc / 现有 vitest 均不会告警。

### 推荐修复

将 `resetForm` 中的 `frameCount` 与初始 state、后端 `STORYBOARD_BATCH_SIZE` 保持一致，使用 `4`。

### 修复（after）

```ts
// after — AiImageModal.tsx:73
setStoryboardState({ prompt: '', frameCount: 4, aspectRatio: '16:9', referenceImages: [] });
```

### 验证

- `npx tsc --noEmit` → 0 错误
- `npx vitest run src/components/video/components/AiImageModal` → **3 files, 29 tests, all passing**
- `python -m pytest tests/test_storyboard_grid.py tests/test_storyboard_chained.py tests/test_storyboard_multi_reference.py -v` → **30 passed**

修复仅更改一行字面量常量，不触及业务路径 / 类型 / 条件分支，符合"最小必要变更"原则。

---

## 其他 observation（不修）

以下三项在 `code-review-report.md` 的问题清单中记为 `obs-1 ~ obs-3`，均为设计权衡 / 可接受的既有行为，未在本次修复范围内：

- **obs-1** — `config.py::_int_env(...) or _int_env(...) or yaml_default` 的"或"链对 env 值 `0` 不敏感；由于 `StoryboardGenerationConfig.max_concurrent` Pydantic `ge=1` 强制下限，0 本身非法，运行时行为等价于 fallback。
- **obs-2** — `_chain_prompt_prefix` 文案中的 "previous scene 3/4" 指"上一批 2×2 内第 3/4 幕"（1-indexed）；测试验证 Seedream 仍能正确按 reference 延续风格。若后续 16 幕边缘 case 出现风格漂移再迭代。
- **obs-3** — `_get_generate_semaphore` 在配置热更新时重建 semaphore；已持有旧 semaphore 的任务不受新 limit 约束。生产环境 config 变更伴随重启，窗口可忽略。
