"""Stable "credential not configured" error (setup-wizard-full-capability-coverage §3.4).

Routers call :func:`require_configured` BEFORE touching a service, because some
services answer a missing key with ``None`` / an empty result that the UI would
render as "no search results". The app-level handler in ``main.py`` turns the
exception into the shared ``ErrorResponse`` envelope with the stable code
``credential_not_configured`` and ``error_details.integration_id`` so the
frontend can offer a "go configure it" button instead of parsing English text.
"""

from __future__ import annotations

from app.services.integration_credentials_service import integration_credentials

CREDENTIAL_NOT_CONFIGURED = "credential_not_configured"
NOT_CONFIGURED_STATUS = 409

_MESSAGES = {
    "volcano_tts": "Speech synthesis is not configured.",
    "volcano_asr": "Speech recognition (subtitles) is not configured.",
    "volcano_voice_clone": "Voice cloning is not configured.",
    "ark": "AI image/video generation (Volcano Ark) is not configured.",
    "pexels": "The Pexels video library is not configured.",
    "unsplash": "The Unsplash image library is not configured.",
    "freesound": "The Freesound sound library is not configured.",
}


class CredentialNotConfigured(Exception):
    """A feature was requested whose required credentials are missing."""

    def __init__(self, integration_id: str) -> None:
        self.integration_id = integration_id
        self.message = (
            f"{_MESSAGES.get(integration_id, 'This service is not configured.')} "
            "Open Settings -> Services & asset libraries to set it up."
        )
        super().__init__(self.message)


def require_configured(integration_id: str) -> None:
    """Raise :class:`CredentialNotConfigured` unless the integration is usable.

    Raises:
        CredentialNotConfigured: a required field has no usable value.
        UnknownIntegrationError: ``integration_id`` is not in the registry.
    """
    if not integration_credentials.is_usable(integration_id):
        raise CredentialNotConfigured(integration_id)
