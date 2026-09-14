"""
Subtitle service for adding subtitles to videos with automatic edge detection and line wrapping.
"""

import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Optional, Sequence, Tuple
import cv2

from app.logger import get_logger
from app.models import SubtitleAddRequest, SubtitleAddResponse
from app.services.composition.composition_outcome import (
    CompositionStageError,
    last_stderr_line,
)
from app.services.composition.ffmpeg_args import video_filter_args

logger = get_logger(__name__)

#: The standalone /add-subtitles burn keeps a bound; the composition passes
#: ``timeout=None`` so a long export never loses its subtitles to it (EXO-16).
SUBTITLE_BURN_TIMEOUT_SECONDS = 300

_HEX_COLOR = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


@dataclass(frozen=True)
class SubtitleDrawStyle:
    """How one subtitle is drawn; colors are already FFmpeg colors."""

    font_family: str = "default"
    font_size: int = 24
    font_color: str = "#FFFFFF"
    #: None = no background box (EXO-10: no implicit translucent black box).
    background_color: Optional[str] = None
    position: str = "bottom"
    border_width: int = 2
    border_color: str = "#000000"
    margin_vertical: int = 50
    margin_horizontal: int = 50
    max_line_width: Optional[int] = None


@dataclass(frozen=True)
class SubtitleCue:
    """One subtitle's text and half-open ``[start, end)`` window in seconds."""

    index: int
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class DrawCanvas:
    """The frame drawtext filters target and where their text files go."""

    width: int
    height: int
    text_files_dir: str
    #: 'standard' (landscape / square) or 'centered' (portrait). Logging only:
    #: both layouts centre every wrapped line individually.
    layout: str


