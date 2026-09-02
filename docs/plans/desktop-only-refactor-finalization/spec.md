# Ecliptrix 纯桌面端收敛重构 · 收尾轮开发方案（Endgame Spec v2）

> **本轮定位**：第 1 轮的四节点流水线（设计 → 评审 → 开发 → Review/提交）在**第 4 个节点崩溃**，
> 重构代码已经全量落到工作区但**一行都没进 git 历史**。本轮需求是一句话：「之前的运行中途中断了，
> 应该是断在了审查节点，现在继续完成」。
>
> **因此本方案不是又一份重构方案**。上一轮的重构方案是
> [`docs/plans/desktop-only-refactor/spec.md`](../desktop-only-refactor/spec.md)（v4，1757 行，
> 已评审通过并已实施完毕）。**本文档只解决一件事：把「已经写完但没提交、没评审、没验证过打包产物」
> 的 324 条工作区变更，安全地变成「已评审、已验证、已提交」的 git 历史**，并把上一轮明确顺延下来的
> 未竟事项（C-2 提交、C-7 集成测试、§10.3 桌面走查、F-1 密钥轮换、A3/A4/A5 判据自洽化）一次性收口。
>
> **v2 说明**：本文档已由收尾轮评审节点（#1）逐节评审。评审共提出 **2×P0 + 8×P1 + 6×P2**，
> 全部 P0/P1 已直接改入正文（见《评审记录（Review Notes · v2）》与文末《评审结论（Review Verdict · v2）》）。
> 四段流水线因此从 v1 的 `R→F→C→V` 调整为 **`R→F(静态)→C(提交)→V(产物验证)`**：
> 两个最长、最易崩溃的任务（集成测试、桌面打包）被移到**提交之后**，因为工作区是唯一副本，
> 而上一轮正是崩在提交之前（见 R-P0-2）。
>
> **读者**：本轮的评审节点（#1）、开发节点（#2）、Review 与提交节点（#3）。
> **前置阅读（必读，不可跳过）**：`docs/plans/desktop-only-refactor/spec.md` 的 §2、§9.1、§10.4、
> 《评审结论 v4》C-1..C-8、《实施过程发现的方案缺陷》I-1..I-11。

---

## 0. TL;DR（给赶时间的实施者）

1. **绝对禁止**：`git reset --hard`、`git checkout .`、`git restore .`（无路径）、`git clean -fd`、
   `git add -A`（无路径）、`git stash`/`git stash push`（会卷走未跟踪文件）。工作区里躺着
   **325** 条**唯一副本**的重构成果，上述任一条都会当场毁掉两个节点 2 小时的产出
   ——在你做完第 3 条的 F0 备份之前，它**无法恢复**（没有 stash、没有分支、没有远端）。
2. 本轮**不改重构结论**：`desktop-only-refactor/spec.md` 标记为「已落地」的 P0-R/P3/P4/P5/P6/P7
   一律不重做、不"再优化"。
3. **动手前第一条命令是备份，不是别的**（v2 评审 R-P0-2 新增）：`git stash create` 生成一个
   游离 commit 并打印 SHA，**不动工作区、不动索引**；用 `git tag` 把它钉成真 ref，再把 9 个未跟踪
   路径拷到仓库外。零风险，几秒钟。**在此之前不要跑任何长任务。** 命令见 §11.0。
4. 本轮的主线是四段：**R 评审 → F 静态修复 → C 提交（6 个）→ V 产物验证**。
   **v2 改了时序**：集成测试与桌面打包这两个长任务挪到**提交之后**（R-P0-2），
   因为工作区是唯一副本，而上一轮正是崩在提交之前。
5. 提交切分见 §4.5，精确暂存命令见 §11.2，六条提交信息全文见 §6.3。
   **校验条数一律用 `--no-renames` 口径**（R-P1-7）：G1=1 / G2=54 / G3=121 / **G4=153** /
   G5=10 / G6=7+，合计 346。带重命名配对的计数不是确定值，不能当门禁。
6. 上一轮从未跑过的两件事，本轮必须真跑（**在 C 之后**）：`npm run test:integration`（C-7）与
   `npm run build:dir` + `desktop/scripts/smoke-test.js`（§10.3 走查的可自动化子集）。
   **它们失败不回滚已落地的提交**（R-P2-6），只记入 residual。
7. A3「lint 0 error」与 A4「pytest 全绿」是**从未成立过的判据**（I-1/I-6 已用 HEAD 基线实测证明），
   本轮正式改写为差分判据 A3′/A4′（§8.3），并把改写回写进 v4 spec。
   基线**钉死为 commit `37719be`**，不用 `HEAD`、不用 `merge-base`（R-P1-4）。
8. **不要相信「reset 前后 `git status` 条数守恒」**——它是错的，v2 已实证推翻（R-P0-1）。
   真正守恒的是**路径集合**，见 §4.5 step 1。

---

## 评审记录（Review Notes · v2）

> **评审人**：收尾轮流水线节点 #1（方案评审与修复）。**评审对象**：本文档 v1（982 行）。
> **评审方式**：逐节对照工作区**实测**。本节每一条都附可复算命令与真实输出；
> 只靠读文档得出的结论标注 `by-reading`，跑过命令的标注 `by-running`。
> **评审边界**：本节点只改本文档，未触碰任何源码，未跑 `git commit`，未动 git 索引。

### RV.1 复核基线：v1 的现状描述是否可信

先核实事实层，再谈执行层。逐条复算结果如下（全部 `by-running`）：

| v1 的断言 | 复算命令 | 实测 | 判定 |
|-----------|----------|------|------|
| 工作区 325 条 | `git status --porcelain \| wc -l` | `325` | 通过 |
| 状态码分布 186 `D ` / 108 ` M` / 14 `R ` / 7 `RM` / 9 `??` / 1 ` D` | `awk '{print substr($0,1,2)}' \| sort \| uniq -c` | 逐项一致 | 通过 |
| 索引 207 files / 35371 deletions | `git diff --cached --shortstat` | 一致 | 通过 |
| 工作区 116 files / +2191 −5215 | `git diff --shortstat` | 一致 | 通过 |
| **六组切分互不相交且并集 = 全集** | 独立脚本按 `-z` 解析 status、对重命名双路径匹配 | `1+54+121+132+10+7=325`，`uncovered=[]`，`split=[]` | 通过 |
| 9 个未跟踪路径清单 | `git status --porcelain \| grep '^??'` | 与 §2.2 清单逐条一致 | 通过 |
| BFF 103 条 | `find src/app/api -name route.ts \| wc -l` | `103` | 通过 |
| A1 前端 / 后端 = 0 | §2.3 两条 grep | `0` / `0` | 通过 |
| A2 非桌面工件全部不存在 | `ls -d ops install.sh …` | 7 条全部 `No such file` | 通过 |
| A5′ 源码口径 = 0 | 限定 `desktop/{main,preload,scripts}` + `src/` | `0` | 通过 |
| C-3 实测 4 命中且全在护栏测试 | `grep -rn` | 4 命中，行号 **7/29/30/31**，全在 `no-auth-surface.test.ts` | 通过 |
| RC-16 `tests/conftest.py` 只有注释变更 | `git diff -- …/tests/conftest.py` | 仅 1 行 docstring（`rate_limiter` → `thumbnail_service`） | 通过 |
| RC-17 十一个文件的行数 | `wc -l` | `12/20/153/136/240/229/177/172/85/183/699` 全部命中 | 通过 |
| §6.2 后端子集门禁 `155 passed / 2 skipped / 0 errors` | **真跑** | `155 passed, 2 skipped, 25 warnings in 16.87s` | 通过 |
| `desktop` 有 `clean`、根有 `test:integration` / `build:dir` | 读两个 `package.json` | 三个 script 全部存在 | 通过 |
| 六组的每个 pathspec 都能解析（否则 `git add` 会整条中止） | `git ls-tree -r --name-only HEAD -- <p>` | 24 个 pathspec 全部 ≥ 1 命中；G2 的 10 个合计正好 `17+15+14+2+1×6 = 54` | 通过 |
| E-6「最近 180 个提交全部 conventional」 | `git log -180 --format=%s \| grep -cE …` | 168 conventional / 11 方括号 | 通过（全历史数字有误，见 R-P2-2） |

> **基线结论**：**v1 的 §2.2 / §2.3 事实描述全部可信**，六组切分算法经独立复算**正确**
> ——这是本文档最有价值的部分，v2 完整保留。下列缺陷**集中在执行契约**（校验口径、
> 阶段时序、前置条件），不在事实描述。

### RV.2 问题清单

| ID | 严重度 | 维度 | 一句话 | 处置 |
|----|--------|------|--------|------|
| **R-P0-1** | P0 | 可行性 | 「`git reset` 前后 `git status` 条数守恒」是**假命题**，已实证推翻；而它是 §4.5/§7.2/§11.2 的门禁，失败话术又直指"工作区被人动过" | 已改：换成真正守恒的**路径集合**不变量 |
| **R-P0-2** | P0 | 完整性 | 唯一副本要穿过 F 阶段两个最长任务（集成测试、桌面打包，后者含 CPython 组装 + pip 安装）才被提交；**全程无任何备份**，而上一轮就是崩在提交前 | 已改：新增 F0 零风险备份；F3/F4 移到 C 之后 |
| **R-P1-1** | P1 | 一致性 | RC-18 / §11.1 的「旧名残留 = 0」当前**不成立**，实测 2 命中 | 已改：F 阶段修注释；RC-1 加"可解释增量"条款 |
| **R-P1-2** | P1 | 完整性 | §11.2 让 `.msg-G*.txt` 落在 `docs/…/` 里，G6 的 `git add -A -- docs` 会把它们**提交进历史**（已实证） | 已改：提交信息文件移出仓库 |
| **R-P1-3** | P1 | 完整性 | §11.1 让实施者把扫描脚本写到 `scripts-tmp/`，该路径**不属于任何一组** → B-1 永远不为 0 | 已改：脚本走仓库外目录 / `python -c`；新增 B-13 |
| **R-P1-4** | P1 | 一致性 | A3′ 的基线 `git merge-base HEAD main` 实测 = `dc25d77` ≠ 实测基线 `37719be`；且提交落地后 `HEAD` 会漂移 | 已改：基线钉死 SHA `37719be` |
| **R-P1-5** | P1 | 可行性 | N-2 的因果结论**是错的**：`build:dir` 每次都重建 `build/backend` 与 `build/python`，"陈旧后端被打进包"这个机制不存在；而 `npm run clean` 被写成"必须"，代价是一次完整 CPython 组装 + pip 安装 | 已改：`clean` 降为建议并写明真实理由 |
| **R-P1-6** | P1 | 一致性 | R 阶段「禁止写任何文件」与 RC-4/6/7/14/15（要求跑 pytest/vitest）、§12（评审节点直接改本文正文）**互相矛盾** | 已改：精确表述只读范围 |
| **R-P1-7** | P1 | 可行性 | §11.2 每组期望条数依赖**重命名配对**，而配对不是确定性的（相似度低于阈值就退化成 `A`+`D`，已实证）；门禁却是"对不上就停下" | 已改：统一 `--no-renames` 确定性口径 |
| **R-P1-8** | P1 | 可行性 | §8.1 / §11.3 要求"先激活 venv"，但本机**没有 venv**；实测直接用环境解释器即可，子集门禁 155 passed | 已改：改为条件性表述 |
| **R-P2-1** | P2 | 一致性 | §4.5 step 0 与 RE-13 写"8 个未跟踪路径"，实际 **9** | 已改 |
| **R-P2-2** | P2 | 一致性 | E-6 的全历史统计不准：实测 **475** 方括号 / 182 conventional（文档写 458）；且 v4 §12.6 规定的是 `feat:`，本轮用四种类型，属**细化**而非"保持一致" | 已改 |
| **R-P2-3** | P2 | 一致性 | §2.1 把 v4 的 1757 行记在节点 #1 名下；实际 #1 产出 1449 行，#2 追加 I-1..I-11 至 1757 | 已改 |
| **R-P2-4** | P2 | 可行性 | RC-20 的命令只列**未暂存**改动（漏掉 186 个已暂存条目），且 100+ 文件的命令替换在 Windows 下有长度与已删文件报错风险 | 已改 |
| **R-P2-5** | P2 | 一致性 | A4′「0 collection error」与基线「19 errors」措辞冲突（collection error ≠ fixture error） | 已改 |
| **R-P2-6** | P2 | 完整性 | 未写明 B-10（打包冒烟）失败时**不得回滚已落地的提交** | 已改 |

### RV.3 P0 详情

#### R-P0-1（P0）· 「条数守恒」是假命题，且它的失败会把人推向被禁止的破坏性命令

**v1 怎么写的**：§4.5 step 1「校验：`git status --porcelain | wc -l` 仍为 324（条目状态码变了，
**条数不变**）」；§7.2 不变量 1「S1 与 S2 的 `git status --porcelain | wc -l` **守恒**」；
§11.2「`# 守恒：reset 前后条数不变`」。

**实测证伪**（`by-running`，用一次性 scratch 仓库完成，**未触碰本仓库**）：

```
$ git mv old new ; echo modified >> new/a.txt
$ git status --porcelain          # reset 前
RM old/a.txt -> new/a.txt
R  old/b.txt -> new/b.txt
R  old/c.txt -> new/c.txt         # → 3 行
$ git reset -q
$ git status --porcelain          # reset 后
 D old/a.txt
 D old/b.txt
 D old/c.txt
?? new/                           # → 4 行
```

一条 `R  old -> new` 是 **1 行**；mixed reset 之后它裂成 ` D old` 加一条未跟踪项，**至少 2 行**
（未跟踪项是否被目录折叠，取决于该目录是否整体未跟踪，所以裂开后的行数**还不是确定值**）。
本仓库有 21 条重命名，reset 后条数必然 > 325，且**无法预先算准**。

**为什么这是 P0 而不是 P1**：§4.3 的 R1 门禁写着「与 §2.2/§2.3 完全一致，**否则停手上报**」，
§2.2 又写着「与本节对不上就说明工作区在两轮之间**被人动过，必须先查清再动手**」，
§11.2 写着「核对不通过就**停下**」。也就是说：一条**必定触发**的告警，配上一句
"工作区可能被人动过"的解释。在一个**唯一副本、没有备份**的仓库里，这正是诱发
`git checkout .` / `git reset --hard` 的心理场景——而那是本文档存在的唯一理由所要防止的事故。

**修法**（已改入 §4.5 step 1、§7.2 不变量 1、§11.2）：换成真正守恒的量。mixed reset
**从不触碰工作区**，所以「相对 HEAD 有差异的路径」∪「未跟踪路径」这个**集合**逐字守恒：

```bash
git diff HEAD --name-only ; git ls-files --others --exclude-standard   # 排序去重后比较
```

实测本仓库该集合大小 = **346**（= 325 个条目 + 21 条重命名的另一侧路径），reset 前后一致。
校验从"比条数"改为"比集合"，既是确定值，又能真正抓住"工作区被动过"。

#### R-P0-2（P0）· 唯一副本要穿过两个最长任务才被提交，且全程没有备份

**v1 怎么写的**：§4.1「F 修复 → C 提交」，F 阶段含 F3（`npm run test:integration`）与
F4（`npm run clean` + `npm run build:dir` + `smoke-test.js`）；理由是「提交信息里要写明门禁实际
结果（C-8）与 U-2/U-3 的真实结论，先提交就只能写'待验证'」。RE-1 把"工作区丢失"列为
**唯一不可逆风险**，缓解措施是「三处显式禁令 + 每步条数校验」。

**问题**：① 条数校验已被 R-P0-1 证伪，缓解措施实际只剩"禁令"，即"别打错字"；
② F4 不是普通长任务——实测 `desktop/scripts/prepare-backend.js:81-144`，每次 `build:dir` 都要
**下载并组装 embeddable CPython**、`pip install -r requirements.txt`（55 行依赖，含
`opencv-python==4.8.1.78` / `numpy==1.26.4`），需要网络，分钟级；
③ **上一轮的节点 #3 就是死在提交之前**（`Agent 进程异常退出 (CRASHED)`），本轮的存在本身
就是这个风险已经兑现过一次的证据；④ 整份方案**没有任何备份动作**——没有 stash、没有备份分支、
没有 tag、没有仓库外副本。

**v1 理由的强度不足**：C-8 要求贴门禁真实输出，但真正需要写进提交信息的是**静态门禁**
（tsc / lint / vitest / pytest / window-state）——它们验证的是这批 diff 本身，全部在 F 阶段跑完。
`test:integration` 与 `build:dir + smoke-test` 验证的是**打包产物**；而 v4 的 C-7 原文是
「要么跑通并贴输出，**要么**显式写明未跑及原因」，从来没有要求它进提交信息。
B-9/B-10 的证据落在 runlog 与 `residual-actions.md` 里同样可查可审计。

**修法**（已改入 §4.1 / §4.2 E-15,E-16 / §4.3 / §10.1 / §11.0）：

1. **新增 F0「零风险备份」，作为本轮第一条命令**（在 R 之后、任何长任务之前）：
   `git stash create` 只创建一个游离 commit 并打印 SHA，**不动工作区、不动索引**；
   用 `git tag` 把它钉成真 ref 以免被 gc；再把 9 个未跟踪路径（stash 不含未跟踪内容）
   拷到仓库外。整体几秒钟、零风险，让 RE-1 第一次有了**纵深防御**而不只是禁令。
2. **时序改为 `R → F(静态) → C(提交) → V(含产物验证)`**：把 F3/F4 移到 C 之后。
   一旦六个提交落地，工作区就不再是唯一副本，之后任何崩溃都只损失时间。

> 这条修改直接回答了本轮的立项理由：上一轮丢的不是代码质量，是**没有先落盘**。

### RV.4 P1 详情（逐条给证据与修法）

**R-P1-1 · RC-18 判据当前不成立**
实测 `grep -rn "AdminSettings|DesktopTitleBar|HeaderActions" src/`（三选一）命中 **2 条**，
而 §11.1 写"期望 0"、RC-18 写"= 0"：

```
src/hooks/useTheme.ts:14:            * shared `HeaderActions` cluster can own a single copy (spec §2.1).
src/hooks/__tests__/useTheme.test.ts:4:  * The hook was extracted from `Header` so the shared `HeaderActions` cluster
```

两处都是**注释里的旧组件名**，违反 CLAUDE.md《Clean Code》「一个概念，一个名字」。
修法：F 阶段把这两行注释里的 `HeaderActions` 改成 `TitleBarActions`（判据保持 0，不放宽口径）。
**连带影响**：这两个文件当前**不在** `git status` 里，改完条目数 325 → 327，
所以 RC-1 的"= 325"必须同步改成"≥ 325 且每个新增条目可解释"（已改）。

