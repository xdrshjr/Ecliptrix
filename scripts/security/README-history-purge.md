# Ecliptrix 历史泄露清理 Runbook（git filter-repo）

> 状态：**脚本已就绪，尚未在真实仓库执行**。执行前必须先完成凭证轮换（见第 6 节）。
> 配套脚本：`scripts/security/purge-leaked-history.ps1`（默认干跑，纯 ASCII，PowerShell 5.1）
> 配套门禁：`scripts/scan-secrets.py`（防止再次提交密钥）

---

## 1. 为什么上一次清理没有完成

`c6e04277 fix(security): purge leaked credentials from the public repo and gate recurrence`
只做了两件事：把两个文件的内容改成从环境变量读取，并加了提交前的密钥扫描。

**改内容不等于改历史。** Git 是内容寻址的：新提交只是新增了一层，旧 blob 仍然被旧提交引用，
而旧提交仍然被 `raw.githubusercontent.com` 提供下载。实测（已用真实 HTTP 请求验证）：

| 文件 | 泄露所在提交 | 现在的状态 |
|------|--------------|-----------|
| `docs/coding-plan/kimi/test_kimi_k2.5.py` | `6b559351`、`15ff5b4f` | `main` 上的版本已脱敏，但旧提交仍可取到 |
| `docs/coding-plan/glm/test_glm_coding_plan.py` | `2358302a` | 同上 |

也就是说：只要仓库是 public，任何人拿到提交 SHA 就能拼出 raw URL 读取真实密钥。
**唯一能让它失效的办法是重写历史 + 强制推送 + 让 GitHub 清缓存，而真正兜底的是轮换凭证。**

## 2. 影响范围（实测，比最初认知更大）

用「已知密钥字面量」反查历史中出现过它的路径（命令见下），确认一共有 **4 个**路径承载过真实密钥：

```
docs/coding-plan/kimi/test_kimi_k2.5.py           在 main 中仍存在（已脱敏）
docs/coding-plan/glm/test_glm_coding_plan.py      在 main 中仍存在（已脱敏）
example-package/kimi-coding/test_kimi_k2.5.py     已在 15ff5b4f 中从 main 删除，只剩历史
backend-services/basic-service/.env               已在 15ff5b4f 中从 main 删除，只剩历史
```

反查命令（把 `<字面量>` 换成凭证本身，**不要**把输出贴到 issue/聊天里）：

```bash
git log --all --pretty=format: --name-only -S "<字面量>" | sort -u
```

**如果只删前两个路径，清理是无效的**：演练中，只删前两个路径后，Kimi 密钥仍能在 3 个提交里读到，
GLM 密钥仍能在 2 个提交里读到。所以脚本的默认目标列表包含全部 4 个路径。

## 3. 前置条件

1. **凭证已经轮换**（第 6 节）。历史清理不能替代轮换，顺序不能颠倒。
2. 已安装 `git`（Windows: Git for Windows）。
3. 已安装 `git filter-repo`：

```bash
pip install git-filter-repo
git filter-repo --version        # 必须能打印版本号
```

> 本机（生成此 runbook 的机器）**没有**安装 `git filter-repo`。演练是在临时目录
> `pip install --target %TEMP%\gfr-pkg git-filter-repo` 并把 `%TEMP%\gfr-pkg\bin` 加进
> `PATH` 之后完成的，演练结束后该临时安装已删除。真实执行前请按上面两条命令正式安装。

4. 工作树干净：`git status --porcelain` 必须为空（脚本会拒绝执行）。
5. 分支保护（若开启）需要临时放开 `main` 的 force push 限制。
6. 通知协作者：强制推送后他们必须重新 clone。

## 4. 备份（脚本会自动做，但要知道它在哪）

脚本在**任何破坏性操作之前**先做镜像克隆：

```bash
git clone --mirror "M:\takoAI\Ecliptrix" "%TEMP%\ecliptrix-pre-purge-<yyyyMMdd-HHmmss>.git"
```

`--mirror` 会带上**所有 ref**（分支、tag、远端分支引用），这才是可用于恢复的备份；
普通 clone 只带走当前分支，恢复不了 tag 和侧分支。脚本会把备份路径用绿色高亮打印出来，
**在验证通过之前不要删除它**。