def to_ffmpeg_color(value: Optional[str]) -> Optional[str]:
    """Frontend color → FFmpeg color, or None for "no color".

    ``None`` / ``''`` / ``transparent`` → None; ``#RGB`` → ``#RRGGBB``;
    ``#RRGGBB`` unchanged; ``#RRGGBBAA`` → ``0xRRGGBB@alpha``; a value that
    already carries ``@`` is an FFmpeg color and passes through. Anything else
    is logged and ignored rather than breaking the whole drawtext pass.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "transparent":
        return None
    if "@" in text:
        return text
    match = _HEX_COLOR.match(text)
    if not match:
        logger.warning(f"Unsupported subtitle color {text!r}; ignoring it")
        return None
    digits = match.group(1)
    if len(digits) == 3:
        return "#" + "".join(channel * 2 for channel in digits)
    if len(digits) == 6:
        return text
    alpha = int(digits[6:], 16) / 255
    return f"0x{digits[:6]}@{alpha:.3f}"


def resolve_draw_style(item: Any) -> SubtitleDrawStyle:
    """The style of ONE composition subtitle item, defaults for missing fields."""
    defaults = SubtitleDrawStyle()
    font_size = getattr(item, "font_size", None)
    return SubtitleDrawStyle(
        font_family=getattr(item, "font_family", None) or defaults.font_family,
        font_size=int(font_size) if font_size else defaults.font_size,
        font_color=to_ffmpeg_color(getattr(item, "font_color", None)) or defaults.font_color,
        background_color=to_ffmpeg_color(getattr(item, "background_color", None)),
        position=getattr(item, "position", None) or defaults.position,
    )


class SubtitleEntry:
    """Represents a single subtitle entry from SRT file."""
    
    def __init__(self, index: int, start_time: str, end_time: str, text: str):
        self.index = index
        self.start_time = start_time
        self.end_time = end_time
        self.text = text.strip()
    
    def __repr__(self):
        return f"SubtitleEntry({self.index}, {self.start_time}->{self.end_time}, '{self.text}')"


class SubtitleService:
    """
    Service for adding subtitles to videos with automatic edge detection and line wrapping.
    """
    
    def __init__(self):
        """Initialize the subtitle service."""
        self.output_dir = Path("static/video/subtitled")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Check ffmpeg availability
        self._check_ffmpeg()
        
        logger.info("SubtitleService initialized")
    
    def _check_ffmpeg(self) -> bool:
        """Check if ffmpeg is available."""
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
            logger.info("ffmpeg is available for subtitle processing")
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            logger.error("ffmpeg not found - subtitle processing will not work")
            return False
    
    def _get_video_properties(self, video_path: str) -> Tuple[Optional[int], Optional[int], Optional[float]]:
        """
        Get video properties (width, height, fps).
        
        Args:
            video_path: Path to the video file
            
        Returns:
            Tuple of (width, height, fps) or (None, None, None) if failed
        """
        try:
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                logger.error(f"Failed to open video file: {video_path}")
                return None, None, None
            
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            
            cap.release()
            
            logger.info(f"Video properties: {width}x{height} @ {fps}fps")
            return width, height, fps
            
        except Exception as e:
            logger.error(f"Failed to get video properties: {str(e)}")
            return None, None, None
    
    def _parse_srt_file(self, srt_path: str) -> List[SubtitleEntry]:
        """
        Parse SRT subtitle file.
        
        Args:
            srt_path: Path to the SRT file
            
        Returns:
            List of SubtitleEntry objects
        """
        try:
            with open(srt_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Split by double newlines to separate subtitle blocks
            blocks = re.split(r'\n\s*\n', content.strip())
            subtitles = []
            
            for block in blocks:
                lines = block.strip().split('\n')
                if len(lines) < 3:
                    continue
                
                try:
                    # Parse index
                    index = int(lines[0])
                    
                    # Parse time range - support both comma and dot as millisecond separator
                    time_match = re.match(r'(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})', lines[1])
                    if not time_match:
                        logger.warning(f"Invalid time format in subtitle block: {lines[1]}")
                        continue
                    
                    start_time = time_match.group(1)
                    end_time = time_match.group(2)
                    
                    # Parse text (may span multiple lines)
                    text = '\n'.join(lines[2:])
                    
                    subtitles.append(SubtitleEntry(index, start_time, end_time, text))
                    
                except (ValueError, IndexError) as e:
                    logger.warning(f"Failed to parse subtitle block: {block}, error: {str(e)}")
                    continue
            
            logger.info(f"Parsed {len(subtitles)} subtitle entries from {srt_path}")
            return subtitles
            
        except Exception as e:
            logger.error(f"Failed to parse SRT file {srt_path}: {str(e)}")
            return []
    
    def _calculate_max_line_width(self, video_width: int, font_size: int, margin_horizontal: int, video_height: int = None) -> int:
        """
        Calculate maximum characters per line, derived purely from the frame width.

        The budget is computed against the CJK full-width worst case (advance ≈ 1.0 em
        ≈ font_size px). Because CJK glyphs are the widest input we accept, a single line
        of at most this many characters can never exceed the available width for any
        script (Latin/half-width glyphs are narrower, so the same character count is only
        ever shorter). This makes one formula correct for every aspect ratio, instead of
        the previous Latin-coefficient (0.6/0.8) estimates plus frame-decoupled hard caps
        (100 / portrait 10/12/18/25/35 / min_chars=20) that let long CJK lines overflow.

        Args:
            video_width: Video width in pixels
            font_size: Font size in pixels
            margin_horizontal: Horizontal margin in pixels
            video_height: Video height in pixels (kept for signature compatibility / logging)

        Returns:
            Maximum line width in characters
        """
        # Available width for subtitles after subtracting the left/right margins.
        available_width = video_width - (2 * margin_horizontal)

        # CJK full-width step ≈ 1.0 em = font_size px (worst case → guarantees no overflow).
        char_width = font_size

        # Lower bound is 1: never raise the budget above what the frame can fit. A higher
        # floor (e.g. the old min_chars=20) would re-overflow on large fonts in narrower
        # landscape frames (e.g. 1280x720 @ 72px → 20*72=1440px > 1280px). At worst this
        # degrades to one character per line for absurd font sizes (available < font_size),
        # which only occurs outside the model's 8..200px range; a wrapped line never bleeds.
        max_chars = max(1, int(available_width / char_width))

        logger.info(f"Calculated max line width: {max_chars} characters for video {video_width}x{video_height}px, font size {font_size}")
        return max_chars
    
    def _wrap_text(self, text: str, max_line_width: int) -> List[str]:
        """
        Wrap text to fit within video edges.
        Supports both Chinese character-based wrapping and English word-based wrapping.
        
        Args:
            text: Text to wrap
            max_line_width: Maximum characters per line
            
        Returns:
            List of wrapped lines
        """
        if not text:
            return []
        
        # Split by existing newlines first
        paragraphs = text.split('\n')
        wrapped_lines = []
        
        for paragraph in paragraphs:
            if not paragraph.strip():
                wrapped_lines.append('')
                continue
            
            # Check if text contains Chinese characters
            has_chinese = self._contains_chinese(paragraph)
            
            if has_chinese:
                # For Chinese text, wrap by characters
                wrapped_lines.extend(self._wrap_chinese_text(paragraph, max_line_width))
            else:
                # For English text, wrap by words
                wrapped_lines.extend(self._wrap_english_text(paragraph, max_line_width))
        
        return wrapped_lines
    
    def _wrap_chinese_text(self, text: str, max_line_width: int) -> List[str]:
        """
        Wrap Chinese text by characters.
        
        Args:
            text: Chinese text to wrap
            max_line_width: Maximum characters per line
            
        Returns:
            List of wrapped lines
        """
        wrapped_lines = []
        current_line = ""
        
        for char in text:
            # Check if adding this character would exceed the limit
            if len(current_line) < max_line_width:
                current_line += char
            else:
                # Start a new line
                if current_line:
                    wrapped_lines.append(current_line)
                current_line = char
        
        # Add the last line
        if current_line:
            wrapped_lines.append(current_line)
        
        return wrapped_lines
    
    def _wrap_english_text(self, text: str, max_line_width: int) -> List[str]:
        """
        Wrap English text by words.
        
        Args:
            text: English text to wrap
            max_line_width: Maximum characters per line
            
        Returns:
            List of wrapped lines
        """
        wrapped_lines = []
        words = text.split()
        current_line = []
        current_length = 0
        
        for word in words:
            # Check if adding this word would exceed the limit
            word_length = len(word)
            space_length = 1 if current_line else 0
            
            if current_length + space_length + word_length <= max_line_width:
                current_line.append(word)
                current_length += space_length + word_length
            else:
                # Start a new line
                if current_line:
                    wrapped_lines.append(' '.join(current_line))
                current_line = [word]
                current_length = word_length
        
        # Add the last line
        if current_line:
            wrapped_lines.append(' '.join(current_line))
        
        return wrapped_lines
    
    def _contains_chinese(self, text: str) -> bool:
        """
        Check if text contains Chinese characters.
        
        Args:
            text: Text to check
            
        Returns:
            True if text contains Chinese characters, False otherwise
        """
        chinese_ranges = [
            (0x4e00, 0x9fff),   # CJK Unified Ideographs
            (0x3400, 0x4dbf),   # CJK Extension A
            (0x20000, 0x2a6df), # CJK Extension B
            (0x2a700, 0x2b73f), # CJK Extension C
            (0x2b740, 0x2b81f), # CJK Extension D
            (0x2b820, 0x2ceaf), # CJK Extension E
            (0x2ceb0, 0x2ebef), # CJK Extension F
            (0xf900, 0xfaff),   # CJK Compatibility Ideographs
            (0x2f800, 0x2fa1f), # CJK Compatibility Supplement
        ]
        
        for char in text:
            char_code = ord(char)
            for start, end in chinese_ranges:
                if start <= char_code <= end:
                    return True
        return False

    @staticmethod
    def _is_cjk_capable_font(font_path: str) -> bool:
        """
        Heuristic check: does this font file contain CJK glyphs?

        Based on the well-known CJK font filenames used across Windows/macOS/Linux
        (see the candidate lists in `_get_font_path`). Used to detect the degraded
        state where Chinese text is present but only a Latin-only font (e.g.
        DejaVuSans) is available, so we can warn loudly instead of silently
        rendering missing-glyph boxes.
        """
        name = os.path.basename(font_path).lower()
        cjk_markers = (
            "cjk", "wqy", "sourcehan", "source-han", "uming", "ukai",
            "droidsansfallback",          # Linux
            "msyh", "simhei", "simsun",    # Windows (微软雅黑/黑体/宋体)
            "pingfang", "songti", "stheiti",  # macOS
        )
        return any(marker in name for marker in cjk_markers)

    def _get_font_path(self, font_family: str = "default", text_content: str = "") -> Optional[str]:
        """
        Get available font path for the specified font family with cross-platform support.
        Prioritizes Chinese fonts when Chinese characters are detected.
        
        Args:
            font_family: Font family type (default, serif, sans-serif, monospace)
            text_content: Text content to analyze for Chinese characters
            
        Returns:
            Font file path or None if no suitable font found
        """
        import platform
        
        system = platform.system().lower()
        has_chinese = self._contains_chinese(text_content) if text_content else False
        
        logger.info(f"Getting font path for system: {system}, family: {font_family}, has_chinese: {has_chinese}, text_preview: '{text_content[:50] if text_content else ''}'")
        
        # Font paths by system and font family
        font_paths_map = {}
        
        if system == "windows":
            # 为Windows系统定义中文字体和英文字体列表
            chinese_fonts = [
                "C:/Windows/Fonts/msyh.ttc",        # Microsoft YaHei (微软雅黑) - best for Chinese
                "C:/Windows/Fonts/simhei.ttf",      # SimHei (黑体)
                "C:/Windows/Fonts/simsun.ttc",      # SimSun (宋体)
            ]
            
            latin_fonts = [
                "C:/Windows/Fonts/arial.ttf",       # Arial - best for English
                "C:/Windows/Fonts/arialbd.ttf",     # Arial Bold
                "C:/Windows/Fonts/calibri.ttf",     # Calibri
            ]
            
            # 根据是否包含中文决定字体优先级
            if has_chinese:
                default_fonts = chinese_fonts + latin_fonts
                logger.info("Chinese characters detected in Windows subtitle, prioritizing Chinese fonts (微软雅黑, 黑体, 宋体)")
            else:
                default_fonts = latin_fonts + chinese_fonts
                logger.info("No Chinese characters detected in Windows subtitle, prioritizing Latin fonts (Arial, Calibri)")
            
            font_paths_map = {
                "default": default_fonts,
                "serif": [
                    "C:/Windows/Fonts/simsun.ttc",      # SimSun (宋体) - serif Chinese
                    "C:/Windows/Fonts/times.ttf",       # Times New Roman
                    "C:/Windows/Fonts/timesbd.ttf",     # Times New Roman Bold
                    "C:/Windows/Fonts/georgia.ttf",     # Georgia
                ],
                "sans-serif": default_fonts,  # 与default相同，根据语言自动选择
                "monospace": [
                    "C:/Windows/Fonts/consola.ttf",     # Consolas
                    "C:/Windows/Fonts/cour.ttf",        # Courier New
                    "C:/Windows/Fonts/lucon.ttf",       # Lucida Console
                ]
            }
        elif system == "darwin":  # macOS
            # 为macOS系统定义中文字体和英文字体列表
            chinese_fonts = [
                "/System/Library/Fonts/PingFang.ttc",       # PingFang - best for Chinese
                "/Library/Fonts/Songti.ttc",                # Songti (宋体)
                "/System/Library/Fonts/STHeiti Medium.ttc", # STHeiti (华文黑体)
            ]
            
            latin_fonts = [
                "/System/Library/Fonts/Helvetica.ttc",  # Helvetica - best for English
                "/System/Library/Fonts/Arial.ttf",      # Arial
                "/System/Library/Fonts/SFNSDisplay.ttf",# SF Display
            ]
            
            # 根据是否包含中文决定字体优先级
            if has_chinese:
                default_fonts = chinese_fonts + latin_fonts
                logger.info("Chinese characters detected in macOS subtitle, prioritizing Chinese fonts (PingFang, Songti)")
            else:
                default_fonts = latin_fonts + chinese_fonts
                logger.info("No Chinese characters detected in macOS subtitle, prioritizing Latin fonts (Helvetica, Arial)")
            
            font_paths_map = {
                "default": default_fonts,
                "serif": [
                    "/Library/Fonts/Songti.ttc",            # Songti (宋体) - serif Chinese
                    "/System/Library/Fonts/Times.ttc",      # Times New Roman
                    "/System/Library/Fonts/Georgia.ttf",    # Georgia
                ],
                "sans-serif": default_fonts,  # 与default相同，根据语言自动选择
                "monospace": [
                    "/System/Library/Fonts/Monaco.ttf",     # Monaco
                    "/System/Library/Fonts/Courier New.ttf",# Courier New
                    "/System/Library/Fonts/Menlo.ttc",      # Menlo
                ]
            }
        else:  # Linux (Ubuntu) - 修复中文字幕乱码问题
            # 为Ubuntu系统优化字体配置，中文字体优先
            chinese_fonts = [
                # Noto CJK 字体 - 最佳中文支持
                "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/opentype/noto/NotoSansCJK.ttc",
                "/usr/share/fonts/truetype/noto/NotoSansCJK.ttc",
                # 文泉驿字体 - 常见的开源中文字体
                "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
                "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                # 思源字体
                "/usr/share/fonts/opentype/source-han-sans/SourceHanSansCN-Regular.otf",
                "/usr/share/fonts/truetype/source-han-sans/SourceHanSansCN-Regular.ttf",
                # AR PL 字体
                "/usr/share/fonts/truetype/arphic/uming.ttc",
                "/usr/share/fonts/truetype/arphic/ukai.ttc",
                # Droid 字体
                "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
            ]
            
            latin_fonts = [
                # 拉丁字体 - 不支持中文
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
            ]
            
            # 根据是否包含中文决定字体优先级
            if has_chinese:
                default_fonts = chinese_fonts + latin_fonts
                logger.info("Chinese characters detected, prioritizing Chinese fonts")
            else:
                default_fonts = latin_fonts + chinese_fonts
                logger.info("No Chinese characters detected, using standard font priority")
            
            font_paths_map = {
                "default": default_fonts,
                "serif": [
                    # 中文衬线字体
                    "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc",
                    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
                    "/usr/share/fonts/truetype/arphic/uming.ttc",
                    # 拉丁衬线字体
                    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
                ],
                "sans-serif": default_fonts,  # 与default相同
                "monospace": [
                    # 中文等宽字体
                    "/usr/share/fonts/truetype/noto/NotoSansMonoCJK-Regular.ttc",
                    "/usr/share/fonts/opentype/noto/NotoSansMonoCJK-Regular.ttc",
                    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
                    # 拉丁等宽字体
                    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
                    "/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf",
                ]
            }
        
        # Get font paths for the requested family, fallback to default
        font_paths = font_paths_map.get(font_family, font_paths_map.get("default", []))
        
        # Check which fonts exist and log the search process
        logger.info(f"Searching for {font_family} fonts, checking {len(font_paths)} font paths")
        logger.info(f"Font search priority: {', '.join([os.path.basename(p) for p in font_paths[:3]])}")
        
        for i, font_path in enumerate(font_paths):
            if os.path.exists(font_path):
                logger.info(f"✓ Found suitable font (#{i+1}/{len(font_paths)}): {font_path}")
                if has_chinese and not self._is_cjk_capable_font(font_path):
                    # Degraded state: Chinese text present but no CJK font is installed,
                    # so the search fell through to a Latin-only font. We STILL return it
                    # (returning None would drop fontfile= and let ffmpeg fall back to
                    # fontconfig's default Sans — which on a CJK-less host is still Latin,
                    # producing the same boxes, or breaking the whole export pass). Make
                    # the failure LOUD instead of silently emitting tofu (□□□).
                    logger.error(
                        f"❌ Chinese characters detected but no CJK font is installed; "
                        f"falling back to non-CJK font '{os.path.basename(font_path)}'. "
                        f"Chinese subtitles WILL render as missing-glyph boxes (□□□). "
                        f"Install a CJK font on the host, e.g. "
                        f"`apt-get install -y fonts-noto-cjk && fc-cache -f`."
                    )
                else:
                    logger.info(f"Font selection result: Using '{os.path.basename(font_path)}' for {'Chinese' if has_chinese else 'English'} subtitle rendering")
                return font_path
            else:
                logger.debug(f"✗ Font not found (#{i+1}/{len(font_paths)}): {font_path}")
        
        # If no specific font found, try default fonts
        if font_family != "default":
            logger.warning(f"No {font_family} font found, trying default fonts")
            return self._get_font_path("default", text_content)
        
        logger.error("❌ No suitable font found on the system! This will cause subtitle rendering issues.")
        logger.error("Please install appropriate fonts for proper subtitle support:")
        logger.error("  Windows: Ensure Arial/Calibri (English) and 微软雅黑/黑体 (Chinese) are installed")
        logger.error("  macOS: Ensure Helvetica/Arial (English) and PingFang/Songti (Chinese) are installed")
        logger.error("  Ubuntu: sudo apt-get install fonts-noto-cjk fonts-wqy-microhei")
        return None
    
    def _convert_time_to_seconds(self, time_str: str) -> float:
        """
        Convert SRT time format (HH:MM:SS,mmm or HH:MM:SS.mmm) to seconds.
        
        Args:
            time_str: Time string in format HH:MM:SS,mmm or HH:MM:SS.mmm
            
        Returns:
            Time in seconds as float
        """
        try:
            # Replace comma with dot for consistent parsing
            time_str = time_str.replace(',', '.')
            
            # Split by colon to get hours, minutes, and seconds.milliseconds
            parts = time_str.split(':')
            if len(parts) != 3:
                raise ValueError(f"Invalid time format: {time_str}")
            
            hours = int(parts[0])
            minutes = int(parts[1])
            
            # Split seconds and milliseconds
            seconds_parts = parts[2].split('.')
            seconds = int(seconds_parts[0])
            milliseconds = int(seconds_parts[1]) if len(seconds_parts) > 1 else 0
            
            # Convert to total seconds
            total_seconds = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000.0
            return total_seconds
            
        except Exception as e:
            logger.error(f"Failed to convert time '{time_str}' to seconds: {str(e)}")
            return 0.0
    
    def build_drawtext_filters_for_items(
        self,
        items: Sequence[Any],
        video_width: int,
        video_height: int,
        text_files_dir: str,
    ) -> List[str]:
        """Drawtext filters for composition subtitle items, each in its OWN style.

        Reads the items directly. The old SRT round trip applied the first
        item's style to every subtitle (EXO-01), dropped all text after a blank
        line (EXO-11) and burned the item name for an empty subtitle.
        """
        is_portrait = bool(video_height) and video_width / video_height < 1.0
        canvas = DrawCanvas(
            video_width, video_height, text_files_dir, "centered" if is_portrait else "standard"
        )
        ordered = sorted(
            enumerate(items), key=lambda pair: (float(pair[1].start_time), pair[0])
        )
        filters: List[str] = []
        for position, item in ordered:
            text = (getattr(item, "text", None) or "").strip()
            if not text:
                continue
            start = float(item.start_time)
            cue = SubtitleCue(position + 1, text, start, start + float(item.duration))
            filters.extend(
                self._drawtext_filters_for_entry(cue, resolve_draw_style(item), canvas)
            )
        logger.info(
            f"Built {len(filters)} drawtext filters for {len(items)} subtitle items "
            f"({canvas.layout} layout)"
        )
        return filters

    def burn_drawtext_filters(
        self,
        video_path: str,
        output_path: str,
        filters: List[str],
        temp_dir: str,
        timeout: Optional[float],
    ) -> None:
        """Burn ``filters`` into ``video_path``; raises CompositionStageError on failure.

        The composition passes ``timeout=None``: a long export must not lose its
        subtitles to a fixed wall-clock limit (EXO-16). A long chain reaches
        FFmpeg through a script file (EXO-05).
        """
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            *video_filter_args(",".join(filters), temp_dir, "ffmpeg"),
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            output_path,
        ]
        logger.info(f"Burning {len(filters)} subtitle drawtext filters into {video_path}")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            logger.error(f"Subtitle burn-in timed out after {timeout}s")
            raise CompositionStageError(
                "subtitles", f"subtitle burn-in timed out after {timeout}s"
            ) from exc
        except OSError as exc:
            logger.error(f"Subtitle burn-in could not start: {exc}")
            raise CompositionStageError("subtitles", str(exc)) from exc
        if result.returncode != 0:
            summary = last_stderr_line(result.stderr)
            logger.error(f"Subtitle burn-in failed: {summary}")
            raise CompositionStageError("subtitles", summary)

    def _build_ffmpeg_command(
        self,
        input_video: str,
        output_video: str,
        subtitles: List[SubtitleEntry],
        request: SubtitleAddRequest,
        video_width: int,
        video_height: int,
        text_files_dir: str
    ) -> List[str]:
        """Build the ffmpeg command of the standalone /add-subtitles burn-in.

        A long drawtext chain is passed through a script file in
        ``text_files_dir`` so the Windows command-line limit cannot drop it
        (EXO-05).
        """
        aspect_ratio = video_width / video_height
        is_portrait = aspect_ratio < 1.0

        logger.info(f"Video aspect ratio: {aspect_ratio:.2f} ({video_width}x{video_height})")

        if is_portrait:
            logger.info("Portrait video detected - using multi-line centered subtitle rendering for optimal display")
            drawtext_filters = self._build_multiline_centered_drawtext_filters(
                subtitles, request, video_width, video_height, text_files_dir
            )
        else:
            logger.info("Landscape video detected - using standard subtitle rendering")
            drawtext_filters = self._build_standard_drawtext_filters(
                subtitles, request, video_width, video_height, text_files_dir
            )

        if not drawtext_filters:
            logger.warning("No valid subtitle filters created")
            return []

        logger.info(f"Generated {len(drawtext_filters)} drawtext filters for subtitle rendering")

        return [
            'ffmpeg',
            '-i', input_video,
            *video_filter_args(','.join(drawtext_filters), text_files_dir, 'ffmpeg'),
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'copy',  # Copy audio without re-encoding
            '-y',  # Overwrite output file
            output_video
        ]

    def _build_standard_drawtext_filters(
        self,
        subtitles: List[SubtitleEntry],
        request: SubtitleAddRequest,
        video_width: int,
        video_height: int,
        text_files_dir: str
    ) -> List[str]:
        """Landscape / square drawtext filters for SRT entries."""
        canvas = DrawCanvas(video_width, video_height, text_files_dir, "standard")
        return self._drawtext_filters_for_srt(subtitles, request, canvas)

    def _build_multiline_centered_drawtext_filters(
        self,
        subtitles: List[SubtitleEntry],
        request: SubtitleAddRequest,
        video_width: int,
        video_height: int,
        text_files_dir: str
    ) -> List[str]:
        """Portrait drawtext filters for SRT entries (every line centred)."""
        canvas = DrawCanvas(video_width, video_height, text_files_dir, "centered")
        return self._drawtext_filters_for_srt(subtitles, request, canvas)

    def _drawtext_filters_for_srt(
        self,
        subtitles: List[SubtitleEntry],
        request: SubtitleAddRequest,
        canvas: DrawCanvas,
    ) -> List[str]:
        """SRT entries of the standalone burn-in, all in the request's single style."""
        style = SubtitleDrawStyle(
            font_family=getattr(request, 'font_family', None) or "default",
            font_size=request.font_size,
            font_color=request.font_color,
            background_color=request.background_color or None,
            position=request.position,
            border_width=request.border_width,
            border_color=request.border_color,
            margin_vertical=request.margin_vertical,
            margin_horizontal=request.margin_horizontal,
            max_line_width=request.max_line_width,
        )
        filters: List[str] = []
        for subtitle in subtitles:
            cue = SubtitleCue(
                subtitle.index,
                subtitle.text,
                self._convert_time_to_seconds(subtitle.start_time),
                self._convert_time_to_seconds(subtitle.end_time),
            )
            filters.extend(self._drawtext_filters_for_entry(cue, style, canvas))
        return filters

    def _drawtext_filters_for_entry(
        self, cue: SubtitleCue, style: SubtitleDrawStyle, canvas: DrawCanvas,
    ) -> List[str]:
        """One horizontally centred drawtext per wrapped line of ``cue``.

        A single multi-line drawtext would left-align the wrapped lines inside
        its box (``text_align=center`` needs FFmpeg >= 7.0, production ships
        6.x), so every line is its own filter. Line text goes through
        ``textfile=`` to bypass filter-graph escaping of quotes and colons;
        blank lines keep their vertical slot.
        """
        max_line_width = style.max_line_width or self._calculate_max_line_width(
            canvas.width, style.font_size, style.margin_horizontal, canvas.height
        )
        wrapped_lines = self._wrap_text(cue.text, max_line_width)
        if not wrapped_lines:
            return []

        line_height = style.font_size + 5
        start_y = self._block_start_y(style, canvas.height, len(wrapped_lines) * line_height)
        font_path = self._get_font_path(style.font_family, cue.text)
        logger.info(
            f"{canvas.layout} subtitle {cue.index}: position={style.position}, "
            f"start_y={start_y}, lines={len(wrapped_lines)}, max_line_width={max_line_width}"
        )

        filters: List[str] = []
        for line_index, line_text in enumerate(wrapped_lines):
            if not line_text.strip():
                continue
            text_file_path = os.path.join(
                canvas.text_files_dir, f"sub_{cue.index}_line_{line_index}.txt"
            )
            with open(text_file_path, 'w', encoding='utf-8') as text_file:
                text_file.write(line_text)
            line_y = start_y + line_index * line_height
            filters.append(
                self._drawtext_line_filter(text_file_path, font_path, style, line_y, cue)
            )
        return filters

    @staticmethod
    def _block_start_y(style: SubtitleDrawStyle, video_height: int, block_height: int) -> int:
        """Top of the wrapped text block for the subtitle position."""
        if style.position == "top":
            return style.margin_vertical
        if style.position == "upper-3/4":
            return int(video_height * 0.25 - block_height // 2)
        if style.position == "center":
            return (video_height - block_height) // 2
        if style.position == "lower-3/4":
            return int(video_height * 0.75 - block_height // 2)
        return video_height - block_height - style.margin_vertical

    @staticmethod
    def _drawtext_line_filter(
        text_file_path: str,
        font_path: Optional[str],
        style: SubtitleDrawStyle,
        line_y: int,
        cue: SubtitleCue,
    ) -> str:
        """The drawtext filter for one wrapped line."""
        escaped_path = text_file_path.replace('\\', '/').replace(':', '\\:')
        drawtext_filter = f"drawtext=textfile='{escaped_path}'"
        if font_path:
            escaped_font_path = font_path.replace('\\', '\\\\').replace(':', '\\:')
            drawtext_filter += f":fontfile='{escaped_font_path}'"
        drawtext_filter += (
            f":fontsize={style.font_size}"
            f":fontcolor={style.font_color}"
            f":borderw={style.border_width}"
            f":bordercolor={style.border_color}"
            # Subtitle text is literal. The default expansion rejects a stray
            # "%" ("50% off") and drops the whole line, and eats backslashes.
            ":expansion=none"
            f":x=(w-text_w)/2"  # Center each line individually
            f":y={line_y}"
            # Half-open window: adjacent subtitles never share a frame (EXO-17).
            f":enable='gte(t,{cue.start:.3f})*lt(t,{cue.end:.3f})'"
        )
        if style.background_color:
            drawtext_filter += f":box=1:boxcolor={style.background_color}:boxborderw=5"
        return drawtext_filter

    async def add_subtitles(self, request: SubtitleAddRequest) -> SubtitleAddResponse:
        """
        Add subtitles to a video file.
        
        Args:
            request: Subtitle addition request
            
        Returns:
            SubtitleAddResponse with processing results
        """
        start_time = time.time()
        
        try:
            logger.info(f"Starting subtitle addition process for video: {request.video_file_path}")
            
            # Validate input files
            if not os.path.exists(request.video_file_path):
                logger.error(f"Video file not found: {request.video_file_path}")
                return SubtitleAddResponse(
                    success=False,
                    message=f"Video file not found: {request.video_file_path}"
                )
            
            if not os.path.exists(request.subtitle_file_path):
                logger.error(f"Subtitle file not found: {request.subtitle_file_path}")
                return SubtitleAddResponse(
                    success=False,
                    message=f"Subtitle file not found: {request.subtitle_file_path}"
                )
            
            # Get video properties
            video_width, video_height, fps = self._get_video_properties(request.video_file_path)
            if video_width is None:
                return SubtitleAddResponse(
                    success=False,
                    message="Failed to read video properties"
                )
            
            # Parse subtitle file
            subtitles = self._parse_srt_file(request.subtitle_file_path)
            if not subtitles:
                return SubtitleAddResponse(
                    success=False,
                    message="No valid subtitles found in SRT file"
                )
            
            # Generate output filename
            input_path = Path(request.video_file_path)
            output_filename = f"{input_path.stem}_subtitled_{int(time.time())}.mp4"
            output_path = self.output_dir / output_filename
            
            # Create a temporary directory to hold subtitle text files for ffmpeg textfile= params.
            # These files bypass all filter-graph escaping issues with special characters.
            text_files_dir = tempfile.mkdtemp(prefix="ecliptrix_subs_")
            try:
                # Build ffmpeg command
                ffmpeg_cmd = self._build_ffmpeg_command(
                    request.video_file_path,
                    str(output_path),
                    subtitles,
                    request,
                    video_width,
                    video_height,
                    text_files_dir
                )

                if not ffmpeg_cmd:
                    return SubtitleAddResponse(
                        success=False,
                        message="Failed to build ffmpeg command"
                    )

                # Execute ffmpeg command
                logger.info(f"Executing ffmpeg command: {' '.join(ffmpeg_cmd)}")

                try:
                    result = subprocess.run(
                        ffmpeg_cmd,
                        capture_output=True,
                        text=True,
                        timeout=SUBTITLE_BURN_TIMEOUT_SECONDS
                    )

                    if result.returncode != 0:
                        logger.error(f"ffmpeg failed with return code {result.returncode}")
                        logger.error(f"ffmpeg stderr: {result.stderr}")
                        return SubtitleAddResponse(
                            success=False,
                            message=f"Video processing failed: {result.stderr}"
                        )

                except subprocess.TimeoutExpired:
                    logger.error("ffmpeg process timed out")
                    return SubtitleAddResponse(
                        success=False,
                        message="Video processing timed out"
                    )
            finally:
                # Clean up temp text files regardless of success or failure
                shutil.rmtree(text_files_dir, ignore_errors=True)

            # Check output file
            if not output_path.exists():
                logger.error(f"Output file was not created: {output_path}")
                return SubtitleAddResponse(
                    success=False,
                    message="Output video file was not created"
                )
            
            # Get output file size
            file_size = output_path.stat().st_size
            processing_time = time.time() - start_time
            
            logger.info(f"Subtitle addition completed successfully in {processing_time:.2f}s")
            logger.info(f"Output file: {output_path} ({file_size} bytes)")
            
            return SubtitleAddResponse(
                success=True,
                message="Subtitles added successfully",
                output_video_path=str(output_path),
                video_width=video_width,
                video_height=video_height,
                subtitle_count=len(subtitles),
                processing_time=processing_time,
                file_size=file_size
            )
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"Subtitle addition failed after {processing_time:.2f}s: {str(e)}")
            return SubtitleAddResponse(
                success=False,
                message=f"Subtitle addition failed: {str(e)}",
                processing_time=processing_time
            ) 