**R-P1-2 · `.msg-G*.txt` 会被提交进历史**
§11.2 让实施者把六条提交信息写进 `docs/plans/desktop-only-refactor-finalization/.msg-Gn.txt`，
而 G6 执行 `git add -A -- README.md … docs`。实测（scratch 仓库）：

```
$ git add -A -- d ; git diff --cached --name-only
d/.msg-G1.txt
d/real.md
```

`git add -A -- <dir>` **会收走点开头的文件**。文档自己写的"提交完成后删除"来不及——G6 提交时
这些文件必须还在磁盘上（`git commit -F` 正在读 `.msg-G6.txt`）。且已通读 `.gitignore` 全文，
无任何 `.msg` 规则。修法：**提交信息文件写到仓库外**（已改 §11.2），仓库零污染，
也不必为此新增忽略规则。

**R-P1-3 · `scripts-tmp/` 会让 B-1 永远不为 0**
§11.1 写：「把 v4 spec §10.5 的脚本存成 `scripts-tmp/scan_dangling.py` 后执行」。
六组 pathspec 里没有 `scripts-tmp`（G2 的 `scripts` 是精确目录名，不前缀匹配 `scripts-tmp`），
`.gitignore` 也不覆盖它 → 六组提交完成后 `git status --porcelain | wc -l` = 1，B-1 判负。
修法：脚本落仓库外目录或直接 `python -c`（已改 §11.1），并新增
**B-13：六组之外不得出现新的未跟踪路径**。

**R-P1-4 · A3′ 基线指向了错误的 commit**
实测 `git merge-base HEAD main` = `dc25d775…`，而 `HEAD` = `37719be4…`；I-1/I-6 的基线数字
（8 个 lint error、98 failed / 19 errors）是在 **`37719be`** 上测的。用 `merge-base` 会拿一棵
**从未被测量过**的更早的树当基线。而且六个提交落地后 `HEAD` 就不再是 `37719be`，符号引用会漂移。
修法：A3′/A4′ 的基线一律写死 **`37719be`**（已改 §8.3）。

**R-P1-5 · N-2 的因果结论是错的**
v1 写：「F4 执行 `build:dir` 之前**必须**先 `npm run clean`，否则陈旧的旧后端副本会被带进新包，
冒烟测试跑的就不是本次代码 —— 漏掉会让 U-3 的结论完全失真」。实测反证：

```
desktop/scripts/prepare-backend.js:51   fs.rmSync(destDir,  { recursive: true, force: true })  # build/backend
desktop/scripts/prepare-backend.js:87   fs.rmSync(pythonDir,{ recursive: true, force: true })  # build/python
```

**每次 `build:dir` 都会先删掉再重建 `build/backend/` 与 `build/python/`**，所以"陈旧后端被打进
新包"的机制**不存在**。代价却是真的：`npm run clean` 连 `build/python/` 一起删
（`build.js:251-253`），逼出一次完整的 CPython 组装 + pip 安装（网络 + 分钟级）。
修法（已改 E-10 / §8.3 A5′ / §11.3）：`npm run clean` 从"必须（否则结论失真）"降为**建议**，
真实理由改为"清掉 `release/`，避免 electron-builder 复用半成品 unpacked 目录"——这正是
`build.js:173` 自己在重试路径上做的事。N-2 真正的修法是 A5′ 的**路径限定**，予以保留。

**R-P1-6 · R 阶段"只读"的定义自相矛盾**
§4.1 / §4.3 要求 R「严格只读，禁止写任何文件」；但 RC-4/RC-6/RC-7/RC-14/RC-15 明令跑
`pytest` / `vitest` / `node`（会写 `.pytest_cache/`、`__pycache__/`），§12 又写着
「评审节点如需修订，**直接改本文正文**并追加《评审记录》一节」（本节点的任务契约同样要求写
`spec.md`）。按字面执行，本节点无法交付。修法（已改 §4.1）：精确表述为
**「对源码与 git 索引只读；允许写本轮方案目录；允许跑只读门禁（副产物均被 `.gitignore` 覆盖）」**。

**R-P1-7 · 每组期望条数不是确定值**
实测（scratch 仓库，3 条重命名其中 1 条带内容修改）：

```
$ git diff --cached --name-status
A       new/a.txt
R100    old/b.txt       new/b.txt
R100    old/c.txt       new/c.txt
D       old/a.txt
$ git diff --cached --name-only | wc -l      # → 4，不是 3
```

相似度低于阈值的"重命名 + 修改"会退化成 `A` + `D` 两行。本仓库 G4 含 **7 条 `RM`**
（重命名且内容被改过），重新 `git add` 后是否仍被判为 rename **不是确定性的**，
而 §11.2 的门禁是"对不上就停下"。修法（已改 §4.5 / §11.2 / §8.2 B-4）：门禁统一改用
**`git diff --cached --name-only --no-renames | wc -l`**（每条路径独立计数，确定值），
期望 **G1=1 / G2=54 / G3=121 / G4=153 / G5=10 / G6=7+**（合计 346 = 325 + 21）；
rename 配对交给 B-4 单独校验，且 B-4 从「≈21」改为「**≥14，缺口须逐条解释**」——
14 条纯 `R ` 必然配对，7 条 `RM` 允许退化。

**R-P1-8 · "先激活 venv"不可执行**
实测 `backend-services/basic-service/venv` **不存在**。本节点直接用环境解释器跑了 §6.2 的子集门禁：

```
155 passed, 2 skipped, 25 warnings in 16.87s
```

与 §6.2 的期望**逐字一致**——`tests/conftest.py` 的 cv2 stub 正是为这种环境准备的（RC-16 要保住它）。
修法（已改 §8.1 / §11.3）：改为「**若存在 venv 则激活，否则用环境解释器**」，并把这条实测输出
写进 §6.2 作为参考值。

### RV.5 认可项（明确不要在后续轮次里"优化"掉）

1. **六组切分算法**：经独立复算，互不相交、并集为全集、21 条重命名天然同组，是本文档的核心价值。
2. **E-4 选 mixed reset 而非 `git commit --only`**：避开了"已 `git rm --cached` 但仍在磁盘"的脚枪，
   且让 `git diff --cached` 成为下一个提交的诚实预览，抗崩溃能力更好。判断正确。
3. **E-3 诚实标注"中间提交不单独绿"**：拒绝为了假装可 bisect 而重做分阶段实施，是对的取舍。
4. **E-8 / N-1 "判据错了就改判据，不许删测试凑绿灯"**：方向完全正确，C-3′ 的写法可直接采用。
5. **E-11 拒绝 skip/xfail**：与 v4《评审结论》「不通过情形 2」一致，守住了底线。
6. **§4.6 崩溃恢复协议**：按 `git log` 判定进度、从下一组续做而不是重头来，正是上一轮缺的东西。
7. **§6.3 六条提交信息全文**：把"必须轮换 SSH 私钥"写进 `git log` 而不只是文档，是好设计（RE-11）。

## 1. 概述（Overview）

Ecliptrix 正在从「可服务器部署的多用户 Web 应用」收敛为「单用户 Electron 桌面应用」。第 1 轮的
四节点流水线已经把这件事**做完了**：后端删掉用户/鉴权/限流台/Alembic 迁移链，改为
`create_all` + `LOCAL_OWNER_ID` 单所有者模型；前端删掉登录页、着陆页、用户资料、用户管理、
`useAuth`/`AuthProvider`/`SESSION_TOKEN_KEY` 全部鉴权面，把 `page.tsx` 重写为「标题栏 + 任务栏 +
工作区」的桌面外壳，把 `AdminSettings/` 重命名为 `settings/` 并重排信息架构、新增「通用」面板；
BFF 路由从 122 条降到 103 条；Electron 主进程彻底移除凭证桥；`ops/`、`install.sh`、`coverage/`、
`example-package/` 等非桌面部署工件整目录删除。工作区实测：324 条变更，索引里 207 个文件净删除
35371 行，工作区另有 116 个文件 +2191/−5215。

**问题在于：这一切从未进入 git 历史。** 负责「代码 Review、修复与提交」的第 4 个节点进程崩溃
（`Agent 进程异常退出 (CRASHED)`），于是整轮重构以「未提交的工作区」形态悬在那里 —— 这是这个仓库
目前**风险最高的状态**：没有 stash、没有备份分支、没有远端副本，任何一次误操作的
`git checkout .` 都会把它清零；同时它也没有被任何人独立评审过（开发节点自评不算评审），没有在
**打包产物**上验证过，`npm run test:integration` 与桌面端十一条走查一条都没跑。

**本轮要交付的，是把这个"悬空态"落地的完整设计**：一套可复算的现状复核（§2）、一份逐项到文件的
评审清单（§4.4）、一个把 324 条变更切成 6 个可评审提交的精确暂存方案（§4.5 + §11.2）、两条上一轮
欠下的验证（集成测试与打包冒烟）、三条从未成立过的验收判据的自洽化改写（§8.3），以及一份把
"代码改不掉、必须由人执行"的残留动作（生产 SSH 私钥轮换、后端 82 个既有失败用例的独立立项）
登记在案的 residual 文档。设计的核心约束只有一条：**新增价值全部来自"验证 + 落盘"，不来自"再改一版
重构"**；任何试图在本轮重新设计 UI、重新组织目录、重新删代码的动作，都是对已通过评审的 v4 方案的
违背，应当被打回。

---

## 2. 现状复核（本轮实测证据）

> 本节每一条都附**可复算命令**。实施节点动手前必须重跑一遍，与本节对不上就说明工作区在两轮之间
> 被人动过，**必须先查清再动手**。

### 2.1 上一轮断在哪儿

| 节点 | 状态 | 产出 |
|------|------|------|
| #0 方案设计 | completed | `desktop-only-refactor/spec.md` v3（1052 行） |
| #1 方案评审与修复 | completed | 同文件 v4（评审后 1449 行），3×P0 + 8×P1 + 8×P2 全部改入正文，结论"有条件通过" + C-1..C-8 |
| #2 代码开发 | completed | P0-R/P3/P4/P5/P6/P7 全部落到**工作区**；追加《实施过程发现的方案缺陷》I-1..I-11（文件最终 **1757 行**，实测） |
| #3 代码 Review、修复与提交 | **failed（CRASHED）** | **无**。C-2（提交）、C-7（集成测试）、§10.3（走查）全部落空 |

```bash
git log --oneline -1        # → 37719be feat: multi-keyframe camera motion ...（重构一行未进历史）
git rev-parse --abbrev-ref HEAD   # → feat/remove-user-system
```

### 2.2 工作区实测（2026-09-01，本节点复算）

```bash
git status --porcelain | wc -l                    # → 324（本节点写入 spec 后 325，见下方注）
git status --porcelain | awk '{print substr($0,1,2)}' | sort | uniq -c
#  186 "D "   已暂存删除
#  108 " M"   仅工作区修改
#   14 "R "   已暂存重命名
#    8 "??"   未跟踪
#    7 "RM"   已暂存重命名 + 工作区又改过
#    1 " D"   仅工作区删除（未暂存）
git diff --cached --shortstat                     # → 207 files changed, 35371 deletions(-)
git diff --shortstat                              # → 116 files changed, 2191 insertions(+), 5215 deletions(-)
```

**按顶层路径分组**（324 = 1 + 54 + 121 + 132 + 10 + 6，这就是 §4.5 六个提交的切分依据）：

| 组 | 路径 | 条数 | 性质 |
|----|------|------|------|
| G1 | `.gitignore` | 1 | 忽略规则：新增 `coverage/`、`/logs/`、`.run-log/`、`.claude-index/graph.json`；删除 `!ops/config.env` 例外 |
| G2 | `ops/`(17) `coverage/`(15) `example-package/`(14) `scripts/`(2) `dev/`(1) `install.sh` `install.ps1` `start.sh` `kill.sh` `test_seedance.py` | 54 | **纯删除**，非桌面部署工件 |
| G3 | `backend-services/` | 121 | 用户系统/鉴权/限流/Alembic 删除 + 单所有者模型 + 新增 3 个回归测试 |
| G4 | `src/`(125) `tests/`(3) `vitest.config.ts` `vitest.integration.config.ts` `next.config.js` `.eslintrc.json` | 132 | 前端外壳收敛 + 鉴权面归零 + BFF 清理 |
| G5 | `desktop/` | 10 | 凭证桥移除 |
| G6 | `README.md` `README.zh-CN.md` `CLAUDE.md` `.claude-index/`(2) `docs/`(1→2，未跟踪目录) | 6→7 | 文档桌面化 + 两轮方案文档入库 |

**未跟踪路径**（`git add` 时一个都不能漏，漏任一条都会让提交自相矛盾）。
开发节点动手时是 **9 条** —— 前 8 条是上一轮留下的，第 9 条是本文档所在目录：


```
backend-services/basic-service/app/constants.py                      ← LOCAL_OWNER_ID 的唯一定义
backend-services/basic-service/tests/test_local_owner_claim.py
backend-services/basic-service/tests/test_local_owner_materials_listing.py
backend-services/basic-service/tests/test_no_auth_surface.py
src/lib/localOwner.ts                                                ← 前端镜像，后端 docstring 指向它
src/components/settings/GeneralSettingsPanel.tsx
src/lib/api/__tests__/no-auth-surface.test.ts
docs/plans/desktop-only-refactor/                                    ← v4 方案本体
docs/plans/desktop-only-refactor-finalization/                       ← 本轮方案（本节点新增）
```

> **计数说明**：§2.2 表里的 324 与分组算术是**本节点写入本文档之前**的实测值。
> 本节点只新增了 `docs/plans/desktop-only-refactor-finalization/` 一个未跟踪目录条目，
> 因此后续节点看到的是 **325**（G6 组 6 → 7）。F 阶段再产出 `residual-actions.md` /
> `review-notes.md` 时它们落在同一目录内，`git status` 仍按目录折叠为 1 条。
> **除此之外工作区一字未动** —— 本节点被约束为“只写 `docs/plans/<feature>/`”。

**1 个未暂存删除**（容易漏，`git add -A -- backend-services` 才会收进去）：

```
 D backend-services/basic-service/tests/test_user_id_self_heal.py    ← 已被 test_local_owner_claim.py 取代
```

**21 条重命名**（14 `R ` + 7 `RM`）已用 `git mv` 完成，`AdminSettings/ → settings/`、
`DesktopTitleBar → shell/AppTitleBar`、`HeaderActions → shell/TitleBarActions`。
**切分提交时源路径与目标路径必须落在同一个提交里**，否则 git 无法识别为重命名，diff 会退化成
「删 19 个文件 + 加 19 个文件」，评审成本翻倍。三组重命名全部在 `src/` 下 → 天然落在 G4，无需特殊处理。

### 2.3 判据实测现状（#0 复算 + 【v2 评审复测】；除 N-3 外全部通过）

| 判据 | 命令 | 实测 | 期望 |
|------|------|------|------|
| A1 前端 | `grep -rn "useAuth\|SESSION_TOKEN_KEY\|AuthProvider\|isAuthenticated" src/ --include=*.ts --include=*.tsx \| grep -v __tests__ \| wc -l` | **0** | 0 |
| A1 后端 | `grep -rn "get_current_user\|require_admin" backend-services/basic-service/app/ \| wc -l` | **0** | 0 |
| A2 | `ls -d ops install.sh start.sh kill.sh coverage example-package backend-services/basic-service/alembic` | **全部 No such file** | 不存在 |
| A5（源码口径） | `rg "getBootstrapCredentials\|ROOT_PASSWORD\|ROOT_USERNAME\|ADMIN_PASSWORD\|BootstrapCredentials"` 于 `desktop/{main,preload,scripts}` + `src/` | **0** | 0 |
| A5（v4 字面口径） | `grep -rn "getBootstrapCredentials\|ROOT_PASSWORD\|ROOT_USERNAME\|ADMIN_PASSWORD" desktop/ src/ \| wc -l` | **32** | ⚠️ 见下 |
| A9 ③ | §10.5 悬挂文档引用扫描 | **scanned=943 dangling=0** | dangling=0 |
| BFF 收敛 | `find src/app/api -name route.ts \| wc -l` | **103** | 103（原 122） |
| C-3 | `grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/ \| wc -l` | **4** | ⚠️ 见下 |
| C-3 反向 | `grep -c "RateLimitError" src/lib/api/http-client.ts` | **13** | > 0 |
| RC-18 旧名残留【v2 新增】 | `grep -rn "AdminSettings\|DesktopTitleBar\|HeaderActions" src/ \| wc -l` | **2** | ⚠️ 见 N-3 |
| 后端子集门禁【v2 新增】 | §6.2 的 `pytest … -q`（**无 venv，用环境解释器**） | **155 passed / 2 skipped / 0 errors，16.87s** | 与 §6.2 期望一致 |
| 组切分完整性【v2 新增】 | 按 §4.5 六组 pathspec 对 325 条做归组 | `1+54+121+132+10+7=325`，未覆盖 0、跨组 0 | 分区正确 |

> ⚠️ **N-1（本节点新发现，P2）**：C-3 的字面判据「`grep ... src/` = 0」**当前不成立，实测 4 命中**。
> 4 处全在 `src/lib/api/__tests__/no-auth-surface.test.ts`（第 7/29/30/31 行），是**护栏测试的负向断言**
> —— 它正是用来证明这三个类已经不再被导出的。这与 v4 评审在 A1 上已经打过的补丁（P1-7:
> 「判据必须排除负向断言测试，否则恒不可满足」）是同一类问题，只是 C-3 那一行漏改了。
> **处置**：修判据，不修代码（删掉护栏测试来满足判据是本末倒置）。见 §4.2 E-8 与 §8.3。

> ⚠️ **N-3（v2 评审新发现，P1 → 已定修法）**：RC-18 与 §11.1 的「旧名残留 = 0」**当前不成立，
> 实测 2 命中**，均为注释里的旧组件名：`src/hooks/useTheme.ts:14` 与
> `src/hooks/__tests__/useTheme.test.ts:4` 仍写着 `HeaderActions`（已重命名为 `TitleBarActions`）。
> **处置**：修代码不修判据——这与 N-1/N-2 相反，因为它不是"判据恒不可满足"，而是**真的漏改了**，
> 且违反 CLAUDE.md《Clean Code》「一个概念，一个名字」。F1 改这两行注释即可（见 §5.2）。
> **连带**：两文件当前不在 `git status` 内，改完条目数 325 → 327，故 RC-1 改为"≥ 325 且增量可解释"。

