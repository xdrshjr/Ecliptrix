# TODO 04: 未使用依赖包检查与清理

**对应 Spec:** `specs/04-dependency-cleanup.md`

## Dependencies
- `depends_on: [01, 02]` — 需要先完成死代码清理，确保引用关系准确
- `blocks: []` — 无后续阻塞
- `parallel_group: B` — 可与 TODO 03 并行

## 任务清单

### 前端 npm 依赖
- [ ] 读取 `package.json` 中 dependencies 和 devDependencies
- [ ] 对每个包名 grep `src/` 中的 import 引用
- [ ] 检查配置文件中的间接引用（next.config、tailwind.config 等）
- [ ] 检查 npm scripts 中的命令行工具引用
- [ ] 排除 `@types/*`、peer dependencies 等特殊包
- [ ] 从 `package.json` 移除确认未使用的依赖

### 后端 Python 依赖
- [ ] 读取 `requirements.txt`
- [ ] 对每个包名 grep `app/` 中的 import（注意包名/import名映射）
- [ ] 排除命令行工具（uvicorn、alembic）和间接依赖（asyncpg、aiosqlite）
- [ ] 从 `requirements.txt` 移除确认未使用的依赖
