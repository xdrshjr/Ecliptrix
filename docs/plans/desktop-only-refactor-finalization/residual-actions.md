# 残留动作登记（Residual Actions）· 纯桌面端收敛重构收尾轮

> **产出者**：收尾轮流水线节点 #2（开发 / F 阶段）。**产出时间**：2026-09-01。
> **上游方案**：[`spec.md`](./spec.md)（Endgame Spec v2）§5.4 定义了本文件的字段规范，
> §3.3 定义了范围边界。
>
> **这份文件登记的是「代码改不掉、或本轮明确不该做」的动作**。它不是 TODO 清单的同义词：
> 每一条都必须写清**为什么本轮不做**（只接受"范围外"或"需人工 / 需环境"，**不接受"来不及"**）、
> **由谁做**、以及**怎么验收**。写进来的目的是让它们**可被追踪**，而不是被一句
> "后续再说"稀释掉 —— 尤其是 RA-1，它是一条**已经发生的生产安全事件**。

---

## RA-1 · 轮换 `ops/key/inkclaw-singpore-260322.pem` 对应的生产 SSH 私钥

- **严重度**：**P0**
- **来源**：黑板 `F-1`；收尾轮 spec §2.4 U-7；v4 spec R-1
- **为什么本轮不做**：**范围外 —— 代码改不掉**。本轮的 G2 提交删除了整个 `ops/` 目录，
  但**删文件不等于清历史**：该私钥曾被 git 追踪，任何一个能读到本仓库历史的人
  （`git log -p -- ops/key/inkclaw-singpore-260322.pem`）都能把它完整取出。
  真正的修复只有两条路，都必须由人执行：**轮换密钥**（推荐），或重写全部 git 历史
  （`git filter-repo` + 强制推送，会打断所有已有克隆）。
- **由谁做**：**人工运维**（持有生产主机 `47.84.198.68` 与云账号控制台的人）
- **验收方式**：
  ```bash
  # ① 旧公钥已从生产主机移除
  ssh <prod> "grep -c 'inkclaw-singpore-260322' ~/.ssh/authorized_keys"   # → 0
  # ② 旧私钥已失效（用它连接必须被拒）
  ssh -i ops/key/inkclaw-singpore-260322.pem <prod> true                  # → Permission denied
  ```
- **补充**：本轮已把这句警告写进 **G2 提交信息正文**，让它出现在 `git log` 里而不是只躺在
  文档里（RE-11）。另见记忆库 `incident-prod-compromise-2026-06-03`：该主机历史上被反复入侵，
  且真正的入侵向量被判定为**云账号**而非主机 —— 轮换 SSH 私钥是必要条件，不是充分条件。

---

## RA-2 · 后端 82 个既有失败 + 19 个 error 的独立修复立项

- **严重度**：P1
- **来源**：黑板 `F-15`；v4 spec I-1；收尾轮 spec §2.4 U-8
- **为什么本轮不做**：**范围外**。I-1 已用 `git worktree` 建出 `37719be` 基线实测证明这些失败
  **早于本次重构就存在**（基线 = 98 failed / 1175 passed / 19 errors），性质是历史腐化：
  给已被删除的方法打 patch、模型漂移、依赖网络的 SSRF 用例。把它们塞进本次 diff 会让这批
  已经很大的重构**彻底失去可评审性**（E-1 / §3.3）。本次重构反而让失败数**减少了 16 个**。
- **由谁做**：**独立工作项**（建议按失败原因分 3 类分别立项，而不是开一个"修全部测试"的大票）
- **验收方式**：
  ```bash
  cd backend-services/basic-service && python -m pytest tests/ -q
  # 失败集合相对基线 37719be 严格减小；禁止用 skip / xfail 制造差值（E-11）
  ```
- **红线**：**不得**通过 `skip` / `xfail` 让它变绿 —— v4《评审结论》「不通过情形 2」明令禁止。

---

## RA-3 · `npm run lint` 的 8 个既有 error

