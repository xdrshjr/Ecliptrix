# Spec 04：全量验证与分类提交（verification-and-commit）

> 对应 master-plan 类别五　|　风险等级：低
> 上游：Spec 01 + Spec 02 + Spec 03（全部完成后汇合）　|　下游：无

## 1. 目标

在三类清理完成后，通过**五道验证闸**确认未破坏功能，并在当前分支 `feat/local-video-editing-refactor` 上**按类别分多次提交**。

## 2. 关键原则：基线对比，而非绝对通过

本仓库**构建时忽略 ESLint 错误**（`next.config.js` 中 `eslint.ignoreDuringBuilds: true`；注意 **TypeScript 类型错误并未被忽略**，故 `type-check` 与 `build` 对断引用是真实门禁）。lint/type-check/test 可能存在**清理前就有的既存失败**。因此验证标准是：

> **清理后的失败集合 ⊆ 清理前的基线失败集合**（即"不引入新失败"），而非"绝对零失败"。

所以**必须在动手清理前先采集基线**。

> **时序说明**：本 spec 在依赖图中虽位于 Spec 01/02/03 下游（汇合做最终验证与提交），但第 3 节的**基线采集必须在 Spec 01/02/03 任何删除/改动开始之前执行**。即：先跑基线 → 再执行三类清理 → 最后回到本 spec 跑五道闸并提交。切勿在已删代码之后才采基线（那会把新失败误并入基线）。

## 3. 基线采集（清理开始前执行一次）

```
# 在任何删除/改动之前运行，记录每项的退出码与失败摘要
baseline:
  npm run type-check   → 记录错误数与清单
  npm run lint         → 记录 error/warning 数
  npm run build        → 记录是否成功
  npm run test         → 记录通过/失败用例数（=vitest run，见第 5 节）
  cd backend-services/basic-service && pytest tests/ -v → 记录通过/失败用例数
```

将基线写入执行报告的「Baseline」小节。

## 4. 五道验证闸

| 闸 | 命令 | 关注点 |
|----|------|--------|
| G-type | `npm run type-check` (`tsc --noEmit`) | **最关键**：删源码后无「找不到模块/符号」 |
| G-lint | `npm run lint` | 无新增断引用 / 未使用导入 |
| G-build | `npm run build` | 生产构建仍成功 |
| G-vitest | `npm run test`（=`vitest run`，见 5.1） | 受影响模块测试通过；删 `usePlaybackWaitState.test.ts` 后无残留引用 |
| G-pytest | `cd backend-services/basic-service && pytest tests/ -v` | 后端测试不回归（后端源码未改，应全绿） |

## 5. 验证命令确认

### 5.1 前端测试命令

`package.json` 的 `scripts` 已定义 `"test": "vitest run"`（非 watch，一次性跑完退出），因此前端测试命令为 **`npm run test`**（等价于 `npx vitest run`）。相关脚本：`test:watch`=`vitest`、`test:coverage`=`vitest run --coverage`、`test:integration`=`vitest run --config vitest.integration.config.ts`。本次验证用 `npm run test` 即可，**不要**用 watch 模式（`test:watch`）。

可只跑受影响范围以加速：
```
npx vitest run src/components/video/hooks src/components/video/timeline src/lib/video-editing-agent
```
最终收尾仍需跑一次全量前端测试确认无遗漏。

### 5.2 后端测试

后端源码本次未改动，`pytest` 应与基线一致（全绿或既存失败不变）。若出现新失败，排查是否误删了被后端引用的产物（如 `datas/` 固件）。

## 6. 提交策略（当前分支，分类提交）

按 **02 → 03 → 01 → 04** 顺序提交（低风险先行，源码最后），每个 commit 前跑相应验证：

| 提交 | 内容 | 建议 message | 提交前验证 |
|------|------|-------------|-----------|
| Commit 1 | Spec 02-a 取消跟踪产物 | `[update] untrack mis-committed generated media and logs` | `git status` 核对清单 |
| Commit 2 | Spec 02-b .gitignore 加固 | `[update] harden .gitignore against generated artifacts and ops scratch` | `git status --ignored` 抽查 |
| Commit 3 | Spec 01 源码废弃删除 | `[refactor] remove verified dead frontend modules (formatConverter, deprecated services, orphan hook)` | **全量五道闸** |
| —（无提交） | Spec 03 工作区垃圾 | 未跟踪文件删除**不进 commit**，仅 `.gitignore` 已在 Commit 2 覆盖 | `git status` 确认垃圾消失 |

> Spec 03 删除的是未跟踪文件，**不产生 commit**；其效果在工作区与 `.gitignore`。在执行报告中单独记录其删除清单。

### 6.1 提交注意（来自项目约定）

- 使用 `git commit --only <paths>` 精确提交，**避免**一次 `git add` 误纳无关文件（项目记忆：曾经 `git add` 误纳 19 个无关文件）。
- 不提交 `__pycache__/`、`.pyc`、`.next/`、`.idea/`、`tsconfig.tsbuildinfo`（CLAUDE.md 约定）。
- commit message 前缀遵循 `[add]/[modify]/[update]/[refactor]/[fix]`。

## 7. 失败处理

```
对每道闸：
    若失败用例 ⊆ 基线失败 → 通过（既存问题，非本次引入）
    若出现新失败：
        定位是哪类清理引入（type-check 报错通常指向 Spec 01 误删）
        若为误删源码 → 恢复该文件（git checkout），重做零引用核验
        若为 .gitignore 误伤 → 修正规则
        修复后重跑该闸
```

## 8. 完成判据

- [ ] 清理前基线已采集并记录。
- [ ] 五道闸全部「不引入新失败」（失败集 ⊆ 基线）。
- [ ] Commit 1/2/3 已按序提交，message 合规，未夹带无关文件。
- [ ] Spec 03 的未跟踪垃圾已清，删除清单记录在案。
- [ ] 最终 `git status` 干净（除有意保留的本地产物与存疑脚本）。
- [ ] 执行报告含：Baseline、五道闸结果、各 commit 哈希、Spec 03 删除清单。
