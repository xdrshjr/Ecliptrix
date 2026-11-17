# 特效工作台第三轮设计核查

日期：2026-11-17。方案：`spec.md` v4。
代码基线：`8d53a66d`，第二轮设计基线为 `58dce2a7`。
本节点职责为方案设计，未修改产品源码、安装依赖、打包或提交 Git。

## 输入与增量范围

已读取指定任务文件、README.md、CLAUDE.md、项目索引、本次任务板的
两轮历史，以及本功能 spec、acceptance、final-review、第二轮设计
核查和定位文件。当前已实现 12 库 / 24 模板、持久任务、原键恢复、
编辑租约、真实应用回执与发行验证工具，第三轮不重复实施。

本轮交付更新方案顶部和 §20–26，记录四项缺口：离线 emoji 字形、
多行与安全区、草稿分页、补充文字向量证据。新增 AC-57–66，保留
AC-01–56 和前两轮 RV / IM / 审查历史。计划列出 60 个精确文件路径，
另明确 catalog 唯一决定的 48 个已有预览生成文件。

## 已实际取得的缺陷依据

1. 对三个现有 TTF 运行仓库的 `effects_metrics.py glyphs`，输入
   `效果 🎬✨😀`。输出为 missing=[U+1F3AC,U+1F600,U+2728]、
   offline_glyphs_complete=false。这是当前资源缺字的证据，不能写成
   新字体已经补齐或视觉矩阵通过。
2. 使用本机 Pillow 13.0.0 直接测量现有 NotoSansSC 字体：`a` 与
   `一` 可测量，LF 抛出 RuntimeError: raqm_layout() failed。
3. 初次直接导入后端 recovery 调用原 validate_text_layout，实际在
   getlength(LF) 失败；导入触发后端既有日志初始化。随后通过 Python
   AST 仅提取现有函数、使用真实 Pillow，分别对英文两行和中文五行
   重复观察到同一异常，避免继续初始化其它服务。未运行数据库写入
   或 HTTP 测试，不把函数复现冒称完整接口故障注入。
4. 安全区差异由实际源码确认：五行最小文字高度 294.84px，现有
   Python 固定区域为 378px，而 Slideshow 为 270px。现有代码会先
   遇到换行异常；修复换行后该数值差异仍需下游修复，本文未宣称
   已经跑出修复后的 422 或真实 renderer 溢出。
5. 读取 list_drafts、listEffectDrafts、controller 和 modal，确认
   服务端有 next_cursor，而客户端丢弃它；当前目录只加载一次。
   尚未创建 13 个真实草稿执行 UI 验证，AC-61 / 62 保持未执行。
6. 读取 runVisual、sampleFrame、assertVisualGlyphs，确认原七组
   补充文字只归档 a.png / glyph JSON，没有逐组核对 MP4 / Player /
   双 PNG / 实际字体来源。本轮只规定修复契约，未修改验收实现。

上述结论分别属于真实函数 / 字体复现和静态调用链确认，证据强度
已在 spec 的 R3-01–04 表中区分，没有将全部项都称为端到端复现。

## 实际执行的文档检查

使用 Python 标准库从磁盘重新读取 UTF-8 spec 与定位 JSON，验证：

- 正文超过 800 个空白分隔词，主章节恰为 1–26，代码围栏成对。
- 所有 AC 主表编号恰为 1–66，各出现一次；新增表恰为 57–66。
- §23 计划表路径不重复；所有标为修改 / 生成更新的文件存在，标为
  新增的文件尚不存在，准确区分设计与实现。
- catalog 真实拥有 12 库 / 24 模板；预览路径由该 catalog 的
  thumbnail / demoPreview 确认，正好 48 个，不扫描其它功能猜范围。
- 四项 R3 编号、资源锁、接口、数据形状、测试命令、风险与上报限制
  在本轮增量中齐全；定位为 iteration=3、v4、基线 8d53a66d、当前
  task prompt；blackboard_write_status 仍明确为 unavailable。
- 使用仓库现有 TypeScript transpileModule 检查 §22 的新增 interface
  示例，语法诊断为零错误；这只验证文档示例语法，不是产品类型检查。
- git diff --check 与 git status 用于确认空白和修改边界。未提交或
  暂存任何文件，原有 `.pytest-workspace-import/` 不处理、不暂存。

方案自查修订了 vendored-only 资源缺失策略、资源定义唯一来源、
报告根对象 v2 与原附件 envelope v1 的边界，并为两端安全区 golden
给出精确文件路径。一次 apply_patch 因上下文不一致失败，重新读取
原段后完整应用；没有部分源码写入或忽略失败。

## 官方资料与来源限制

本轮浏览并核对：

- [Remotion 字体加载](https://www.remotion.dev/docs/fonts)：现有
  FontFace / delayRender 路径可继续复用，不引入在线字体依赖。
- [Noto Emoji 元数据](https://github.com/google/fonts/blob/main/ofl/notoemoji/METADATA.pb)：
  文件为 NotoEmoji[wght].ttf，字重范围为 300–700。
- [Noto 官方使用说明](https://github.com/notofonts/noto-docs/blob/main/docs/website/use.md)：
  单色 Noto Emoji 与彩色字体是不同资源，本方案选单色。
- [字体许可证原文](https://github.com/google/fonts/blob/main/ofl/notoemoji/OFL.txt)：
  方案要求保留原版权和 OFL 文件，不在本节点作法律结论。
- [Chrome DevTools 字体来源接口](https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getPlatformFontsForNode)：
  仅用于验收的实际字体观察，未新增生产 bridge。

这些链接支持资源与接口选型，不能证明锁定 Remotion 4.0.544 的实际
实包兼容已通过。对官方字体二进制和完整 commit 的额外 Python
网络读取没有获得结果，已中止该临时进程；GitHub API 的 web 读取
也不可用。因此本节点没有下载 / 保存新字体或编造 SHA-256。
首次真实导入和冻结固定 commit 的步骤明确列于 §21.1 / §25.1，
源锁校验属于下游实际实施门禁，不冒称本轮已完成资源导入。

## 未执行项与上报边界

本轮没有执行产品修复测试、构建、字体导入、真实安装、72 组主矩阵、
27 组文字补充、最终导出、性能或真实 LLM。AC-57–66 全部待执行，
前两轮尚未完成的发行门禁也保持原状态。

任务目录工具的 history、get(plan)、put(plan/current)、progress
均实际执行，因未注入 TASK_SERVER_URL 在 HTTP 前退出。已读取本次
task-board 的两轮明确历史，沿用指定功能目录；plan-current.json
是本地定位副本，不等于共享黑板写入。收尾严格按任务要求重试
complete、调用 status，仍失败则只更新 Subtask #0 本地回退并核验。
具体完成状态及远端未确认限制以该 section 的 Completion Notes 为准。
