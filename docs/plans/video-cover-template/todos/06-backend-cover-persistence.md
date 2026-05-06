# TODO 06 — Backend Cover Persistence

> Spec: `specs/06-backend-cover-persistence.md`

## Dependencies

```yaml
depends_on: []              # 后端独立，可与前端 01 同时启动
blocks: [07]                # 前端 BFF 路由消费此契约
parallel_group: A           # 与 01 并行
```

## Tasks

### A. ORM

- [ ] 在 `backend-services/basic-service/app/models/db_models.py` 末尾追加 `ProjectCover` 类（spec 06 §3）
- [ ] 字段：`id, project_id (FK + unique), user_id, template_id, cover_config (JSON), image_source, frame_virtual_time_ms, uploaded_image_url, aspect_ratio, created_at, updated_at`
- [ ] Index：`ix_project_covers_user_updated`

### B. Pydantic Schemas

- [ ] 新建 `app/models/video_cover_models.py`
- [ ] 定义 `CoverTextLayer / CoverDecoration / CoverConfig / CoverState`，全部 `model_config = {"populate_by_name": True, "ser_by_alias": True}`（让响应自动 camelCase）
- [ ] 定义 `CoverStateResponse(BaseResponse)`（data: Optional[CoverState] = None）
- [ ] 定义 `PngCacheData`、`PngCacheResponse`

### C. Service

- [ ] 新建 `app/services/video_cover_service.py`
- [ ] `_verify_project_owner(db, project_id, user_id) → VideoProject` 抛 404/403
- [ ] `get_cover(db, project_id, user_id) → CoverState | None`
- [ ] `upsert_cover(db, project_id, user_id, payload) → CoverState`（INSERT 或 UPDATE）
- [ ] `save_png_cache(db, project_id, user_id, file) → str`：写到 `settings.storage.root + /static/uploads/projects/<id>/cover/cover.png`，回写 `video_projects.cover_url`
- [ ] `delete_cover(db, project_id, user_id) → None`

### D. Router

- [ ] 新建 `app/routers/video_cover_router.py`，prefix=`/api/video-cover`
- [ ] `GET /{project_id}` → `CoverStateResponse`
- [ ] `PUT /{project_id}` → 接 `CoverState`
- [ ] `POST /{project_id}/png-cache` → `UploadFile`, content_type 校验, 5MB 上限
- [ ] `DELETE /{project_id}` → 清除记录

### E. 注册

- [ ] 在 `app/main.py` `include_router(video_cover_router.router)`（与 `video_project_router` 同位置）

### F. Alembic 迁移

- [ ] `cd backend-services/basic-service && alembic revision -m "add project_covers"`
- [ ] 编辑 `alembic/versions/<ts>_add_project_covers.py` 写完整 upgrade/downgrade（spec 06 §7.1）
- [ ] 包含所有索引（unique on project_id, user_id, user_updated 复合）
- [ ] 本地跑 `alembic upgrade head` 验证；再 `alembic downgrade -1` 验证回滚

### G. 测试

- [ ] 写 `tests/test_video_cover_service.py`（SQLite in-memory）：get/upsert/png-cache/delete/非 owner
- [ ] 写 `tests/test_video_cover_router.py`（FastAPI TestClient）：401/404/403/200 路径 + multipart 上传
- [ ] 跑 `pytest tests/test_video_cover_*.py -v`

### H. 验收

- [ ] alembic up/down 都能跑
- [ ] PUT 保存后 GET 能取回相同数据（含 camelCase 字段名）
- [ ] PNG 上传后 `/api/storage/files/projects/<id>/cover/cover.png` 可访问
- [ ] 重复 PUT 同一 project_id 走 UPDATE 而非 INSERT（unique 约束生效）
- [ ] 跨 user 操作返回 403
- [ ] pytest 全绿
