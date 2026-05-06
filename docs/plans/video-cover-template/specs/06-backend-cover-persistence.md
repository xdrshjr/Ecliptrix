# Spec 06 — Backend Cover Persistence

> 父：`master-plan.md` §6.1, §7.2
> 范围：`project_covers` 表、Alembic 迁移、ORM、Pydantic、router、service、文件存储

## 1. Goals

- G6.1 新建 `project_covers` 表，1:1 对应 `video_projects`
- G6.2 提供 GET / PUT / POST 三个路由，支持读取配置、保存配置、上传 PNG 缓存
- G6.3 上传 PNG 时写入 `STORAGE_ROOT/static/uploads/projects/<id>/cover.png` 并回写 `video_projects.cover_url`
- G6.4 所有路由要求登录用户拥有该 project（沿用 `video_project_router.py` 的鉴权方式）
- G6.5 提供 Alembic up/down 迁移脚本

## 2. 文件改动列表

### 2.1 新增

```
backend-services/basic-service/
├── app/
│   ├── routers/
│   │   └── video_cover_router.py
│   ├── services/
│   │   └── video_cover_service.py
│   ├── models/
│   │   └── video_cover_models.py        # Pydantic schemas
│   └── ... (db_models.py 修改见 2.2)
├── alembic/
│   └── versions/
│       └── <ts>_add_project_covers.py
└── tests/
    ├── test_video_cover_router.py
    └── test_video_cover_service.py
```

### 2.2 修改

- `app/models/db_models.py` — 追加 `ProjectCover` ORM 类
- `app/main.py` — 注册新 router（与 `video_project_router` 同位置）
- `app/database.py` — 无需修改。**双轨说明**：开发环境 `database.py` 启动时会 `create_all` 自动建表（包含本次新增的 `ProjectCover`），所以本地无需先跑 Alembic 即可工作；生产部署仍 **必须** 跑 `alembic upgrade head` 走正式迁移流程（已在 §7.3 列出）。**不要** 跳过 Alembic 仅依赖 auto-create——生产数据库的表与索引必须由迁移文件管理，便于回滚与审计。

## 3. ORM 模型

```python
# app/models/db_models.py
class ProjectCover(Base):
    """A 1:1 cover record per video project.

    Stores the cover template configuration plus references to the cached PNG.
    The cached PNG URL is also mirrored into video_projects.cover_url so the
    project list view can render thumbnails without a join.
    """
    __tablename__ = "project_covers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("video_projects.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    user_id = Column(String(36), nullable=False, index=True)
    template_id = Column(String(50), nullable=False)        # 'title' | 'tutorial' | 'click' | 'minimal'
    cover_config = Column(JSON, nullable=False)              # see CoverConfig schema
    image_source = Column(String(20), nullable=False)        # 'frame' | 'upload'
    frame_virtual_time_ms = Column(Integer, nullable=True)
    uploaded_image_url = Column(String(1000), nullable=True)
    aspect_ratio = Column(String(20), nullable=False)        # '16:9' | '9:16' | etc.
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_project_covers_user_updated", "user_id", "updated_at"),
    )
```

约束：

- `project_id` 唯一 + 外键级联：项目删除自动清理封面记录
- `user_id` 冗余存储（避免每次查询都 join 项目表做权限检查）
- 服务层负责验证 `user_id == current_user.id` 与 `video_projects.user_id == current_user.id` 一致

## 4. Pydantic Schemas

