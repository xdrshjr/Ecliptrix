# Spec 01：源码废弃代码删除（source-dead-code-removal）

> 对应 master-plan 类别一　|　风险等级：中（误删 → 编译/运行失败，靠验证兜底）
> 上游：无　|　下游：Spec 04（全量验证 + 提交）

## 1. 目标

删除 Ecliptrix 前端 `src/` 下**经独立零引用验证确认**的废弃模块、函数与孤儿测试。后端源码经扫描无可删项（仅有意保留的前向兼容字段），故本 spec 仅覆盖前端。

## 2. 核心原则：验证优先（硬约束）

探查报告只是**候选清单**，不是事实。本次扫描已抓出一处误判：`src/lib/clipboard.ts` 被报告为"HIGH 置信度无引用"，实际被 `src/components/chat/MessageBubble.tsx` 引用。

因此，**删除任一文件/符号前，必须完成以下零引用核验**：

1. **按符号名检索**：对该文件的每个导出符号（函数/类/类型/常量）做全仓库检索。
2. **按文件路径检索**：检索 `from '...<basename>'`、`import('...<basename>')`、`require('...<basename>')`，含相对路径与 `@/` 别名。
3. **检查 `index.ts` 再导出**：该符号是否被某个 barrel 文件 `export ... from` 转出后被他处使用。
4. **检查动态/字符串引用**：是否以字符串形式出现在路由表、动态 import、配置中。
5. 仅当上述全部命中均为「定义自身」「测试自身」「纯注释」时，才判定为可删。

> 任何一项出现真实运行时引用 → 该候选**降级为保留**，并在执行报告中记录原因。

## 3. 删除候选清单（已初步核验）

| # | 路径 | 类型 | 初核结论 | 删除动作 |
|---|------|------|---------|---------|
| C1 | `src/lib/utils/formatConverter.ts` | 模块（workflow 遗留） | 0 引用 | 删整文件 |
| C2 | `src/components/video/services/timelineExportService.ts` | `@deprecated` 服务 | 仅 `TimelineRepository.ts` 注释提及 | 删整文件 + 更新悬空注释 |
| C3 | `src/components/video/services/VideoCache.ts` | `@deprecated` 服务 | 1 处命中待确认（已核验：唯一命中为文件内部的 `videoCache` 单例自引用 @ line 349，另有 2 处纯注释提及，无外部 importer） | 核验后删整文件 |
| C4 | `buildVideoEditingTools()` @ `src/lib/video-editing-agent/tools/index.ts` | `@deprecated` 函数 | 2 处命中待确认 | 核验后删函数（非整文件） |
| C5 | `src/components/video/hooks/usePlaybackWaitState.ts` + 其测试 | 仅测试引用的孤儿 hook | 仅自身测试引用 | 删 hook + 同删 `__tests__/usePlaybackWaitState.test.ts` |

### 明确保留（不得删除）

| 路径 | 原因 |
|------|------|
| `src/lib/clipboard.ts` | 被 `chat/MessageBubble.tsx` 引用（探查误判） |
| `AgentMessageBubble.tsx` / `AgentToolCallCard.tsx` | `@deprecated` 但仍被 `VideoChatWindow.tsx` import |
| 后端 `cover_render_metadata` / `ref_count` 字段 | 有意保留的前向兼容预留，已写明用途 |

## 4. 逐项处理流程

```
对每个候选 C_i：
    执行第 2 节五步零引用核验
    若判定保留 → 记录原因，跳过
    若判定可删：
        若为整文件 → 删除文件
        若为函数/符号 → 仅删该符号，保留文件其余部分
        若存在悬空注释引用（如 C2 → TimelineRepository.ts）→ 同步更新注释为「历史实现，已移除」
        若为带测试的 hook（C5）→ 同删其测试文件
    记录：删了什么、核验依据、是否触及他处
```

## 5. 接口与影响面

- **不改变任何公共运行时接口**：所有删除项均为零引用，删除后对外行为不变。
- **C2 注释更新**：`TimelineRepository.ts` 中提及 `timelineExportService.ts` 的注释共 5 行（line 8、13、110、208、209），分布在 3 个注释块（文件头 `Extracted from` 块、字段/shape 注释、`exportToJSON` 方法 docstring）。删除后这些注释需改写为不指向已删文件（保留"逻辑来源"的历史说明即可，措辞如「逻辑源自已移除的 timelineExportService（git 历史可查）」）。删前以 `grep -n timelineExportService` 复核行号，避免遗漏。
- **C5 测试删除**：删除 `usePlaybackWaitState.test.ts` 会减少测试数量，但因 hook 已无生产引用，不影响有效覆盖率。

## 6. 验证（交由 Spec 04 全量执行，本 spec 内做局部确认）

- 删除后立即跑 `npm run type-check`，确认无「找不到模块/符号」错误。
- 跑 `npm run lint`，确认无新增未使用导入或断引用。
- 受影响目录的 vitest：`video-editing-agent`、`video/hooks`、`video/timeline/infrastructure`。

## 7. 回退方式

- 所有删除均通过 git 跟踪，`git checkout -- <path>` 或 `git revert <commit>` 即可恢复。
- 本类别独立成一个 commit（`[refactor] remove verified dead frontend modules`），便于单独回退。

## 8. 完成判据

- [ ] C1–C5 全部完成五步核验，结论记录在案。
- [ ] 判定可删的均已删除；判定保留的记录了原因。
- [ ] C2 的悬空注释已更新。
- [ ] C5 的 hook 与其测试一并删除。
- [ ] `type-check` + `lint` + 受影响 vitest 通过。