- **严重度**：P2
- **来源**：黑板 `F-16`；v4 spec I-6；收尾轮 spec §2.4 U-5
- **为什么本轮不做**：**范围外**。本轮 F 阶段实测 8 个 error，逐条核对后确认
  **8 个全部落在本次重构未触碰的文件里**（`git status --porcelain -- <file>` 对 6 个文件
  全部返回空）。实测清单：

  | 文件 | 位置 | 规则 |
  |------|------|------|
  | `AudioSearchModal.tsx` | 9:11 | `@typescript-eslint/no-empty-object-type` |
  | `ImageSearchModal.tsx` | 8:11 | `@typescript-eslint/no-empty-object-type` |
  | `VideoSearchModal.tsx` | 8:11 | `@typescript-eslint/no-empty-object-type` |
  | `MaterialsPanel.tsx` | 2772:21 / 2772:55 | `react/no-unescaped-entities` |
  | `WatermarkRemovalModal.tsx` | 629:43 / 629:50 | `react/no-unescaped-entities` |
  | `ImageUploadInput.tsx` | 61:26 | `no-restricted-syntax`（直接 `fetch('/api/...')`，应走 http-client） |

- **由谁做**：独立工作项（前 5 条是纯机械修复；`ImageUploadInput.tsx` 那条是**真实的架构违规**，
  绕过了 http-client 的超时 / abort / 错误信封，建议单独评估）
- **验收方式**：`npm run lint` → 0 error（届时 A3′ 可退回为绝对判据）

---

## RA-4 · 3 个"既有 vitest 失败"——**本轮实测未复现**

- **严重度**：P2（**已降级**：由"确认失败"降为"疑似 flaky，待观察"）
- **来源**：黑板 `F-16` / v4 spec I-1（原记：`backend-proxy` T2/T18、`cachePlayback` 端到端共 3 个失败）
- **本轮实测（`by-running`，2026-09-01）**：

  ```
  npm test  →  Test Files 204 passed (204)   Tests 1811 passed (1811)   exit 0
  npx vitest run src/lib/api/server/__tests__/backend-proxy.test.ts \
                 src/components/video/timeline/__tests__/cachePlayback.integration.test.ts \
                 src/lib/api/__tests__/no-auth-surface.test.ts \
                 src/components/__tests__/VerticalTaskbar.a11y.test.ts
        →  Test Files 4 passed (4)   Tests 42 passed (42)
  ```

  **0 失败**，且 1808 + 3 = 1811 —— 上一轮记录的那 3 个用例本轮**全部通过**。
- **为什么本轮不做**：没有可修的东西。但**不能据此宣布问题消失**：同一批用例在上一轮被记为失败、
  本轮通过，最可能的解释是它们**对时序 / 环境敏感（flaky）**，而不是被本轮改好了
  —— 本轮**没有触碰**这两个测试文件之外的相关实现。一个时好时坏的测试比一个稳定失败的测试更危险。
- **由谁做**：独立工作项（建议连跑 20 次定位不稳定源，而不是等它下次偶发时再查）
- **验收方式**：`npx vitest run <这两个文件> --repeat 20` → 20 次全绿

---

## RA-5 · 本机 OpenCV 二进制损坏导致 `python -c "import app.main"` 恒失败

- **严重度**：P2
- **来源**：v4 spec I-11；收尾轮 spec §2.4 U-9
- **为什么本轮不做**：**环境问题**，与代码无关，且**已有等效替代**。
  `tests/conftest.py` 里的 cv2 stub 正是为这种环境准备的，后端门禁子集在本机实测
  `155 passed / 2 skipped`（10.29s），后端验证能力并未因此丧失。
- **由谁做**：环境修复（重装 `opencv-python==4.8.1.78`，或在干净 venv 中验证）
- **验收方式**：`cd backend-services/basic-service && python -c "import app.main"` → 无异常
- **红线**：**不得**为此删除 `tests/conftest.py` 的 cv2 stub（RC-16 / EC-9）——
  删掉它等于砍掉本机全部后端验证能力。

---

## RA-6 · `CLAUDE.md` 记载的提交风格与实际实践不符

- **严重度**：P2
- **来源**：收尾轮 spec E-6
- **为什么本轮不做**：**范围外 —— 不在本轮单方面改项目约定**。实测：仓库 669 个提交里 475 个用
  `[add]/[modify]` 方括号风格、182 个用 Conventional Commits；但**最近 180 个提交里 168 个是
  Conventional、只有 11 个是方括号**。也就是说 `CLAUDE.md:149` 记录的是一条**已经落后于实践**的
  约定。本轮六条提交按 v4 spec §12.6（已通过评审）用 Conventional Commits，
  但"改 CLAUDE.md 的约定条文"是一个需要项目维护者拍板的决定，不该由一个收尾节点顺手改掉。
