"""图片解码与 HTML 解析在可终止子进程内运行，不阻塞 ASGI。"""
import asyncio
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import warnings


def validate_image(source, target):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 40_000_000
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(source) as image:
            if image.format not in {"JPEG", "PNG", "WEBP", "GIF"}:
                raise ValueError("not_an_image")
            image.verify()
        with Image.open(source) as image:
            width, height = image.size
            if width * height > 40_000_000:
                raise ValueError("response_too_large")
            animated = getattr(image, "n_frames", 1) > 1
            image.seek(0)
            # 新建像素图丢弃 EXIF、ICC、注释和其他载荷。
            mode = "RGBA" if "A" in image.getbands() else "RGB"
            clean = Image.new(mode, image.size)
            clean.paste(image.convert(mode))
            clean.save(target, format="PNG")
    return {"type": "image", "format": "png", "width": width,
            "height": height, "first_frame_only": animated}


def probe_metadata(probe):
    from app.models.web_research_models import WebResearchError
    streams = probe.get("streams", [])
    audio = any(s.get("codec_type") == "audio" for s in streams)
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    try:
        duration = float(probe.get("format", {}).get("duration", 0))
    except (ValueError, TypeError):
        duration = 0
    if not (audio or video) or not math.isfinite(duration) or duration <= 0:
        raise WebResearchError("unsupported_media_type")
    formats = probe.get("format", {}).get("format_name", "").split(",")
    accepted = {"mp4", "mov", "m4a", "webm", "matroska", "mp3", "wav"}
    if not set(formats) & accepted:
        raise WebResearchError("unsupported_media_type")
    extension = "mp4" if "mp4" in formats or "mov" in formats else formats[0]
    if extension == "matroska":
        extension = "webm"
    result = {"type": "video" if video else "audio",
              "format": extension, "duration": duration}
    if video:
        for key in ("width", "height"):
            value = video.get(key, 0)
            if not isinstance(value, int) or not 0 < value <= 32768:
                raise WebResearchError("unsupported_media_type")
            result[key] = value
    return result


async def run_process(arguments, timeout=10):
    from app.models.web_research_models import WebResearchError
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    process = await asyncio.create_subprocess_exec(
        *arguments, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, **options)
    try:
        async with asyncio.timeout(timeout):
            stdout, _ = await process.communicate()
        if process.returncode:
            raise WebResearchError("media_validation_failed")
        return stdout
    except BaseException:
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), .5)
            except TimeoutError:
                process.kill()
                await process.wait()
        raise


async def image_async(source, target):
    output = str(target) + ".json"
    try:
        await run_process([sys.executable, "-X", "utf8", str(Path(__file__)),
                           "image", str(source), str(target), output], 10)
        return json.loads(Path(output).read_text(encoding="utf-8"))
    finally:
        Path(output).unlink(missing_ok=True)


async def probe_async(path):
    from app.models.web_research_models import WebResearchError
    # 协议白名单禁止探测媒体内嵌的远程播放列表。
    try:
        result = await run_process([
            "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
            "-show_format", "-show_streams", "-of", "json", str(path)], 10)
        return probe_metadata(json.loads(result))
    except (OSError, ValueError):
        raise WebResearchError("unsupported_media_type") from None


def temporary_root():
    from app.config import settings
    root = Path(settings.storage.root).resolve().parent / "research_artifacts" / "tmp"
    root.mkdir(parents=True, exist_ok=True)
    return root


async def parse_html_async(body, url):
    with tempfile.TemporaryDirectory(dir=temporary_root()) as directory:
        source, target = Path(directory) / "page", Path(directory) / "result"
        source.write_bytes(body)
        await run_process([sys.executable, "-X", "utf8", str(Path(__file__)),
                           "html", str(source), str(target), url], 10)
        return json.loads(target.read_text(encoding="utf-8"))


def parse_html(body, url):
    """有节点数量边界的静态资料提取，保留已知尺寸和公开链接。"""
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin, urlsplit
    soup = BeautifulSoup(body, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    for node in soup(["script", "style", "nav", "footer", "form", "noscript"]):
        node.decompose()
    images, links = [], []
    def dimension(value):
        try:
            number = int(value)
            return number if 0 < number <= 100000 else None
        except (TypeError, ValueError):
            return None
    for image in soup.find_all("img", limit=100):
        target = urljoin(url, image.get("src", ""))
        if urlsplit(target).scheme in {"http", "https"}:
            images.append({"image_url": target, "alt": image.get("alt", "")[:256],
                           "width": dimension(image.get("width")),
                           "height": dimension(image.get("height"))})
    for anchor in soup.find_all("a", href=True, limit=100):
        target = urljoin(url, anchor["href"])
        if urlsplit(target).scheme in {"http", "https"}:
            links.append({"url": target, "text": anchor.get_text(" ", strip=True)[:256]})
    return {"title": title[:512], "text": soup.get_text("\n", strip=True),
            "images": images, "links": links}


def main():
    mode, source, target, extra = sys.argv[1:]
    if mode == "image":
        result = validate_image(source, target)
        Path(extra).write_text(json.dumps(result), encoding="utf-8")
    else:
        result = parse_html(Path(source).read_bytes(), extra)
        Path(target).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
