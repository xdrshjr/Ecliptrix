"""
API routers for the Basic Service application.
"""

from . import api_router
from . import video_router
from . import tts_router
from . import supabase_router
from . import audio_router

__all__ = [
    "api_router",
    "video_router", 
    "tts_router",
    "supabase_router",
    "audio_router"
] 