> ℹ️ **N-4（v2 评审新发现）**：`backend-services/basic-service/venv` **不存在**。§8.1/§11.3 的
> "先激活 venv"不可执行。本节点直接用环境解释器跑 §6.2 的子集门禁得到
> `155 passed, 2 skipped, 25 warnings in 16.87s`，与期望逐字一致——`tests/conftest.py` 的 cv2 stub
> 正是为这种环境准备的。判据不变，执行说明改为"有 venv 则激活，否则用环境解释器"。

> ⚠️ **N-2（本节点新发现，P2）**：A5 的字面判据「`grep -rn ... desktop/ src/` = 0」**当前不成立，
> 实测 32 命中**。逐条定位后确认：**32 条全部落在 git 忽略的构建产物里** ——
> `desktop/build/backend/app/**`（上一次打包时从旧源码拷进去的后端副本）与
> `desktop/release/win-unpacked/resources/backend/app/**`（含 `__pycache__`）。
> 源码目录（`desktop/{main,preload,scripts}` + `src/`）实测为 **0**，它们也确实没出现在
> `git status` 里（`.gitignore` 已覆盖）。
> **处置**：判据改写为源码口径 A5′（§8.3）。
>
> ~~**F4 执行 `build:dir` 之前必须先 `cd desktop && npm run clean`**，否则陈旧的旧后端副本会被
> 带进新包，冒烟测试跑的就不是本次代码。~~
> **【v2 评审修订 R-P1-5：这句因果是错的，已撤销】** 实测
> `desktop/scripts/prepare-backend.js:51` 与 `:87` 每次 `build:dir` 都 `fs.rmSync` 掉
> `build/backend/` 与 `build/python/` 再重建，"陈旧后端被打进新包"的机制**不存在**；
> 而 `npm run clean` 会连 `build/python/` 一起删（`build.js:251-253`），逼出一次完整的
> CPython 组装 + `pip install`（网络 + 分钟级）。`npm run clean` 因此降为**建议**，
> 真实理由是"清掉 `release/`，避免 electron-builder 复用半成品 unpacked 目录"
> （`build.js:173` 在重试路径上自己就这么做）。这些残留是 `.gitignore` 覆盖的构建产物，
> **不会**进入本轮任何一个提交。

### 2.4 未竟事项清单（U-1 .. U-9）

| ID | 来源 | 一句话 | 本轮归属 |
|----|------|--------|----------|
| **U-1** | C-2 / I-10 / F-19 | 工作区从未提交，且开发节点被禁止 `git commit`，顺延至今 | **C 阶段（本轮主线）** |
| **U-2** | C-7 | `npm run test:integration` 从未跑过 | **V 阶段**（尝试真跑，失败则显式声明）【v2 评审修订 R-P0-2：由 F 移到 C 之后】 |
| **U-3** | §10.3 | 桌面端十一条走查一条没跑（需打包产物） | **V 阶段**（自动化子集）+ 人工子集移交【同上】 |
| **U-4** | I-1 | A4「pytest 全绿」从未成立（基线 `37719be` = 98 failed / 19 errors） | F 阶段：改判据 A4′ |
| **U-5** | I-6 | A3「lint 0 error」从未成立（8 个既有 error 在未触碰文件里） | F 阶段：改判据 A3′ |
| **U-6** | N-1（本轮新增） | C-3 判据未做"排除负向断言测试"补丁 | F 阶段：改判据 C-3′ |
| **U-6b** | N-2（本轮新增） | A5 判据未排除 git 忽略的构建产物（实测 32 命中全在 `desktop/{build,release}`） | F 阶段：改判据 A5′（【v2 修订 R-P1-5】不再捆绑"必须先 `npm run clean`"） |
| **U-6c** | N-3（v2 评审新增） | RC-18「旧名残留 = 0」当前实测 2 命中，是真漏改而非判据问题 | F1：改两行注释，判据不放宽（B-14） |
| **U-7** | F-1 / R-1 | `ops/key/inkclaw-singpore-260322.pem` 曾被 git 追踪，删文件不清历史 → **必须轮换** | 登记到 residual 文档 + 提交信息显式声明 |
| **U-8** | I-1 | 后端 82 个既有失败 + 19 个 error 需独立立项，不塞进本次 diff | 登记到 residual 文档 |
| **U-9** | I-11 | `python -c "import app.main"` 在本机恒失败（OpenCV 二进制损坏，与代码无关） | 登记到 residual 文档；用 pytest 子集作等效替代（v2 实测该子集 155 passed，可用） |

---

## 3. 设计原则与范围边界

### 3.1 原则

1. **不重做已完成的工作**。v4 spec §2.1 与《实施过程发现的方案缺陷》标记为已落地的内容，
   本轮只**验证**、不**重写**。想改设计 → 打回，不在本轮做。
2. **工作区是唯一副本，按对待生产数据的规格对待它**。任何会丢弃工作区内容的命令都是 P0 事故。
3. **【v2 评审新增】禁令不是备份，纵深防御才是**。"别打错字"不是缓解措施。动手前先做一次
   零风险备份（§11.0），并尽早把唯一副本变成 git 历史——这正是上一轮丢盘的教训。
4. **证据先行**。每一条"通过"必须附命令与**真实输出**；不接受"应该能过""按理说没问题"。
   这一条是 v4 §3.1 原则 5 的延续，本轮同样适用于评审结论。
5. **判据不可自证**。发现判据本身错了（恒不可满足 / 与实现矛盾），改判据并写明理由，
   **不许**通过删测试、加 `skip`/`xfail`、放宽 grep 范围来"让它变绿"。
   反过来，判据没错、是代码漏改的（N-3），就**改代码不改判据**。
6. **门禁必须是确定值**。会随 git 内部启发式（如重命名相似度阈值）浮动的计数不能当停手依据
   ——【v2 评审新增 R-P1-7】，见 §4.5 的 `--no-renames` 口径。
7. **提交必须可评审**。324 条变更压成一个提交，等于没有评审价值；切成六组按领域提交，
   每组的 diff 都能被人在十分钟内读完。

### 3.2 范围内（In scope）

- 对工作区 325 条变更做独立评审（正确性 + Clean Code 门限 + 无障碍 + i18n 完整性）。
- **【v2 新增】动手前的零风险备份（F0，§11.0）**。
- 修复评审发现的缺陷（含判据自洽化，以及 N-3 的两行注释）。
- 把工作区切成 6 个提交并落到 `feat/remove-user-system` 分支。
- 跑通/或显式声明 `npm run test:integration`（**在提交之后**）。
- 跑 `npm run build:dir` + `desktop/scripts/smoke-test.js`（**在提交之后**），覆盖走查第 1/9/10 条。
- 产出 `residual-actions.md`（残留动作登记）。
- 把本轮的判据改写回写进 `desktop-only-refactor/spec.md`（追加《收尾轮记录》一节，不改历史结论）。

### 3.3 范围外（Out of scope）

- **修后端 82 个既有失败用例**（I-1 已证明与本次重构无关；硬塞进来会让本次 diff 失去可评审性）→ U-8 立项。
- **修 `npm run lint` 的 8 个既有 error**（I-6，全在本次未触碰的文件里）→ U-8 立项。
- **修 3 个既有 vitest 失败**（backend-proxy T2/T18、cachePlayback 端到端；已用 HEAD 源码逐个复现）→ U-8 立项。
- **修本机 OpenCV**（U-9，环境问题）。
- **轮换生产 SSH 私钥**（U-7，运维动作，代码改不掉）→ 登记，由人执行。
- **UI 再设计 / 目录再重组 / 再删代码**。
- **改分支名 / 建 PR / push 远端**（本仓库当前无远端 PR 流程；用户未要求）。

---

## 4. 技术设计（Technical Design）

### 4.1 本轮的"系统"是一条四段流水线

本轮没有运行时架构变更。要设计的"系统"是一条**从工作区到 git 历史的流水线**，它的正确性完全
取决于每一段的进入条件与退出门禁：

```
  工作区 325 条（唯一副本）
        |
        v
  [R] 评审  —— 对源码与 git 索引只读；可写本轮方案目录；可跑只读门禁
        |     产出：评审记录（P0 / P1 / P2 分级）
        v
  [F0] 零风险备份  —— git stash create -> git tag  +  9 个未跟踪路径拷到仓库外
        |            【v2 评审新增 R-P0-2】不动工作区、不动索引，几秒钟
        v
  [F] 静态修复与静态门禁  —— 修 P0/P1；判据自洽化 A3'/A4'/A5'/C-3' 回写 v4 spec；
        |                    写 residual-actions.md；跑 tsc / lint / vitest / pytest /
        |                    window-state（这些正是提交信息要引用的证据，C-8）
        v
  [C] 提交（6 个，顺序固定，精确暂存）
        |   G1 卫生 -> G2 部署工件 -> G3 后端 -> G4 前端 -> G5 桌面 -> G6 文档
        v   ==== 到这里工作区不再是唯一副本，最大风险解除 ====
  [V] 验证 —— V1..V5 提交自洽性（status 归零 / 卫生 / HEAD 上重跑静态门禁）
        |     V6 产物验证【v2 评审从 F 移来 R-P0-2】：
        |        npm run test:integration（U-2）
        |        npm run build:dir + smoke-test.js（U-3 自动化子集）
        v     失败 -> 记 residual，**不回滚已落地的提交**（R-P2-6）
      收口：runlog + 黑板
```

**R 阶段"只读"的精确范围**【v2 评审修订 R-P1-6】：**对源码与 git 索引只读**——不改任何
`src/` / `backend-services/` / `desktop/` 文件，不跑 `git add` / `git commit` / `git reset`。
**允许**写 `docs/plans/desktop-only-refactor-finalization/`（评审记录本身要落盘），
**允许**跑只读门禁（`pytest` / `vitest` / `node --check` 会产生 `.pytest_cache/`、`__pycache__/`
等副产物，它们全部被 `.gitignore` 覆盖，不进 `git status`）。
理由不变：评审节点边看边改就无法区分"缺陷是开发节点留下的"还是"评审节点自己引入的"。
v1 原文写的"禁止写任何文件"与 RC-4/6/7/14/15（明令跑测试）及 §12（评审节点直接改本文正文）
自相矛盾，按字面执行则评审节点无法交付。

**为什么 F0 备份必须排在所有长任务之前**【v2 评审新增 R-P0-2】：工作区是唯一副本，
而 RE-1 原本的缓解措施只有"禁令 + 条数校验"，其中条数校验已被 R-P0-1 证伪。
`git stash create` 生成一个游离 commit 并打印 SHA，**不修改工作区、不修改索引**，
配合 `git tag` 钉成真 ref 即可免于 gc；未跟踪文件 stash 不覆盖，另拷一份到仓库外。
成本几秒，收益是把"唯一不可逆风险"变成可逆。

**为什么静态门禁在 C 之前、产物验证在 C 之后**【v2 评审修订 R-P0-2】：
提交信息需要引用的是**静态门禁**（tsc / lint / vitest / pytest / window-state）——它们验证
这批 diff 本身，跑得快，且是 C-8 的实际对象。而 `test:integration` 与 `build:dir + smoke-test`
验证的是**打包产物**，耗时长、依赖网络（`prepare-backend.js` 每次都要组装 CPython 并
`pip install`），把唯一副本压在这两个任务后面，正是上一轮节点 #3 崩溃丢盘的形状。
v4 的 C-7 原文是「跑通并贴输出 **或** 显式写明未跑及原因」，从未要求它进提交信息；
B-9/B-10 的证据落在 runlog 与 `residual-actions.md` 里同样可审计。

**为什么 V 必须在 C 之后再跑一次静态门禁**：切分提交用的是 `git reset` + 分组 `git add`，
存在"某一组漏加导致 HEAD 与工作区不一致"的风险；只有在 `git status` 归零后的 HEAD 上重跑
一次 `npx tsc --noEmit` + `npm test`，才能证明提交出来的历史是自洽的。

### 4.2 决策记录（Decision Log · E 系列）

> 编号 **E-n**（Endgame），与 v4 的 D-n、评审的 C-n、实施的 I-n 区分。

| ID | 决策 | 理由 |
|----|------|------|
| **E-1** | 本轮不重做 P0-R/P3/P4/P5/P6/P7，只评审 + 修复 + 提交 | v4 已评审通过、已实施完毕；重做等于丢弃两个节点的产出，且违反多轮迭代任务的第 1 条约束（不回滚已完成代码） |
| **E-2** | 324 条切成 **6 个按领域分组的提交**，而不是 1 个巨型提交，也不是按 P0..P7 阶段提交 | ① 单提交（324 文件 / 十万级删除）无法评审；② 按阶段提交不可行——工作区是一次性快照，无法反推出各阶段的中间态，强行拆分等于重做；③ 按顶层路径分组的边界是客观的（§2.2 表），每组自成主题，且 21 条重命名全在 `src/` 内，不会被拆散 |
| **E-3** | 接受"中间提交不单独绿"这一代价，并在提交信息里**明说** | 六个提交是一次原子重构的六个切片：G3（后端删鉴权）单独存在时，前端仍在调 `/api/auth/*`。要求每个中间提交都能独立通过全门禁，唯一办法是重做一遍分阶段实施（E-1 已否决）。诚实标注 > 假装可 bisect |
| **E-4** | 用 `git reset`（**mixed，绝不加 `--hard`**）+ 分组 `git add -A -- <路径>` + 普通 `git commit` 实现切分 | 对比方案 `git commit -- <pathspec>`（--only 语义）有已知脚枪：它会把"已 `git rm --cached` 但仍在磁盘上"的文件重新加回来。本仓库当前**没有**这种文件（实测：186 个 `D ` 条目 0 个仍在磁盘上），但 `git reset` 方案让 `git diff --cached` 成为下一个提交的**诚实预览**，可逐组核对，抗崩溃能力也更强（mixed reset 不动工作区，中途崩溃只需重新 `git add`） |
| **E-5** | 提交顺序固定为 G1 → G2 → G3 → G4 → G5 → G6 | 忽略规则先落地（避免后续步骤误纳构建产物）；纯删除的部署工件次之（零依赖）；再后端、前端、桌面壳（依赖方向：数据面 → 表现面 → 外壳）；文档最后（它描述的是最终态） |
| **E-6** | 提交信息用 **Conventional Commits**（`refactor:` / `chore:` / `docs:`），不用 `CLAUDE.md` 记载的 `[add]/[modify]` 风格 | 【v2 评审修订 R-P2-2 · 数字已按实测更正】实测：仓库 669 个提交里 **475** 个用方括号风格、182 个用 conventional；但**最近 180 个提交里 168 个是 conventional、只有 11 个是方括号**。v4 spec §12.6 已明文规定用 Conventional Commits（其原文举的例是 `feat:`）并通过评审——本轮按每组的实际性质**细化**为 `chore:` / `refactor!:` / `docs:`（六组里没有一组是新功能，写 `feat:` 反而失真），这是对 §12.6 的细化而非偏离。与最近实践和已批准方案保持一致 > 与一份已经落后于实践的文档行保持一致。`CLAUDE.md:149` 与实践不符一事登记为 residual（不在本轮单方面改项目约定） |
| **E-7** | 破坏性变更用 `refactor!:` 标注（G3/G4） | 删除用户系统对任何服务器部署都是破坏性的；桌面单机产品虽无外部消费者，但历史里留个 `!` 让未来的人一眼看见分水岭 |
| **E-8** | 判据错了就改判据，并把改动**回写进 v4 spec**（追加一节，不改历史结论） | A3/A4/A5/C-3 四条判据要么恒不可满足（I-1/I-6），要么与护栏测试自相矛盾（N-1），要么被上一次构建的残留决定（N-2）。留着它们只会逼下一个节点造假绿灯。回写而非重写，保留评审轨迹 |
| **E-9** | U-2（集成测试）**先尝试真跑**，跑不起来才用 C-7 的"显式声明"条款 | 上一轮直接走了声明分支。本轮既然是收尾轮，应当先试一次真起栈（`tests/integration/helpers/spawn-stack.ts`）；只有确认环境不具备（缺 Python 依赖 / 端口占用 / 后端起不来）才声明，且要写清失败原因 |
| **E-10** | U-3（桌面走查）拆成**可自动化子集**与**人工子集**，自动化子集本轮必须跑 | `npm run build:dir` + `node desktop/scripts/smoke-test.js` 覆盖走查第 1 条（全新启动无登录框）、第 9 条（子进程全退出）、第 10 条（日志无口令）中的可脚本化部分——smoke-test 已被上一轮改写为"匿名请求项目列表返回 200"的无鉴权断言（`smoke-test.js:143-151`，v2 复核后的准确行号）。第 2/3/4/5/6/7/8/11 条需要人操作 UI，移交人工验收并在 residual 中登记 |
| **E-11** | 三个既有 vitest 失败、8 个 lint error、82 个 pytest 失败**一律不修、不 skip、不 xfail**，只立项 | v4《评审结论》「不通过情形 2」明令禁止为了绿灯而 skip；I-1/I-6 已用 `git worktree` 建 HEAD 基线证明它们与本次重构无关。修它们是独立工作项 |
| **E-12** | 不改分支名、不建 PR、不 push | 当前分支 `feat/remove-user-system` 名字比实际范围窄，但改名会打断任何已有引用，且用户本轮只要求"继续完成"。范围外 |
| **E-13** | 回滚策略 = **区间 revert**，不是单提交 revert | 六个提交是一次原子重构；真要回滚必须 `git revert --no-commit <G1>^..<G6>` 整段回退，单独 revert 其中一个会造出前后端不一致的状态 |
| **E-14** | 本轮所有新增文档落在 `docs/plans/desktop-only-refactor-finalization/`，**不覆盖** v4 spec | v4 是已通过评审的基线，覆盖它会毁掉评审轨迹；本轮只在其尾部**追加**一节《收尾轮记录》 |
| **E-15**【v2 评审新增】 | 动手前先做**零风险备份**：`git tag <name> $(git stash create)` + 把 9 个未跟踪路径拷到**仓库外** | `git stash create` 只创建游离 commit 并打印 SHA，**不动工作区、不动索引**（区别于 `git stash push`，后者会卷走内容）；`git tag` 让它免于 gc。未跟踪文件不进 stash，故另拷一份。成本几秒，把 RE-1 从"只有禁令"升级为**纵深防御**——而 RE-1 原本依赖的条数校验已被 R-P0-1 证伪 |
| **E-16**【v2 评审修订】 | **产物验证（U-2 集成测试、U-3 打包冒烟）挪到 C 之后**，静态门禁仍在 C 之前 | 提交信息真正要引用的是验证 diff 本身的静态门禁（C-8 的实际对象）；产物验证耗时长、依赖网络（`prepare-backend.js` 每次组装 CPython + `pip install`），把唯一副本压在它们后面正是上一轮 #3 崩溃丢盘的形状。v4 的 C-7 本就允许"未跑 + 原因"，B-9/B-10 的证据落 runlog / residual 同样可审计 |
| **E-17**【v2 评审修订】 | 分组条数门禁统一用 **`--no-renames`** 口径，不用会被重命名配对影响的计数 | 实测：相似度低于阈值的"重命名 + 修改"会退化成 `A`+`D` 两行，本仓库 G4 有 7 条 `RM` 属于这种情形，配对与否**不是确定值**。门禁必须是确定值，否则"对不上就停下"会变成随机停摆。rename 配对本身由 B-4 单独、宽松地校验 |
| **E-18**【v2 评审修订】 | 差分判据的基线**钉死 commit `37719be`**，不用 `HEAD`、不用 `git merge-base HEAD main` | 实测 `merge-base HEAD main` = `dc25d77` ≠ `37719be`，是一棵**从未被测量过**的树；且六个提交落地后 `HEAD` 会漂移，符号引用当基线必然失真 |
| **E-19**【v2 评审新增】 | 提交信息临时文件写在**仓库外**，不写进 `docs/plans/…/` | 实测 `git add -A -- <dir>` 会收走点开头文件，G6 的 `git add -A -- … docs` 必然把 `.msg-G*.txt` 提交进历史（提交时它们必须还在磁盘上，"事后删除"来不及）。写仓库外可让仓库零污染，也不必为此新增忽略规则 |