```python
# app/models/video_cover_models.py
from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Any
from datetime import datetime
from app.models.base_response import BaseResponse


class CoverTextLayer(BaseModel):
    key: str
    text: str
    font_family: str = Field(alias="fontFamily")
    font_size: int = Field(alias="fontSize")
    color: str
    font_weight: int = Field(alias="fontWeight")
    italic: bool
    underline: bool
    align: Literal["left", "center", "right"]
    x: float
    y: float
    width: float

    model_config = {"populate_by_name": True}


class CoverDecoration(BaseModel):
    type: Literal["rect", "line", "badge"]
    x: float; y: float; w: float; h: float
    fill: Optional[str] = None
    stroke: Optional[str] = None
    stroke_width: Optional[float] = Field(default=None, alias="strokeWidth")
    border_radius: Optional[float] = Field(default=None, alias="borderRadius")
    rotation: Optional[float] = None

    model_config = {"populate_by_name": True}


class CoverConfig(BaseModel):
    version: Literal[1] = 1
    text_layers: List[CoverTextLayer] = Field(alias="textLayers")
    decorations: List[CoverDecoration]

    model_config = {"populate_by_name": True}


class CoverState(BaseModel):
    template_id: Literal["title", "tutorial", "click", "minimal"] = Field(alias="templateId")
    config: CoverConfig
    image_source: Literal["frame", "upload"] = Field(alias="imageSource")
    frame_virtual_time_ms: Optional[int] = Field(default=None, alias="frameVirtualTimeMs")
    uploaded_image_url: Optional[str] = Field(default=None, alias="uploadedImageUrl")
    aspect_ratio: Literal["16:9", "9:16", "1:1", "4:3", "21:9"] = Field(alias="aspectRatio")

    model_config = {"populate_by_name": True}


class CoverStateResponse(BaseResponse):
    data: Optional[CoverState] = None


class PngCacheData(BaseModel):
    url: str


class PngCacheResponse(BaseResponse):
    data: PngCacheData
```

> 使用 `populate_by_name=True` + alias 同时支持 snake_case（Python）与 camelCase（前端）。
>
> **序列化方向（重要）**：Pydantic 默认 `model_dump()` 用字段名（snake_case）输出。前端 `CoverState` 类型是 camelCase（spec 02/master-plan §6.4），因此 router 返回时**必须**显式按 alias 序列化。两种做法任选：
>
> 1. 在每个 model 里加 `model_config = {"populate_by_name": True, "alias_generator": ..., "ser_by_alias": True}`（Pydantic v2 的 `ser_by_alias`）；或
> 2. 在 router 中显式 `return CoverStateResponse(success=True, message="ok", data=state.model_dump(by_alias=True))`（注意 `data` 类型需放宽为 `Optional[Any]` 或保持 Pydantic 反序列化重新组装）。
>
> 推荐方案 1：模型层一次性配置，避免每个 router 出入口都手工指定。具体落地代码以实施时为准。

## 5. 路由

### 5.1 router

```python
# app/routers/video_cover_router.py
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from app.database import get_db_session
from app.dependencies import get_current_user      # 现有依赖
from app.services import video_cover_service
from app.models.video_cover_models import CoverState, CoverStateResponse, PngCacheResponse, PngCacheData

router = APIRouter(prefix="/api/video-cover", tags=["video-cover"])


@router.get("/{project_id}", response_model=CoverStateResponse)
async def get_cover(project_id: str, current_user=Depends(get_current_user), db=Depends(get_db_session)):
    state = await video_cover_service.get_cover(db, project_id=project_id, user_id=str(current_user.id))
    return CoverStateResponse(success=True, message="ok", data=state)   # data may be None


@router.put("/{project_id}", response_model=CoverStateResponse)
async def upsert_cover(
    project_id: str,
    payload: CoverState,
    current_user=Depends(get_current_user),
    db=Depends(get_db_session),
):
    state = await video_cover_service.upsert_cover(
        db, project_id=project_id, user_id=str(current_user.id), payload=payload
    )
    return CoverStateResponse(success=True, message="ok", data=state)


@router.post("/{project_id}/png-cache", response_model=PngCacheResponse)
async def upload_png_cache(
    project_id: str,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db_session),
):
    if file.content_type != "image/png":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "must be PNG")
    if file.size and file.size > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "file too large (>5MB)")
    url = await video_cover_service.save_png_cache(
        db, project_id=project_id, user_id=str(current_user.id), file=file
    )
    return PngCacheResponse(success=True, message="ok", data=PngCacheData(url=url))


@router.delete("/{project_id}", response_model=CoverStateResponse)
async def delete_cover(project_id: str, current_user=Depends(get_current_user), db=Depends(get_db_session)):
    await video_cover_service.delete_cover(db, project_id=project_id, user_id=str(current_user.id))
    return CoverStateResponse(success=True, message="deleted", data=None)
```