- **由谁做**：项目维护者（二选一：更新 `CLAUDE.md` 承认 Conventional，或明确要求回到方括号风格）
- **验收方式**：`CLAUDE.md` 的 Git commit style 一节与 `git log -180` 的实际分布一致

---

## RA-7 · 桌面走查的人工子集（第 2/3/4/5/6/7/8/11 条）

- **严重度**：P1
- **来源**：v4 spec §10.3；收尾轮 spec §2.4 U-3 / §8.4
- **为什么本轮不做**：**需人工** —— 这 8 条都要求人操作真实 UI（导入视频、听声音、拖时间线、
  切语言主题、看齿轮琥珀点、双击标题栏），无法脚本化。可自动化的第 1/9/10 条已归 V 阶段
  （`build:dir` + `smoke-test.js`）。
- **由谁做**：人工验收（拿 `npm run build:dir` 的 unpacked 产物走一遍）
- **验收方式**：逐条对照 v4 spec §10.3 的十一条走查表打勾，重点是：

  | # | 走查项 | 判定要点 |
  |---|--------|----------|
  | 2 | 升级后旧工程 + 旧素材全部可见 | 需**旧 `userData/`**；验证 D2 幂等 UPDATE 与 D13 目录枚举两条机制（见 spec §7.3 兼容矩阵） |
  | 3 | 导入视频 → 时间线 → 预览有画面**有声音** → 可 seek | 音频静音是本项目的高频回归（见记忆库 `project_timeline_preview_audio_silent_fixed`） |
  | 4 | TTS → 素材库 → 音频轨 → 可听 | |
  | 5 | 导出后 `ffprobe` 与重构前比对 | 时长 / 分辨率 / 音轨存在性 |
  | 6 | 设置默认落「通用」，切语言 / 主题即时生效且重启保持 | 本轮新增面板 |
  | 7 | 模型与凭证保存后齿轮琥珀点消失 | |
  | 8 | 标题栏四动作 + 双击品牌区 | |
  | 11 | 零死路：关光标签页后空态可点、键盘可达 | 静态部分已有 `VerticalTaskbar.a11y.test.ts` 守卫（本轮实测绿） |

---

## RA-8 · *（条件性）* V 阶段产物验证判负的登记

- **严重度**：P1
- **来源**：收尾轮 spec R-P2-6 / B-10 修订条款；§2.4 U-2 / U-3
- **为什么本轮不做**：**方案规定的时序** —— 不是遗漏。收尾轮 v2 评审的 R-P0-2 把
  `npm run test:integration`（U-2）与 `npm run build:dir` + `smoke-test.js`（U-3）
  从 F 阶段**移到六个提交落地之后**（E-16 / EC-7），因为工作区在提交前是**唯一副本**，
  而 `prepare-backend.js` 每次 `build:dir` 都要组装 embeddable CPython 并 `pip install`
  （需网络、分钟级）—— 上一轮节点 #3 正是崩在提交之前。
- **由谁做**：**V 阶段（提交节点 #3）**
- **验收方式**：
  ```bash
  npm run test:integration      # 全 skip 记 inconclusive，不得记 ok（RE-12）
  cd desktop && npm run build:dir && node scripts/smoke-test.js
  ```
- **红线（B-10 修订条款）**：这两项**判负不构成回滚六个提交的理由** —— 它们验证的是
  **打包产物**而不是这批 diff，且届时工作区已不再是唯一副本，回滚只会让唯一一份可审计的历史
  消失。处置方式是**在本文件补记结论 + runlog 记 `fail`**。唯一例外：若 smoke-test 暴露的是
  本次 diff 引入的**功能回归**，则按新缺陷立项并追加一个 `fix:` 提交，**仍然不 revert**。

---

## RA-9 · 设置中心的 i18n 命名空间仍叫 `adminSettings`

- **严重度**：P2
- **来源**：本轮 F 阶段 RC-21 复核时新发现（`by-running`）
- **现象**：组件目录已由 `AdminSettings/` 重命名为 `settings/`（v4 P3 已落地），但
  `src/lib/i18n.ts` 的翻译键命名空间仍是 `t.adminSettings.*`（本轮新增的「通用」面板
  也沿用了它：`t.adminSettings.general` / `.language` / `.theme` / `.autoTheme` …）。
  同类情形还有 `t.header.*` —— `Header` 已并入 `shell/AppTitleBar`。
