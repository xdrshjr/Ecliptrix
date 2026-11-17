"""Single catalog export, strict document normalization and renderability."""

import base64
import copy
import hashlib
import json
import math
from pathlib import Path

from pydantic import ValidationError

from app.models.effects_models import EffectDocument, EffectError

CATALOG_BYTES = Path(__file__).with_name("catalog.generated.json").read_bytes()
CATALOG_HASH = hashlib.sha256(CATALOG_BYTES).hexdigest()
CATALOG = json.loads(CATALOG_BYTES)
TEMPLATES = {entry["id"]: entry for entry in CATALOG["templates"]}
ACTIVE = ("queued", "running", "cancelling")
TERMINAL = ("succeeded", "failed", "cancelled", "interrupted")


def document_hash(value: dict) -> str:
    """Hash canonical immutable JSON; reject non-finite values."""
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_template(identifier: str) -> dict:
    """Resolve only a built-in, versioned template."""
    if identifier not in TEMPLATES:
        raise EffectError("EFFECT_TEMPLATE_INCOMPATIBLE", status=409)
    return TEMPLATES[identifier]


def create_document(identifier: str = "title-rise") -> dict:
    """Create an editable draft without silently supplying user content."""
    template = get_template(identifier)
    return EffectDocument(template_id=identifier,
                          params=copy.deepcopy(template["defaults"])) \
        .model_dump(exclude_none=True)


def _validate_parameter(value, schema: dict) -> bool:
    kind = schema["type"]
    if kind == "string":
        return (isinstance(value, str)
                and len(value) <= schema.get("maxLength", 300)
                and value in schema.get("enum", [value]))
    if kind == "array":
        return (isinstance(value, list)
                and schema["minItems"] <= len(value) <= schema["maxItems"]
                and all(_validate_parameter(item, schema["items"])
                        for item in value))
    return (type(value) in (int, float) and math.isfinite(value)
            and (kind != "integer" or int(value) == value)
            and schema["minimum"] <= value <= schema["maximum"])


def _validate_bindings(document: dict, template: dict) -> None:
    bindings = document["inputs"]
    slots = {slot["id"]: slot for slot in template["slots"]}
    video_count = sum(binding["kind"] == "video" for binding in bindings)
    if video_count > 1 or len(bindings) - video_count > 8:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "inputs.count")
    for binding in bindings:
        slot = slots.get(binding["slot"])
        if not slot or binding["kind"] not in slot["kinds"]:
            raise EffectError("EFFECT_INVALID_ARGUMENT", "inputs.slot")
    for identifier, slot in slots.items():
        selected = [item for item in bindings if item["slot"] == identifier]
        if len(selected) > slot["max"]:
            raise EffectError("EFFECT_INVALID_ARGUMENT", "inputs.count")
        if identifier == "images" and sorted(item["index"]
                for item in selected) != list(range(len(selected))):
            raise EffectError("EFFECT_INVALID_ARGUMENT", "inputs.index")


def normalize_document(value: dict) -> dict:
    """Normalize defaults, rejecting malformed structure even for drafts."""
    try:
        document = EffectDocument.model_validate(value) \
            .model_dump(exclude_none=True)
    except (ValidationError, ValueError) as exc:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "文档字段无效") from exc
    template = get_template(document["template_id"])
    if document["template_version"] != template["version"]:
        raise EffectError("EFFECT_TEMPLATE_INCOMPATIBLE", status=409)
    supplied = document["params"]
    if set(supplied) - set(template["parameterSchema"]):
        raise EffectError("EFFECT_INVALID_ARGUMENT", "params.unknown")
    document["params"] = {**copy.deepcopy(template["defaults"]), **supplied}
    for key, schema in template["parameterSchema"].items():
        if not _validate_parameter(document["params"][key], schema):
            raise EffectError("EFFECT_INVALID_ARGUMENT", f"params.{key}")
    _validate_bindings(document, template)
    return document


def renderability(document: dict) -> dict:
    """Missing required content blocks rendering without rejecting a save."""
    template = get_template(document["template_id"])
    paths = [f"content.{key}" for key in template["requiredContent"]
             if not document["content"][key].strip()]
    for slot in template["slots"]:
        if sum(item["slot"] == slot["id"] for item in document["inputs"]) \
                < slot["min"]:
            paths.append(f"inputs.{slot['id']}")
    return {"ready": not paths, "errors": [
        {"path": path, "code": "EFFECT_DRAFT_INCOMPLETE",
         "messageKey": "effects.required"} for path in paths]}


def to_runtime_document(document: dict) -> dict:
    """Map only fixed wire keys; preserve arbitrary template parameter keys."""
    names = {"schema_version": "schemaVersion", "template_id": "templateId",
             "template_version": "templateVersion",
             "duration_frames": "durationFrames"}
    result = {names.get(key, key): value for key, value in document.items()
              if key != "inputs"}
    binding_names = {"asset_id": "assetId", "focal_x": "focalX",
                     "focal_y": "focalY",
                     "trim_start_seconds": "trimStartSeconds"}
    result["inputs"] = [{binding_names.get(key, key): value
                         for key, value in binding.items()}
                        for binding in document["inputs"]]
    return result


def descriptor(template: dict, *, full: bool = False) -> dict:
    """Expose a summary until a caller explicitly asks for one schema."""
    names = {"libraryId": "library_id", "nameKey": "name_key",
             "descriptionKey": "description_key",
             "allowedInputKinds": "allowed_input_kinds"}
    fields = ["id", "version", "libraryId", "nameKey", "descriptionKey",
              "thumbnail", "allowedInputKinds"]
    result = {names.get(key, key): template[key] for key in fields}
    if full:
        result.update(parameter_schema=template["parameterSchema"],
                      defaults=template["defaults"], slots=template["slots"],
                      required_content=template["requiredContent"],
                      min_frames=template["minFrames"],
                      max_frames=template["maxFrames"],
                      component_id=template["componentId"],
                      variant=template["variant"],
                      demo_preview=template["demoPreview"])
    return result


def page_slice(items: list, cursor: str | None, page_size: int) -> dict:
    """Bound opaque pagination by immutable sorted identifiers."""
    if not 1 <= page_size <= 50:
        raise EffectError("EFFECT_INVALID_ARGUMENT", "page_size")
    offset = 0
    if cursor:
        try:
            offset = int(base64.urlsafe_b64decode(cursor).decode("ascii"))
            if offset < 0:
                raise ValueError("negative cursor")
        except (ValueError, UnicodeError) as exc:
            raise EffectError("EFFECT_INVALID_ARGUMENT", "cursor") from exc
    end = offset + page_size
    next_cursor = base64.urlsafe_b64encode(str(end).encode()).decode() \
        if end < len(items) else None
    return {"items": items[offset:end], "next_cursor": next_cursor}