### 4.3 关键路径与时序

```
R 阶段（评审节点，对源码与索引只读）
  R1  复核 §2 现状（§11.1 命令块）——与本文档对不上先查清再动手，**但不要用 reset/checkout 去"修"**
  R2  按 §4.4 的 RC-1..RC-22 逐项核对，每项记 pass / fail + 证据
  R3  产出评审记录：P0（阻断提交）/ P1（本轮必修）/ P2（记 residual）

F 阶段（开发节点）
  F0  【v2 新增】零风险备份（§11.0）：git tag <name> $(git stash create) + 未跟踪路径拷到仓库外
      gate: git cat-file -t <tag> = commit，且仓库外副本含全部 9 个未跟踪路径
  F1  修 R 阶段的 P0/P1（含 N-3 的两行注释）
  F2  判据自洽化：A3'/A4'/A5'/C-3'（§8.3），回写 v4 spec 尾部《收尾轮记录》
  F3  写 docs/plans/desktop-only-refactor-finalization/residual-actions.md（§5.4 给了字段规范）
  F4  跑**静态**门禁（§8.1 矩阵的前 8 行），贴真实输出 —— 这是提交信息要引用的证据

C 阶段（提交节点）
  C0  再跑一次 §11.1 现状复核（确认 F 阶段没把工作区搞乱；用**路径集合**而非条数）
  C1  git reset（mixed！）
  C2..C7  六组：git add -A -- <路径> -> --no-renames 条数核对 -> git commit -F <仓库外的 msg 文件>
  每组提交后立刻 git log -1 --stat | head -30 检查卫生

V 阶段（提交节点）
  V1  git status --porcelain | wc -l -> 0
  V2  git log --oneline -6 -> 六条，顺序正确
  V3  git log -6 --stat | grep -E "\.next/|__pycache__|tsbuildinfo|\.idea/|\.msg-" -> 0
  V4  在 HEAD 上重跑 npx tsc --noEmit + npm test + §6.2 后端子集，确认历史自洽
  V5  【v2 从 F 移来】产物验证：npm run test:integration（U-2）；
      npm run build:dir + node desktop/scripts/smoke-test.js（U-3 自动化子集）
      ——失败只记 residual，**不回滚已落地的提交**
  V6  runlog result + 黑板 put，把证据落盘；确认后可删掉 F0 的备份 tag
```

### 4.4 评审清单（RC-1 .. RC-22）

> R 阶段逐项执行。**"验证方式"列的命令必须真跑并贴输出**；纯靠读代码给出的结论要在记录里标注
> `by-reading`，与 `by-running` 区分。

#### A. 不可破坏性（最高优先级，任一条 fail 都是 P0）

| ID | 检查项 | 验证方式 |
|----|--------|----------|
| RC-1 | 工作区变更完整无缺失 | 【v2 修订 R-P1-1】`git status --porcelain \| wc -l` **≥ 325**，且**每一个超出 325 的条目都必须能解释**（预期增量：N-3 的 `src/hooks/useTheme.ts` 与 `src/hooks/__tests__/useTheme.test.ts` 两条 → 327；F 阶段新增的文档落在已折叠的方案目录内，不增计数）。分组统计与 §2.2 表一致，且六组之外**零新增路径**（B-13） |
| RC-2 | 9 个未跟踪路径全部存在且非空 | `ls -l` §2.2 清单；`wc -l` 均 > 0 |
| RC-3 | 启动路径无破坏性 DDL（F-2，历史上最贵的两次事故） | `grep -rniE "drop\s+(table\|column)\|ALTER .* DROP" backend-services/basic-service/app/` = 0 |
| RC-4 | `create_all` + 幂等 UPDATE 认领仍在 | 读 `app/database.py`；`pytest tests/test_local_owner_claim.py -q` 绿 |
| RC-5 | `LOCAL_OWNER_ID` 前后端两处**完全一致** | `grep LOCAL_OWNER_ID backend-services/basic-service/app/constants.py src/lib/localOwner.ts` 字面比对 |
| RC-6 | 素材库读放宽（D13）仍在：列表侧枚举全部 `user_*` 目录 | `pytest tests/test_local_owner_materials_listing.py -q` 绿 |
| RC-7 | `RateLimitError` / 429 通路完整（v2 已踩过一次） | `grep -c RateLimitError src/lib/api/http-client.ts` > 0；`npx vitest run src/lib/api/__tests__/no-auth-surface.test.ts` 绿 |

#### B. 判据符合性（对应 v4 的 A1..A9 / C-1..C-8）

| ID | 检查项 | 验证方式 |
|----|--------|----------|
| RC-8 | A1 鉴权概念归零（排除 `__tests__` 负向断言） | §2.3 表两条 grep = 0 |
| RC-9 | A2 非桌面工件不存在 | §2.3 `ls -d` 全部 No such file |
| RC-10 | A5 凭证桥归零（**源码口径**，见 N-2） | `rg` 于 `desktop/{main,preload,scripts}` + `src/` = 0。**必须限定路径**：递归整个 `desktop/` 会跑进 `node_modules`/`release`（实测超时），且会命中 32 条陈旧打包产物里的旧后端副本 |
| RC-11 | A9 悬挂文档引用 = 0 | 跑 v4 §10.5 脚本 → `dangling=0` |
| RC-12 | C-1 docs 定点回退没做过头 | `git diff --cached --name-status -- docs/ \| wc -l` = 0，且 `git diff --cached --shortstat` 仍是万级删除 |
| RC-13 | C-3 三个鉴权错误类只剩护栏测试里的负向断言 | `grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/` 的**每一条**都位于 `src/lib/api/__tests__/no-auth-surface.test.ts`（实测 4 条，行号 7/29/30/31） |
| RC-14 | C-4 空态创建入口是真 `<button>` 且键盘可达 | 读 `src/components/Container.tsx` 空态分支 + `src/components/VerticalTaskbar.tsx` 常驻新建按钮；`npx vitest run src/components/__tests__/VerticalTaskbar.a11y.test.ts` 绿 |
| RC-15 | C-5 桌面三文件按 v4 改造 | `node desktop/main/window-state.test.js` 绿；`node --check desktop/scripts/smoke-test.js`、`node --check desktop/scripts/dev.js` OK |
| RC-16 | C-6 `tests/conftest.py` 的 cv2 stub 与 dialect shim 原样保留 | `git diff -- backend-services/basic-service/tests/conftest.py` 只有注释变更（v2 实测：仅 1 行 docstring，`rate_limiter` → `thumbnail_service`）。**这个 stub 是无 venv 环境能跑通后端门禁的原因（N-4），删它等于砍掉后端验证能力** |

#### C. 代码质量（CLAUDE.md《Clean Code Guidelines》门限）

| ID | 检查项 | 验证方式 |
|----|--------|----------|
| RC-17 | 新增/重写文件的体量门限（文件 ≤1000 行、函数 ≤60 行、参数 ≤5、嵌套 ≤4） | 实测行数：`localOwner.ts` 12、`constants.py` 20、`GeneralSettingsPanel.tsx` 153、`page.tsx` 136、`Container.tsx` 240、`VerticalTaskbar.tsx` 229、`AppTitleBar.tsx` 177、`TitleBarActions.tsx` 172、`SettingsPage.tsx` 85、`SettingsSidebar.tsx` 183、`http-client.ts` 699 —— 全部达标（v2 已逐条复测命中）。**已知豁免**：`src/lib/i18n.ts` 7129 行（CLAUDE.md 明示"Single large translation file"） |
| RC-18 | 命名一致性：一个概念一个名字 | `settings` / `AppTitleBar` / `TitleBarActions` 三组重命名后无残留旧名：`grep -rn "AdminSettings\|DesktopTitleBar\|HeaderActions" src/` = 0。**【v2 评审实测：当前为 2，见 N-3】** `src/hooks/useTheme.ts:14` 与 `src/hooks/__tests__/useTheme.test.ts:4` 的注释里仍写 `HeaderActions` → **F1 必须改这两行**（改代码，不放宽判据；判据由 B-14 复核） |
| RC-19 | 错误不被吞：删鉴权分支时没顺手删掉 catch/日志 | 读 `src/lib/api/http-client.ts` 的错误分类分支；确认 429 与非 2xx 仍有明确分支 |
| RC-20 | 无残留调试输出 / TODO / 注释掉的代码 | 【v2 修订 R-P2-4】原命令 `grep … $(git diff --name-only -- src/)` 只列**未暂存**改动（漏掉 186 个已暂存条目），且 100+ 文件的命令替换在 Windows 下会超命令行长度、并对已删除文件报错。改用：`git diff HEAD --name-only --diff-filter=d -- src \| tr '\n' '\0' \| xargs -0 grep -n "console\.log\|TODO\|FIXME"`，逐条判断是否本次引入 |
| RC-21 | i18n 键完整：新增面板的所有可见文案都有 en + zh | 读 `GeneralSettingsPanel.tsx` 用到的 `t.*` 键，在 `src/lib/i18n.ts` 的 en/zh 两侧都能找到；无 `t.auth.*` / `t.profile.*` 残留（I-8） |
| RC-22 | 无障碍：改动过的交互元素有可访问名、焦点可见、键盘可达 | 读 `Container.tsx` 空态按钮、`VerticalTaskbar.tsx` 新建按钮、`AppTitleBar.tsx` 窗口控件的 `aria-label` / `title` / `tabIndex`；`VerticalTaskbar.a11y.test.ts` 绿 |

### 4.5 提交切分设计

**输入**：一个混合状态的索引（186 `D ` + 14 `R ` + 7 `RM` 已暂存；108 ` M` + 1 ` D` 仅工作区；
**9** `??` 未跟踪）。【v2 修订 R-P2-1：v1 此处写 8，与 §2.2、§7.2 的 9 不一致】

**输出**：6 个提交，`git status` 归零。

**算法**（每一步都可用 `git status` / 路径集合验证，中途崩溃可从任意步重入，见 §4.6）：

```
step -1  【v2 新增】F0 备份已完成（§11.0）——没有备份不许进入本节
step 0   记录基线路径集合（这是唯一真正守恒的量）：
             { git diff HEAD --name-only ; git ls-files --others --exclude-standard } | sort -u
         实测本仓库 = 346 条路径（325 个 status 条目 + 21 条重命名的另一侧）
step 1   git reset                     # mixed。绝不加 --hard / --keep / --merge
         -> 索引回到 HEAD，工作区**一字未动**，325 条全部变成未暂存/未跟踪
         -> 校验：重算 step 0 的路径集合，必须与基线**逐条相等**
            【v2 评审修订 R-P0-1】不要校验 `git status | wc -l` 相等——它**不守恒**：
            一条 `R old -> new` 在 reset 后裂成 ` D old` + 一条未跟踪项（是否被目录折叠
            还不确定），本仓库 21 条重命名，reset 后条数必然 > 325 且无法预先算准
step 2   for G in G1..G6:
             git add -A -- <G 的路径列表>
             git diff --cached --name-only --no-renames | wc -l   # 确定值，见下表
             git diff --cached --stat | tail -1                   # 人工核对
             git commit -F <仓库外的该组提交信息文件>              # 【v2 E-19】不放 docs/ 内
             git log -1 --stat | head -40                         # 卫生检查
step 3   git status --porcelain | wc -l -> 0
```

**每组的精确路径列表**（可直接粘贴，见 §11.2 的完整命令块）：

| 组 | `git add -A --` 路径 | status 条目 | **门禁值（`--no-renames` 路径数）** | 提交类型 |
|----|----------------------|------------|-----------------------------------|----------|
| G1 | `.gitignore` | 1 | **1** | `chore:` |
| G2 | `ops coverage example-package scripts dev install.sh install.ps1 start.sh kill.sh test_seedance.py` | 54 | **54** | `chore:` |
| G3 | `backend-services` | 121 | **121** | `refactor!:` |
| G4 | `src tests vitest.config.ts vitest.integration.config.ts next.config.js .eslintrc.json` | 132（含 21 重命名） | **153** | `refactor!:` |
| G5 | `desktop` | 10 | **10** | `refactor:` |
| G6 | `README.md README.zh-CN.md CLAUDE.md .claude-index docs` | 7 | **7+**（F 阶段新增文档） | `docs:` |

> 【v2 评审修订 R-P1-7】**门禁只认「门禁值」那一列**：`git diff --cached --name-only --no-renames | wc -l`。
> 它对每条路径独立计数，是确定值；G4 的 153 = 132 − 21 + 21×2。
> 带 rename 配对的计数（`git status` 条目数、不加 `--no-renames` 的 `--name-only`）**不是确定值**——
> 相似度低于阈值的"重命名 + 修改"会退化成 `A` + `D`，本仓库 G4 恰有 7 条 `RM` 属于这种情形。
> 六组门禁值合计 **346**，与 step 0 的基线路径集合大小一致，这是第二重交叉校验。
>
> **每个 pathspec 都必须能解析**——`git add -A -- a b c` 只要有一个 pathspec 匹配不到任何东西
> 就整条中止、一个字都不暂存。v2 已逐个实测：24 个 pathspec 在 `HEAD` 里全部 ≥ 1 命中
> （G2 的 10 个合计正好 `17+15+14+2+1×6 = 54`），reset 后索引 = HEAD，故不会中止。

> G6 的条数会 > 6：本轮新增的 `docs/plans/desktop-only-refactor-finalization/spec.md`、
> `residual-actions.md` 与 v4 spec 的追加节都落在这一组。

**重命名保序校验**（G4 提交后必跑）：

```bash
git show --stat -M HEAD | grep -c "=>"      # 期望 ≥ 14
```

【v2 评审修订 R-P1-7】判据从「≈ 21」放宽为「**≥ 14，且缺口须逐条解释**」：14 条纯 `R `（只改路径
未改内容）必然被识别为 rename；7 条 `RM`（重命名 + 内容修改）是否配对取决于相似度阈值，
**不是确定值**，退化成"删一个加一个"不构成错误，只是 diff 可读性下降。
若结果 **< 14**，才说明重命名被真正拆散了（多半是 G4 的路径列表漏了 `src`）——
此时 `git reset --soft HEAD~1` 重做该组（`--soft` 保留索引与工作区，安全）。

**卫生黑名单**（每次提交后必查，命中即 `git reset --soft HEAD~1` 修正后重提）：

```
.next/            __pycache__/      *.pyc          tsconfig.tsbuildinfo
.idea/            coverage/         node_modules/  data/*.db
.msg-G*.txt       scripts-tmp/      .pytest_cache/
backend-services/basic-service/static/uploads/     desktop/release/  desktop/build/
```

> 【v2 评审新增 R-P1-2 / R-P1-3】黑名单里的 `.msg-G*.txt` 与 `scripts-tmp/` 是本轮**自己会造出来**
> 的两类污染：前者是提交信息临时文件（E-19 已改为写仓库外），后者是 §11.1 原本建议的扫描脚本
> 落点。两者都不被 `.gitignore` 覆盖，且都会被 `git add -A -- docs` / 六组之外的残留检查捕获成
> "提交完成后 `git status` 不为 0"。最省事的做法是**根本不在仓库内创建它们**。

### 4.6 崩溃恢复协议（本轮存在的直接原因）

上一轮就是死在这一步。任何节点在 C 阶段中途崩溃后，**继任者第一件事是判定"提交到哪一步了"**，
而不是重头再来：

```bash
git log --oneline -8
```

| 观察到的 HEAD | 结论 | 下一步 |
|---------------|------|--------|
| `37719be feat: multi-keyframe...` | 一个都没提交 | 从 §4.5 step 0 开始 |
| 顶上有 1..5 条本轮提交 | 提交到第 N 组 | **不要 reset 已提交的**，从第 N+1 组继续 `git add -A -- <路径>` |
| 顶上有 6 条本轮提交 且 `git status` 非空 | 有组漏加 | 把剩余条目归入最贴切的一组，用 `git commit --amend` 或追加一个 `fix:` 提交 |
| 顶上有 6 条且 `git status` 空 | C 阶段已完成 | 直接进 V 阶段 |
| 任意状态 + **怀疑工作区内容已损坏** | 【v2 新增】这是 F0 备份存在的唯一理由 | `git stash branch` / `git checkout <备份 tag> -- <路径>` 定点恢复；未跟踪文件从仓库外副本拷回。**仍然不许** `reset --hard` / `checkout .` |

**恢复期绝对禁止的动作**（重复三遍是因为上一轮真的差点发生）：
`git reset --hard`、`git checkout .`、`git restore .`（无路径）、`git clean -fd`、
`git stash`（即 `git stash push`，会把未跟踪文件卷走）、`git add -A`（无路径，会把 `.next/`
打包产物一起提交）。

> 【v2 评审澄清 R-P0-2】上面禁的是 `git stash` / `git stash push`。**`git stash create` 不在此列**——
> 它只创建一个游离 commit 并把 SHA 打到标准输出，**不修改工作区、不修改索引、不写 stash ref**，
> 是本方案唯一推荐的备份原语（E-15 / §11.0）。两者名字像，语义完全不同，不要混用。

