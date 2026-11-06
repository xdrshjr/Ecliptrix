"""旧共享凭证的一次性事务迁移；事务由调用方提交。"""

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import LOCAL_OWNER_NAME
from app.models.db_models import IntegrationCredential, SettingsAuditLog
from app.services.secret_values import is_usable_secret


async def migrate_media_credentials(
    session: AsyncSession,
    rows: Sequence[IntegrationCredential],
    image_environment_configured: bool,
) -> None:
    """标记和图片行在同一事务中；不创建或读取视频凭证。"""
    by_id = {row.integration_id: row for row in rows}
    legacy = by_id.get("ark")
    if legacy is None or (legacy.fields or {}).get("_media_split_v1") is True:
        return
    fields = dict(legacy.fields or {})
    key = fields.get("api_key")
    if "ark_image" not in by_id and not image_environment_configured and is_usable_secret(key):
        session.add(IntegrationCredential(integration_id="ark_image", fields={"api_key": key.strip()}))
    legacy.fields = {**fields, "_media_split_v1": True}
    session.add(SettingsAuditLog(
        setting_type="integration", category="credentials", key="ark_image",
        action="media_split_v1", changed_by=LOCAL_OWNER_NAME,
    ))
    await session.flush()
