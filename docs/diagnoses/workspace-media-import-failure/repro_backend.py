"""离线回归：真实路径解析、素材提交、SQLite 约束和音频时长。

这里只替换运行配置、日志装配和服务单例，不修改业务函数。
所有临时文件留在本报告目录下；不读取用户配置或连接实际数据库。
断言已转为正确行为；音频探测使用本机已安装的 ffprobe。
"""
import asyncio
import hashlib
import json
import logging
import shutil
import sys
import tempfile
import types
import wave
from pathlib import Path

sys.dont_write_bytecode = True
REPORT_DIR = Path(__file__).resolve().parent
REPO = REPORT_DIR.parents[2]
BACKEND = REPO / "backend-services/basic-service"
sys.path.insert(0, str(BACKEND))


def configure_isolation(directory):
    """绕过服务包的全量视频组件装配，注入本次临时存储配置。"""
    for name in ("services", "routers"):
        package = types.ModuleType("app." + name)
        package.__path__ = [str(BACKEND / "app" / name)]
        sys.modules["app." + name] = package
    config = types.ModuleType("app.config")
    config.settings = types.SimpleNamespace(
        storage=types.SimpleNamespace(root=str(directory / "storage")))
    sys.modules["app.config"] = config
    logger = types.ModuleType("app.logger")
    logger.get_logger = logging.getLogger
    sys.modules["app.logger"] = logger
    settings = types.ModuleType("app.services.system_settings_service")
    settings.toolkit_settings = lambda: {
        "enabled": True, "workspace_enabled": True,
        "workspace_quota_mb": 100, "max_file_mb": 50,
    }
    sys.modules["app.services.system_settings_service"] = settings


def report(label, **fields):
    print(label + " " + json.dumps(fields, ensure_ascii=False), flush=True)


def make_wav(target):
    with wave.open(str(target), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(8000)
        handle.writeframes(b"\x00\x00" * 12000)


async def reproduce(directory):
    from sqlalchemy import event, select
    from sqlalchemy.dialects.postgresql import UUID
    from sqlalchemy.ext.compiler import compiles
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.models.agent_toolkit_models import AgentToolkitError
    from app.models.db_models import CachedMaterial
    from app.routers import agent_toolkit_router as router
    from app.services.agent_host.shell_runner import _resolve_cwd
    from app.services.agent_toolkit import workspace_store
    from app.services import material_download_service as downloads

    # 与生产 database.py 相同的 SQLite UUID 编译规则。
    @compiles(UUID, "sqlite")
    def compile_uuid(element, compiler, **kwargs):
        return "CHAR(36)"

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sql_errors = []

    @event.listens_for(engine.sync_engine, "handle_error")
    def capture_error(context):
        sql_errors.append(str(context.original_exception))

    service = downloads.MaterialDownloadService()
    service._session_factory = async_sessionmaker(
        engine, expire_on_commit=False)
    # 使用同一测试循环/内存库；保留真实 _dispatch 与全部提交逻辑。
    service._ensure_loop = asyncio.get_running_loop
    downloads.get_material_download_service = lambda: service
    try:
        async with engine.begin() as connection:
            await connection.run_sync(CachedMaterial.__table__.create)

        project_id = "diagnosis-workspace-bgm"
        cwd = _resolve_cwd({"shell_scope": "workspace"}, project_id, None)
        source = cwd / "bgm.wav"
        make_wav(source)
        body = router.WorkspaceImportRequest(
            project_id=project_id, name="bgm.wav")

        try:
            await router._import_material(body)
        except AgentToolkitError as error:
            assert error.error_code == "workspace_not_found"
            report("复现一：根目录产物未被导入", error_code=error.error_code,
                   status=error.status_code, root_file_exists=source.is_file())
        else:
            raise AssertionError("预期根目录文件无法按 files/ 相对名导入")

        target = cwd / "files/bgm.wav"
        shutil.copyfile(source, target)
        listing = workspace_store.list_files(project_id)
        assert [item["name"] for item in listing["files"]] == ["bgm.wav"]
        report("对照一：存储层列表正常", names=["bgm.wav"])

        first = await router._import_material(body)
        assert first['duration'] == 1.5
        assert not first['metadata']['reused']
        assert sql_errors == []
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        source_id = "workspace-" + digest[:24]
        local_url = (
            "/api/storage/files/cached_materials/workspace/"
            + source_id + ".wav")
        assert first['local_url'] == local_url
        from app.services.local_media_resolver import resolve_media_reference
        looked_up = await service.lookup_by_url_async(local_url)
        resolved = resolve_media_reference(local_url)
        assert Path(looked_up).resolve() == resolved.path.resolve()
        async with service._session_factory() as session:
            row = (await session.execute(select(CachedMaterial))).scalar_one()
            assert row.source_url == local_url
            assert Path(row.local_path).read_bytes() == target.read_bytes()
        assert target.is_file()
        report('首次导入成功', duration=first['duration'], local_url=local_url,
               sqlite_errors=sql_errors, source_preserved=True)

        imported = await router._import_material(body)
        assert imported["metadata"]["reused"] is True
        assert imported["duration"] == 1.5
        assert imported['id'] == first['id']
        assert imported['local_url'] == first['local_url']
        assert len(list((service.cache_dir / 'workspace').iterdir())) == 1
        with wave.open(str(target), "rb") as handle:
            actual_duration = handle.getnframes() / handle.getframerate()
        report("重复导入稳定复用且保留真实时长",
               actual_duration=actual_duration,
               returned_duration=imported["duration"],
               reused=imported["metadata"]["reused"])
    finally:
        await engine.dispose()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    with tempfile.TemporaryDirectory(
            prefix="diagnosis-", dir=REPORT_DIR) as temporary:
        directory = Path(temporary).resolve()
        # 验证自动清理的绝对目标始终在报告目录内。
        assert directory.is_relative_to(REPORT_DIR)
        assert REPORT_DIR.is_relative_to(REPO)
        configure_isolation(directory)
        asyncio.run(reproduce(directory))
    report("修复回归完成", live_project_modified=False)


if __name__ == "__main__":
    main()
