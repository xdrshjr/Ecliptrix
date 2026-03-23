# Spec 02: 后端废弃代码扫描与清理

## 概述

扫描 `backend-services/basic-service/app/` 下的所有 Python 代码，识别并删除未使用的导入、函数、类、方法、模型字段和变量。

## 扫描目标

### 1. 未使用的导入

**检查方法：** grep 扫描所有 `import`/`from...import` 语句，交叉验证文件内引用

### 2. 未使用的服务方法

**检查范围：** `app/services/` — 38 个服务文件
**检查方法：**
- 对每个公开方法，grep 查找路由层或其他服务的调用
- 仅在 service 内部调用的 `_private` 方法检查是否真正被调用

### 3. 未使用的模型/字段

**检查范围：** `app/models/` — Pydantic 模型和 SQLAlchemy ORM 模型
**检查方法：**
- 对每个 model class，grep 查找引用
- 对 Pydantic model 的字段，检查是否在序列化/反序列化中使用

### 4. 未使用的路由端点

**检查方法：** 对比 `app/routers/` 中的端点定义和前端 API 路由代理（与 Spec 03 配合）

### 5. 未使用的工具函数/常量

**检查范围：** `app/` 下所有辅助函数、常量定义
**检查方法：** 定义处 grep 引用次数 = 0 → 废弃

## 安全检查清单

- [ ] 装饰器引用的函数不能误删（如 `@with_simple_queue`）
- [ ] FastAPI 依赖注入的函数不能误删（如 `get_current_user`、`get_db_session`）
- [ ] 通过 `include_router()` 注册的路由不能误删
- [ ] `__init__.py` 中 re-export 的模块不能误删
- [ ] Alembic migration 引用的模型不能误删

## 验证方式

```bash
cd backend-services/basic-service
python -c "from app.main import app; print('OK')"  # 导入检查
pytest tests/ -v  # 测试验证（如有）
```
