# 最终代码审查与验证

审查日期：2026-11-05（America/New_York）。

修复符合 `analysis.md` 方案 A：Agent 产物携带稳定段落归属，
面板继续从真实素材和时间轴派生状态。审查发现并修复一处批量上轨
绕过段落存在性校验的问题；本次审查范围内没有待处理的阻断项。

## 逐项核对

| 诊断要求 | 代码审查结果 |
| --- | --- |
| 稳定段落身份 | 生成工具一次创建 ID，工具结果、同回合上下文、store 和界面沿用；旧操作在 store 接收时补 ID，保存及重排不重新编号。 |
| 工具获得真实身份 | 请求、路由和 Agent 传递最小段落快照，提示词暴露 ID；TTS 拒绝未知 ID 和不匹配文本。无 ID 的普通配音保持兼容。 |
| 首次写入完整配音关联 | 单段及批量素材首次入库即带段 ID、请求文本哈希、音色、实际语速及成功写入时间；不依赖同 ID 素材二次同步。 |
| 批量结果与版本 | 后端请求 ID、脚本 ID、素材 ID 分离；乱序及部分失败依请求索引匹配，同段重试保留不同素材。批量仍使用既有统一语速协议，元数据如实记录该语速。 |
| 片段归属与快照 | 句级归属优先，其次显式片段归属，再回退源素材；冲突拒绝，跨段复用不重标源素材。两端应用器及 JSON/时间轴实体保留关联。 |
| 异步结果 | 前端按当前工程和段落复核；被删除段的素材、单条及批量上轨均拒绝迟到写入。文本/设置变化保留原请求版本，派生为待更新。 |
| 画面状态和内容 | 缩略图、展开态列表及导航共用只读画面列表；保留手动候选优先及候选应用语义，删除画面后恢复空态并约束索引。 |
| 字幕及相邻功能 | 字幕继续按关联音视频段范围与实际字幕相交判断；未上轨配音仍为候选，没有画面不标已配置。未扩展字幕关联协议或全量脚本撤销。 |
| 命名、风格及范围 | 沿用现有工具工厂、操作类型、router 和 hook 分层；未增加依赖、轮询或强制刷新，新增错误提示使用中文，无遗留修复 TODO。 |

## 本轮发现并修复的问题

**R-01：批量分镜上轨绕过实时段落校验。**

`AgentEventRouter.handleToolResult` 优先处理 `result.operations`，
在到达新增的单条 `filterCurrentSegmentOperation` 之前直接应用整个批次。
`compose_storyboard` 使用相同素材快照构造器，因此批次也可能携带脚本段归属。
用户删除某段后，迟到的批次仍会把该段画面写入时间轴。

新增参数化行为回归，调用真实 `compose_storyboard`、router、状态管理器和
前端操作应用器。修复前：段落都存在的用例通过；删除第二段的用例失败，
预期 0 个片段，实际写入 2 个。随后在批量应用前逐项执行同一归属校验，
任一失效即拒绝整个批次并报告错误，保持原有批次整体应用语义。
正常批次仍能写入全部片段。没有模拟时间轴聚合算法。

同时在 `analysis.md` 顶部标明历史阶段，避免把旧的六项缺陷复现记录
误读为当前回归结果；原诊断日志作为根因证据保留。

## 本轮实际验证

所有成功项均已实际执行并检查退出码；下列成功命令退出码均为 0。

| 检查 | 结果 |
| --- | --- |
| R-01 修复前验证 | 1 项预期失败、1 项通过；失败原因是已删除段批次仍落轨。 |
| 修复后针对性验证 | 段落关联、router 应用结果及分镜静态图保护：3 文件，33/33 通过。 |
| 扩展回归 | 98 文件，889/889 通过，66.47 秒。 |
| 原诊断入口 | 已复用默认目录回归，23/23 通过，5.95 秒。 |
| TypeScript 编译 API | 1590 个文件，0 诊断；排除并行任务验收副本，关闭增量缓存写入。 |

扩展回归命令：

```powershell
node node_modules/vitest/vitest.mjs run src/lib/video-editing-agent/__tests__ src/components/video/lib/segments/__tests__ src/components/video/components/SegmentCard/__tests__ src/stores/__tests__ src/components/video/hooks/__tests__/useAgentExecution src/components/video/hooks/__tests__/useSegmentVoiceGeneration.test.ts src/components/video/hooks/__tests__/useMaterialManagement.storeSync.test.tsx --reporter=dot --no-color --maxWorkers=4
```

原诊断入口：

```powershell
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/agent-script-panel-status-stale/vitest.repro.config.ts --reporter=dot --no-color
```

类型检查可在仓库根目录重放：

```powershell
@'
const ts = require('typescript');
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent({
  ...config.config,
  exclude: [...config.config.exclude,
    'backend-services/basic-service/data/ark-video-acceptance/**'],
}, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, {
  ...parsed.options, incremental: false,
});
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
console.log({ files: parsed.fileNames.length, diagnostics: diagnostics.length });
for (const diagnostic of diagnostics) {
  console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}
process.exitCode = diagnostics.length ? 1 : 0;
'@ | node
```

这是保留原项目编译选项、仅排除验收副本的检查，不等同于根目录
`npm run type-check` 或完整生产构建；未改动项目 tsconfig 或并行验收文件。
测试中的熔断、未知工具记录及无效 TTS 结果告警来自既有错误路径用例，
测试结果没有失败或未捕获异常。

## 验证边界及提交范围

未调用真实 LLM/TTS，未运行 Electron 供应商端到端会话。
旧无标记产物不猜测迁移；字幕仍按时间相交判断，不验证文本或完整覆盖；
整份脚本撤销仍保留诊断报告所述边界。

提交范围为 24 个已修改的产品/测试文件、1 个新增关联回归文件，以及
本诊断目录内 6 个报告、复现配置和历史证据文件。
桌面环境改动、pytest 工作副本、后端 node_modules、构建产物及
`.agentmesh` 运行记录均不纳入提交。
