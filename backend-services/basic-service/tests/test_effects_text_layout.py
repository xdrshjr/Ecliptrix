"""共享规则和换行预检；真实 shaping 由浏览器专项负责。"""
import hashlib
import json
from pathlib import Path

import pytest

from app.models.effects_models import EffectError
from app.services.effects.catalog import create_document, document_hash
from app.services.effects.recovery import validate_text_layout

ROOT = Path(__file__).resolve().parents[3]
RESOURCES = ROOT / "desktop/build/effects"

@pytest.mark.parametrize("text", ["First line\nSecond line", "第一行\r\nSecond line", "第一行\rSecond line", "一\n\n二\n", "\t"])
def test_multiline_layout_breaks(text):
    document = create_document("title-rise")
    document["content"]["title"] = text
    original = document_hash(document)
    validate_text_layout(document, RESOURCES)
    assert document_hash(document) == original

def test_slideshow_explicit_lines_exceed_only_its_box():
    document = create_document("slides-crossfade")
    document["content"]["title"] = "一\n二\n三\n四\n五"
    with pytest.raises(EffectError) as failure:
        validate_text_layout(document, RESOURCES)
    assert failure.value.code == "EFFECT_TEXT_OVERFLOW"
    assert failure.value.details["fields"][0]["path"] == "content.title"
    document["template_id"] = "title-rise"
    validate_text_layout(document, RESOURCES)

def test_hidden_subtitle_does_not_reject():
    document = create_document("type-lines")
    document["content"]["subtitle"] = "\n" * 299
    validate_text_layout(document, RESOURCES)

def test_text_layout_golden_boxes():
    from app.services.effects.text_layout import get_effect_text_box
    vectors = json.loads((ROOT / "src/lib/effects/__fixtures__/text-layout-vectors.json").read_text(encoding="utf-8"))
    for vector in vectors:
        document = create_document(vector["templateId"])
        document.update(canvas=vector["canvas"], params=vector["params"])
        document["typography"]["scale"] = vector["scale"]
        assert get_effect_text_box(document, vector["field"]) == pytest.approx(vector["expectedBox"])

def test_text_layout_manifest_mismatch(tmp_path):
    from app.services.effects.runtime_client import EffectsRuntimeClient
    manifest = json.loads((RESOURCES / "manifest.json").read_text(encoding="utf-8"))
    manifest["textLayoutHash"] = "0" * 64
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    client = EffectsRuntimeClient()
    client.resource_root = tmp_path
    with pytest.raises(EffectError, match="EFFECT_RUNTIME_MISMATCH"):
        client.load_manifest()

def test_generated_layout_matches_source():
    source = (ROOT / "src/lib/effects/textLayout.json").read_bytes()
    generated = (ROOT / "backend-services/basic-service/app/services/effects/text-layout.generated.json").read_bytes()
    assert source == generated
    manifest = json.loads((RESOURCES / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["textLayoutHash"] == hashlib.sha256(source).hexdigest()
