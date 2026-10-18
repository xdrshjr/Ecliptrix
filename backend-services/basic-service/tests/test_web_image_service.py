import io
from PIL import Image
import pytest


def test_image_reencoding_hashes_final_bytes_and_rejects_svg(tmp_path):
    from app.services.web_research.media_worker import validate_image
    source = tmp_path / 'input.part'
    target = tmp_path / 'output.part'
    Image.new('RGB', (8, 9), 'red').save(source, format='JPEG')
    metadata = validate_image(source, target)
    assert metadata['width'] == 8 and metadata['height'] == 9
    assert metadata['format'] == 'png'
    assert target.read_bytes().startswith(b'\x89PNG')
    source.write_text('<svg/>')
    with pytest.raises(Exception):
        validate_image(source, target)
