# 封面工作室第二轮最终代码审查

日期：2026-09-28。审查基线：`664d0a3`。对应规格：[spec.md](./spec.md)。

结论：通过。规格第7节的27项计划文件均已落地；最终审查补充本文件，共28个功能相关文件。发现的2项P1、1项P2均已修复，并用新增行为测试先复现失败、再验证通过。没有后端协议、数据库、依赖或生产打包配置变更。

## 修复结论

| 编号 | 级别 | 根因与影响 | 修复及证据 |
| --- | --- | --- | --- |
| CR01 | P1 | 首次加载失败后的 reload 复用冲突恢复；再次GET失败被标成save，使无草稿界面只能重试保存，失去继续加载入口。 | 在恢复开始固定 initialLoad，失败保留load归属。新增“初始加载连续失败仍提供加载重试而非保存空草稿”，验证两次失败后仍能恢复、期间没有PUT。 |
| CR02 | P1 | 初始加载恢复只合并资源与草稿，没有收录snapshot.jobs；已有生图任务不再被观察。 | 仅初始恢复调用统一任务合并入口；不创建人工或Agent自动采用授权。新增“初始加载重试成功后恢复已有任务订阅而不自动采用旧结果”，验证轮询唤醒、结果入候选、背景与轨道不变、无生成POST。 |
| CR03 | P2 | 候选区筛选排除了succeeded任务并遗漏warnings；后端部分成功仍以succeeded返回，用户看不到缺失图片提示。 | 保留有warnings的终态，增加中英文部分成功说明，不直接输出任意后端错误文本。新增“生成部分成功时保留警告且不诱发自动重新生成”。 |

新增3项测试在修复前均因上述行为失败（55项既有测试通过），修复后58项全部通过；完整相关集合随后通过206项。

## 逐文件覆盖审查

以下封面组件、纯模块和组件测试的路径均相对于 `src/components/video/cover/`；其余使用完整仓库相对路径。每行均核对实现、相邻调用方及相关测试，而非仅检查文件存在。

| 计划文件 | 核对结果 |
| --- | --- |
| `src/types/videoCover.ts` | 新增前端恢复、可读性和活动状态类型；既有持久化形状不变。 |
| `coverRecovery.ts` | 根据ApiError/CoverError和动作来源区分CAS与本地失效，恢复按钮不按错误文本猜测。 |
| `coverResourceUtils.ts` | 稳定资产去重、不可变元数据校验、UTC时间排序及当前版本置顶；采用规格I01的Windows兼容命名。 |
| `useCoverController.ts` | 背景意图、会话身份、操作所有者、恢复屏障、原负载重放、历史取回及撤销均有边界检查；修复CR01/CR02。 |
| `useCoverJobs.ts` | 单一调度器、终态单调、活动任务不截断、404停查、按任务退避与手动刷新；取消与旧响应不会复活任务。 |
| `CoverStudio.tsx` | UI动作统一交给控制器；设置返回不重载草稿；窄屏属性、恢复入口、主预览及底栏可用。 |
| `CoverTemplatePicker.tsx` | 五模板沿用原几何，按当前五种比例完整缩放，方向键及单Tab入口保留。 |
| `CoverCandidates.tsx` | 资源统一展示、稳定assetId焦点、连接反馈及独立等待时间；修复CR03。 |
| `CoverResources.tsx` | 图片/最近成品分页状态不会被轮询重置；空间受限时原生dialog承载同一份列表。 |
| `CoverRevisionHistory.tsx` | 预览、载入、下载职责分开，缺背景与缺PNG分别禁用；不可读取的当前引用保留占位。 |
| `CoverPreviewDialog.tsx` | 原生模态、宽高共同适配、关闭/焦点恢复及历史PNG解码；竖版实机验收通过。 |
| `CoverErrorPanel.tsx` | 仅呈现类型化恢复动作，本地编辑失效不提供覆盖草稿；未知提交与普通重试分开。 |
| `layout.ts` | 共享fitCoverPreview处理零空间与宽高约束，不修改输出像素表。 |
| `coverStudio.css` | 深浅主题、紧凑布局、资源区、原生dialog及底栏；已查看最终包截图。 |
| `src/components/video/VideoEditingInterface.tsx` | 截帧开始即暂停播放，项目身份和入口序号共同保护迟到回调；真实切工程冒烟通过。 |
| `src/lib/i18n.ts` | 新增文案中英文与类型同步，包括部分生成成功提示；类型检查通过。 |
| `__tests__/coverRecovery.test.ts` | 覆盖真实CAS、本地同名错误、非CAS409、各恢复动作及历史版本归属。 |
| `__tests__/coverResources.test.ts` | 覆盖不可变资源合并、当前版本置顶、20项边界及UTC解析。 |
| `__tests__/coverPreview.test.tsx` | 覆盖比例适配、五模板卡及dialog标签/焦点。 |
| `__tests__/CoverRevisionHistory.test.tsx` | 验证三个动作分离、背景不可用、缺详情占位和PNG重建入口。 |
| `__tests__/useCoverController.races.test.ts` | 53项行为测试覆盖上传、CAS、取回、Agent、未知提交与资源刷新乱序，并补充CR01/CR02。 |
| `__tests__/useCoverJobPolling.test.ts` | 真实hook和可控时钟验证单轮询、终态、空闲唤醒、取消、404与退避。 |
| `__tests__/CoverStudio.test.tsx` | 验证恢复按钮、设置返回、资源页保留、紧凑布局和模态内反馈。 |
| `__tests__/CoverCandidates.test.tsx` | 验证阶段、等待播报隔离、重排焦点、404提示及CR03。 |
| `src/lib/video-editing-agent/__tests__/coverOperation.test.ts` | 人工背景意图使旧Agent采用失效；只读操作不撤销权限。 |
| `desktop/scripts/smoke-test.js` | 使用真实桌面控件，新增正文/音频夹具、历史零写入、窄屏竖版及迟到截帧检查；健康日志等待保留原条件。 |
| `docs/plans/video-cover-studio-refinement/spec.md` | 设计、实施偏离与前一节点证据齐备；补充本最终审查入口，明确历史记录和最新验证边界。 |