---

## 5. 文件 / 模块变更计划

> 本轮**不产生新的产品代码**（除非 R 阶段发现 P0/P1 缺陷）。下表列出本轮会创建或修改的每一个文件。

### 5.1 本节点（#0 方案设计）产出

| 文件 | 动作 | 一句话意图 |
|------|------|------------|
| `docs/plans/desktop-only-refactor-finalization/spec.md` | **新建**（v1） | 本文档：收尾轮的评审 / 修复 / 提交 / 验证方案 |
| 同上 | **v2 修订**（评审节点 #1） | 插入《评审记录（Review Notes · v2）》、把 2×P0 + 8×P1 改入正文、追加《评审结论（Review Verdict · v2）》。**评审记录直接写在本文档内**，因此 §5.2 里的 `review-notes.md` 不再需要单建 |

### 5.2 F 阶段（开发节点）产出

| 文件 | 动作 | 一句话意图 |
|------|------|------------|
| `docs/plans/desktop-only-refactor-finalization/residual-actions.md` | **新建** | 登记 U-7/U-8/U-9 与人工走查移交项；字段规范见 §5.4 |
| `docs/plans/desktop-only-refactor/spec.md` | **追加一节**（不改既有内容） | 尾部追加《收尾轮记录（Endgame Notes）》：A3′/A4′/A5′/C-3′ 的判据改写、U-2/U-3 的真实结论、R 阶段缺陷清单的处置 |
| `docs/plans/desktop-only-refactor-finalization/review-notes.md` | 【v2 修订】**不再单建** | 方案评审记录已写在本文档的《评审记录（Review Notes · v2）》里；F 阶段若还要记 RC-1..RC-22 的逐项 pass/fail，追加到 `residual-actions.md` 或 runlog 即可 |
| `src/hooks/useTheme.ts`（第 14 行注释） | **修改** | 【v2 评审 R-P1-1 / N-3】`HeaderActions` → `TitleBarActions`，让 RC-18 判据真正成立 |
| `src/hooks/__tests__/useTheme.test.ts`（第 4 行注释） | **修改** | 同上 |
| 仓库外（scratchpad）：`.msg-G1..G6.txt` | 新建 | 【v2 评审 E-19】六条提交信息全文，`git commit -F` 读它。**不得**落在 `docs/` 内，否则被 G6 提交进历史 |
| *（条件性）* R 阶段判定为 P0/P1 的其它源码文件 | 修改 | 仅限修复评审缺陷；每修一处必须留"问题 → 证据 → 修法 → 验证"四段 |

### 5.3 C 阶段（提交节点）产出

| 文件 | 动作 | 一句话意图 |
|------|------|------------|
| `.git/` 历史 | 新增 6 个提交 | §4.5 的 G1..G6 |
| `docs/plans/desktop-only-refactor-finalization/commit-evidence.md` | 新建（可选） | 六条提交的 `git log -1 --stat` 摘要与门禁输出留档；若直接写进 runlog 可省 |

### 5.4 `residual-actions.md` 字段规范（下游照抄即可）

每条残留动作一个小节，必须包含五个字段：

```markdown
### RA-<n> · <一句话标题>

- **严重度**：P0 / P1 / P2
- **来源**：F-1 / I-1 / U-7 …（可追溯到黑板或 v4 spec 的编号）
- **为什么本轮不做**：一句话，必须是"范围外"或"需人工/需环境"，不接受"来不及"
- **由谁做**：人工运维 / 独立工作项 / 环境修复
- **验收方式**：一条可执行命令或一个可观察事实
```

**必须登记的条目（至少 5 条）**：

| ID | 标题 | 严重度 |
|----|------|--------|
| RA-1 | 轮换 `ops/key/inkclaw-singpore-260322.pem` 对应的生产 SSH 私钥（删文件不清 git 历史，密钥仍然泄露） | **P0** |
| RA-2 | 后端 82 个既有失败 + 19 个 collection error 的独立修复立项（HEAD 基线 98/19，与本次重构无关） | P1 |
| RA-3 | `npm run lint` 的 8 个既有 error（`AudioSearchModal`/`ImageSearchModal`/`VideoSearchModal` 的 `no-empty-object-type`，`MaterialsPanel`/`WatermarkRemovalModal` 的 `unescaped-entities`，`ImageUploadInput` 的 `no-restricted-syntax`） | P2 |
| RA-4 | 3 个既有 vitest 失败（`backend-proxy` T2/T18、`cachePlayback` 端到端），已用 HEAD 源码逐个复现 | P2 |
| RA-5 | 本机 OpenCV 二进制损坏导致 `python -c "import app.main"` 恒失败（环境问题） | P2 |
| RA-6 | `CLAUDE.md:149` 记载的提交风格（`[add]/[modify]`）与最近 180+ 个提交的 Conventional Commits 实践不符 | P2 |
| RA-7 | §10.3 桌面走查的人工子集（第 2/3/4/5/6/7/8/11 条）移交人工验收 | P1 |
| RA-8【v2 新增】 | *（条件性）* V5 的产物验证若判负（`test:integration` 全 skip、`build:dir` 或 `smoke-test.js` 失败），按残留项登记并写清真实原因；**不回滚已落地的六个提交**（B-10 修订条款） | P1 |

---

## 6. 接口设计（Interface Design）

### 6.1 应用接口：本轮零变更

本轮不新增、不修改、不删除任何 HTTP 端点、Electron IPC 通道或 npm script。
v4 spec §6 描述的接口形态即为最终形态。复核命令：

```bash
find src/app/api -name route.ts | wc -l                       # → 103，与 v4 §5-P4 一致
grep -rn "ipcMain.handle\|ipcMain.on" desktop/main/index.js   # 通道清单应与 v4 §6.3 一致
python -c "import json;print(json.load(open('package.json',encoding='utf-8'))['scripts'])"
```

### 6.2 门禁命令契约

本轮真正的"接口"是门禁命令。每条门禁必须给出**命令 → 期望 → 证据落盘位置**三元组：

| 阶段 | 命令 | 期望 | 证据落盘 |
|------|------|------|----------|
| **F0** | `git tag endgame-backup-<ts> $(git stash create)` | `git cat-file -t <tag>` = `commit` | runlog note，记 tag 名与 SHA |
| **F0** | 把 9 个未跟踪路径拷到仓库外 | 副本文件数与源一致 | runlog note |
| F | `npx tsc --noEmit` | exit 0 | runlog result，`--metric tsc_exit=0` |
| F | `npm run lint` | 无**新增** error（基线 `37719be` 实测 8 个，见 RA-3） | runlog note，贴 error 列表 |
| F | `npm test`（`vitest run`） | 相对上一轮的 `1808 passed / 3 failed` **零新增失败** | runlog result，`--metric vitest_failed=<n>` |
| F | `npm run build` | exit 0 且 `.next/standalone/server.js` 存在 | runlog note |
| F | `python -m pytest tests/ -q`（在 `backend-services/basic-service/`） | 收集不因本次改动而报错；失败集合 ⊆ 基线 `37719be`（A4′） | runlog result，`--metric pytest_failed=<n>` |
| F | `python -m pytest tests/test_no_auth_surface.py tests/test_local_owner_claim.py tests/test_local_owner_materials_listing.py tests/test_thumbnail_service.py tests/security/ -q` | `155 passed / 2 skipped / 0 errors`（**v2 实测复现：`155 passed, 2 skipped, 25 warnings in 16.87s`，无 venv，用环境解释器**） | runlog result |
| F | `node desktop/main/window-state.test.js` | 全绿 | runlog note |
| F | v4 §10.5 悬挂引用扫描（**用 `python -c` 或仓库外脚本**，不要建 `scripts-tmp/`） | `dangling=0` | runlog note |
| **C** | 六组 `git add` + `git commit`（§11.2） | 每组 `--no-renames` 条数命中 §4.5 表 | runlog note |
| **V** | `npm run test:integration` | 真跑；跑不起来则显式声明原因（C-7 二选一）。**全 skip 记 `inconclusive`，不得记 `ok`** | runlog result，`--status ok\|inconclusive` |
| **V** | `cd desktop && npm run clean` | **建议**（清 `release/`），非必须——见 N-2 的 v2 修订 | runlog note |
| **V** | `cd desktop && npm run build:dir` | 产出 unpacked 目录 | **长任务（含 CPython 组装 + `pip install`，需网络），必须先 `wait_async`** |
| **V** | `node desktop/scripts/smoke-test.js` | 通过（含"匿名请求项目列表 200"断言） | runlog result |

> 【v2 评审修订 R-P0-2 / E-16】表里的 **阶段** 列是本轮唯一的时序契约：F 只跑**静态**门禁
> （它们验证这批 diff 本身，是提交信息要引用的证据），产物验证（集成测试 / 打包冒烟）
> 一律排到 **C 之后**。理由见 §4.1「为什么静态门禁在 C 之前、产物验证在 C 之后」。
>
> 【v2 评审修订 R-P1-8 / N-4】后端命令**若存在 venv 则先激活，否则直接用环境解释器**。
> 本机实测无 `backend-services/basic-service/venv`，环境解释器可正常跑通全部后端门禁；
> `tests/conftest.py` 的 cv2 stub 就是为这种环境写的（RC-16 必须保住它）。

> ⚠️ **Windows 执行提示**：`grep -rn ... desktop/` 会递归进 `desktop/node_modules/` 与
> `desktop/release/`（数十万文件），实测会跑到超时。所有对 `desktop/` 的 grep 必须显式限定到
> `desktop/main`、`desktop/preload`、`desktop/scripts`，或改用 ripgrep（默认遵守 `.gitignore`）。

### 6.3 提交信息契约（六条全文，可直接使用）

> 统一要求：首行 ≤ 72 字符、祈使语气、英文；正文中文/英文皆可但必须说明"为什么"；
> 破坏性变更用 `!`；每条都要带上本轮的证据摘要。落盘方式建议
> `git commit -F <文件>`，避免 PowerShell/cmd 对多行字符串的解释差异。
> 各节点按各自 harness 的要求追加署名 trailer（本仓库约定：`Co-Authored-By:` 行）。

**G1**
```
chore: ignore coverage and run artifacts, drop the ops config exception

`coverage/` was tracked by mistake — it is a `vitest --coverage` build product.
`/logs/`, `.run-log/` and `.claude-index/graph.json` are equally machine-generated.
The `!ops/config.env` negation is dropped along with the whole `ops/` tree: the
project no longer has a server deployment path.
```

**G2**
```
chore: remove the server-deployment and sample-code trees

Ecliptrix ships as a single-user Electron desktop app; nothing here is reachable
from the packaged product:
  ops/            systemd units, nginx template, deploy/healthcheck/uninstall scripts
  install.sh|.ps1, start.sh, kill.sh   server bootstrap wrappers
  coverage/       tracked build output
  example-package/, dev/, scripts/, test_seedance.py   scratch and sample code

SECURITY: ops/key/inkclaw-singpore-260322.pem was a git-tracked production SSH
private key. Deleting the file does NOT purge it from history — the key MUST be
rotated. Tracked as RA-1 in docs/plans/desktop-only-refactor-finalization/
residual-actions.md.
```

**G3**
```
refactor!: drop the multi-user surface from the backend

There is no login, session, RBAC or rate-limit console any more: the backend binds
to 127.0.0.1 and has exactly one owner, the compile-time LOCAL_OWNER_ID in
app/constants.py. Auth dependencies, auth/rate-limit middleware, the user/session/
login-history models and the whole Alembic chain are gone; the schema is built by
create_all plus an idempotent UPDATE that claims pre-refactor rows for the local
owner. NO destructive DDL runs at startup — two past incidents came from exactly
that, so removing a model means dropping it from the ORM and leaving the table
behind as inert data.

Material listing stays deliberately permissive (it enumerates every legacy
user_<uuid> directory) so an upgrading install does not lose its library.
Per-IP throttling in media_proxy_service and the 429 contract are untouched.

Regression guards added: test_no_auth_surface.py, test_local_owner_claim.py,
test_local_owner_materials_listing.py.

BREAKING CHANGE: server deployments are unsupported; there is no user system.
```

**G4**
```
refactor!: converge the frontend on the single-user desktop shell

Login page, landing page, profile, user management and the rate-limit console are
gone, together with useAuth / AuthProvider / SESSION_TOKEN_KEY and the three auth
error classes. src/lib/localOwner.ts now mirrors the backend LOCAL_OWNER_ID (the
two values MUST stay identical). http-client injects no credentials and the BFF
proxy forwards none — but RateLimitError and the 429 branch stay, because
media-proxy still throttles per IP; a new no-auth-surface test pins both halves.

page.tsx is rewritten as title bar + task bar + workspace. Closing the last tab is
no longer a dead end: the empty state is a real <button> and the task bar carries
a permanent "new task" pair, both keyboard reachable.

AdminSettings/ is renamed to settings/ and regrouped into 3 sections; the new
General panel owns language and theme (auto follows matchMedia).

BFF routes: 122 -> 103. next.config.js emits standalone unconditionally.

BREAKING CHANGE: the browser dev path no longer has any authentication.
```

**G5**
```
refactor: remove the desktop credential bridge

The main process no longer generates, stores, forwards or self-heals root/admin
credentials: no ROOT_USERNAME/ROOT_PASSWORD injection in dev.js or prepare-env.js,
no getBootstrapCredentials IPC, no BootstrapCredentials type. smoke-test.js now
asserts an anonymous project-list request returns 200, which proves both that the
auth layer is gone and that the SQLite file is readable.
```

**G6**
```
docs: describe Ecliptrix as the single-user desktop app it now is

README, README.zh-CN, CLAUDE.md and the project index no longer mention
PostgreSQL, Alembic, install.sh, login or user management. CLAUDE.md's Auth
section now matches app/constants.py, and the plan documents for this refactor
(docs/plans/desktop-only-refactor/ and .../desktop-only-refactor-finalization/)
are checked in so the "why" survives.
```

### 6.4 黑板 / runlog 记录契约

下游节点必须写入的结构化记录（供人工审计与后续轮次复用）：

| kind | id | 何时写 | data 要点 |
|------|----|--------|-----------|
| `finding` | `F-20`.. | R 阶段每发现一个缺陷 | `{sev, status, title}`，`title` 里必须含文件:行号 |
| `finding` | `F-8` `F-19` | C 阶段完成后**更新** | `status` 改为 `fixed`（工作区已提交，风险解除） |
| `design` | `D-SPEC-FINAL` | 本节点 | `{path, feature, phases, note}` |
| runlog `result` | — | 每条门禁跑完 | `--status ok\|fail\|partial\|inconclusive` + `--metric` |
| runlog `note` | — | 每个阶段结束 | 阶段摘要 |

---

## 7. 数据模型（Data Model）

### 7.1 应用数据模型：本轮零变更

本轮不碰 ORM、不碰 schema、不碰迁移。复核点（R 阶段 RC-3/RC-4）：

- 建表方式：`Base.metadata.create_all`（无 Alembic，`backend-services/basic-service/alembic/` 已整目录删除）。
- 演进方式：**只允许追加**。启动时**不得**出现 `DROP TABLE` / `DROP COLUMN` / `ALTER ... DROP`
  —— 这是本项目历史上最贵的两次生产事故的直接成因（F-2）。
- `user_id` 列**保留但不再是身份**：所有业务表的 `user_id` 恒为 `LOCAL_OWNER_ID`；
  升级路径是启动时一条**幂等 UPDATE** 认领历史行，重复执行结果一致。
- 文件系统侧：**读放宽、写收敛**（D13）。写入统一落到 `LOCAL_OWNER_ID` 目录，
  列表侧枚举**全部** `user_*` 目录 —— 少了这一半，老用户升级后素材库会整片消失。
- 前端持久化：`localStorage` 的主题 / 语言 / 任务态；不存在任何 token 或 session 键。

### 7.2 本轮真正的状态机：git 索引

| 状态 | 条目数 | 触发动作 | 迁移到 |
|------|--------|----------|--------|
| S0 混合索引（`D `186 / `R `14 / `RM`7 / ` M`108 / ` D`1 / `??`9） | 325 条目 / **346 路径** | 记录基线路径集合（§4.5 step 0） | S1 |
| S1 已记录基线 | 同上 | `git reset`（mixed） | S2 |
| S2 全量未暂存（**工作区一字未动**） | 条目数 **> 325 且不确定**；**路径集合仍为 346** | `git add -A -- <G1 路径>` | S3(G1) |
| S3(Gn) 第 n 组已暂存 | 该组的 `--no-renames` 门禁值 | `git commit -F <仓库外 msg>` | S2′（剩余组）或 S4 |
| S4 全部提交完毕 | 0 | — | 终态 |

> 【v2 评审修订 R-P0-1】S1→S2 的条目数**不守恒**：一条 `R old -> new` 在 mixed reset 后裂成
> ` D old` 加一条未跟踪项（是否被目录折叠还不确定）。守恒的是**路径集合**，见下方不变量 1。

**不变量**（每一步都必须成立，破了立即停手）：

1. **工作区文件内容在 S0→S4 全程零变化**（提交只改索引与 HEAD）。校验：
   `git diff HEAD --stat` 在 S4 时为空；且 S1 与 S2 的**路径集合**
   `{ git diff HEAD --name-only } ∪ { git ls-files --others --exclude-standard }`
   逐条相等（实测 **346** 条）。
   **【v2 评审修订 R-P0-1】不要用 `git status --porcelain | wc -l` 守恒来校验——它是假命题。**
   已用一次性 scratch 仓库实证：3 条重命名在 reset 前是 3 行、reset 后是 4 行。
2. 六组路径**互不相交且并集 = 全集**。算术形式有两个等价写法：
   按 status 条目 `1+54+121+132+10+7 = 325`；按 `--no-renames` 路径 `1+54+121+153+10+7 = 346`。
   v2 已用独立脚本复算：未覆盖 0 条、跨组 0 条。
3. 任一时刻 `.next/`、`__pycache__/`、`tsconfig.tsbuildinfo`、`.idea/`、`desktop/release/`
   **不出现在索引里**。

### 7.3 用户数据兼容矩阵（走查第 2 条的判定表）

