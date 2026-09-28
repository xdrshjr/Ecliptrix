# 封面工作室第三轮最终代码审查

日期：2026-09-28。基线：`c75c2b7`。范围：第三轮规格的24项文件变更，以及本审查记录。首轮与第二轮能力沿用已有提交，不重复实现。

## 审查发现与处理

| 编号 | 级别 | 发现 | 处理及验证 |
| --- | --- | --- | --- |
| R3-01 | P2 | 原始 phase 排序未受 status 约束，异常 queued/downloading 可以污染后续生成阶段；迟到排队响应也能提前推进运行阶段。 | 在活跃合并入口按 status 规范化阶段，再比较单调顺序。新增两项回归先失败后通过，轮询文件29项通过；候选和警告合并保持。 |
| R3-02 | 文档 | 规格声明独立 list_snapshot_jobs helper，实际查询内联于 load_state。 | 核对单SQL、项目隔离、活跃全集与终态配额测试，确认语义一致；修订规格描述，保留唯一调用点内联实现。 |

未发现未解决的功能阻塞问题。命名、类型集中管理、中英文翻译、错误归属及现有持久化协议保持一致；未新增依赖、数据库迁移或Agent参数。

## 文件计划逐项核对

以下路径除注明外均位于 `src/components/video/cover/`。

| 文件 | 审查结果 |
| --- | --- |
| `src/types/videoCover.ts` | 只增加会话检查类型和三个前端错误码，不改变持久化文档。 |
| `coverValidation.ts` | 模式内容、背景结构、唯一画布、三字段和真实可测量性统一；复用 fitCoverText。 |
| `useCoverReadiness.ts` | 无条件调用、输入身份同步失效、有限资源等待、显式重试图片键及布局重测相互分离。 |
| `CoverReadinessPanel.tsx` | 原因、定位、重试和延迟播报集中；无业务写入依赖。 |
| `CoverCanvas.tsx` | 兼容旧布尔测量接口；提供模式标识与仅预览使用的图片加载键。 |
| `CoverStudio.tsx` | 首次画布和设置返回重新测量；唯一反馈面板、宽窄布局焦点及按钮说明关联完整。 |
| `CoverInspector.tsx` | 字段ID、aria-invalid与原因关联；原有失焦保存未禁用。 |
| `coverStudio.css` | 反馈可滚动，紧凑主面板64px、抽屉112px，保留画布与底栏空间。 |
| `renderCover.ts` | 资源错误分类、绝对十五秒预算、有限截图重试、迟到Promise消费和bitmap释放。 |
| `CoverRenderHost.tsx` | 正式重新读取背景、快照去重、有效任务串行、job独立DOM及按Promise身份清理。 |
| `useCoverController.ts` | 暴露工程/会话检查身份；flush后共享结构校验，保留owner与不可变版本门禁。 |
| `useCoverJobs.ts` | 活跃集合不裁剪；状态约束下阶段单调，资产/警告合并及终态墓碑保持。 |
| `src/lib/i18n.ts` | 中文、英文的检查原因、动作及三个错误码齐全。 |
| `backend-services/basic-service/app/services/video_cover_v2_service.py` | 同一SQL返回项目活跃全集和最近20个终态；created_at/id稳定排序，无逐组查询竞态。 |
| `__tests__/coverValidation.test.ts` | 空白/标签、三模式、本地资源、不可测量及字段顺序覆盖。 |
| `__tests__/useCoverReadiness.test.tsx` | 字体/图片截止、A/B竞争、会话切换、显式重试、布局恢复及卸载清理覆盖。 |
| `__tests__/CoverStudio.test.tsx` | 初次挂载、禁用/定位、窄屏唯一抽屉及原有失焦保存覆盖。 |
| `__tests__/renderCover.test.ts` | 43项覆盖真实挂载Host、HTTP/fetch/body分类、总预算、迟到结果与新任务隔离。 |
| `__tests__/useCoverController.races.test.ts` | 会话身份与应用/下载零发布门禁；既有异步权限回归保持。 |
| `__tests__/useCoverJobPolling.test.ts` | 原阶段回退、墓碑、轮询与活跃全集测试，以及本次新增两种异常排队顺序。 |
| `src/lib/video-editing-agent/__tests__/coverOperation.test.ts` | 无可见工作室时三个新错误仍阻止Agent发布、应用并返回失败。 |
| `backend-services/basic-service/tests/test_video_cover_v2.py` | 老running加25终态、28活跃、同时间排序及跨项目配额；断言任务读取为单SQL。 |
| `desktop/scripts/smoke-test.js` | 真实模板/比例/文字测量、窗口稳定、图片失败重试计数及媒体帧边界；来源SHA和BUILD_ID验证。 |
| `docs/plans/video-cover-studio-finalization/spec.md` | 需求、实现偏差、37项验收及实施证据清晰区分；补充最终审查修复。 |

