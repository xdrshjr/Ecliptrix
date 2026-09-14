"""
API routers for the Basic Service application.
"""

from . import api_router
from . import video_router
from . import tts_router
from . import storage_router
from . import audio_router
from . import youtube_router
from . import image_router
from . import timeline_export_router
from . import timeline_import_router
from . import chat_router
from . import ai_mixed_editing_router
from . import voice_clone_router
from . import material_router
from . import media_proxy_router
from . import config_router

__all__ = [
    "api_router",
    "video_router",
    "tts_router",
    "storage_router",
    "audio_router",
    "youtube_router",
    "image_router",
    "timeline_export_router",
    "timeline_import_router",
    "chat_router",
    "ai_mixed_editing_router",
    "voice_clone_router",
    "material_router",
    "media_proxy_router",
    "config_router",
]