命名、风格与注释沿用项目约定。控制器共享事务边界和工作室单一属性面板的聚合原因已有源码注释；未引入第二套状态框架。保留原HTML/AI/混合三模式、五模板、Agent工具、真实片头轨道及严格导出链路。R01–R34通过纯函数、组件、控制器、轮询、Agent、后端和桌面证据组合核对；不宣称所有子场景均在桌面人工逐一执行。

## 本节点独立执行的验证

- `npm test -- src/components/video/cover src/lib/video-editing-agent/__tests__/coverOperation.test.ts src/lib/video-editing-agent/__tests__/coverTools.test.ts src/lib/video-editing-agent/__tests__/coverCard.test.tsx src/components/video/hooks/__tests__/videoCoverExport.test.ts src/components/video/timeline/store/actions/__tests__/applyCover.test.ts src/components/video/projects/__tests__/coverPersistence.test.ts`：18个文件、206项通过（封面/Agent175项，时间轴/导出/持久化31项）。
- 后端执行 `python -m pytest tests/test_video_cover_v2.py tests/test_video_cover_jobs.py tests/test_video_cover_project.py tests/test_video_cover_export.py -q --basetemp=M:/takoAI/Ecliptrix/.agentmesh/cover-refinement-runtime/pytest-final-review`：74项通过，27条既有依赖警告；含真实FFmpeg导出回归。
- `npm run type-check`：退出码0。仓库既有 `.eslintrc.json` 对封面目录、编辑器入口、类型、i18n及Agent变更测试进行定向ESLint检查：36个文件、0错误、31条警告。未把定向检查描述为全仓lint通过。
- 重新执行 `.agentmesh/cover-refinement-runtime/build-package.ps1`：Next生产构建与electron-builder独立包均退出0，日志 `review-build.log`。打包前检查隔离目录没有运行进程，未结束用户实例。
- 24份生产输入SHA-256均与构建前 `review-build-source.json` 一致；仓库、prepared frontend及包内frontend的BUILD_ID同为 `sIrdJBxPf-furcf0qCUgM`。最终代码与验证包对应，不复用修复前的构建证明。
- `node desktop/scripts/smoke-test.js --unpacked M:/takoAI/Ecliptrix/.agentmesh/cover-refinement-package/win-unpacked`：退出0，记录PASS和无残留进程，日志 `review-smoke.log`。独立用户目录 `.agentmesh/ecliptrix-smoke-G4I7Nw`，产物在其 `artifacts/`。

实际MP4为1920×1080、30fps、90帧、3秒。第0/29帧相对PNG平均RGB误差1.6954/1.6931，第30帧正文误差0，音频起始标记1.500021秒。历史浏览/下载写请求0；载入只改草稿，再应用仅保留一个片头；当前草稿下载双击只触发一次发布/下载且不改时间轴。竖版产物1080×1920，900×640和960×600放大预览四边与关闭按钮完整；原生Tab/Shift+Tab、Esc恢复、窄屏设置返回焦点及迟到截帧跨工程保护通过。已查看最终竖版和浅色工作室截图。

## 证据边界与提交范围

真实付费供应商、实际Windows系统DPI切换、下载预检后由外部进程删除同一PNG的故障注入均未执行；供应商fixture、等效CSS视口与真实桌面离线导出不替代这些证据。全仓既有lint问题仍按规格11.3记录，不属于本轮改动。

本节点调用wait_async得到HTTP400 `probe_template_not_supported_on_host`，与实施节点I02一致；长命令改用会话和持续日志检查，均核对最终退出码。测试临时目录、日志和隔离包留在工作区，构建工具固定输出保持原路径。

提交白名单为规格27个文件加本审查记录。逐路径暂存并核对提交清单；`.bug-diagnosis/336be7e1-d7df-4fc8-b994-2b80f45c9128/`、`docs/images/`、`.agentmesh/`和构建产物不纳入提交。两条修复机制logic记录已成功登记。
