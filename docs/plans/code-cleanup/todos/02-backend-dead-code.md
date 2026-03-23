# TODO 02: 后端废弃代码扫描与清理

**对应 Spec:** `specs/02-backend-dead-code.md`

## Dependencies
- `depends_on: []` — 无前置依赖，可独立执行
- `blocks: [03]` — API 路由清理需要先完成后端死代码清理
- `parallel_group: A` — 可与 TODO 01 并行

## 任务清单

### 未使用导入
- [ ] 扫描 `app/` 下所有 `.py` 文件的未使用 import
- [ ] 删除确认未使用的 import 行
- [ ] 验证 `python -c "from app.main import app"`

### 未使用服务方法
- [ ] 列出 `app/services/` 下所有公开方法
- [ ] 对每个方法 grep 路由层和其他服务的调用
- [ ] 检查 private 方法是否被同文件调用
- [ ] 删除未被调用的方法

### 未使用模型/字段
- [ ] 列出 `app/models/` 下所有 model class
- [ ] 对每个 model grep 引用次数
- [ ] 删除未被引用的 model class
- [ ] 检查 model 字段是否有未使用的（需谨慎，Pydantic 自动序列化）

### 未使用工具函数/常量
- [ ] 扫描 `app/` 下辅助函数和常量
- [ ] 删除未被引用的

### 最终验证
- [ ] 运行 `python -c "from app.main import app; print('OK')"`
- [ ] 运行 `pytest tests/ -v`（如可用）
