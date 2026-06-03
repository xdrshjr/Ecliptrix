"""
Subtitle service for adding subtitles to videos with automatic edge detection and line wrapping.
"""

import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import List, Optional, Tuple
import cv2

from app.logger import get_logger
from app.models import SubtitleAddRequest, SubtitleAddResponse

logger = get_logger(__name__)


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
    
    def build_drawtext_filters(
        self,
        request: SubtitleAddRequest,
        text_files_dir: str
    ) -> Tuple[List[str], int, int]:
        """
        Build drawtext filter strings for subtitle burning without running FFmpeg.
        Used by VideoCompositionService to merge subtitle filters with image overlays.

        Args:
            request: Subtitle request parameters
            text_files_dir: Directory to store temporary text files for ffmpeg textfile= params

        Returns:
            Tuple of (list of drawtext filter strings, video_width, video_height)
        """
        video_width, video_height, fps = self._get_video_properties(request.video_file_path)
        if video_width is None:
            return [], 0, 0

        subtitles = self._parse_srt_file(request.subtitle_file_path)
        if not subtitles:
            return [], 0, 0

        aspect_ratio = video_width / video_height
        is_portrait = aspect_ratio < 1.0

        if is_portrait:
            filters = self._build_multiline_centered_drawtext_filters(
                subtitles, request, video_width, video_height, text_files_dir
            )
        else:
            filters = self._build_standard_drawtext_filters(
                subtitles, request, video_width, video_height, text_files_dir
            )

        return filters, video_width, video_height

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
        """
        Build ffmpeg command for adding subtitles.
        
        Args:
            input_video: Path to input video
            output_video: Path to output video
            subtitles: List of subtitle entries
            request: Subtitle request parameters
            video_width: Video width
            video_height: Video height
            
        Returns:
            ffmpeg command as list of strings
        """
        # Calculate aspect ratio to detect portrait/vertical videos
        aspect_ratio = video_width / video_height
        is_portrait = aspect_ratio < 1.0
        
        logger.info(f"Video aspect ratio: {aspect_ratio:.2f} ({video_width}x{video_height})")
        
        if is_portrait:
            logger.info("Portrait video detected - using multi-line centered subtitle rendering for optimal display")
            # Use special handling for portrait videos to ensure each line is centered
            drawtext_filters = self._build_multiline_centered_drawtext_filters(
                subtitles, request, video_width, video_height, text_files_dir
            )
        else:
            logger.info("Landscape video detected - using standard subtitle rendering")
            # Use standard handling for landscape videos
            drawtext_filters = self._build_standard_drawtext_filters(
                subtitles, request, video_width, video_height, text_files_dir
            )
        
        if not drawtext_filters:
            logger.warning("No valid subtitle filters created")
            return []
        
        logger.info(f"Generated {len(drawtext_filters)} drawtext filters for subtitle rendering")
        
        # Build complete ffmpeg command with explicit video encoding
        cmd = [
            'ffmpeg',
            '-i', input_video,
            '-vf', ','.join(drawtext_filters),
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'copy',  # Copy audio without re-encoding
            '-y',  # Overwrite output file
            output_video
        ]

        return cmd
    
    def _build_standard_drawtext_filters(
        self,
        subtitles: List[SubtitleEntry],
        request: SubtitleAddRequest,
        video_width: int,
        video_height: int,
        text_files_dir: str
    ) -> List[str]:
        """
        Build standard drawtext filters for landscape videos.
        
        Args:
            subtitles: List of subtitle entries
            request: Subtitle request parameters
            video_width: Video width
            video_height: Video height
            
        Returns:
            List of drawtext filter strings
        """
        # Calculate max line width if not provided
        max_line_width = request.max_line_width
        if max_line_width is None:
            max_line_width = self._calculate_max_line_width(
                video_width, request.font_size, request.margin_horizontal, video_height
            )
        
        # Calculate position
        if request.position == "top":
            y_position = request.margin_vertical
            logger.debug(f"Standard subtitle using TOP position: y={y_position}")
        elif request.position == "upper-3/4":
            y_position = f"(h*0.25-text_h/2)"
            logger.debug(f"Standard subtitle using UPPER-3/4 position: y={y_position}")
        elif request.position == "center":
            y_position = f"(h-text_h)/2"
            logger.debug(f"Standard subtitle using CENTER position: y={y_position}")
        elif request.position == "lower-3/4":
            y_position = f"(h*0.75-text_h/2)"
            logger.debug(f"Standard subtitle using LOWER-3/4 position: y={y_position}")
        else:  # bottom
            y_position = f"h-text_h-{request.margin_vertical}"
            logger.debug(f"Standard subtitle using BOTTOM position: y={y_position}")
        
        logger.info(f"Standard subtitle positioning: position={request.position}, y_formula='{y_position}', max_line_width={max_line_width}")
        
        # Build drawtext filters for each subtitle
        drawtext_filters = []
        
        for subtitle in subtitles:
            # Wrap text
            wrapped_lines = self._wrap_text(subtitle.text, max_line_width)
            if not wrapped_lines:
                continue
            
            # Convert times to seconds
            start_time = self._convert_time_to_seconds(subtitle.start_time)
            end_time = self._convert_time_to_seconds(subtitle.end_time)
            
            # Write subtitle text to a temp file so ffmpeg reads it via textfile=.
            # This bypasses all text escaping issues (apostrophes, colons, etc.) entirely,
            # since ffmpeg reads the file content directly without filter-graph parsing.
            text_file_path = os.path.join(text_files_dir, f"sub_{subtitle.index}.txt")
            with open(text_file_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(wrapped_lines))  # actual newlines — supported by textfile=

            # Escape path separators and colons for ffmpeg filter syntax
            escaped_path = text_file_path.replace('\\', '/').replace(':', '\\:')
            drawtext_filter = f"drawtext=textfile={escaped_path}"
            
            # Add font file if available - pass text content for Chinese character detection
            font_path = self._get_font_path(getattr(request, 'font_family', 'default'), subtitle.text)
            if font_path:
                # Escape backslashes for ffmpeg
                escaped_font_path = font_path.replace('\\', '\\\\').replace(':', '\\:')
                drawtext_filter += f":fontfile='{escaped_font_path}'"
            
            drawtext_filter += (
                f":fontsize={request.font_size}"
                f":fontcolor={request.font_color}"
                f":borderw={request.border_width}"
                f":bordercolor={request.border_color}"
                f":x=(w-text_w)/2"
                f":y={y_position}"
                f":enable='between(t,{start_time},{end_time})'"
            )
            
            # Add background if specified
            if request.background_color:
                logger.info(f"Adding background color {request.background_color} to subtitle: '{subtitle.text[:20]}...'")
                drawtext_filter += f":box=1:boxcolor={request.background_color}:boxborderw=5"
            else:
                logger.info(f"No background color specified for subtitle: '{subtitle.text[:20]}...'")

            drawtext_filters.append(drawtext_filter)

        return drawtext_filters

    def _build_multiline_centered_drawtext_filters(
        self,
        subtitles: List[SubtitleEntry],
        request: SubtitleAddRequest,
        video_width: int,
        video_height: int,
        text_files_dir: str
    ) -> List[str]:
        """
        Build multi-line centered drawtext filters for portrait videos.
        This ensures each line of subtitle is horizontally centered.
        
        Args:
            subtitles: List of subtitle entries
            request: Subtitle request parameters
            video_width: Video width
            video_height: Video height
            
        Returns:
            List of drawtext filter strings
        """
        logger.info("Building multi-line centered drawtext filters for portrait video")
        
        # Calculate max line width if not provided
        max_line_width = request.max_line_width
        if max_line_width is None:
            max_line_width = self._calculate_max_line_width(
                video_width, request.font_size, request.margin_horizontal, video_height
            )
        
        logger.info(f"Portrait video max line width: {max_line_width} characters")
        
        # Build drawtext filters for each subtitle
        drawtext_filters = []
        
        for subtitle in subtitles:
            # Wrap text into multiple lines
            wrapped_lines = self._wrap_text(subtitle.text, max_line_width)
            if not wrapped_lines:
                continue
            
            logger.info(f"Portrait subtitle '{subtitle.text[:30]}...' wrapped into {len(wrapped_lines)} lines")
            
            # Convert times to seconds
            start_time = self._convert_time_to_seconds(subtitle.start_time)
            end_time = self._convert_time_to_seconds(subtitle.end_time)
            
            # Calculate line height (approximate)
            line_height = request.font_size + 5  # Font size + small padding
            
            # Calculate total text block height
            total_text_height = len(wrapped_lines) * line_height
            
            # Calculate starting Y position to center the entire text block
            if request.position == "top":
                start_y = request.margin_vertical
                logger.debug(f"Using TOP position: margin_vertical={request.margin_vertical}")
            elif request.position == "upper-3/4":
                start_y = int(video_height * 0.25 - total_text_height // 2)
                logger.debug(f"Using UPPER-3/4 position: 25% of height ({video_height * 0.25}) minus half text height")
            elif request.position == "center":
                start_y = (video_height - total_text_height) // 2
                logger.debug(f"Using CENTER position: centered vertically")
            elif request.position == "lower-3/4":
                start_y = int(video_height * 0.75 - total_text_height // 2)
                logger.debug(f"Using LOWER-3/4 position: 75% of height ({video_height * 0.75}) minus half text height")
            else:  # bottom
                start_y = video_height - total_text_height - request.margin_vertical
                logger.debug(f"Using BOTTOM position: video_height - total_text_height - margin_vertical")
            
            logger.info(f"Portrait subtitle positioning: position={request.position}, start_y={start_y}, total_height={total_text_height}, lines={len(wrapped_lines)}, video_height={video_height}")
            
            # Create a separate drawtext filter for each line to ensure proper centering
            for line_index, line_text in enumerate(wrapped_lines):
                if not line_text.strip():
                    continue
                
                # Calculate Y position for this line
                line_y = start_y + (line_index * line_height)
                
                # Write this line to a temp file so ffmpeg reads it via textfile=,
                # bypassing all filter-graph escaping issues.
                text_file_path = os.path.join(text_files_dir, f"sub_{subtitle.index}_line_{line_index}.txt")
                with open(text_file_path, 'w', encoding='utf-8') as f:
                    f.write(line_text)  # single line, no newline needed

                escaped_path = text_file_path.replace('\\', '/').replace(':', '\\:')
                drawtext_filter = f"drawtext=textfile={escaped_path}"
                
                # Add font file if available
                font_path = self._get_font_path(getattr(request, 'font_family', 'default'), subtitle.text)
                if font_path:
                    # Escape backslashes for ffmpeg
                    escaped_font_path = font_path.replace('\\', '\\\\').replace(':', '\\:')
                    drawtext_filter += f":fontfile='{escaped_font_path}'"
                
                # Each line is individually centered horizontally
                drawtext_filter += (
                    f":fontsize={request.font_size}"
                    f":fontcolor={request.font_color}"
                    f":borderw={request.border_width}"
                    f":bordercolor={request.border_color}"
                    f":x=(w-text_w)/2"  # Center each line individually
                    f":y={line_y}"
                    f":enable='between(t,{start_time},{end_time})'"
                )
                
                # Add background if specified
                if request.background_color:
                    drawtext_filter += f":box=1:boxcolor={request.background_color}:boxborderw=5"
                
                drawtext_filters.append(drawtext_filter)
                
                logger.debug(f"Portrait line {line_index + 1}/{len(wrapped_lines)}: '{line_text}' at y={line_y}")
        
        logger.info(f"Generated {len(drawtext_filters)} individual line filters for portrait video multi-line centering")
        return drawtext_filters
    
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
                        timeout=300  # 5 minute timeout
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