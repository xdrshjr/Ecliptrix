"""从已保存的项目文档选择首个真实视频片段，不执行 IO。"""
from dataclasses import dataclass
import math
from urllib.parse import urlsplit


@dataclass(frozen=True)
class ProjectThumbnailSelection:
    origin: str
    track_id: str | None
    item_id: str | None
    material_id: str | None
    start_time: float
    track_order: float
    clip_start: float
    clip_end: float
    duration: float
    references: tuple[str, ...]
    remote_urls: tuple[str, ...]
    source: str | None
    source_id: str | None


def _dictionary(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _array(value: object) -> list:
    return value if isinstance(value, list) else []


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _number(value: object) -> bool:
    if not isinstance(value, (float, int)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _is_video(item: dict, material: dict) -> bool:
    types = [obj[key] for obj, key in ((item, "originalMaterialType"), (material, "type"))
             if key in obj]
    if "video" not in types or any(value != "video" for value in types):
        return False
    for obj in (item, material):
        metadata = _dictionary(obj.get("metadata"))
        cover = _dictionary(metadata.get("cover"))
        if metadata.get("role") == "video-cover" or any(
            _text(cover.get(key)) for key in ("revisionId", "assetId")
        ):
            return False
    return True


def _references(obj: dict) -> list[str]:
    metadata = _dictionary(obj.get("metadata"))
    fields = [(metadata, "localResolvedUrl"), (obj, "localResolvedUrl"),
              (obj, "cacheUrl"), (obj, "storageKey"), (metadata, "storageKey"),
              (obj, "url"), (obj, "serverUrl")]
    return ["/api/storage/files/" + value if key == "storageKey" else value
            for container, key in fields if (value := _text(container.get(key)))]


def _cache_identity(metadata: dict, fallback: dict) -> tuple[str | None, str | None]:
    # 来源与 ID 是同一条身份，不能把新素材来源和旧快照 ID 拼接。
    for record in (metadata, fallback):
        source, identifier = _text(record.get("source")), _text(record.get("sourceId"))
        if source and identifier:
            return source, identifier
    return None, None


def _describe(item: dict, material: dict, position: tuple) -> ProjectThumbnailSelection:
    origin, track_id, order = position
    metadata = _dictionary(material.get("metadata"))
    fallback = _dictionary(item.get("metadata"))
    remote = []
    for obj in (material, item):
        for value in (obj.get("serverUrl"), obj.get("url"),
                      _dictionary(obj.get("metadata")).get("originalUrl")):
            try:
                is_remote = bool(_text(value)) and urlsplit(value).scheme in {"http", "https"}
            except ValueError:
                is_remote = False
            if is_remote:
                remote.append(value)
    start = item.get("clipStart", 0)
    duration = item["duration"]
    source, source_id = _cache_identity(metadata, fallback)
    return ProjectThumbnailSelection(
        origin, _text(track_id), _text(item.get("id")),
        _text(item.get("materialId")), item["startTime"], order, start,
        item.get("clipEnd", start + duration), duration,
        tuple(dict.fromkeys(_references(material) + _references(item))),
        tuple(dict.fromkeys(remote)),
        source, source_id,
    )


def _valid_item(item: dict, material: dict) -> bool:
    start, duration = item.get("startTime"), item.get("duration")
    opacity, clip_start = item.get("opacity", 1), item.get("clipStart", 0)
    if not all(_number(value) for value in (start, duration, opacity, clip_start)):
        return False
    if start < 0 or duration <= 0 or opacity <= 0 or clip_start < 0:
        return False
    clip_end = item.get("clipEnd", clip_start + duration)
    return (item.get("type") == "video" and _is_video(item, material)
            and _number(clip_end) and clip_end > clip_start)


def _material_index(data: dict, origin: str) -> dict:
    index = {}
    fields = ("pendingMaterials", "materials") if origin == "pending" else ("materials",)
    for field in fields:
        for raw in _array(data.get(field)):
            material = _dictionary(raw)
            identifier = _text(material.get("id"))
            if identifier:
                index.setdefault(identifier, material)
    return index


def _from_timeline(data: dict, timeline: object, origin: str) -> ProjectThumbnailSelection | None:
    materials, candidates = _material_index(data, origin), []
    for track_index, raw in enumerate(_array(_dictionary(timeline).get("tracks"))):
        track = _dictionary(raw)
        if track.get("type") != "video" or track.get("isVisible") is False:
            continue
        order = track.get("order", 0)
        order = order if _number(order) else 0
        for item_index, raw_item in enumerate(_array(track.get("items"))):
            item = _dictionary(raw_item)
            material = materials.get(_text(item.get("materialId")), {})
            if _valid_item(item, material):
                selection = _describe(item, material, (origin, track.get("id"), order))
                candidates.append(((selection.start_time, -order, track_index, item_index), selection))
    return min(candidates, key=lambda entry: entry[0])[1] if candidates else None


def select_project_thumbnail(project_data: dict | None) -> ProjectThumbnailSelection | None:
    """尊重权威时间线键，包括显式清空及损坏值，避免旧片复活。"""
    data = _dictionary(project_data)
    ui_state = _dictionary(data.get("uiState"))
    if "currentTimelineState" in ui_state:
        return _from_timeline(data, ui_state["currentTimelineState"], "timeline")
    if "pendingTimelineData" in data:
        return _from_timeline(data, data["pendingTimelineData"], "pending")
    for raw in _array(data.get("scriptSegments")):
        for raw_video in _array(_dictionary(raw).get("videos")):
            video = _dictionary(raw_video)
            if video.get("type") == "video" and _is_video(video, video):
                item = {**video, "startTime": 0, "duration": 1,
                        "clipStart": 0, "clipEnd": 1, "materialId": video.get("id")}
                return _describe(item, video, ("legacy-segment", None, 0))
    return None