### 5.2 注册到 main.py

```python
# app/main.py
from app.routers import video_cover_router
app.include_router(video_cover_router.router)
```

> 路由前缀 `/api/video-cover` 与 master-plan §7.2 一致。

## 6. Service

```python
# app/services/video_cover_service.py
import os
import aiofiles
from fastapi import HTTPException
from sqlalchemy import select, delete
from app.models.db_models import ProjectCover, VideoProject
from app.models.video_cover_models import CoverState
from app.config import get_settings

settings = get_settings()


async def _verify_project_owner(db, project_id: str, user_id: str) -> VideoProject:
    result = await db.execute(select(VideoProject).where(VideoProject.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(404, "project not found")
    if str(project.user_id) != user_id:
        raise HTTPException(403, "forbidden")
    return project


async def get_cover(db, project_id: str, user_id: str) -> CoverState | None:
    await _verify_project_owner(db, project_id, user_id)
    result = await db.execute(select(ProjectCover).where(ProjectCover.project_id == project_id))
    row = result.scalar_one_or_none()
    if row is None:
        return None
    return CoverState(
        templateId=row.template_id,
        config=row.cover_config,
        imageSource=row.image_source,
        frameVirtualTimeMs=row.frame_virtual_time_ms,
        uploadedImageUrl=row.uploaded_image_url,
        aspectRatio=row.aspect_ratio,
    )


async def upsert_cover(db, project_id: str, user_id: str, payload: CoverState) -> CoverState:
    await _verify_project_owner(db, project_id, user_id)
    result = await db.execute(select(ProjectCover).where(ProjectCover.project_id == project_id))
    row = result.scalar_one_or_none()
    if row is None:
        row = ProjectCover(
            project_id=project_id,
            user_id=user_id,
            template_id=payload.template_id,
            cover_config=payload.config.model_dump(by_alias=True),
            image_source=payload.image_source,
            frame_virtual_time_ms=payload.frame_virtual_time_ms,
            uploaded_image_url=payload.uploaded_image_url,
            aspect_ratio=payload.aspect_ratio,
        )
        db.add(row)
    else:
        row.template_id = payload.template_id
        row.cover_config = payload.config.model_dump(by_alias=True)
        row.image_source = payload.image_source
        row.frame_virtual_time_ms = payload.frame_virtual_time_ms
        row.uploaded_image_url = payload.uploaded_image_url
        row.aspect_ratio = payload.aspect_ratio
    await db.commit()
    return payload


async def save_png_cache(db, project_id: str, user_id: str, file) -> str:
    project = await _verify_project_owner(db, project_id, user_id)
    # 已确认 settings 实际暴露 settings.storage.root（StorageConfig），
    # 不是顶层 settings.storage_root；保持与项目其它服务（如 ark_image_service / storyboard_service）一致。
    storage_root = settings.storage.root
    cover_dir = os.path.join(storage_root, "static", "uploads", "projects", str(project_id), "cover")
    os.makedirs(cover_dir, exist_ok=True)
    cover_path = os.path.join(cover_dir, "cover.png")
    async with aiofiles.open(cover_path, "wb") as f:
        contents = await file.read()
        await f.write(contents)
    public_url = f"/api/storage/files/projects/{project_id}/cover/cover.png"
    project.cover_url = public_url
    await db.commit()
    return public_url


async def delete_cover(db, project_id: str, user_id: str) -> None:
    await _verify_project_owner(db, project_id, user_id)
    await db.execute(delete(ProjectCover).where(ProjectCover.project_id == project_id))
    await db.commit()
```

## 7. Alembic 迁移

### 7.1 文件