| 升级前存在 | 升级后期望 | 依赖的机制 |
|-----------|-----------|-----------|
| 旧工程 / 分类 / 分镜包 / 封面（DB 行，`user_id` = 某个 uuid） | 全部可见 | 启动幂等 UPDATE 认领（D2） |
| 旧素材文件（磁盘 `static/uploads/user_<uuid>/…`） | 全部可见 | 列表侧枚举全部 `user_*` 目录（D13） |
| 旧 `userData/.env`（可能含 `ROOT_*`） | 正常启动，多余键被忽略 | `prepare-env.js` 不再读 `LOCAL_ADMIN_KEYS` |
| 旧 localStorage（可能含 session token 键） | 正常启动，多余键被忽略 | 前端不再读任何 token 键 |

---

## 8. 测试与验收标准

### 8.1 门禁矩阵

见 §6.2 的三元组表。补充执行纪律：

- **每条门禁必须贴真实输出**（v4 §3.1 原则 5）。"应该能过"视同未跑。
- 长任务（`npm run build`、`npm run build:dir`、`pytest tests/` 全量）**执行前必须先
  `wait_async` 注册**，或至少在开跑前打印一行标记，避免被调度器判定为挂死
  （上一轮节点 #3 就是死在长任务无输出上）。
- 后端命令一律在 `backend-services/basic-service/` 下执行；**若存在 `venv/` 则先激活，否则直接用
  环境解释器**——本机实测无 venv，环境解释器可跑通全部后端门禁（`155 passed / 2 skipped`，
  16.87s），`tests/conftest.py` 的 cv2 stub 正是为此存在（【v2 评审修订 R-P1-8 / N-4】）。
- **F0 备份未完成之前，不得启动任何长任务**（【v2 评审新增 R-P0-2】）。

### 8.2 本轮验收判据（B-0 .. B-14）

| # | 判据 | 判定方式 |
|---|------|----------|
| **B-0**【v2 新增】 | F0 备份在任何长任务与任何索引操作之前完成 | `git cat-file -t <备份 tag>` = `commit`；仓库外副本含全部 9 个未跟踪路径 |
| **B-1** | 工作区全部变更（§2.2 的 325 条 + F 阶段新增）进入 git 历史，零丢失 | `git status --porcelain \| wc -l` = 0；`git diff HEAD --stat` 空；且提交前后的**路径集合**（346 + F 阶段增量）与 §4.5 step 0 基线一致 |
| **B-2** | 提交切分为 6 条，顺序 G1..G6 | `git log --oneline -6` |
| **B-3** | 提交历史卫生 | `git log -6 --stat \| grep -E "\.next/\|__pycache__\|tsbuildinfo\|\.idea/\|desktop/release\|desktop/build\|\.msg-\|scripts-tmp"` = 0（【v2 评审新增 R-P1-2/R-P1-3】后三项是本轮自己会造出来的污染） |
| **B-4** | 重命名被识别为 rename 而非删加 | 【v2 修订 R-P1-7】`git show --stat -M <G4> \| grep -c "=>"` **≥ 14**（14 条纯 `R ` 必然配对；7 条 `RM` 是否配对取决于相似度阈值，退化不算错误但要在 runlog 里点名）。**< 14 才判负** |
| **B-5** | 提交完成后，HEAD 上前端门禁与提交前一致 | `npx tsc --noEmit` exit 0；`npm test` 失败数 ≤ 3 且集合不变 |
| **B-6** | RC-1..RC-22 全部有结论，P0/P1 全部关闭 | 评审记录逐项可查 |
| **B-7** | A1 / A2 / A5 / A9 判据在 HEAD 上仍成立 | §2.3 命令重跑 |
| **B-8** | A3′ / A4′ / A5′ / C-3′ 四条判据完成自洽化改写并回写 v4 spec | `git show <G6>:docs/plans/desktop-only-refactor/spec.md \| grep -c "A4′"` > 0 |
| **B-9**（V 阶段） | U-2 有真实结论（跑通并贴输出 **或** 显式声明未跑及原因；全 skip 记 `inconclusive`） | runlog result / `residual-actions.md` 可查 |
| **B-10**（V 阶段） | U-3 自动化子集已跑：`build:dir` 成功且 `smoke-test.js` 通过 | runlog result。**【v2 评审修订 R-P2-6】B-9/B-10 判负不回滚已落地的六个提交**——它们验证的是打包产物而不是这批 diff，失败按残留项处理（新增 RA-8），并在 runlog 里如实记 `fail`。**唯一例外**：若 smoke-test 暴露的是本次 diff 引入的功能回归，则按新缺陷立项修复并追加 `fix:` 提交，仍不 revert |
| **B-11** | `residual-actions.md` 存在且至少含 RA-1..RA-7，RA-1（密钥轮换）标注为 P0 | 文件可读 |
| **B-12** | 全程未使用任何禁用命令 | 会话记录可查；工作区零丢失（B-1）是其充分证据 |
| **B-13**【v2 新增】 | 六组之外**零新增未跟踪路径**（防 `scripts-tmp/`、`.msg-G*.txt` 这类自造污染） | 提交完成后 `git status --porcelain` 为空即已覆盖；过程中可随时 `git status --porcelain \| grep -v -E "^(\.gitignore\|ops\|coverage\|example-package\|scripts/\|dev/\|install\|start\.sh\|kill\.sh\|test_seedance\|backend-services\|src\|tests/\|vitest\|next\.config\|\.eslintrc\|desktop\|README\|CLAUDE\|\.claude-index\|docs)"` 自检 |
| **B-14**【v2 新增】 | RC-18 判据在 F1 之后真正成立 | `grep -rn "AdminSettings\|DesktopTitleBar\|HeaderActions" src/ \| wc -l` = **0**（当前为 2，见 N-3） |

### 8.3 判据自洽化：A3′ / A4′ / A5′ / C-3′（正式定义）

> 这四条要**原文写进** v4 spec 尾部的《收尾轮记录》，并注明"取代原 A3 / A4 / A5 / C-3 的字面判据"。

**A3′（前端门禁 · 差分判据）**
> **基线 = commit `37719be`**（本次重构的父提交，即 `feat/remove-user-system` 在重构前的 tip）。
> `npx tsc --noEmit` exit 0；`npm run build` exit 0；
> `npm test` 的失败集合 **不大于** 同一命令在基线 `37719be` 上的失败集合；
> `npm run lint` 的 error 集合 **不大于** 基线 error 集合（基线实测 8 个，全在本次未触碰的文件里）。
> **理由**：原 A3「lint 无 error / test 全绿」在本仓库**从未成立过**（I-6 已用 HEAD 基线实测证明）。
> 恒不可满足的判据只会诱导造假绿灯。
> **【v2 评审修订 R-P1-4】基线必须写死 SHA，不得写 `HEAD`，更不得写 `git merge-base HEAD main`**：
> 实测 `merge-base HEAD main` = `dc25d77` ≠ `37719be`，是一棵**从未被测量过**的更早的树；
> 而 `HEAD` 在六个提交落地后就不再指向 `37719be`。取基线的方法：
> `git worktree add <仓库外目录> 37719be`（I-1/I-6 就是这么做的），用完 `git worktree remove`。

**A4′（后端门禁 · 差分判据）**
> **基线 = commit `37719be`**（同 A3′，【v2 评审修订 R-P1-4】）。
> `pytest tests/ -q` 能**整体收集**——精确含义是【v2 评审修订 R-P2-5】：
> **不存在因本次改动而新增的 collection error**（如 `import app.dependencies.auth` 这类 ImportError）。
> 基线自带的 19 个 **error 是 fixture/运行期错误，不是 collection error**，它们照旧存在、照旧计入
> "失败集合 ⊆ 基线"这一侧，不与"能整体收集"冲突。且失败集合 **不大于** 同一命令在基线上的失败集合。
> 基线实测：`37719be` = 98 failed / 1175 passed / 19 errors；
> 本次重构后 = 82 failed / 1020 passed / 19 errors（失败减少 16 个；passed 下降是因为随用户系统
> 删掉了约 155 个鉴权/限流用例）。
> **禁止**用 `skip` / `xfail` 制造差值（v4《评审结论》「不通过情形 2」）。

**C-3′（鉴权错误类清除 · 排除负向断言）**
> `grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/` 的命中**必须全部位于
> `src/lib/api/__tests__/no-auth-surface.test.ts`**（护栏测试的负向断言）；
> 且 `grep -c "RateLimitError" src/lib/api/http-client.ts` > 0。
> **理由**：与 A1 的 P1-7 修订同口径。护栏测试正文里必然写着这些符号名——那正是它的作用。
> 实测当前 4 命中，全在该文件（第 7/29/30/31 行）。

**A5′（桌面凭证桥归零 · 源码口径）**
> `rg "getBootstrapCredentials\|ROOT_PASSWORD\|ROOT_USERNAME\|ADMIN_PASSWORD\|BootstrapCredentials"`
> 于 **`desktop/main`、`desktop/preload`、`desktop/scripts`、`src/`** = 0；
> `src/types/desktop.d.ts` 无 `BootstrapCredentials`。
> **明确排除**：`desktop/node_modules/`、`desktop/build/`、`desktop/release/` —— 三者都是
> `.gitignore` 覆盖的构建产物，不是源码。
> **理由**：原 A5 写的是 `grep -rn ... desktop/`，实测 32 命中，全部来自**上一次打包时拷进
> `desktop/build/backend/` 与 `desktop/release/win-unpacked/resources/backend/` 的旧后端副本**
> （含 `__pycache__`）。判据不该被上一次构建的残留决定。
> **配套动作**【v2 评审修订 R-P1-5】：~~跑 `build:dir` 前必须先 `npm run clean`，否则冒烟测试跑的
> 不是本次代码~~ —— **这条因果是错的，已撤销**。实测 `desktop/scripts/prepare-backend.js:51` 与 `:87`
> 每次 `build:dir` 都 `fs.rmSync` 掉 `build/backend/` 与 `build/python/` 再重建，
> "陈旧后端被打进新包"的机制不存在。`npm run clean` 保留为**建议**动作，真实收益是清掉 `release/`，
> 避免 electron-builder 复用半成品 unpacked 目录（`build.js:173` 在重试路径上自己就这么做）；
> 代价是连 `build/python/` 一起删（`build.js:251-253`），逼出一次完整的 CPython 组装 + `pip install`
> （需网络、分钟级）。**A5′ 的路径限定才是 N-2 的正解**，与 clean 与否无关。

### 8.4 桌面走查：自动化子集 vs 人工子集

| 走查项（v4 §10.3） | 本轮处置 |
|---------------------|----------|
| 1 全新安装无登录框直入工作区 | **自动化**：`build:dir` + `smoke-test.js`（匿名 200 断言 + 无登录路由） |
| 9 关窗后子进程全退出 | **自动化**：smoke-test 的关闭流程 |
| 10 日志不含口令/令牌字样 | **半自动**：`grep -riE "password\|token\|secret" <userData>/logs/` = 0 |
| 2 升级后旧工程 + 旧素材全部可见 | 人工（需旧 `userData/`）→ RA-7 |
| 3 导入视频 → 时间线 → 预览有画面有声音 → 可 seek | 人工 → RA-7 |
| 4 TTS → 素材库 → 音频轨 → 可听 | 人工 → RA-7 |
| 5 导出后 ffprobe 与重构前比对 | 人工 → RA-7 |
| 6 设置默认落"通用"，切语言/主题即时生效且重启保持 | 人工 → RA-7 |
| 7 模型与凭证保存后齿轮琥珀点消失 | 人工 → RA-7 |
| 8 标题栏四动作 + 双击品牌区 | 人工 → RA-7 |
| 11 零死路：关光标签页后空态可点、键盘可达 | **静态守卫**：`VerticalTaskbar.a11y.test.ts` + RC-14；交互部分人工 → RA-7 |

### 8.5 提交后验证（V 阶段）

```bash
git status --porcelain | wc -l            # → 0                                   (B-1/B-13)
git log --oneline -6                      # → G1..G6，顺序正确                     (B-2)
git diff HEAD --stat                      # → 空（工作区与 HEAD 一致）              (B-1)
git log -6 --stat | grep -E "\.next/|__pycache__|tsbuildinfo|\.idea/|desktop/release|desktop/build|\.msg-|scripts-tmp" | wc -l   # → 0   (B-3)
git show --stat -M <G4 的 SHA> | grep -c "=>"   # → ≥ 14                            (B-4)
npx tsc --noEmit                          # → exit 0                               (B-5)
npm test                                  # → 失败数与提交前一致（≤ 3，且是同样那 3 个）(B-5)
grep -rn "AdminSettings\|DesktopTitleBar\|HeaderActions" src/ | wc -l   # → 0     (B-14)
cd backend-services/basic-service && python -m pytest tests/test_no_auth_surface.py \
  tests/test_local_owner_claim.py tests/test_local_owner_materials_listing.py \
  tests/test_thumbnail_service.py tests/security/ -q     # → 155 passed / 2 skipped  (B-5 后端侧)
```

> 【v2 评审新增】以上全部通过后，才进入 V5 的产物验证（`test:integration`、`build:dir` +
> `smoke-test.js`）。产物验证失败**不回滚**这六个提交（B-10 的修订条款）。
> V6 收口确认无误后，可以删除 F0 留下的备份 tag：`git tag -d endgame-backup-<ts>`。

---

## 9. 风险与缓解

| ID | 风险 | 影响 | 缓解 |
|----|------|------|------|
| **RE-1** | 误用 `git reset --hard` / `checkout .` / `clean -fd` 清空工作区 | **灾难性且不可恢复**：两个节点 2 小时产出归零，重构需完全重做 | §0 与 §4.6 三处显式禁令；§4.5 只用 mixed reset；每步后 `git status \| wc -l` 校验条数守恒 |
| **RE-2** | `git add -A`（无路径）把 `.next/`、`__pycache__/`、`desktop/release/` 提交进历史 | 仓库膨胀数百 MB，且难以清理 | 六组全部用 `git add -A -- <显式路径>`；每次提交后跑卫生黑名单检查（§4.5） |
| **RE-3** | 提交切分把 21 条重命名拆散，diff 退化成"删 19 加 19" | 评审成本翻倍，历史可读性下降 | 三组重命名全在 `src/` → 天然同组；G4 提交后跑 B-4 校验；不达标用 `git reset --soft HEAD~1` 重做 |
| **RE-4** | 节点再次崩溃在 C 阶段中途 | 半提交状态，继任者不知从哪继续 | §4.6 崩溃恢复协议：用 `git log --oneline -8` 判定进度，从下一组续做，**不重头来** |
| **RE-5** | 长任务（`build:dir`、全量 pytest）无输出被调度器判定挂死 | 节点被强杀，重演上一轮 | 开跑前 `wait_async` 注册或打印进度标记；每 5–10 分钟 `progress` |
| **RE-6** | 为了让 A3/A4 变绿而 skip/xfail 既有失败 | 造假绿灯，掩盖真实腐化 | A3′/A4′ 差分判据（§8.3）；v4《评审结论》「不通过情形 2」；E-11 |
| **RE-7** | 评审节点顺手"优化"已落地的 P0–P7 | 引入未经评审的新变更，破坏 E-1 | R 阶段严格只读（§4.1）；任何改动必须走 F 阶段并留四段记录 |
| **RE-8** | `grep -rn ... desktop/` 递归进 `node_modules`/`release` 导致命令超时 | 门禁跑不完，误判为失败 | §6.2 的 Windows 提示：显式限定到 `desktop/{main,preload,scripts}` 或用 ripgrep |
| **RE-9** | 中间提交不单独绿，未来 `git bisect` 落进区间被误判 | 排障时浪费时间 | E-3：在 G3/G4 提交信息里明说是原子重构切片；E-13：回滚用区间 revert |
| **RE-10** | `RateLimitError` / 429 分支在收尾时被"顺手清理" | media-proxy 的限流退化（v2 已踩过一次） | RC-7 + `no-auth-surface.test.ts` 正向断言 + C-3′ 的反向判据，三重保险 |
| **RE-11** | 生产 SSH 私钥已泄露在 git 历史里，删文件给人"已处理"的错觉 | 生产主机可被登录 | RA-1 标 P0；G2 提交信息里**显式写明必须轮换**，让它出现在 `git log` 里而不是只躺在文档里 |
| **RE-12** | `test:integration` 走 skip 分支却被当成"全绿" | 虚假绿灯 | E-9：先尝试真起栈；若全 skip 必须按 `inconclusive` 记录，不得记 `ok` |
| **RE-13** | **9** 个未跟踪路径漏 `git add`，提交出自相矛盾的历史（如后端 docstring 指向不存在的 `localOwner.ts`） | HEAD 不可构建 | 六组 `git add -A -- <路径>` 已覆盖全部 9 条（v2 复算：未覆盖 0）+ B-1（`git status` 归零）+ V4（HEAD 上重跑门禁）。【v2 修订 R-P2-1：v1 写"8 个"，实际 9 个】 |
| **RE-14**【v2 新增】 | 「条数守恒」校验必定失败 → 实施者误判"工作区被人动过" → 动用 `reset --hard` / `checkout .` 试图"恢复" | **灾难性**：与 RE-1 同级，且这条是**方案自己诱发**的 | R-P0-1 已把不变量换成路径集合（§4.5 step 1、§7.2）；§4.6 新增一行明确"怀疑损坏时用备份定点恢复，仍然不许 reset --hard" |
| **RE-15**【v2 新增】 | 唯一副本在被提交之前先穿过 `build:dir`（含 CPython 组装 + `pip install`，需网络、分钟级），节点崩在半路 | 与上一轮 #3 同样的丢盘 | R-P0-2：F0 零风险备份前置 + 产物验证移到 C 之后（E-15/E-16） |
| **RE-16**【v2 新增】 | 本轮自己造出来的临时文件（`.msg-G*.txt`、`scripts-tmp/`）被提交进历史或卡住 `git status` 归零 | 历史脏 / B-1 永远判负 | E-19：提交信息写仓库外；§11.1 扫描脚本改 `python -c`；§4.5 卫生黑名单与 B-3/B-13 都加了这两项 |
| **RE-17**【v2 新增】 | 差分判据的基线取错（`HEAD` 漂移、`merge-base` 指向未测量过的树），把"零新增回归"证成假命题 | 结论不可信 | E-18：A3′/A4′ 基线钉死 `37719be`，取基线用 `git worktree add <仓库外目录> 37719be` |

---

## 10. 实施顺序与回滚

### 10.1 严格串行的执行序