手工备份（等价）：

```bash
git clone --mirror https://github.com/xdrshjr/Ecliptrix.git D:\backup\ecliptrix-mirror.git
```

## 5. 执行步骤

### 5.1 干跑（默认，什么都不会改）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security\purge-leaked-history.ps1
```

输出会包含：git / 仓库根目录 / 当前 HEAD 与全 ref 提交数 / origin URL / filter-repo 版本 /
工作树状态 / 每个目标路径的历史提交数与是否仍在 main / 备份命令 / 重写命令 / 退出码。

退出码：`0` 干跑通过、`1` 运行错误、`2` 缺少前置条件（如没装 filter-repo）、`3` 因安全原因拒绝（工作树脏、origin 不是预期 URL）。

### 5.2 真跑

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security\purge-leaked-history.ps1 -Execute
```

`-Execute` 存在时脚本才会：① 校验前置条件 → ② 建镜像备份 → ③ 执行

```bash
git filter-repo --invert-paths \
  --path docs/coding-plan/kimi/test_kimi_k2.5.py \
  --path docs/coding-plan/glm/test_glm_coding_plan.py \
  --path example-package/kimi-coding/test_kimi_k2.5.py \
  --path backend-services/basic-service/.env \
  --force
```

**为什么用 `--path` + `--invert-paths` 而不是 `--replace-text`：** 整文件删除不依赖"我猜对了密钥的每一种写法"。
`--replace-text` 是逐字替换，漏掉一个变体（换行拼接、注释里的旧值、另一处复制）密钥就照样可读。
`--replace-text` 只在 `-KeepFiles` 模式下作为备选出现。

**代价：** 前两个文件会从 `main` 上彻底消失（连脱敏后的版本也没了）。如果团队要保留这两个
（已脱敏）文件，改用保留模式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security\purge-leaked-history.ps1 -Execute -KeepFiles
```

`-KeepFiles` 会在**运行时**从本仓库自己的历史里提取字面量，写一份临时 `replacements.txt`，
交给 `git filter-repo --replace-text`，然后在 `finally` 里删除该文件；**字面量不会被打印**，
脚本只报告"替换了多少条"。注意该模式下**密钥值会短暂落在 `%TEMP%` 的磁盘文件里**（通常 1 分钟内被删除）。

### 5.3 重写之后、推送之前

`git filter-repo` 会**移除 origin**（防止误推到旧历史）。这是预期行为，脚本把恢复远端与推送
作为**人工清单**打印出来，脚本自己绝不推送。

## 6. 轮换凭证才是第一优先级

顺序必须是：**先轮换 → 再清理**。

- 历史重写在 GitHub 上永远不保证"立刻、彻底"生效（缓存、fork、别人的 clone 都可能留着旧对象）。
- 在旧 key 仍然有效的时间窗口里，清理只是"降低可见度"，不是"消除风险"。
- 所以：立刻去 Moonshot（Kimi）与智谱（GLM）的控制台**吊销旧 key、签发新 key**，把新值只写进
  本地 `.env`（`.env` 已在 `.gitignore:13`，仓库里只提交 `env.template` / `.env.example`）。
- 轮换完成后，再执行第 5 节的清理。清理的收益是"旧 URL 不再返回有效凭证"，而不是"风险已消除"。

## 7. force push 之后必须做的事

按顺序逐条确认（脚本会把这份清单打印出来）：

1. 恢复远端：

   ```bash
   git remote add origin https://github.com/xdrshjr/Ecliptrix.git
   ```

2. 强制推送分支与 tag：

   ```bash
   git push --force origin --all
   git push --force origin --tags
   ```

3. **向 GitHub Support 提交"清除缓存敏感数据"请求**（Settings → Support，说明 remove cached
   sensitive data，附上仓库与提交 SHA）。不做这一步，`raw.githubusercontent.com` 仍可能继续
   返回旧 blob，清理等于白做。
4. 通知所有协作者**重新 clone**（旧 clone 里仍然有旧对象，`git pull` 不会删除它们）。
5. 关闭/清理仍然指向旧提交的 PR、Issue 引用、发布的 Release 资产。
6. 跑一遍 `scripts/scan-secrets.py` 确认当前树干净；提交前门禁保持开启，防止复发。

## 8. 如何验证清理成功

在真实仓库执行并推送之后，用下面三条独立验证。`<字面量>` 是你手上的真实密钥，**不要把输出贴出去**。

```bash
# 1) 全历史里不再有任何提交引入/删除该字面量 —— 输出必须为空
git log --all --oneline -S "<字面量>"
git log --all --oneline -S "<另一个字面量>"

