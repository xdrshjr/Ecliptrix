# TODO 05: 注释代码块全面清理

**对应 Spec:** `specs/05-commented-code-cleanup.md`

## Dependencies
- `depends_on: []` — 无前置依赖，可独立执行
- `blocks: []` — 无后续阻塞
- `parallel_group: A` — 可与 TODO 01、02 并行

## 任务清单

### 前端注释代码
- [ ] 扫描 `src/` 下所有 `.ts`/`.tsx` 文件
- [ ] 识别连续 3+ 行的注释代码块
- [ ] 识别单行注释掉的 import/赋值/return
- [ ] 识别 `/* */` 块中的注释代码
- [ ] 区分代码注释和文档注释，保留有价值注释
- [ ] 删除所有注释掉的代码

### 后端注释代码
- [ ] 扫描 `app/` 下所有 `.py` 文件
- [ ] 识别连续 3+ 行以 `#` 开头的代码注释
- [ ] 识别单行注释掉的 import/赋值
- [ ] 区分代码注释和说明注释
- [ ] 删除所有注释掉的代码

### 验证
- [ ] 运行 `npm run type-check`
- [ ] 运行 `npm run build`
- [ ] 验证后端导入正常