- **为什么本轮不做**：**范围外**。① 这是**跨文件的命名空间重命名**，要动
  `src/lib/i18n.ts`（7129 行，CLAUDE.md 明示的豁免文件）的 en / zh / 接口三处，
  外加全部设置面板的引用点；② 它**不影响任何用户可见行为**，纯属内部命名；
  ③ 在收尾轮做这种改动直接违反 **E-1**（不重做已通过评审的 P3）与 §3.3（"UI 再设计 / 目录再重组"范围外）。
  RC-18 判据只约束三个**组件名**（`AdminSettings` / `DesktopTitleBar` / `HeaderActions`），
  本轮已归零（B-14）；`adminSettings` 是小写开头的**键名**，不在该判据口径内。
- **由谁做**：独立工作项（建议与 RA-3 合并成一个"命名一致性清理"票）
- **验收方式**：`grep -c "adminSettings" src/lib/i18n.ts` → 0，且 `npm test` 与 `npx tsc --noEmit` 仍绿

---

## RA-10 · 收尾轮方案自身的门禁命令缺陷（已在 spec 修好，此处备案）

- **严重度**：P2（**代码无影响**；登记目的是留下"为什么 spec 被改"的轨迹）
- **来源**：本轮 F 阶段实测新发现，黑板 `F-26`；详见
  [`spec.md`](./spec.md) 的《实施过程发现的方案缺陷》I-E1
- **现象**：收尾轮 spec 用「路径集合守恒」取代了被证伪的「条数守恒」（R-P0-1），
  但取的命令 `git diff HEAD --name-only` **默认开启重命名检测**，因此**它本身也不守恒**：
  本仓库实测 **329**（21 条重命名里 17 条被配对折叠）而非文档写的 346；
  scratch 仓库实证 reset 前 5 / reset 后 10。
- **为什么本轮不做**：**已经做了** —— 已在 spec 正文改为 `--no-renames` 口径并实测
  346（reset 前后逐条相等），与六组门禁值合计 `1+54+121+153+10+7=346` 交叉自洽。
  此处仅备案，供后续轮次理解 spec 的修订轨迹。
- **由谁做**：无（已闭环）
- **验收方式**：
  ```bash
  { git diff HEAD --name-only --no-renames ; git ls-files --others --exclude-standard ; } | sort -u | wc -l
  # → 348（F1 修完 N-3 的两行注释后；F1 之前为 346）
  ```

---

## 附：本轮 F 阶段已闭环、**无需**登记的事项

以下几条在上游文档里被标记为"待办 / 存疑"，但本轮实测已**关闭**，特此说明以免下游重复排查：

| 事项 | 上游编号 | 本轮结论 |
|------|----------|----------|
| RC-18「旧名残留 = 0」当前为 2 | N-3 / U-6c / EC-5 | **已修**：`src/hooks/useTheme.ts:14` 与 `src/hooks/__tests__/useTheme.test.ts:4` 的注释 `HeaderActions` → `TitleBarActions`；实测归零（B-14） |
| A3 / A4 / A5 / C-3 恒不可满足 | U-4 / U-5 / U-6 / U-6b | **已改判据**：A3′/A4′/A5′/C-3′ 原文已回写进 `docs/plans/desktop-only-refactor/spec.md` 尾部《收尾轮记录》（B-8） |
| RC-3「启动路径无破坏性 DDL」实测 2 命中 | 本轮新发现 | **判据缺陷，非代码缺陷**：2 条分别是 `database.py:132` 那句**禁止** DROP 的告警 docstring，与它的 `.pyc` 字节码。改写为 RC-3′（排除注释与 `__pycache__`），实测 0。**告警注释必须保留**——它是 F-2 两次生产事故留下的护栏 |
| 后端无 `venv` 导致门禁不可执行 | N-4 / R-P1-8 | **不成立**：环境解释器实测跑通，`155 passed / 2 skipped / 10.29s` |
| 本次 diff 引入调试残留 | RC-20 | **无**：本次 diff 新增行中 `console.log` / `TODO` / `FIXME` 命中数 = **0** |
| 新增面板 i18n 不全 | RC-21 | **完整**：8 个新键在 `Translations` 接口 + en + zh 三处均存在 |
| 悬挂文档引用 | A9 ③ / RC-11 | **0**：`scanned=943 dangling=0` |
