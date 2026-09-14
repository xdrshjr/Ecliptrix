"""The unused AI video generation workflow is no longer mounted (BL-14).

The service behind it had no caller anywhere in the repository, bypassed Model
Settings and described volume on a scale that contradicts AI mixing. Its old
names are deliberately not spelled out here so the A11 gate grep stays at 0.
"""

from app.main import app

REMOVED_PATH = "/api/workflow/ai-video-generate"


def test_workflow_video_generation_route_is_not_mounted():
    mounted_paths = {getattr(route, "path", None) for route in app.routes}

    assert "/api/ai-mixed-editing" in mounted_paths
    assert REMOVED_PATH not in mounted_paths