## 本节点重新执行的验证

- 前端：封面目录、Agent operation/tools/card、导出、时间轴应用与工程持久化，共20个文件、283项通过。
- 后端：video_cover_v2/jobs/project/export四个文件，77项通过，27条既有Pydantic/audioop弃用警告。
- `npm run type-check`：退出0。
- 本轮所有修改/新增TS及TSX的定向lint：退出0，保留既有img与Hook依赖警告。
- `npm run lint`：退出1，五项错误均在本次未修改的文件：AudioSearchModal 9:11、ImageSearchModal 8:11、VideoSearchModal 8:11空接口，以及WatermarkRemovalModal 629:43/629:50未转义引号。未修改规则隐藏错误。
- 新回归红绿验证：修改生产逻辑前2失败/27通过；修复后29项全部通过。

本节点日志与构建来源位于 `.agentmesh/cover-final-review-runtime/`；测试临时数据与构建输出不进入Git。

## 独立生产包

本节点重新运行 preflight、prepareFrontend（含标准Next生产构建）、prepareBackend、prepareFfmpeg、prepareEnv、payload检查与electron-builder，完整构建退出0。独立输出为 `.agentmesh/cover-final-review-package/win-unpacked/`，未使用上游构建包替代本次修复验证。

构建前后生产输入SHA一致：`becde3216aa35c55208dc2a461b2f95dada33ff47dc09e6937d90b4955d52a4d`。根目录、prepared frontend和包内frontend的BUILD_ID均为 `AZ1Xr_zuMPpzlkcrqJoBF`。完整逐文件来源记录保存在 `.agentmesh/cover-final-review-runtime/build-provenance.json`，桌面冒烟启动已再次核对。

完整桌面smoke退出0、日志以PASS结束，关闭后无残留进程。证据位于 `.agentmesh/cover-finalization-runtime/ecliptrix-smoke-4zsGcv/artifacts/`（smoke脚本统一使用该临时根目录，本次启动的包仍为上述独立审查包）：

| 检查 | 本次实际结果 |
| --- | --- |
| 五模板×五比例×中英文 | 50组真实尺寸、文字Range与无溢出检查通过。 |
| 多问题布局 | 1440×900、900×640、960×600各连续60帧保持blocked，画布正尺寸，底栏可见且无覆盖；已查看900×640截图。 |
| 图片失败后显式重试 | 重建图片节点、更新仅预览的读取URL并恢复成功，净新增写入0。 |
| 未保存字段失焦 | 普通失焦与修正动作的保存次数均为1，保留既有保存行为。 |
| 应用、保存重开、历史与竖屏 | 完整脚本通过；切工程后迟到截帧未进入新工程。一次撤销由时间轴回归测试覆盖，本次smoke未另执行真实桌面撤销。 |
| 导出帧边界 | 1920×1080、30fps、90帧、3秒；源90帧裁取60帧正文，封面30帧；第0/29帧平均RGB误差约1.695/1.693，正文第30帧误差0。 |
| 音频边界 | 正文原0.5秒事件移动至1.500020833秒，误差小于一帧。 |
| 请求与进程 | 真实生成POST为0，外网请求和失效拦截ID均为0，应用关闭后无残留进程。 |

脚本语法检查与 `git diff --check` 均退出0。964项生产输入在构建前后及smoke启动时核对一致。

## 交付边界

三模式、五模板、Agent制作、真实轨道片头和绑定不可变版本的导出沿用并回归。未调用付费AI供应商，受控测试不代表供应商端到端验证；CSS视口验证不代表Windows系统DPI验证；未知生成提交的跨进程持久恢复未扩展。第三方平台是否自动采用片头为缩略图不在本地导出承诺内。

工作区原有 `.bug-diagnosis/336be7e1-d7df-4fc8-b994-2b80f45c9128/` 与 `docs/images/` 保持原样，不加入提交。提交清单限定原计划24项加本审查记录，共25项。
