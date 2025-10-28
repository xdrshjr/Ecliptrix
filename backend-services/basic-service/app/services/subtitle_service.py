"""
Subtitle service for adding subtitles to videos with automatic edge detection and line wrapping.
"""

import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
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
        Calculate maximum line width in characters based on video dimensions and aspect ratio.
        
        Args:
            video_width: Video width in pixels
            font_size: Font size in pixels
            margin_horizontal: Horizontal margin in pixels
            video_height: Video height in pixels (for aspect ratio calculation)
            
        Returns:
            Maximum line width in characters
        """
        # Calculate available width for subtitles
        available_width = video_width - (2 * margin_horizontal)
        
        # Apply aspect ratio adjustments for better subtitle display
        if video_height is not None:
            aspect_ratio = video_width / video_height
            logger.info(f"Video aspect ratio: {aspect_ratio:.2f} ({video_width}x{video_height})")
            
            if aspect_ratio < 1.0:
                # Portrait/vertical video - use more accurate character width calculation
                logger.info("Portrait video detected - applying optimized character limits")
                
                # For Chinese characters, use more accurate width estimation
                # Chinese characters are typically wider than Latin characters
                char_width_factor = 0.8  # More accurate for Chinese characters
                char_width = font_size * char_width_factor
                
                # Calculate base character count
                base_max_chars = int(available_width / char_width)
                
                # Apply reasonable limits that respect user font size settings
                # The previous limits were too conservative and made fonts appear much smaller
                if font_size >= 100:
                    # Extra large font - allow fewer characters to prevent overflow
                    # For 100px font: 100 * 0.8 * 10 chars = 800px < 980px available
                    max_chars = min(base_max_chars, 10)
                elif font_size >= 72:
                    # Large font - allow reasonable character count while preventing overflow
                    # For 72px font: 72 * 0.8 * 12 chars = 691px < 980px available
                    max_chars = min(base_max_chars, 12)
                elif font_size >= 50:
                    # Medium font - allow good readability 
                    # For 50px font: 50 * 0.8 * 18 chars = 720px < 980px available
                    max_chars = min(base_max_chars, 18)
                elif font_size >= 30:
                    # Standard font - allow sufficient characters for normal text
                    # For 36px font: 36 * 0.8 * 25 chars = 720px < 980px available
                    max_chars = min(base_max_chars, 25)
                else:
                    # Small font - be more generous to maintain readability
                    # For 24px font: 24 * 0.8 * 35 chars = 672px < 980px available
                    max_chars = min(base_max_chars, 35)
                
                logger.info(f"Portrait video: base_chars={base_max_chars}, final_chars={max_chars} for font size {font_size}")
                
            elif aspect_ratio < 1.5:
                # Nearly square or slightly wide - moderate adjustment
                logger.info("Nearly square video detected - applying moderate character limits")
                char_width = font_size * 0.6
                max_chars = int(available_width / char_width * 0.8)
            else:
                # Landscape/horizontal video - use standard calculation
                logger.info("Landscape video detected - using standard character limits")
                char_width = font_size * 0.6
                max_chars = int(available_width / char_width)
        
        # Ensure minimum and maximum reasonable values
        # For portrait videos, use very conservative minimums to prevent overflow
        if video_height and video_width / video_height < 1.0:
            # Portrait video - use calculated value directly, no artificial minimum
            min_chars = 2  # Allow very small values for large fonts
        else:
            # Landscape video - use standard minimum
            min_chars = 20
        
        max_chars = max(min_chars, min(max_chars, 100))
        
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
        
        logger.info(f"Getting font path for system: {system}, family: {font_family}, has_chinese: {has_chinese}")
        
        # Font paths by system and font family
        font_paths_map = {}
        
        if system == "windows":
            font_paths_map = {
                "default": [
                    "C:/Windows/Fonts/msyh.ttc",        # Microsoft YaHei (微软雅黑) - best for Chinese
                    "C:/Windows/Fonts/simhei.ttf",      # SimHei (黑体)
                    "C:/Windows/Fonts/simsun.ttc",      # SimSun (宋体)
                    "C:/Windows/Fonts/arial.ttf",       # Arial (fallback)
                ],
                "serif": [
                    "C:/Windows/Fonts/simsun.ttc",      # SimSun (宋体) - serif Chinese
                    "C:/Windows/Fonts/times.ttf",       # Times New Roman
                    "C:/Windows/Fonts/timesbd.ttf",     # Times New Roman Bold
                    "C:/Windows/Fonts/georgia.ttf",     # Georgia
                ],
                "sans-serif": [
                    "C:/Windows/Fonts/msyh.ttc",        # Microsoft YaHei (微软雅黑)
                    "C:/Windows/Fonts/simhei.ttf",      # SimHei (黑体)
                    "C:/Windows/Fonts/arial.ttf",       # Arial
                    "C:/Windows/Fonts/calibri.ttf",     # Calibri
                ],
                "monospace": [
                    "C:/Windows/Fonts/consola.ttf",     # Consolas
                    "C:/Windows/Fonts/cour.ttf",        # Courier New
                    "C:/Windows/Fonts/lucon.ttf",       # Lucida Console
                ]
            }
        elif system == "darwin":  # macOS
            font_paths_map = {
                "default": [
                    "/System/Library/Fonts/PingFang.ttc",
                    "/System/Library/Fonts/Helvetica.ttc",
                    "/System/Library/Fonts/Arial.ttf",
                ],
                "serif": [
                    "/System/Library/Fonts/Times.ttc",
                    "/System/Library/Fonts/Georgia.ttf",
                ],
                "sans-serif": [
                    "/System/Library/Fonts/Helvetica.ttc",
                    "/System/Library/Fonts/Arial.ttf",
                    "/System/Library/Fonts/PingFang.ttc",
                ],
                "monospace": [
                    "/System/Library/Fonts/Monaco.ttf",
                    "/System/Library/Fonts/Courier New.ttf",
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
        for i, font_path in enumerate(font_paths):
            if os.path.exists(font_path):
                logger.info(f"Found suitable font (#{i+1}): {font_path}")
                return font_path
            else:
                logger.debug(f"Font not found (#{i+1}): {font_path}")
        
        # If no specific font found, try default fonts
        if font_family != "default":
            logger.warning(f"No {font_family} font found, trying default fonts")
            return self._get_font_path("default", text_content)
        
        logger.error("No suitable font found on the system! This will cause subtitle rendering issues.")
        logger.error("Please install Chinese fonts for proper subtitle support:")
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
    
    def _build_ffmpeg_command(
        self, 
        input_video: str, 
        output_video: str, 
        subtitles: List[SubtitleEntry],
        request: SubtitleAddRequest,
        video_width: int,
        video_height: int
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
                subtitles, request, video_width, video_height
            )
        else:
            logger.info("Landscape video detected - using standard subtitle rendering")
            # Use standard handling for landscape videos
            drawtext_filters = self._build_standard_drawtext_filters(
                subtitles, request, video_width, video_height
            )
        
        if not drawtext_filters:
            logger.warning("No valid subtitle filters created")
            return []
        
        logger.info(f"Generated {len(drawtext_filters)} drawtext filters for subtitle rendering")
        
        # Build complete ffmpeg command
        cmd = [
            'ffmpeg',
            '-i', input_video,
            '-vf', ','.join(drawtext_filters),
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
        video_height: int
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
            
            # Create multi-line text with actual newlines
            text_content = '\n'.join(wrapped_lines)
            
            # Escape special characters for ffmpeg
            text_content = text_content.replace("'", "\\'").replace(":", "\\:")
            
            # Build drawtext filter with font support
            drawtext_filter = f"drawtext=text='{text_content}'"
            
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
                logger.info(f"Adding background color {request.background_color} to subtitle: '{text_content[:20]}...'")
                drawtext_filter += f":box=1:boxcolor={request.background_color}:boxborderw=5"
            else:
                logger.info(f"No background color specified for subtitle: '{text_content[:20]}...'")
            
            drawtext_filters.append(drawtext_filter)
        
        return drawtext_filters
    
    def _build_multiline_centered_drawtext_filters(
        self,
        subtitles: List[SubtitleEntry],
        request: SubtitleAddRequest,
        video_width: int,
        video_height: int
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
                
                # Escape special characters for ffmpeg
                escaped_text = line_text.replace("'", "\\'").replace(":", "\\:")
                
                # Build drawtext filter with font support
                drawtext_filter = f"drawtext=text='{escaped_text}'"
                
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
            
            # Build ffmpeg command
            ffmpeg_cmd = self._build_ffmpeg_command(
                request.video_file_path,
                str(output_path),
                subtitles,
                request,
                video_width,
                video_height
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