```
[R]  R1 现状复核（§11.1）           gate: 与 §2.2/§2.3 一致；不一致先查清，
                                         **不许用 reset/checkout 去"修"**
     R2 RC-1..RC-22                 gate: 每项有 pass/fail + 证据
     R3 缺陷分级                    gate: P0/P1 清单成文
[F]  F0 零风险备份（§11.0）         gate: B-0 —— tag 指向一个 commit 对象，
                                         且仓库外副本含全部 9 个未跟踪路径
                                         **没有 F0 不许进 F1**
     F1 修 P0/P1（含 N-3 两行注释） gate: 每处四段记录（问题→证据→修法→验证）；B-14
     F2 判据自洽化 + 回写 v4 spec   gate: A3'/A4'/A5'/C-3' 四条原文入档（B-8）
     F3 residual-actions.md         gate: RA-1..RA-8 齐备，RA-1 标 P0（B-11）
     F4 静态门禁重跑                gate: §6.2 表中 阶段=F 的每一行逐条贴输出
[C]  C0 再复核工作区                gate: **路径集合**与 §4.5 step 0 基线相等（不是条数）
     C1 git reset（mixed）
     C2..C7 六组提交                gate: 每组 --no-renames 条数命中 §4.5 表；
                                         每组 git log -1 --stat 卫生检查
[V]  V1..V4 提交自洽性              gate: §8.5 命令块全部符合期望
     V5 产物验证（U-2 / U-3）       gate: 有真实结论；判负记 RA-8，**不回滚提交**
     V6 runlog + 黑板更新           gate: F-8 / F-19 / F-22 状态改为 fixed；
                                         确认无误后删除 F0 的备份 tag
```

### 10.2 回滚

- **C 阶段中途要撤某一组**：`git reset --soft HEAD~1`（保留索引与工作区），修正后重提。
  **只允许 `--soft`**。
- **全部提交完成后要整体回滚**：`git revert --no-commit <G1>^..<G6>` 然后一次性提交
  （E-13：六个提交是一次原子重构，单独 revert 其中一个会造出前后端不一致的状态）。
- **【v2 评审新增 R-P2-6】产物验证判负不是回滚理由**：`npm run test:integration` 全 skip、
  `build:dir` 失败或 `smoke-test.js` 不过，都**不构成** revert 六个提交的理由——它们验证的是
  打包产物而非这批 diff，且此时工作区已不再是唯一副本，回滚只会让唯一一份可审计的历史消失。
  处置方式是登记 RA-8 + runlog 记 `fail`；若确认是本次 diff 引入的功能回归，则追加一个 `fix:`
  提交修复，仍然不 revert。
- 数据层无 DDL 变更，回滚不涉及数据迁移；`userData/` 不受影响。

---

## 11. 附录：实施者速查

### 11.0 【v2 评审新增】零风险备份（F0 · 本轮第一条命令）

> **在此之前不要跑任何长任务、不要碰 git 索引。** 工作区里躺着两个节点 2 小时的唯一副本，
> 而 v1 的全部缓解措施只有"禁令"。下面两步几秒钟就能把"唯一不可逆风险"变成可逆。

```bash
cd M:/takoAI/Ecliptrix

# ── ① 把全部**已跟踪**改动（含已暂存的 186 个删除与 21 条重命名）钉成一个游离 commit。
#     git stash create 不修改工作区、不修改索引、不写 stash ref —— 与 git stash push 完全不同。
BK=$(git stash create)
echo "$BK"                                  # 必须打印出一个 40 位 SHA；空字符串 = 没有可保存的改动
git tag endgame-backup-20260901 "$BK"       # 打成真 ref，免于 gc
git cat-file -t endgame-backup-20260901     # 期望：commit          ← B-0 的判据

# ── ② 未跟踪文件不会进 stash，另拷一份到**仓库外**（下面的目录换成你自己的 scratchpad）
BKDIR="$TEMP/ecliptrix-endgame-backup"
python -c "import os,shutil,sys; d=os.environ['BKDIR']; shutil.rmtree(d,ignore_errors=True)"
git ls-files --others --exclude-standard | python -c "
import os, shutil, sys
dst = os.environ['BKDIR']
n = 0
for line in sys.stdin.read().splitlines():
    if not line:
        continue
    out = os.path.join(dst, line)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    shutil.copy2(line, out)
    n += 1
print('copied', n, 'untracked files to', dst)
"
# 期望：copied N ... ，N 与 `git ls-files --others --exclude-standard | wc -l` 相等  ← B-0 的判据
```

**恢复方式**（只在确认工作区被破坏时使用，**永远不要**用 `reset --hard` / `checkout .`）：

```bash
git stash branch endgame-restore endgame-backup-20260901   # 已跟踪改动整体复原到新分支
# 或定点恢复单个文件：
git checkout endgame-backup-20260901 -- <路径>
# 未跟踪文件：从 $BKDIR 拷回
```

**清理**：V6 收口确认六个提交都在、`git status` 归零之后，
`git tag -d endgame-backup-20260901` 并删掉 `$BKDIR`。在此之前**不要删**。

---

### 11.1 现状复核（动手前必跑，与 §2.2 / §2.3 比对）

```bash
cd M:/takoAI/Ecliptrix
git log --oneline -1                                 # 期望 37719be（C 阶段之前）
git rev-parse --abbrev-ref HEAD                      # 期望 feat/remove-user-system
git status --porcelain | wc -l                       # 期望 >= 325（F1 修完 N-3 后为 327）
git status --porcelain | awk '{print substr($0,1,2)}' | sort | uniq -c
git diff --cached --shortstat                        # 期望 207 files, 35371 deletions
git diff --shortstat                                 # 期望 116 files, +2191 -5215
git status --porcelain | grep '^??'                  # 期望 9 条，与 §2.2 清单一致
find src/app/api -name route.ts | wc -l              # 期望 103

# 【v2 评审新增 R-P0-1】唯一真正守恒的量：路径集合（reset 前后必须逐条相等）
{ git diff HEAD --name-only ; git ls-files --others --exclude-standard ; } | sort -u | wc -l
# 期望 346（= 325 个 status 条目 + 21 条重命名的另一侧路径）；F1 修完 N-3 后为 348
```

判据侧（全部期望 0 / 达标）：

```bash
grep -rn "useAuth\|SESSION_TOKEN_KEY\|AuthProvider\|isAuthenticated" src/ --include=*.ts --include=*.tsx | grep -v "__tests__" | wc -l   # 期望 0（实测 0）
grep -rn "get_current_user\|require_admin" backend-services/basic-service/app/ | wc -l                                                    # 期望 0（实测 0）
grep -c "RateLimitError" src/lib/api/http-client.ts                                                                                        # 期望 > 0（实测 13）
ls -d ops install.sh start.sh kill.sh coverage example-package backend-services/basic-service/alembic                                       # 期望全部 No such file

# 【v2 评审修订 R-P1-1 / N-3】这一条**当前是 2，不是 0** —— 两处注释里的旧组件名，F1 修完才归零
grep -rn "AdminSettings\|DesktopTitleBar\|HeaderActions" src/ | wc -l    # F1 之前：2；F1 之后：0（B-14）
```

C-3′ 与 A5（注意限定路径，见 RE-8）：

```bash
grep -rn "MissingAuthError\|SessionExpiredError\|ForbiddenError" src/     # 4 条，必须全在 no-auth-surface.test.ts（第 7/29/30/31 行）
grep -rn "getBootstrapCredentials\|ROOT_PASSWORD\|ROOT_USERNAME\|ADMIN_PASSWORD" desktop/main desktop/preload desktop/scripts src/ | wc -l   # 期望 0（实测 0）
```

悬挂文档引用扫描（A9 ③，期望 `dangling=0`）：把 v4 spec §10.5 的脚本用 `python -c "..."`
单行执行，**或**存到**仓库外**的 scratchpad 再跑（Windows 下不要用 bash heredoc）。

> ⚠️ 【v2 评审修订 R-P1-3】v1 原文建议存成 `scripts-tmp/scan_dangling.py`。**不要这么做**：
> `scripts-tmp/` 不属于 §4.5 的任何一组（G2 的 `scripts` 是精确目录名，不前缀匹配 `scripts-tmp`），
> `.gitignore` 也不覆盖它，结果就是六组提交完成后 `git status` 仍有 1 条 → **B-1 永远判负**。
> 同理，任何本轮自造的临时文件都必须落在仓库外（见 B-13）。

### 11.2 六组提交（精确暂存，可直接粘贴）

> 每一组执行三步：`add` → 核对 → `commit`。核对不通过就**停下**，不要继续。
> 【v2 评审修订 R-P1-2 / E-19】提交信息先用 Python 写进**仓库外**的
> `$MSGDIR/.msg-Gn.txt` 再 `git commit -F`（既避免跨 shell 的多行字符串差异，
> 又不会被 G6 的 `git add -A -- … docs` 收进历史 —— 实测 `git add -A -- <dir>` **会**收走
> 点开头的文件，而"提交完成后删除"来不及，`git commit -F` 正在读它）。
> **前置**：§11.0 的 F0 备份必须已完成（B-0）。

```bash
# ── step 0：记录基线路径集合（唯一真正守恒的量，见 R-P0-1）
MSGDIR="$TEMP/ecliptrix-endgame-msg"        # 提交信息放**仓库外**（E-19）
python -c "import os; os.makedirs(os.environ['MSGDIR'], exist_ok=True)"
{ git diff HEAD --name-only ; git ls-files --others --exclude-standard ; } | sort -u > "$MSGDIR/paths-before.txt"
wc -l < "$MSGDIR/paths-before.txt"            # 期望 346（F1 修完 N-3 后 348）

# ── step 1：mixed reset（绝不加 --hard）
git reset
{ git diff HEAD --name-only ; git ls-files --others --exclude-standard ; } | sort -u > "$MSGDIR/paths-after.txt"
diff "$MSGDIR/paths-before.txt" "$MSGDIR/paths-after.txt" && echo "PATH SET CONSERVED"
# 期望：diff 无输出 + 打印 PATH SET CONSERVED
# 【v2 评审修订 R-P0-1】**不要**校验 `git status --porcelain | wc -l` 相等 —— 它不守恒：
# 21 条重命名在 reset 后各自裂成 ` D 旧路径` + 一条未跟踪项，条数必然变大且无法预先算准。

# ── G1 仓库卫生
git add -A -- .gitignore
git diff --cached --name-only --no-renames | wc -l   # 期望 1
git commit -F "$MSGDIR/.msg-G1.txt"
git log -1 --stat | head -20

# ── G2 非桌面部署工件（纯删除）
git add -A -- ops coverage example-package scripts dev install.sh install.ps1 start.sh kill.sh test_seedance.py
git diff --cached --name-only --no-renames | wc -l   # 期望 54
git commit -F "$MSGDIR/.msg-G2.txt"

# ── G3 后端
git add -A -- backend-services
git diff --cached --name-only --no-renames | wc -l   # 期望 121
git diff --cached --name-status | grep '^D' | wc -l
git commit -F "$MSGDIR/.msg-G3.txt"

# ── G4 前端（含 21 条重命名）
git add -A -- src tests vitest.config.ts vitest.integration.config.ts next.config.js .eslintrc.json
git diff --cached --name-only --no-renames | wc -l   # 期望 153（= 132 条目 − 21 + 21×2）
                                                     # F1 修了 N-3 的两个文件则为 155
git diff --cached -M --name-status | grep -c '^R'    # 参考值，≥ 14 即可，不作停手依据
git commit -F "$MSGDIR/.msg-G4.txt"
git show --stat -M HEAD | grep -c "=>"               # 期望 ≥ 14（B-4）

# ── G5 桌面壳
git add -A -- desktop
git diff --cached --name-only --no-renames | wc -l   # 期望 10
git commit -F "$MSGDIR/.msg-G5.txt"

# ── G6 文档
git add -A -- README.md README.zh-CN.md CLAUDE.md .claude-index docs
git diff --cached --name-only --no-renames           # 逐条肉眼核对：不得出现 .msg-* / scripts-tmp
git commit -F "$MSGDIR/.msg-G6.txt"

# ── 收口
git status --porcelain | wc -l                # 期望 0（B-1 / B-13）
git log --oneline -6
```

> 【v2 评审修订 R-P1-2】提交信息临时文件放在**仓库外**的 `$MSGDIR`，因此不存在"忘了删就被提交
> 进历史"的问题，也不需要为它新增 `.gitignore` 规则。收口后连同 F0 的备份一起清理即可。
>
> **每组 `git add` 之前先确认 pathspec 都能解析**：`git add -A -- a b c` 只要有一个 pathspec
> 匹配不到任何东西就**整条中止、一个字都不暂存**。v2 已逐个实测 24 个 pathspec 在 `HEAD`
> 里全部 ≥ 1 命中，reset 后索引 = HEAD，故正常流程不会中止；若真的报
> `pathspec '…' did not match any files`，说明你不在仓库根目录或上一步的 reset 没生效，
> **查清楚再继续，不要删 pathspec 硬闯**。

### 11.3 门禁命令块

```bash
# ── F 阶段：静态门禁（这些是提交信息要引用的证据）
# 前端（仓库根）
npx tsc --noEmit
npm run lint
npm test
npm run build

# 后端（backend-services/basic-service；有 venv 则先激活，否则直接用环境解释器 —— 见 N-4）
python -m pytest tests/test_no_auth_surface.py tests/test_local_owner_claim.py tests/test_local_owner_materials_listing.py tests/test_thumbnail_service.py tests/security/ -q
# v2 实测：155 passed, 2 skipped, 25 warnings in 16.87s
python -m pytest tests/ -q                 # 长任务：先 wait_async；判据是 A4'（差分，基线 37719be）

# 桌面（静态部分）
node desktop/main/window-state.test.js
node --check desktop/scripts/smoke-test.js
node --check desktop/scripts/dev.js

# ── V 阶段：产物验证（**在六个提交落地之后**跑 —— 见 E-16 / R-P0-2）
npm run test:integration                   # 全 skip 记 inconclusive，不得记 ok
cd desktop
npm run clean                              # 建议，不是必须（见 N-2 的 v2 修订）：清 release/，
                                           # 避免 electron-builder 复用半成品 unpacked 目录
npm run build:dir                          # 长任务（含 CPython 组装 + pip install，需网络）：先 wait_async
node scripts/smoke-test.js
```

### 11.4 提交后自检

见 §8.5。

### 11.5 崩溃后如何续跑

见 §4.6 的判定表。一句话：**先 `git log --oneline -8` 判定提交到第几组，再从下一组继续；
永远不要因为"不确定"就 reset 或 checkout。**

---

## 12. 与上游文档的关系

| 文档 | 关系 |
|------|------|
| `docs/plans/desktop-only-refactor/spec.md`（v4） | **上游基线**。本轮不修改其既有内容，只在尾部追加《收尾轮记录》一节（A3′/A4′/A5′/C-3′、U-2/U-3 结论、R 阶段缺陷处置） |
| 本文档 | 收尾轮的执行方案。**v2 已由评审节点 #1 修订完毕**：《评审记录（Review Notes · v2）》在正文靠前处，《评审结论（Review Verdict · v2）》在文末，2×P0 + 8×P1 已全部改入正文 |
| `docs/plans/desktop-only-refactor-finalization/residual-actions.md` | F 阶段产出，登记代码改不掉的残留动作（RA-1..RA-7） |
| `docs/plans/desktop-only-refactor-finalization/review-notes.md` | R 阶段产出（缺陷 ≥ 3 条时必建） |

---

## 评审结论（Review Verdict · v2）

### 结论：**有条件通过（Approved with conditions）**

**通过的理由**：本方案对"这一轮到底要做什么"的判断是对的——上一轮丢的不是代码质量，是
**没有先落盘**，所以本轮的正确交付物就是"把 325 条唯一副本安全变成可评审的 git 历史"，
而不是又一版重构。文档最核心的资产——**六组切分算法**——经本节点用独立脚本复算，
**互不相交、并集为全集、21 条重命名天然同组**（`1+54+121+132+10+7=325`，未覆盖 0、跨组 0），
§2.2 / §2.3 的每一个数字也都复测命中。E-3（诚实标注中间提交不绿）、E-4（选 mixed reset 而非
`commit --only`）、E-8（判据错了改判据、不许删测试凑绿灯）、E-11（拒绝 skip/xfail）
这几条判断都站得住。

**加条件的理由**：缺陷集中在**执行契约**——两条 P0 都不是"写错了一个数字"，而是
**方案自己会把实施者推向它自己要防的那场事故**：
① 一条**必定失败**的守恒校验，配着"工作区可能被人动过"的话术（R-P0-1，已实证推翻）；
② 唯一副本要穿过 `build:dir`（含 CPython 组装 + `pip install`）才被提交，而全程**没有任何备份**
（R-P0-2）——这正是上一轮 #3 崩溃丢盘的形状。两者都已在正文中修好，但它们是**执行纪律**，
必须在放行条件里显式钉住，否则下游节点很容易"按老习惯"绕回去。

**缺陷处置状态**：**2×P0 + 8×P1 全部已直接改入正文，无遗留**；6×P2 亦全部改入正文
（其中 R-P2-6 同时新增 RA-8 登记项）。

### 放行条件（EC-1 .. EC-10，下游节点必须逐条满足）

| ID | 条件 | 对应判据 |
|----|------|----------|
| **EC-1** | **F0 备份先做**：`git tag <name> $(git stash create)` + 9 个未跟踪路径拷到仓库外。B-0 未通过之前，**不得**执行任何长任务，也不得碰 git 索引 | B-0 |
| **EC-2** | reset 前后一律比对**路径集合**（346 条），**不得**再用 `git status \| wc -l` 守恒当门禁；任何一次"对不上"都只许查清原因，**绝不许**用 `reset --hard` / `checkout .` / `restore .` / `clean -fd` / `stash push` 去"恢复" | B-1、B-12、RE-1、RE-14 |
| **EC-3** | 分组条数门禁只认 `--no-renames` 口径：G1=1 / G2=54 / G3=121 / G4=153 / G5=10 / G6=7+（合计 346）；重命名配对用 B-4 的「≥ 14」宽松判据，**不作停手依据** | B-4、E-17 |
| **EC-4** | 提交信息文件（`.msg-G*.txt`）与任何临时脚本一律落**仓库外**；六组之外零新增未跟踪路径 | B-3、B-13、E-19 |
| **EC-5** | F1 必须修掉 N-3 的两行注释（`src/hooks/useTheme.ts:14`、`src/hooks/__tests__/useTheme.test.ts:4`），使 RC-18 真正归零；RC-1 按「≥ 325 且每个增量可解释」执行 | B-14、RC-1、RC-18 |
| **EC-6** | A3′ / A4′ 的基线**钉死 commit `37719be`**，取基线用 `git worktree add <仓库外目录> 37719be`；**不得**写 `HEAD`，**不得**写 `git merge-base HEAD main` | A3′、A4′、E-18 |
| **EC-7** | 产物验证（U-2 `test:integration`、U-3 `build:dir` + `smoke-test.js`）在**六个提交落地之后**执行；判负登记 RA-8 并 runlog 记 `fail`，**不得** revert 已落地的提交 | B-9、B-10、E-16 |
| **EC-8** | `cd desktop && npm run clean` 视为**可选**；**不得**再以"没 clean 所以冒烟结论失真"为由阻塞或重跑（该因果已被 R-P1-5 证伪） | N-2 的 v2 修订、A5′ |
| **EC-9** | 后端门禁在无 `venv` 时直接用环境解释器执行；`tests/conftest.py` 的 cv2 stub **必须原样保留**（删它等于砍掉本机全部后端验证能力） | RC-16、N-4 |
| **EC-10** | 底线不变：**不得**为满足判据而删除 `no-auth-surface` 护栏测试，**不得**给既有失败加 `skip`/`xfail`，**不得**重做已通过评审的 P0-R/P3..P7 | E-1、E-8、E-11、RE-6 |

