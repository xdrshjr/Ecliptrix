"""Shared source-pixel boxes. Admission rejects only inevitable line overflow."""
import json
from pathlib import Path

from app.models.effects_models import EffectError
from .catalog import TEMPLATES

RULE_PATH = Path(__file__).with_name("text-layout.generated.json")

def load_rules() -> dict:
    try:
        rules = json.loads(RULE_PATH.read_bytes())
        components = {entry["componentId"] for entry in TEMPLATES.values()}
        if rules["schemaVersion"] != 1 or set(rules["components"]) != components:
            raise ValueError("incomplete layout rules")
        return rules["components"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise EffectError("EFFECT_RUNTIME_MISMATCH", status=503) from exc

def normalize_display_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")

def get_effect_text_box(document: dict, field: str) -> dict:
    rule = load_rules()[TEMPLATES[document["template_id"]]["componentId"]]
    w, h = document["canvas"]["width"], document["canvas"]["height"]
    width, height = w * rule["widthRatio"], h * rule["heightRatio"]
    if rule["kind"] == "product":
        if w <= h * 1.5:
            height = h * (0.15 if field == "title" else 0.10)
        else:
            side = min(document["params"]["cardScale"] * min(w, h), h * 0.85)
            width = min(w * 0.4, w * 0.88 - side - min(w, h) * 0.03)
    elif rule["kind"] == "callout":
        top = h * (0.12 if document["params"]["pointY"] > 0.5 else 0.72)
        height = min(h * 0.35, h * 0.94 - top)
    if width <= 0 or height <= 0:
        raise EffectError("EFFECT_TEXT_OVERFLOW", status=422)
    return dict(width=width, height=height, sizeRatio=rule["sizeRatio"][field],
                minScale=0.6, lineHeight=1.3)

def validate_text_layout(document: dict, resource_root: Path) -> None:
    # The runtime closure is checked separately. Do not measure fallback shaping
    # with Pillow or send LF/CR to its native getlength implementation.
    try:
        manifest = json.loads((resource_root / "fonts/manifest.json").read_bytes())
        fonts = [entry for entry in manifest["fonts"]
                 if entry.get("role") == "font"]
        if (manifest.get("schemaVersion") != 2
                or {entry["family"] for entry in fonts} != {"sans", "serif", "mono", "emoji"}
                or any(not (resource_root / "fonts" / entry["path"]).is_file() for entry in fonts)):
            raise ValueError("incomplete fonts")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise EffectError("EFFECT_RUNTIME_UNAVAILABLE", status=503) from exc
    rule = load_rules()[TEMPLATES[document["template_id"]]["componentId"]]
    for field in rule["renderedFields"]:
        text = document["content"][field]
        if not text:
            continue
        box = get_effect_text_box(document, field)
        minimum = min(document["canvas"]["width"], document["canvas"]["height"]) * box["sizeRatio"] * document["typography"]["scale"] * box["minScale"]
        if len(normalize_display_text(text).split("\n")) * minimum * box["lineHeight"] > box["height"] + 1e-6:
            raise EffectError("EFFECT_TEXT_OVERFLOW", "文字超出安全区", 422,
                              {"fields": [{"path": f"content.{field}"}]})
