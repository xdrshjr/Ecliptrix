# TODO 04：全量验证与分类提交

> 对应 spec：`specs/04-verification-and-commit.md`

## Dependencies

- `depends_on: [01, 02, 03]` — 三类清理全部完成后才能跑最终验证与提交
- `blocks: []` — 终点
- `parallel_group: B` — 独占阶段，串行执行所有 git 提交（避免并发写 index）

## 任务清单

### 基线采集（⚠️ 必须在 TODO 01/02/03 任何改动之前已采集）
- [ ] 确认基线已在清理开始前采集；若编排为串行且尚未采集，先采：
  - `npm run type-check` → 记错误数/清单
  - `npm run lint` → 记 error/warning 数
  - `npm run build` → 记成功与否
  - `npm run test`（=`vitest run`）→ 记通过/失败用例数
  - `cd backend-services/basic-service && pytest tests/ -v` → 记通过/失败用例数
- [ ] 基线写入执行 summary 的「Baseline」小节

### 五道验证闸（标准 = 失败集 ⊆ 基线失败集）

> 既存失败（清理前就有）不算回归；仅当失败集**超出**基线才算引入新失败。注意：构建忽略 ESLint，但 **TS 类型错误不被忽略**，故 G-type / G-build 对断引用是真实硬门禁。

- [ ] G-type：`npm run type-check` — 无新增「找不到模块/符号」
- [ ] G-lint：`npm run lint` — 无新增断引用
- [ ] G-build：`npm run build` — 构建成功
- [ ] G-vitest：`npm run test` — 受影响模块通过，无残留 `usePlaybackWaitState` 引用
- [ ] G-pytest：`cd backend-services/basic-service && pytest tests/ -v` — 不回归

### 失败处理
- [ ] 若出现新失败：定位类别（type-check 报错通常指向 TODO 01 误删）→ 误删则 `git checkout -- <path>` 恢复并重做核验 / gitignore 误伤则修规则 → 重跑该闸

### 分类提交（当前分支，串行，顺序 02→03→01）
- [ ] **Commit 1**（02-a）：`git commit --only` 精确提交取消跟踪的产物 → `[update] untrack mis-committed generated media and logs`
- [ ] **Commit 2**（02-b）：提交 `.gitignore` → `[update] harden .gitignore against generated artifacts and ops scratch`
- [ ] TODO 03 工作区垃圾：**无 commit**（未跟踪文件删除），仅在 summary 记删除清单
- [ ] **Commit 3**（01）：提交源码删除 → `[refactor] remove verified dead frontend modules (formatConverter, deprecated services, orphan hook)`，提交前已过全量五道闸
- [ ] 每次提交用 `git commit --only <paths>`，避免误纳无关文件（如 `static/` 其它改动、`.claude-index/`、`logs/`）
- [ ] 确认未夹带 `__pycache__/`、`.pyc`、`.next/`、`.idea/`、`tsconfig.tsbuildinfo`

### 收尾
- [ ] `git status` 最终核对：仅剩有意保留的本地产物与存疑脚本
- [ ] 执行 summary 含：Baseline、五道闸结果、各 commit 哈希、TODO 03 删除清单