```python
# alembic/versions/<ts>_add_project_covers.py
"""add project_covers

Revision ID: ${ts}
Revises: ${last_revision}
Create Date: ${date}
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "${ts}"
down_revision = "${last_revision}"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "project_covers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True),
                  sa.ForeignKey("video_projects.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("template_id", sa.String(50), nullable=False),
        sa.Column("cover_config", sa.JSON(), nullable=False),
        sa.Column("image_source", sa.String(20), nullable=False),
        sa.Column("frame_virtual_time_ms", sa.Integer(), nullable=True),
        sa.Column("uploaded_image_url", sa.String(1000), nullable=True),
        sa.Column("aspect_ratio", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_project_covers_project_id", "project_covers", ["project_id"], unique=True)
    op.create_index("ix_project_covers_user_id", "project_covers", ["user_id"])
    op.create_index("ix_project_covers_user_updated", "project_covers", ["user_id", "updated_at"])


def downgrade():
    op.drop_index("ix_project_covers_user_updated", table_name="project_covers")
    op.drop_index("ix_project_covers_user_id", table_name="project_covers")
    op.drop_index("ix_project_covers_project_id", table_name="project_covers")
    op.drop_table("project_covers")
```

### 7.2 生成命令

```bash
cd backend-services/basic-service
source venv/Scripts/activate
alembic revision -m "add project_covers"
# 编辑 versions/<ts>_add_project_covers.py（粘上述 upgrade/downgrade）
alembic upgrade head
```

### 7.3 部署注意

- 生产部署需先停止后端服务，跑 `alembic upgrade head`，再启动（标准流程）
- 回滚命令：`alembic downgrade -1`

## 8. 文件存储路径

`STORAGE_ROOT/static/uploads/projects/<project_id>/cover/cover.png`

由 FastAPI 已挂载的 `/api/storage/files` 路径访问：

```
public_url = `/api/storage/files/projects/<project_id>/cover/cover.png`
```

> 不复用 `cached_materials/` 目录，因为封面属于"用户产物"而非"缓存的远端素材"。

## 9. 测试计划

### 9.1 `test_video_cover_service.py`

- get_cover 不存在 → 返回 None
- upsert_cover 第一次创建记录
- upsert_cover 第二次更新已有记录
- save_png_cache 正确写入文件 + 更新 video_projects.cover_url
- delete_cover 移除记录但不影响 video_projects.cover_url（业务约定）
- 非 owner 用户调用 → 403

### 9.2 `test_video_cover_router.py`（FastAPI TestClient）

- GET 未认证 → 401
- GET 不存在 project → 404
- PUT 合法 payload → 200 + 数据库写入
- POST png-cache 非 PNG → 400
- POST png-cache 正常 → 200 + 文件落盘 + cover_url 更新
- DELETE → 200 + 记录消失

> SQLite in-memory + 临时 storage_root 目录

## 10. 边界与风险

| 风险 | 缓解 |
|----|------|
| 多设备同时编辑同一封面竞态 | 服务层 `upsert` 是 transactional；最后写入获胜（接受） |
| `project_id` 类型在 PostgreSQL 是 UUID，前端传字符串 | FastAPI 自动将 path param 转 UUID；非法字符串返回 422 |
| 删除项目时没有清理 cover.png 物理文件 | 关注：可在 `video_project_service.delete_project` 中加清理逻辑（非本 spec 范围，后续工单） |
| 上传文件大小未限制（FastAPI 默认）| 路由层显式校验 5MB 上限 |
| `storage_root` 在 Windows 路径分隔符问题 | 使用 `os.path.join` |
| Alembic 版本号冲突（多人同时新增迁移）| 跑 `alembic merge` 解决；不在本 spec 处理 |
| `data: None` 在 BaseResponse 默认是 dict 时反序列化问题 | **已确认** `app/models/base_models.py:16` 中 `data: Optional[Any] = Field(default=None, ...)`，允许 `data=None`，无须额外处理 |

## 11. Dependencies

- 上游：master-plan §6
- 下游：spec 07（前端调用这些路由）
- 后端依赖：现有 `get_db_session`、`get_current_user`（**已确认**位于 `app/dependencies/auth.py`，从 `app.dependencies` 包级别 re-export，import 路径 `from app.dependencies import get_current_user`）、`config.settings.storage.root`、`/api/storage/files` 静态挂载

## 12. 完成条件

- [ ] ORM 模型可被 `alembic upgrade head` 成功建表
- [ ] 服务层全部单测通过
- [ ] 路由层全部单测通过
- [ ] 上传 PNG 后能通过 `/api/storage/files/...` 公开 URL 访问
- [ ] 数据库 1:1 约束生效（重复 project_id 报错）
