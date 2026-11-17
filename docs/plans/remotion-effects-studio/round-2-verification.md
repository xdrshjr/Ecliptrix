# 特效工作台第二轮设计核查

日期：2026-11-17。设计：`spec.md` v3。
代码基线：`58dce2a7`，前序功能提交 `5e663714`。
本节点职责为设计文档；未修改实现、安装依赖、运行构建或提交 Git。

## 输入与范围

已读取当前任务文件、README、CLAUDE、项目索引、任务板首轮摘要、
本功能首轮 spec / acceptance / final-review，以及实际 UI、API、
Agent、草稿服务、队列、runtime、打包与 smoke 关键代码。
旧 README / 索引与 CLAUDE 的桌面登录描述冲突时以当前 CLAUDE 为准。
没有重做已实现的 12 库 / 24 模板，也没有将旧测试结果记作本轮结果。

本轮识别 7 个增量缺口（5 项 P1、2 项 P2），在 v3 的 R2-01–07
逐一记录触发、符号 / 行号、修复契约与验收。新增 AC-35–46，保留
AC-01–34。相关源码调用链已经静态核对，故障尚待下游复现和修复。

## 实际执行的文档核查

1. Python 标准库读取 UTF-8 spec 与定位 JSON，验证主章节 1–19、
   至少 800 个空白分隔词、代码围栏成对、AC 编号恰为 1–46。
2. 解析 §17 文件表，逐一验证计划“修改”的文件实际存在，路径不重复。
   共 50 个明确路径；新增实现 / 测试脚本属于下游待创建，不冒称已存在。
3. 在 basic-service 工作目录，用现有 Python / Pydantic 2.14.0 调用
   `SaveDraftRequest.model_validate`、`normalize_document` 与
   `renderability` 检查 §16.2 JSON 示例。移除尚待实现的可选 draft_id，
   单独用 UUID 检查该字段；现有 document 的真实校验和可渲染性通过。
   新字段的 HTTP 契约仍是 AC-37 待执行项。
4. 对照真实 catalog，title-rise 的 distance 范围为 [0, 0.2]，示例
   0.12 合法；12 个库 / 24 个模板继续以 catalog 为唯一来源。
5. `git diff --check` 检查本轮文档空白；首次发现一处行尾空格，已修正。
   收尾再次执行。原有 `.pytest-workspace-import/` 未处理或暂存。
6. `git status --porcelain` 核查范围，所有交付修改均位于本方案目录。
   任务状态若需回退，仅允许改指定任务板 Subtask #0。

结构核查初次脚本使用 PowerShell stdin 传输中文字符串时匹配失败；
改用纯 ASCII 的章节编号和 Unicode escape 后完整核查通过。该失败
是验证脚本的编码问题，没有通过修改正文绕过检查。

## 官方接口核对

本轮浏览并核对了 [renderStill](https://www.remotion.dev/docs/renderer/render-still)、
[Player](https://www.remotion.dev/docs/player/player)、
[renderMedia](https://www.remotion.dev/docs/renderer/render-media) 的
帧号、定位、取消与 native 路径语义，验收设计据此固定采样步骤。
使用接口仍以锁定 4.0.544 的实际类型为准，不升级依赖。
许可入口保留在 spec 的发行风险中；未作许可确认或法律结论。

## 未执行的功能与发行检查

本轮没有执行新增 UI / HTTP 恢复测试、真实停止原因故障注入、72 组
逐帧矩阵、真实 installer、离线最终导出、性能与真实 LLM 路径。
这些均明确列为 AC-35–46 / §18 下游门禁，不能据设计核查标为通过。
首轮 acceptance.md 中仍待验的项目保持原状态。

## 运行环境与任务上报

history、get(plan)、put(plan/current)、progress 实际执行均在发 HTTP
前因缺 TASK_SERVER_URL 退出。任务板有首轮摘要，Git 有功能与复核提交，
因此沿用明确的本功能目录继续增量设计，不把接口失败当历史为空。

plan-current.json 已在本轮刷新，记录 v3 / iteration=2 / 当前基线及
准确的 put 重放命令，blackboard_write_status 仍为 unavailable。
这份本地定位副本不等于共享黑板写入。服务端完成状态同样不能在
缺环境变量时确认；收尾按任务规定重试 complete、运行 status，若仍
失败则仅填写当前任务板 Subtask #0 的本地回退。最终具体上报结果
以该任务板 Completion Notes 为准，恢复调度器后仍需重放并确认。
