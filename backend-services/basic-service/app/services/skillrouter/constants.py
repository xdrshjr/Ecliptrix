"""Static tables of the SkillRouter gateway integration (spec §2.1, §3.6).

Leaf module: imports nothing from the app, so the credential store can load it
lazily without an import cycle.
"""

from __future__ import annotations

from typing import Dict, Tuple

DEFAULT_BASE_URL = "https://www.skillrouter.net"
INTEGRATION_ID = "skillrouter"

#: LLM slots covered by the relay (``coding`` is folded into ``chat``).
LLM_SLOTS: Tuple[str, ...] = ("chat", "fast", "video_cut", "vision", "research")

#: Ecliptrix capability -> gateway capability ("llm" for the five LLM slots).
ROUTER_CAPABILITY_MAP: Dict[str, str] = {
    **{slot: "llm" for slot in LLM_SLOTS},
    "tts": "tts",
    "ai_image": "ai_image",
    "ai_video": "ai_video",
    "video_library": "video_search",
    "image_library": "image_search",
    "audio_library": "audio_search",
}

ROUTED = frozenset(ROUTER_CAPABILITY_MAP)

#: Capabilities the gateway does not offer: they always use manual configuration.
MANUAL_ONLY = frozenset({"web_search", "asr", "voice_clone"})

#: Credential integration -> capability it unlocks (only the routable ones).
INTEGRATION_TO_CAPABILITY: Dict[str, str] = {
    "volcano_tts": "tts",
    "ark_image": "ai_image",
    "ark_video": "ai_video",
    "pexels": "video_library",
    "unsplash": "image_library",
    "freesound": "audio_library",
}

PROTOCOLS = ("openai", "anthropic")
VIDEO_JOB_PREFIX = "sr_"