### 打回情形（出现任一条即判本轮不通过，需重新评审）

1. 会话记录里出现 `git reset --hard`、`git checkout .`、`git restore .`（无路径）、
   `git clean -fd`、`git stash`/`git stash push`、或无路径的 `git add -A`。
2. 在六个提交落地**之前**跑 `npm run build:dir` 或任何分钟级长任务（EC-1/EC-7 的实质）。
3. 通过删护栏测试、加 `skip`/`xfail`、放宽 grep 范围来"让判据变绿"。
4. `git status` 未归零就宣布完成，或工作区丢失任何一条变更（B-1 判负）。
5. 本轮重新设计 UI / 重组目录 / 再删代码，即重做 v4 已通过评审的阶段（违反 E-1）。

### 本节点**没有**做的事（避免下游误读评审范围）

- **未运行** `npx tsc --noEmit` / `npm test` / `npm run build` / `npm run lint` /
  `npm run test:integration` / `npm run build:dir` —— 它们属于 F 阶段与 V 阶段的职责，
  本节点只复核了方案对这些门禁的**契约描述**是否可执行、判据是否自洽。
  唯一实跑的门禁是 §6.2 的后端子集（用于验证"155 passed / 2 skipped"这一具体期望值与
  "先激活 venv"这一前置条件是否属实），结果见 RV.1。
- **未逐行复核 325 条 diff 的业务正确性**。本节点的评审对象是**方案文档**；对工作区代码的
  逐项核对是 §4.4 的 RC-1..RC-22，由下游 R 阶段执行。本节点只抽验了方案中被当作事实断言的
  那些点（RC-16、RC-17、RC-18、C-3、A1/A2/A5、组切分完整性）。
- **未触碰任何源码，未跑 `git commit`，未动 git 索引**——工作区在本节点前后逐字不变
  （325 条，`git diff --cached --shortstat` 仍为 `207 files, 35371 deletions`）。

---

**文档状态**：**v2，评审完毕，结论=有条件通过**（放行条件 EC-1..EC-10）。
无遗留 P0 / P1。下一步交给 F 阶段（开发节点）：先做 §11.0 的 F0 备份，再进 F1。

**核心提醒**：本轮唯一不可逆的风险仍然是**工作区丢失**。v1 对这一点的认识是对的，但缓解手段
只有禁令；v2 补上了两件事——**先备份（§11.0），再尽早提交（E-16 把长任务挪到提交之后）**。
在第一个提交落地之前，这个仓库里两个节点 2 小时的产出只有 F0 那一份备份兜底 ——
**先把它安全地变成 git 历史，其余一切都还有第二次机会。**

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> **记录者**：收尾轮流水线节点 #2（开发 / F 阶段）。**记录时间**：2026-09-01。
> **编号**：`I-E<n>`（Endgame Implementation），与 v4 的 `I-n`、本文档评审的 `R-P0-n` 区分。
> **规则**（本节点任务契约）：发现方案有误**不得静默偏离** —— 先在此登记，再按修正后的做法执行。
> 每条给出「问题 → 证据 → 修法 → 验证」四段。

### I-E1（**P0**）· 「路径集合守恒」这条替代不变量**本身也不守恒**

**问题**：v2 评审用 R-P0-1 推翻了「条数守恒」，改用**路径集合**作为 §4.5 step 1 / §7.2 不变量 1 /
§11.1 / §11.2 的停手门禁。方向完全正确，但**取集合的命令选错了**：

```bash
{ git diff HEAD --name-only ; git ls-files --others --exclude-standard ; } | sort -u
```

`git diff --name-only` **默认开启重命名检测**（`diff.renames` 自 git 2.9 起默认为 true），
一条被识别的重命名只输出**目标路径一行**。于是这个"集合"**同样是重命名敏感的**，
和被它取代的「条数」犯的是**同一个错误**。

**证据（`by-running`）**：

① 本仓库实测，两种口径差 17 条 —— 文档写的 346 只有加 `--no-renames` 才成立：

```
{ git diff HEAD --name-only ;             git ls-files --others … } | sort -u | wc -l   → 329
{ git diff HEAD --name-only --no-renames ; git ls-files --others … } | sort -u | wc -l   → 346
git diff HEAD --name-status -M | grep -c '^R'                                            → 17
git diff --cached --name-status  | grep -c '^R'                                          → 21
```

21 条重命名里有 **17 条**被 `git diff HEAD` 配对折叠（2 路径 → 1 行），`325 − 17 + ...` 恰好
得到 329。**§2.2 / §11.1 / §7.2 写的 346 与实际命令的输出对不上。**

② 用一次性 scratch 仓库（**未触碰本仓库**）实证它在 reset 前后**不守恒** ——
5 条重命名，reset 前 5 条路径、reset 后 10 条：

```
$ git status --porcelain           # R  old/{a..e}.txt -> new/{a..e}.txt
$ { git diff HEAD --name-only ; git ls-files --others --exclude-standard ; } | sort -u
new/a.txt new/b.txt new/c.txt new/d.txt new/e.txt                       # → 5
$ git reset -q
$ { git diff HEAD --name-only ; git ls-files --others --exclude-standard ; } | sort -u
new/{a..e}.txt  old/{a..e}.txt                                          # → 10
$ diff pre post   →  5a6,10  > old/a.txt …          *** NOT CONSERVED ***
```

机制：mixed reset 后索引 = HEAD，**暂存的重命名不复存在**；旧路径变成 ` D 旧路径`（已跟踪、
工作区已删），新路径变成**未跟踪**。而 `git diff HEAD` 只看已跟踪文件，配对无从谈起，
集合必然膨胀到 `--no-renames` 的口径。

③ 同一口径下则**逐条守恒**（同一 scratch 仓库，加 `--no-renames`）：reset 前 10、reset 后 10、
`diff` 无输出。

**为什么是 P0 而不是 P1**：这条门禁的失败话术与 R-P0-1 一模一样 —— §4.5 step 1 要求
「必须与基线**逐条相等**」，§2.2 配的解释是「对不上就说明工作区**被人动过，必须先查清再动手**」，
§11.2 写「核对不通过就**停下**」。也就是说：**一条必定触发的告警**，配上"工作区可能被人动过"的
提示，出现在一个**唯一副本、刚做完备份**的仓库里。这正是 **RE-14** 定义的灾难诱因，
而 RE-14 本身就是 v2 评审为了防 R-P0-1 才新增的 —— 缺陷在修补的**同一处**复发了。

**修法**：§4.5 step 0/1、§7.2 不变量 1、§11.1、§11.2 step 0/1 的路径集合命令**统一加
`--no-renames`**：

```bash
{ git diff HEAD --name-only --no-renames ; git ls-files --others --exclude-standard ; } | sort -u
```

这与 §4.5 分组门禁、E-17 已经采用的 `--no-renames` 口径**完全一致**，文档内部因此自洽。

**验证**：本仓库 F1 之前 **346**、F1 之后 **348**（+2 = N-3 的两个文件），与
六组门禁值合计 `1+54+121+153+10+7 = 346` **交叉自洽**；scratch 仓库实证 reset 前后逐条相等。
黑板记 `F-26`。

> **给 C 阶段（节点 #3）的直接影响**：§11.2 的 step 0 / step 1 请用上面这条带 `--no-renames`
> 的命令。若你照 v2 原文执行，`diff` 必然报出 **17 行差异**，而那**不是**工作区被动过 ——
> **此时绝对不要**动 `reset --hard` / `checkout .` / `restore .` / `clean -fd`。

### I-E2（P2）· RC-3「启动路径无破坏性 DDL」是判据缺陷，不是代码缺陷

**问题**：§4.4 的 RC-3 是优先级最高的一档（"任一条 fail 都是 P0"），命令与期望是

```bash
grep -rniE "drop\s+(table|column)|ALTER .* DROP" backend-services/basic-service/app/   # 期望 0
```

**实测 = 2**，按字面执行会把这次重构判为 **P0 失败**。

**证据（`by-running`）**：

```
backend-services/basic-service/app/database.py:132:    DROP / ALTER ... DROP here — both ``user_id`` self-heal incidents in
Binary file backend-services/basic-service/app/__pycache__/database.cpython-311.pyc matches
```

第一条是 `_claim_ownership_for_local_owner()` 的 docstring，原文是
**"Never emit DROP / ALTER ... DROP here — both ``user_id`` self-heal incidents in
``docs/diagnoses`` started in this function's ancestor."** —— 它是**禁止**这件事的告警，
本身就是 F-2 两次生产事故留下的护栏。第二条是同一文件的编译字节码，`.gitignore` 覆盖的构建产物。
真实 DDL 数为 **0**：该函数只可能发出 `ADD COLUMN`，且幂等。

**修法**：判据改写为 **RC-3′**（限定 `--include=*.py`、排除注释 / docstring 行与
`__pycache__/`），原文已写进 v4 spec 的《收尾轮记录》EN.1。**改判据、不改代码** ——
这与 C-3′（护栏测试的负向断言）、A5′（构建产物残留）是**完全同一类**缺陷，
处置也必须一致。把那句告警注释删掉来"满足判据"是本轮最坏的可能结果。

**验证**：排除注释与字节码后实测 **0**；`database.py` 的护栏 docstring 原样保留。

### I-E3（P2）· RA-4 记录的「3 个既有 vitest 失败」本轮**未复现**

**问题**：§5.4 的 RA-4 与黑板 F-16 记载「3 个既有 vitest 失败（`backend-proxy` T2/T18、
`cachePlayback` 端到端）」，§6.2 把 `npm test` 的期望写成「相对上一轮的 **1808 passed / 3 failed**
零新增失败」。若下游按这个期望核对，会以为**必须**看到 3 个失败。

**证据（`by-running`）**：

```
npm test  →  Test Files 204 passed (204)   Tests 1811 passed (1811)   exit 0
npx vitest run backend-proxy.test.ts cachePlayback.integration.test.ts \
               no-auth-surface.test.ts VerticalTaskbar.a11y.test.ts
          →  Test Files 4 passed (4)   Tests 42 passed (42)
```

**0 失败**，且 `1808 + 3 = 1811` —— 上一轮记为失败的那 3 个用例本轮**全部通过**。

**修法**：§6.2 的期望按 A3′ 的**差分**口径理解即可（"失败集合 ⊆ 基线"，空集当然满足），
**不要**把"必须有 3 个失败"当成核对项。同时把 RA-4 从"确认失败"**降级**为
"疑似 flaky，待观察"，并写清：本轮**没有**触碰这两个测试所覆盖的实现，
所以更可能是**时序 / 环境敏感**而不是被修好了。**一个时好时坏的测试比一个稳定失败的测试更危险**，
故仍保留 RA-4 立项（验收方式改为 `--repeat 20` 连跑）。

**验证**：见上方两条命令输出；RA-4 已在 `residual-actions.md` 按降级后的措辞登记。

### I-E4（P2）· 设置中心的 i18n 命名空间仍是 `adminSettings`

**问题**：v4 的 P3 已把 `AdminSettings/` 目录重命名为 `settings/`，RC-18 的三个**组件名**
也已归零（B-14，本轮 F1 修完最后两行注释）。但 `src/lib/i18n.ts` 的**翻译键命名空间**
仍是 `t.adminSettings.*`，本轮新增的「通用」面板也沿用了它
（`t.adminSettings.general` / `.language` / `.theme` / `.autoTheme` …）；
同类情形还有 `t.header.*`（`Header` 已并入 `shell/AppTitleBar`）。
严格按 CLAUDE.md《Clean Code》「一个概念，一个名字」，这是残留的命名不一致。

**证据（`by-running`）**：`grep -oE "t\.[a-zA-Z0-9_.]+" src/components/settings/GeneralSettingsPanel.tsx`
→ `t.adminSettings.{general,generalDesc,generalAutoSaveNote,language,theme,autoTheme,darkTheme,lightTheme}`
与 `t.header.{chinese,english}`。
注：RC-18 的 grep 是**大小写敏感**的 `AdminSettings`，与小写开头的键名 `adminSettings` 不匹配，
所以 B-14 归零与本条并不矛盾 —— 两者口径不同。

**修法**：**本轮不改**，登记为 `residual-actions.md` 的 **RA-9**。理由：① 这是跨文件的命名空间
重命名，要动 `src/lib/i18n.ts`（7129 行，CLAUDE.md 明示的豁免文件）的 en / zh / 接口三处外加
全部引用点；② 不影响任何用户可见行为；③ 在收尾轮做这种改动直接违反 **E-1**
（不重做已通过评审的 P3）与 §3.3（"目录再重组"范围外）。

**验证**：RC-21 已确认新增面板的 8 个键在 `Translations` 接口 + en + zh **三处齐备**
（每键 3 次命中），i18n 完整性本身没有问题；本条只是命名口径问题。

### I-E5（P2）· §6.2 门禁表的后端子集期望值可以收紧为实测值

**问题**：§6.2 写「`155 passed / 2 skipped / 0 errors`（v2 实测 16.87s）」。本轮复跑得到
**同样的 155 passed / 2 skipped**，但耗时 **10.29s**。数字本身没错，只是耗时是环境相关量，
不宜写进"期望"列被当成门禁。

**修法**：把耗时视为参考信息而非判据（本轮按 155 passed / 2 skipped 判定通过）。
无需改动方案正文，此处仅备案，避免下游因 16.87s vs 10.29s 的差异而怀疑环境不一致。

**验证**：`155 passed, 2 skipped, 25 warnings in 10.29s`，`PYTEST_SUBSET_EXIT=0`。


### I-E6（P1）· B-4「重命名保序」的判据命令测的是**终端显示宽度**，不是重命名本身

**记录者**：收尾轮流水线节点 #3（评审 + 提交 / C 阶段）。**记录时间**：2026-09-01。

**问题**：§4.5「重命名保序校验」与 §8.2 B-4 给的命令是

```bash
git show --stat -M HEAD | grep -c "=>"      # 期望 >= 14
```

G4 提交落地后**实测 = 0**，而重命名其实**一条没丢**。按字面执行会触发 §4.5 写明的
「若结果 < 14 ... 此时 `git reset --soft HEAD~1` 重做该组」——对一个完全正确的提交做无谓返工。

**证据（`by-running`）**：

```
git show --name-status -M HEAD | grep -c '^R'   -> 17      # 权威口径：重命名确实记录在案
git show --stat     -M HEAD | grep -c '=>'      ->  0      # 默认 80 列
git show --stat=250 -M HEAD | grep -c '=>'      -> 17      # 放宽列宽后立刻出现
git show --stat        HEAD | tail -1           -> 138 files changed   # 155 - 17 = 138，配对成立
```

`--stat` 的默认宽度是 80 列，超长路径会被从**左侧**截断成 `.../ModelSettingsPanel.tsx`，
而 `{AdminSettings => settings}` 恰好落在被截掉的那一段里。也就是说 `grep "=>"` 命中与否
取决于**路径有多长、终端有多宽**，与"重命名是否保序"无关。本仓库的 17 条重命名全部位于
`src/components/AdminSettings/components/__tests__/...` 这类深路径，因此**必然**全部被截断。

**为什么是 P1**：它与 I-E1（`--name-only` 默认开重命名检测）、I-E2（RC-3 命中护栏注释）、
C-3′（命中负向断言）、A5′（命中构建产物）是**同一族缺陷** —— 判据命令测到的是表征而非语义，
且失败话术会把执行者推向破坏性动作（这里是 `reset --soft` 返工，比 I-E1 的 `reset --hard` 轻，
但同样是"正确的结果被判为失败"）。

**修法**：判据改为 **B-4′**，用 `--name-status` 这个与显示宽度无关的口径：

```bash
git show --name-status -M HEAD | grep -c '^R'   # 期望 >= 14
```

若仍想看 `--stat` 的可读形式，必须显式给宽度：`git show --stat=250 -M HEAD`。
**改判据、不改提交** —— 与 I-E2 的处置原则一致。

**验证**：G4 提交 `9393152` 实测 `--name-status` 口径 **17**（R097~R100，含 `AdminSettings/`
→ `settings/` 全部 17 条），`--stat=250` 口径同为 **17**，B-4′ 通过。黑板记 `F-28`。

---
---

### 本节点执行边界声明

- **未执行 `git commit`**（任务契约禁止，且 C 阶段归节点 #3）；**未动 git 索引**
  （未跑 `git add` / `git reset` / `git rm`）。
- **未执行任何被 §0 / §4.6 列为禁止的命令**：无 `reset --hard`、无 `checkout .`、
  无 `restore .`、无 `clean -fd`、无 `git stash`/`stash push`、无无路径 `git add -A`。
  唯一用到的 stash 原语是 **`git stash create`**（E-15 明确推荐，不改工作区、不改索引）。
- **未执行 V 阶段的产物验证**（`test:integration`、`build:dir` + `smoke-test.js`）——
  这是 E-16 / EC-7 规定的时序：它们必须排在六个提交**落地之后**。见 RA-8。
- **对源码的改动仅两处**，均为 EC-5 明令要求的 N-3 修复：
  `src/hooks/useTheme.ts:14` 与 `src/hooks/__tests__/useTheme.test.ts:4` 注释中的
  `HeaderActions` → `TitleBarActions`。**未新增依赖、未新增范围外文件**。
- 本轮自造的临时文件（6 个 `.msg-G*.txt`、门禁输出、scratch 仓库、F0 备份副本）
  **全部落在仓库外的 scratchpad**，仓库零污染（EC-4 / B-13）：
  `git status` 条目数 = **327**，仅比基线 325 多出 N-3 的两个文件。
