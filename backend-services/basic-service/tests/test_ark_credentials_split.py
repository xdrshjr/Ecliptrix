"""图片与视频凭证独立、迁移原子性及故障关闭。"""

import pytest

from app import config
from app.models.db_models import IntegrationCredential
from app.services import integration_credentials_service as module
from app.services.integration_registry import get_spec


@pytest.mark.asyncio
async def test_image_and_video_save_clear_and_restart_are_independent(integration_db):
    store = module.integration_credentials
    assert get_spec("ark_image") is not None
    assert get_spec("ark_video") is not None
    await store.save("ark_image", {"api_key": "fake-image-key-111"})
    assert not store.is_usable("ark_video")
    await store.save("ark_video", {"api_key": "fake-video-key-222"})
    await store.clear("ark_image")
    store.reset()
    await store.load_all()
    assert store.value("ark_image", "api_key") == ""
    assert store.value("ark_video", "api_key") == "fake-video-key-222"


@pytest.mark.asyncio
async def test_legacy_migrates_only_once_to_image(integration_db):
    async with integration_db() as session:
        session.add(IntegrationCredential(integration_id="ark", fields={"api_key": "legacy-fake-key-111"}))
        await session.commit()
    store = module.integration_credentials
    await store.load_all()
    assert store.value("ark_image", "api_key") == "legacy-fake-key-111"
    assert store.value("ark_video", "api_key") == ""
    await store.clear("ark_image")
    store.reset()
    await store.load_all()
    assert store.value("ark_image", "api_key") == ""
    async with integration_db() as session:
        legacy = await session.get(IntegrationCredential, "ark")
        assert legacy.fields["_media_split_v1"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("new_row,new_environment", [(True, False), (False, True)])
async def test_migration_does_not_overwrite_new_image_configuration(
    integration_db, monkeypatch, new_row, new_environment,
):
    if new_environment:
        monkeypatch.setattr(config.settings, "ark_image_api_key", "new-env-key-111")
    async with integration_db() as session:
        session.add(IntegrationCredential(integration_id="ark", fields={"api_key": "legacy-key-111"}))
        if new_row:
            session.add(IntegrationCredential(integration_id="ark_image", fields={"api_key": "new-db-key-111"}))
        await session.commit()
    await module.integration_credentials.load_all()
    expected = "new-db-key-111" if new_row else "new-env-key-111"
    assert module.integration_credentials.value("ark_image", "api_key") == expected


def test_legacy_environment_is_image_only(monkeypatch):
    monkeypatch.setattr(config.settings, "ark_api_key", "legacy-env-key-111")
    assert module.integration_credentials.value("ark_image", "api_key") == "legacy-env-key-111"
    assert module.integration_credentials.value("ark_video", "api_key") == ""
    assert module.integration_credentials.resolve("ark_image").configuration_warning == "legacy_image_environment"


@pytest.mark.asyncio
async def test_failed_load_blocks_media_reads_and_writes_even_with_environment(integration_db, monkeypatch):
    store = module.integration_credentials
    monkeypatch.setattr(config.settings, "ark_api_key", "legacy-env-key-111")
    store.load_failed = True
    assert not store.resolve("ark_image").usable
    for integration_id in ("ark_image", "ark_video"):
        with pytest.raises(Exception, match="integration_load_failed"):
            store.value(integration_id, "api_key")
        with pytest.raises(Exception, match="integration_load_failed"):
            await store.save(integration_id, {"api_key": "new-fake-key-111"})
        with pytest.raises(Exception, match="integration_load_failed"):
            await store.clear(integration_id)


@pytest.mark.asyncio
async def test_migration_failure_rolls_back_marker_and_image(integration_db, monkeypatch):
    from app.services import integration_credential_migration as migration
    async with integration_db() as session:
        session.add(IntegrationCredential(integration_id="ark", fields={"api_key": "legacy-key-111"}))
        await session.commit()
    original = migration.migrate_media_credentials

    async def broken(session, rows, image_environment_configured):
        await original(session, rows, image_environment_configured)
        raise RuntimeError("simulated migration failure")

    monkeypatch.setattr(migration, "migrate_media_credentials", broken)
    await module.integration_credentials.load_all()
    assert module.integration_credentials.load_failed
    async with integration_db() as session:
        assert await session.get(IntegrationCredential, "ark_image") is None
        assert "_media_split_v1" not in (await session.get(IntegrationCredential, "ark")).fields
    monkeypatch.setattr(migration, "migrate_media_credentials", original)
    await module.integration_credentials.load_all()
    assert not module.integration_credentials.load_failed
    assert module.integration_credentials.value("ark_image", "api_key") == "legacy-key-111"