# 2) 四个路径不再出现在任何提交里 —— 输出必须为空
git log --all --oneline -- docs/coding-plan/kimi/test_kimi_k2.5.py
git log --all --oneline -- docs/coding-plan/glm/test_glm_coding_plan.py
git log --all --oneline -- example-package/kimi-coding/test_kimi_k2.5.py
git log --all --oneline -- backend-services/basic-service/.env

# 3) raw URL 必须 404 或不再含密钥（用旧提交 SHA 拼 URL）
#    https://raw.githubusercontent.com/xdrshjr/Ecliptrix/<旧SHA>/docs/coding-plan/kimi/test_kimi_k2.5.py
```

补充检查（可选，确认没有误删业务文件）：

```bash
git rev-list --all --count          # 只应减少"被删空的提交"数量
git ls-tree -r --name-only HEAD | wc -l   # main 的文件数只应减少 2
node -e "const {execSync}=require('child_process');execSync('git status --short',{stdio:'inherit'})"
```

## 9. 已知限制

- **GitHub 侧缓存需要 Support 介入**：即使 force push 成功，旧 blob 在 CDN/缓存层可能还存在一段时间。
- **无法清理别人的 fork / clone**：fork 是独立仓库，别人的本地 clone 里旧对象一直在；
  唯一能做的是轮换凭证让旧值失效。
- **重写会改变所有提交 SHA**：所有 open PR 需要重新基于新历史；引用旧 SHA 的 Issue、文档、外链会失效。
- **被删空的提交会消失**：演练中全 ref 提交数 1374 → 1372（两个提交只动过被删路径）。
- **`filter-repo` 会在 `.git/filter-repo/` 留下元数据**，包含旧的 ref 映射与原始提交信息；如需彻底清理需手工删除该目录（其中不含密钥内容，但含历史结构）。
- **脚本不推送、不删远端、不动 `.git` 之外的文件**；force push 与 Support 请求永远由人执行。
- **`-KeepFiles` 模式的风险**：依赖正则/字面量清单是否覆盖全部变体，覆盖不到就漏；且临时文件落盘。

## 10. 回滚

```bash
# 用镜像备份恢复到新目录（不要覆盖当前工作目录）
git clone --mirror "%TEMP%\ecliptrix-pre-purge-<timestamp>.git" D:\restore\ecliptrix.git
```

如果已经 force push 过，回滚 = 再次 force push 旧历史，会重新暴露密钥，因此**只在确认新历史
缺失业务内容时**才这样做，并同时确保凭证已轮换。

## 11. 演练记录（lab，未触碰真实仓库）

演练用一次性克隆 `%TEMP%\ecliptrix-purge-lab` 完成，结束后已删除：

| 指标 | 清理前 | 清理后 |
|------|--------|--------|
| `git log --all -S <Kimi 密钥>` | 4 个提交 | 0 |
| `git log --all -S <GLM 密钥>` | 3 个提交 | 0 |
| 承载 Kimi 密钥的路径数 | 2 | 0 |
| 承载 GLM 密钥的路径数 | 2 | 0 |
| HEAD 跟踪文件数 | 2402 | 2400（正好少 2 个，即两条已脱敏的文档） |
| 全 ref 提交数 | 1374 | 1372 |
| `backend-services/basic-service/` 目录条目 | 14 | 14（未误删） |

演练同时验证了脚本的两个模式（默认 `--invert-paths` 与 `-KeepFiles`）、拒绝执行路径（工作树脏 → 退出码 3）、
缺失前置条件路径（无 filter-repo → 退出码 2），以及镜像备份可用性（备份里仍是 1374 个提交、仍含旧历史）。
**演练没有覆盖的部分：真实 force push、GitHub Support 缓存清除、raw URL 在推送后的实际行为。**
