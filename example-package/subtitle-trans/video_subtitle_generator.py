import requests
import json
import time
import subprocess
import os
import sys
import tempfile
import shutil
import re
from typing import Dict, List, Any, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def get_ffmpeg_tool_path(tool_name: str) -> str:
    """获取 FFmpeg 工具的正确路径"""
    # 首先尝试标准路径
    try:
        result = subprocess.run(['which', tool_name], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return tool_name
    except Exception:
        pass
    
    # 尝试 snap 安装的路径
    snap_paths = {
        'ffmpeg': 'ffmpeg',
        'ffprobe': 'ffmpeg.ffprobe',
        'ffplay': 'ffmpeg.ffplay'
    }
    
    if tool_name in snap_paths:
        snap_tool = snap_paths[tool_name]
        try:
            result = subprocess.run(['which', snap_tool], capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return snap_tool
        except Exception:
            pass
    
    # 如果都找不到，返回原始工具名（可能会失败，但至少有明确的错误信息）
    return tool_name


class VideoSubtitleGenerator:
    def __init__(self, appid: str, access_token: str):
        self.appid = appid
        self.access_token = access_token
        self.base_url = 'https://openspeech.bytedance.com/api/v1/vc'
        self.headers = {
            'Authorization': f'Bearer; {access_token}',
            'Content-Type': 'application/json'
        }

    def process_subtitle_punctuation(self, text: str) -> str:
        """智能处理字幕中的标点符号
        
        处理规则：
        1. 遇到逗号：调整成字幕换行（但保护数字中的逗号如1,000）
        2. 遇到句号：去掉句号（但保护小数点和序号点）
        3. 遇到数字中的符号：保持原有的样子
        4. 遇到顿号：转换为逗号保持并列关系
        5. 其他符号根据语义进行处理
        """
        if not text:
            return text
        
        # 临时替换标记，避免在处理过程中产生冲突
        TEMP_COMMA_MARKER = "<!TEMP_COMMA!>"
        TEMP_COLON_MARKER = "<!TEMP_COLON!>"
        TEMP_PERCENT_MARKER = "<!TEMP_PERCENT!>"
        TEMP_DOT_MARKER = "<!TEMP_DOT!>"
        TEMP_LIST_DOT_MARKER = "<!TEMP_LIST_DOT!>"
        NEWLINE_MARKER = "<!NEWLINE!>"
        
        processed_text = text
        
        # 1. 保护数字中的符号
        # 保护千分位符号（如：1,000, 12,345）
        processed_text = re.sub(r'(\d{1,3}),(\d{3})', rf'\1{TEMP_COMMA_MARKER}\2', processed_text)
        # 继续处理更长的数字（如：1,234,567）
        while re.search(r'\d{1,3}' + re.escape(TEMP_COMMA_MARKER) + r'\d{3},\d{3}', processed_text):
            processed_text = re.sub(r'(\d{1,3}' + re.escape(TEMP_COMMA_MARKER) + r'\d{3}),(\d{3})', 
                                  rf'\1{TEMP_COMMA_MARKER}\2', processed_text)
        
        # 保护时间格式中的冒号（如：12:30, 09:45）
        processed_text = re.sub(r'(\d{1,2}):(\d{2})', rf'\1{TEMP_COLON_MARKER}\2', processed_text)
        
        # 保护百分号
        processed_text = re.sub(r'(\d+)%', rf'\1{TEMP_PERCENT_MARKER}', processed_text)
        
        # 保护小数点（如：3.14, 12.5, 0.25）
        processed_text = re.sub(r'(\d+)\.(\d+)', rf'\1{TEMP_DOT_MARKER}\2', processed_text)
        
        # 保护序号后的点（如：1. 2. 3. 一、二、三、）
        processed_text = re.sub(r'(\d+|[一二三四五六七八九十]+)\.\s', rf'\1{TEMP_LIST_DOT_MARKER} ', processed_text)
        
        # 2. 处理标点符号
        # 顿号：转换为逗号（保持并列关系但避免过多换行）
        processed_text = re.sub(r'、', '，', processed_text)
        
        # 句号：直接删除（已保护的小数点和序号点不会被处理）
        processed_text = re.sub(r'[。.]', '', processed_text)
        
        # 逗号：转换为换行标记（已保护的千分位符号不会被处理）
        processed_text = re.sub(r'[，,]', NEWLINE_MARKER, processed_text)
        
        # 分号：转换为换行标记
        processed_text = re.sub(r'[；;]', NEWLINE_MARKER, processed_text)
        
        # 保留的符号（问号、感叹号、引号、括号等有语义意义的符号）
        # 这些符号不需要特殊处理，会被保留
        # ? ! " " ' ' ( ) [ ] { } - — … : 等
        
        # 其他一些可能需要删除的符号（根据实际需要调整）
        # 删除一些无意义的符号
        processed_text = re.sub(r'[#＃@＠&＆]', '', processed_text)
        
        # 3. 恢复被保护的符号
        processed_text = processed_text.replace(TEMP_COMMA_MARKER, ',')
        processed_text = processed_text.replace(TEMP_COLON_MARKER, ':')
        processed_text = processed_text.replace(TEMP_PERCENT_MARKER, '%')
        processed_text = processed_text.replace(TEMP_DOT_MARKER, '.')
        processed_text = processed_text.replace(TEMP_LIST_DOT_MARKER, '.')
        
        # 4. 处理换行标记
        # 对于不同的输出格式，换行标记的处理方式不同
        # 这里先保留标记，让调用方决定如何处理
        processed_text = processed_text.replace(NEWLINE_MARKER, '<SUBTITLE_NEWLINE>')
        
        # 清理多余的空格
        processed_text = re.sub(r'\s+', ' ', processed_text).strip()
        
        return processed_text

    def split_text_by_punctuation_newlines(self, text: str) -> List[str]:
        """根据标点符号换行标记分割文本"""
        if '<SUBTITLE_NEWLINE>' not in text:
            return [text] if text.strip() else []
        
        # 按换行标记分割
        parts = text.split('<SUBTITLE_NEWLINE>')
        # 清理每个部分并过滤空白
        return [part.strip() for part in parts if part.strip()]

    def extract_audio_from_video(self, video_path: str, audio_path: str) -> bool:
        """从视频中提取音频"""
        try:
            ffmpeg_cmd = get_ffmpeg_tool_path('ffmpeg')
            cmd = [
                ffmpeg_cmd, '-i', video_path,
                '-vn', '-acodec', 'pcm_s16le',
                '-ar', '16000', '-ac', '1',
                '-y', audio_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"音频提取成功: {audio_path}")
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"音频提取失败: {e}")
            return False

    def submit_audio(self, audio_path: str) -> Optional[str]:
        """提交音频到字幕生成API"""
        url = f"{self.base_url}/submit"
        params = {
            'appid': self.appid,
            'language': 'zh-CN',
            'use_itn': 'True',
            'use_punc': 'False',  # 关闭标点符号
            'max_lines': 2,
            'words_per_line': 15
        }

        # 读取音频文件
        with open(audio_path, 'rb') as audio_file:
            files = {'file': audio_file}
            headers = {
                'Authorization': f'Bearer; {self.access_token}',
                'Content-Type': 'audio/wav'
            }

            # 直接发送二进制音频数据
            response = requests.post(
                url,
                params=params,
                data=audio_file.read(),
                headers=headers
            )

        if response.status_code == 200:
            result = response.json()
            # 检查返回的message是否为Success
            if result.get('message') == 'Success':
                job_id = result.get('id')
                logger.info(f"音频提交成功，任务ID: {job_id}")
                return job_id
            else:
                logger.error(f"提交失败: {result.get('message')}")
                return None
        else:
            logger.error(f"HTTP请求失败: {response.status_code}, {response.text}")
            return None

    def query_result(self, job_id: str, max_retries: int = 30) -> Optional[Dict[str, Any]]:
        """查询字幕生成结果"""
        url = f"{self.base_url}/query"
        params = {
            'appid': self.appid,
            'id': job_id,
            'blocking': '1'  # 使用阻塞模式
        }

        for attempt in range(max_retries):
            response = requests.get(
                url,
                params=params,
                headers={'Authorization': f'Bearer; {self.access_token}'}
            )

            if response.status_code == 200:
                result = response.json()
                if result.get('code') == 0:
                    logger.info("字幕生成完成")
                    return result
                elif result.get('code') == 2000:
                    logger.info(f"正在处理中，第{attempt + 1}次查询...")
                    time.sleep(5)
                    continue
                else:
                    logger.error(f"查询失败: {result.get('message')}")
                    return None
            else:
                logger.error(f"HTTP请求失败: {response.status_code}")
                return None

        logger.error("查询超时")
        return None

    def convert_to_srt(self, subtitle_data: Dict[str, Any], srt_path: str) -> bool:
        """将API返回的字幕数据转换为SRT格式"""
        if not subtitle_data or 'utterances' not in subtitle_data:
            logger.error("无字幕数据")
            return False

        try:
            with open(srt_path, 'w', encoding='utf-8') as f:
                for i, utterance in enumerate(subtitle_data['utterances'], 1):
                    start_time = self.ms_to_srt_time(utterance['start_time'])
                    end_time = self.ms_to_srt_time(utterance['end_time'])
                    text = utterance['text']

                    # 检查是否为双语字幕（包含换行符）
                    is_bilingual = '\n' in text
                    
                    if is_bilingual:
                        # 双语字幕处理：分别处理两行文本
                        lines = text.split('\n', 1)  # 最多分成两部分
                        primary_text = lines[0].strip()
                        translated_text = lines[1].strip() if len(lines) > 1 else ""
                        
                        # 对两行文本分别进行智能处理
                        primary_text = self.process_subtitle_punctuation(primary_text)
                        translated_text = self.process_subtitle_punctuation(translated_text)
                        
                        # 双语字幕使用较小的换行限制以适应两行显示
                        primary_wrapped = self._wrap_text_for_srt(primary_text, max_chars_per_line=20)
                        translated_wrapped = self._wrap_text_for_srt(translated_text, max_chars_per_line=20)
                        
                        # 合并双语字幕
                        wrapped_text = f"{primary_wrapped}\n{translated_wrapped}"
                        
                        logger.debug(f"处理双语字幕SRT: 原文='{primary_text}' -> 翻译='{translated_text}'")
                    else:
                        # 单语字幕处理（原有逻辑）
                        # 智能处理标点符号
                        text = self.process_subtitle_punctuation(text)

                        # 处理基于标点符号的换行
                        text_lines = self.split_text_by_punctuation_newlines(text)
                        
                        if len(text_lines) > 1:
                            # 如果有基于标点符号的换行，直接使用，不限制行数
                            wrapped_text = '\n'.join(text_lines)
                        else:
                            # 否则使用原来的自动换行逻辑
                            wrapped_text = self._wrap_text_for_srt(text, max_chars_per_line=25)

                    f.write(f"{i}\n")
                    f.write(f"{start_time} --> {end_time}\n")
                    f.write(f"{wrapped_text}\n\n")

            logger.info(f"SRT字幕文件生成成功: {srt_path}")
            return True
        except Exception as e:
            logger.error(f"SRT文件生成失败: {e}")
            return False

    def _wrap_text_for_srt(self, text: str, max_chars_per_line: int = 25) -> str:
        """为SRT格式自动换行文本"""
        if not text.strip():
            return ""
        
        # 对于可能的竖版视频，使用更保守的字符限制
        # 根据文本长度和字符类型进行更精确的估算
        chinese_char_count = sum(1 for char in text if ord(char) > 127)
        total_char_count = len(text)
        
        # 如果中文字符较多或文本较长，使用更保守的限制
        if chinese_char_count > total_char_count * 0.7 or len(text) > 30:
            max_chars_per_line = min(max_chars_per_line, 8)   # 中文为主的文本用极保守的限制
        elif len(text) > 25:
            max_chars_per_line = min(max_chars_per_line, 10)  # 一般较长文本的极保守限制
            
        # 如果文本很短，直接返回
        if len(text) <= max_chars_per_line:
            return text
        
        # 按词分割文本进行换行
        words = text.split()
        lines = []
        current_line = ""
        
        for word in words:
            # 检查添加这个词后是否超出长度限制
            test_line = current_line + (" " if current_line else "") + word
            
            if len(test_line) <= max_chars_per_line:
                current_line = test_line
            else:
                # 如果当前行不为空，保存它
                if current_line:
                    lines.append(current_line)
                    current_line = word
                else:
                    # 如果单个词太长，强制拆分
                    while len(word) > max_chars_per_line:
                        lines.append(word[:max_chars_per_line])
                        word = word[max_chars_per_line:]
                    current_line = word
        
        # 添加最后一行
        if current_line:
            lines.append(current_line)
        
        # 允许更多行数以确保所有内容都能显示，移除省略号逻辑
        # SRT格式可以支持多行字幕，优先保证内容完整性
        
        return "\n".join(lines)

    def convert_to_ass(self, subtitle_data: Dict[str, Any], ass_path: str, style: str = "default", font_size: int = 24) -> bool:
        """将API返回的字幕数据转换为ASS格式（备用方案，Windows兼容性更好）"""
        if not subtitle_data or 'utterances' not in subtitle_data:
            logger.error("无字幕数据")
            return False

        try:
            # 预定义字幕样式
            styles = {
                "default": {
                    "font": "SimHei",
                    "fontsize": font_size,
                    "primarycolor": "&Hffffff",
                    "outlinecolor": "&H000000",
                    "outline": 2,
                    "shadow": 0
                },
                "bold": {
                    "font": "SimHei",
                    "fontsize": font_size,
                    "primarycolor": "&Hffffff",
                    "outlinecolor": "&H000000",
                    "outline": 3,
                    "shadow": 2,
                    "bold": -1
                },
                "elegant": {
                    "font": "Microsoft YaHei",
                    "fontsize": font_size,
                    "primarycolor": "&Hf0f0f0",
                    "outlinecolor": "&H404040",
                    "outline": 1,
                    "shadow": 1
                },
                "colorful": {
                    "font": "SimHei",
                    "fontsize": font_size,
                    "primarycolor": "&H00ffff",
                    "outlinecolor": "&H000080",
                    "outline": 2,
                    "shadow": 1
                }
            }

            current_style = styles.get(style, styles["default"])
            
            with open(ass_path, 'w', encoding='utf-8') as f:
                # 写入ASS文件头
                f.write("[Script Info]\n")
                f.write("Title: Auto-generated subtitles\n")
                f.write("ScriptType: v4.00+\n\n")
                
                f.write("[V4+ Styles]\n")
                f.write("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
                
                bold = current_style.get('bold', 0)
                f.write(f"Style: Default,{current_style['font']},{current_style['fontsize']},{current_style['primarycolor']},&H000000,{current_style['outlinecolor']},&H80000000,{bold},0,0,0,100,100,0,0,1,{current_style['outline']},{current_style['shadow']},2,10,10,10,1\n\n")
                
                f.write("[Events]\n")
                f.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
                
                for utterance in subtitle_data['utterances']:
                    start_time = self.ms_to_ass_time(utterance['start_time'])
                    end_time = self.ms_to_ass_time(utterance['end_time'])
                    text = utterance['text']
                    
                    # 检查是否为双语字幕（包含换行符）
                    is_bilingual = '\n' in text
                    
                    if is_bilingual:
                        # 双语字幕处理：分别处理两行文本
                        lines = text.split('\n', 1)  # 最多分成两部分
                        primary_text = lines[0].strip()
                        translated_text = lines[1].strip() if len(lines) > 1 else ""
                        
                        # 对两行文本分别进行智能处理
                        primary_text = self.process_subtitle_punctuation(primary_text)
                        translated_text = self.process_subtitle_punctuation(translated_text)
                        
                        # 双语字幕使用较小的换行限制以适应两行显示
                        primary_wrapped = self._wrap_text_for_ass(primary_text, max_chars_per_line=25)
                        translated_wrapped = self._wrap_text_for_ass(translated_text, max_chars_per_line=25)
                        
                        # 合并双语字幕，在中间添加一个空行进行分隔
                        wrapped_text = f"{primary_wrapped}\\N{translated_wrapped}"
                        
                        logger.debug(f"处理双语字幕: 原文='{primary_text}' -> 翻译='{translated_text}'")
                    else:
                        # 单语字幕处理（原有逻辑）
                        # 智能处理标点符号
                        text = self.process_subtitle_punctuation(text)
                        
                        # 处理基于标点符号的换行
                        text_lines = self.split_text_by_punctuation_newlines(text)
                        
                        if len(text_lines) > 1:
                            # 如果有基于标点符号的换行，直接使用（ASS格式使用\N表示换行），不限制行数
                            wrapped_text = '\\N'.join(text_lines)
                        else:
                            # 否则使用原来的自动换行逻辑
                            wrapped_text = self._wrap_text_for_ass(text, max_chars_per_line=30)
                    
                    f.write(f"Dialogue: 0,{start_time},{end_time},Default,,0,0,0,,{wrapped_text}\n")

            logger.info(f"ASS字幕文件生成成功: {ass_path}")
            return True
        except Exception as e:
            logger.error(f"ASS文件生成失败: {e}")
            return False

    def ms_to_ass_time(self, milliseconds: int) -> str:
        """将毫秒转换为ASS时间格式 (H:MM:SS.cc)"""
        hours = milliseconds // 3600000
        minutes = (milliseconds % 3600000) // 60000
        seconds = (milliseconds % 60000) // 1000
        centiseconds = (milliseconds % 1000) // 10
        return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"

    def ms_to_srt_time(self, milliseconds: int) -> str:
        """将毫秒转换为SRT时间格式"""
        hours = milliseconds // 3600000
        minutes = (milliseconds % 3600000) // 60000
        seconds = (milliseconds % 60000) // 1000
        ms = milliseconds % 1000
        return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"

    def add_subtitles_to_video(self, video_path: str, srt_path: str, output_path: str,
                               style: str = "default", font_size: int = 24) -> bool:
        """将字幕合成到视频中"""
        try:
            # 预定义字幕样式
            styles = {
                "default": {
                    "font": "SimHei",
                    "color": "&Hffffff",
                    "outline_color": "&H000000",
                    "outline": 2,
                    "shadow": 0
                },
                "bold": {
                    "font": "SimHei",
                    "color": "&Hffffff",
                    "outline_color": "&H000000",
                    "outline": 3,
                    "shadow": 2,
                    "bold": 1
                },
                "elegant": {
                    "font": "Microsoft YaHei",
                    "color": "&Hf0f0f0",
                    "outline_color": "&H404040",
                    "outline": 1,
                    "shadow": 1
                },
                "colorful": {
                    "font": "SimHei",
                    "color": "&H00ffff",  # 黄色
                    "outline_color": "&H000080",  # 深蓝色描边
                    "outline": 2,
                    "shadow": 1
                }
            }

            current_style = styles.get(style, styles["default"])

            # 构建样式字符串
            style_parts = [
                f"FontName={current_style['font']}",
                f"FontSize={font_size}",
                f"PrimaryColour={current_style['color']}",
                f"OutlineColour={current_style['outline_color']}",
                f"Outline={current_style['outline']}"
            ]

            if current_style.get('shadow'):
                style_parts.append(f"Shadow={current_style['shadow']}")
            if current_style.get('bold'):
                style_parts.append(f"Bold={current_style['bold']}")

            style_string = ','.join(style_parts)

            # 解决Windows路径问题：使用filename参数并转义冒号
            # 将路径转换为Unix风格，并转义冒号
            unix_style_path = srt_path.replace('\\', '/').replace(':', '\\:')
            
            # 构建FFmpeg命令
            ffmpeg_cmd = get_ffmpeg_tool_path('ffmpeg')
            cmd = [
                ffmpeg_cmd, '-i', video_path,
                '-vf', f"subtitles=filename='{unix_style_path}':force_style='{style_string}'",
                '-c:a', 'copy',
                '-y', output_path
            ]

            logger.info(f"执行FFmpeg命令: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"字幕合成成功: {output_path}")
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"字幕合成失败: {e}")
            logger.error(f"错误输出: {e.stderr}")
            return False

    def generate_subtitle_for_video(self, video_path: str, output_path: str,
                                    style: str = "default", font_size: int = 24) -> bool:
        """完整的视频字幕生成流程"""
        # 生成临时文件路径
        base_name = os.path.splitext(os.path.basename(video_path))[0]
        temp_dir = tempfile.mkdtemp()
        temp_audio = os.path.join(temp_dir, f"{base_name}_temp.wav")
        temp_srt = os.path.join(temp_dir, f"{base_name}_subtitle.srt")
        temp_ass = os.path.join(temp_dir, f"{base_name}_subtitle.ass")

        try:
            logger.info(f"开始为视频生成字幕: {video_path}")
            logger.info(f"字幕样式: {style}, 字体大小: {font_size}")
            
            # 1. 提取音频
            if not self.extract_audio_from_video(video_path, temp_audio):
                return False

            # 2. 提交音频到API
            job_id = self.submit_audio(temp_audio)
            if not job_id:
                return False

            # 3. 查询字幕结果
            subtitle_data = self.query_result(job_id)
            if not subtitle_data:
                return False

            # 4. 尝试SRT格式，如果失败则使用ASS格式
            success = False
            
            # 首先尝试SRT格式
            if self.convert_to_srt(subtitle_data, temp_srt):
                logger.info("使用SRT格式字幕")
                success = self.add_subtitles_to_video(video_path, temp_srt, output_path, style, font_size)
            
            # 如果SRT失败，尝试ASS格式
            if not success:
                logger.info("SRT格式失败，尝试ASS格式字幕")
                if self.convert_to_ass(subtitle_data, temp_ass, style, font_size):
                    success = self.add_subtitles_to_video_ass(video_path, temp_ass, output_path)
            
            # 如果ASS也失败，尝试硬编码字幕
            if not success:
                logger.info("ASS格式失败，尝试硬编码字幕")
                success = self.add_hardcoded_subtitles(video_path, subtitle_data, output_path, style, font_size)
            
            if not success:
                logger.error("所有字幕格式都失败")
                return False

            logger.info(f"视频字幕生成完成: {output_path}")
            return True

        finally:
            # 清理临时文件
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"删除临时目录: {temp_dir}")
            except Exception as e:
                logger.warning(f"清理临时目录失败: {str(e)}")

    def add_subtitles_to_video_ass(self, video_path: str, ass_path: str, output_path: str) -> bool:
        """使用ASS格式字幕合成视频（Windows备用方案）"""
        try:
            # 解决Windows路径问题：转换为Unix风格并转义冒号
            unix_style_path = ass_path.replace('\\', '/').replace(':', '\\:')
            
            # 使用ASS滤镜
            ffmpeg_cmd = get_ffmpeg_tool_path('ffmpeg')
            cmd = [
                ffmpeg_cmd, '-i', video_path,
                '-vf', f"ass=filename='{unix_style_path}'",
                '-c:a', 'copy',
                '-y', output_path
            ]

            logger.info(f"执行FFmpeg ASS命令: {' '.join(cmd)}")
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"ASS字幕合成成功: {output_path}")
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"ASS字幕合成失败: {e}")
            logger.error(f"错误输出: {e.stderr}")
            return False

    def add_hardcoded_subtitles(self, video_path: str, subtitle_data: Dict[str, Any], output_path: str,
                               style: str = "default", font_size: int = 24) -> bool:
        """使用硬编码方式添加字幕（最终备用方案）"""
        try:
            if not subtitle_data or 'utterances' not in subtitle_data:
                logger.error("无字幕数据")
                return False

            # 获取视频尺寸
            video_info = self._get_video_info(video_path)
            if not video_info:
                logger.warning("无法获取视频信息，使用保守的默认设置（假设为竖版视频）")
                # 使用保守的默认值，假设可能是竖版视频
                video_width = 720   # 常见的竖版视频宽度
                video_height = 1280 # 常见的竖版视频高度
            else:
                video_width = video_info.get('width', 720)
                video_height = video_info.get('height', 1280)

            # 改进竖屏视频检测和字幕区域计算
            aspect_ratio = video_height / video_width if video_width > 0 else 1.78
            is_portrait = aspect_ratio > 1.5  # 长宽比大于1.5认为是竖屏
            is_9_16 = 1.7 <= aspect_ratio <= 1.85  # 9:16视频的长宽比约为1.78
            
            # 根据视频类型设置边距 - 大幅收紧边距确保字幕完全在屏幕内
            if is_9_16:
                margin_ratio = 0.4   # 9:16视频预留60%边距，确保字幕完全在屏幕内
            elif is_portrait:
                margin_ratio = 0.45  # 其他竖屏视频预留55%边距
            elif video_width < 800:
                margin_ratio = 0.5   # 窄屏视频预留50%边距
            else:
                margin_ratio = 0.8   # 横版视频预留20%边距
            
            max_text_width = int(video_width * margin_ratio)
            
            logger.info(f"视频尺寸: {video_width}x{video_height}, 长宽比: {aspect_ratio:.2f}, 竖屏: {is_portrait}, 9:16: {is_9_16}")
            logger.info(f"字幕最大宽度: {max_text_width} (边距比例: {margin_ratio})")

            # 预定义字幕样式
            styles = {
                "default": {
                    "fontfile": "",  # 使用系统默认字体
                    "fontsize": font_size,
                    "fontcolor": "white",
                    "borderw": 2,
                    "bordercolor": "black"
                },
                "bold": {
                    "fontfile": "",
                    "fontsize": font_size,
                    "fontcolor": "white",
                    "borderw": 3,
                    "bordercolor": "black"
                },
                "elegant": {
                    "fontfile": "",
                    "fontsize": font_size,
                    "fontcolor": "lightgray",
                    "borderw": 1,
                    "bordercolor": "gray"
                },
                "colorful": {
                    "fontfile": "",
                    "fontsize": font_size,
                    "fontcolor": "yellow",
                    "borderw": 2,
                    "bordercolor": "navy"
                }
            }

            current_style = styles.get(style, styles["default"])

            # 构建drawtext滤镜链
            drawtext_filters = []
            for i, utterance in enumerate(subtitle_data['utterances']):
                start_time = utterance['start_time'] / 1000.0  # 转换为秒
                end_time = utterance['end_time'] / 1000.0
                text = utterance['text']
                
                # 智能处理标点符号
                text = self.process_subtitle_punctuation(text)
                
                # 处理基于标点符号的换行
                text_lines = self.split_text_by_punctuation_newlines(text)
                
                if len(text_lines) > 1:
                    # 如果有基于标点符号的换行，对每一行单独处理换行，不限制行数
                    wrapped_lines = []
                    for line in text_lines:  # 处理所有行，不截断
                        line = line.replace(':', '\\:').replace("'", "\\'")  # 转义特殊字符
                        line_wrapped = self._wrap_text_for_video(line, max_text_width, current_style['fontsize'])
                        wrapped_lines.extend(line_wrapped)
                else:
                    # 否则使用原来的自动换行逻辑
                    text = text.replace(':', '\\:').replace("'", "\\'")  # 转义特殊字符
                    wrapped_lines = self._wrap_text_for_video(text, max_text_width, current_style['fontsize'])
                
                # 记录换行信息以便调试
                if len(wrapped_lines) > 1:
                    logger.debug(f"文本 '{text}' 被分为 {len(wrapped_lines)} 行: {wrapped_lines}")
                
                # 为每一行创建drawtext滤镜
                for line_index, line_text in enumerate(wrapped_lines):
                    if not line_text.strip():
                        continue
                        
                    # 计算行的垂直位置
                    line_height = current_style['fontsize'] + 4  # 行间距
                    total_text_height = len(wrapped_lines) * line_height
                    base_y = video_height - total_text_height - 60  # 距离底部60像素
                    line_y = base_y + (line_index * line_height)
                    
                    # 创建drawtext滤镜
                    drawtext_filter = f"drawtext=text='{line_text}':fontsize={current_style['fontsize']}:fontcolor={current_style['fontcolor']}:borderw={current_style['borderw']}:bordercolor={current_style['bordercolor']}:x=(w-text_w)/2:y={line_y}:enable='between(t,{start_time},{end_time})'"
                    drawtext_filters.append(drawtext_filter)

            if not drawtext_filters:
                logger.error("没有有效的字幕内容")
                return False

            # 组合所有滤镜
            filter_complex = ','.join(drawtext_filters)

            # 构建FFmpeg命令
            ffmpeg_cmd = get_ffmpeg_tool_path('ffmpeg')
            cmd = [
                ffmpeg_cmd, '-i', video_path,
                '-vf', filter_complex,
                '-c:a', 'copy',
                '-y', output_path
            ]

            logger.info(f"执行FFmpeg硬编码字幕命令")
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"硬编码字幕合成成功: {output_path}")
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"硬编码字幕合成失败: {e}")
            logger.error(f"错误输出: {e.stderr}")
            return False

    def _get_video_info(self, video_path: str) -> Optional[Dict[str, Any]]:
        """获取视频信息（尺寸等）"""
        try:
            ffprobe_cmd = get_ffmpeg_tool_path('ffprobe')
            cmd = [
                ffprobe_cmd, '-v', 'quiet', '-print_format', 'json', 
                '-show_streams', '-select_streams', 'v:0', video_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            info = json.loads(result.stdout)
            
            video_stream = info.get('streams', [{}])[0]
            return {
                'width': int(video_stream.get('width', 1920)),
                'height': int(video_stream.get('height', 1080))
            }
        except Exception as e:
            logger.warning(f"获取视频信息失败: {e}")
            return None

    def _wrap_text_for_video(self, text: str, max_width: int, font_size: int) -> List[str]:
        """根据视频宽度自动换行文本"""
        if not text.strip():
            return []
        
        # 改进字符宽度估算，特别针对中文字符和竖版视频
        # 中文字符通常是方形，宽度约等于字体大小
        # 英文字符宽度约为字体大小的0.5-0.7倍
        # 为了保险起见，使用更保守的估算
        
        def estimate_char_width(char):
            if ord(char) > 127:  # 非ASCII字符（主要是中文）
                return font_size * 1.8  # 大幅提高中文字符宽度系数，极保守的估算
            else:  # ASCII字符（英文、数字、符号）
                return font_size * 1.0  # 大幅提高英文字符宽度系数
        
        def estimate_text_width(text_line):
            return sum(estimate_char_width(char) for char in text_line)
        
        # 为竖版视频预留更多边距，根据视频宽度动态调整 - 大幅收紧安全边距
        if max_width < 500:  # 极窄屏幕（如9:16手机视频）
            safe_max_width = max_width * 0.4   # 预留60%边距
        elif max_width < 800:  # 一般竖屏
            safe_max_width = max_width * 0.5   # 预留50%边距
        else:  # 横屏或宽屏
            safe_max_width = max_width * 0.65  # 预留35%边距
        
        # 如果文本很短，先检查是否需要换行
        if estimate_text_width(text) <= safe_max_width:
            return [text]
        
        # 按字符逐个构建行，更精确地控制宽度
        words = text.split()
        lines = []
        current_line = ""
        
        for word in words:
            # 检查添加这个词后的宽度
            test_line = current_line + (" " if current_line else "") + word
            test_width = estimate_text_width(test_line)
            
            if test_width <= safe_max_width:
                current_line = test_line
            else:
                # 如果当前行不为空，保存它
                if current_line:
                    lines.append(current_line)
                    
                    # 检查单个词是否也太长
                    if estimate_text_width(word) > safe_max_width:
                        # 单个词太长，需要强制拆分
                        chars = list(word)
                        temp_word = ""
                        for char in chars:
                            test_char_line = temp_word + char
                            if estimate_text_width(test_char_line) <= safe_max_width:
                                temp_word = test_char_line
                            else:
                                if temp_word:
                                    lines.append(temp_word)
                                temp_word = char
                        if temp_word:
                            current_line = temp_word
                        else:
                            current_line = ""
                    else:
                        current_line = word
                else:
                    # 当前行为空但词太长，强制拆分
                    chars = list(word)
                    temp_word = ""
                    for char in chars:
                        test_char_line = temp_word + char
                        if estimate_text_width(test_char_line) <= safe_max_width:
                            temp_word = test_char_line
                        else:
                            if temp_word:
                                lines.append(temp_word)
                            temp_word = char
                    current_line = temp_word or ""
        
        # 添加最后一行
        if current_line:
            lines.append(current_line)
        
        # 动态调整最大行数，确保所有内容都能显示，不使用省略号
        if max_width < 500:  # 极窄屏幕（如9:16手机视频）
            max_lines = 4  # 允许更多行数确保内容完整显示
        elif max_width < 800:  # 一般竖屏
            max_lines = 3  # 允许3行
        else:  # 横屏或宽屏
            max_lines = 3  # 最多3行
            
        # 如果行数超过建议最大值，仍然保留所有行，不截断内容
        # 移除省略号逻辑，确保所有字幕内容都能显示
        
        return lines

    def _wrap_text_for_ass(self, text: str, max_chars_per_line: int = 30) -> str:
        """为ASS格式自动换行文本"""
        if not text.strip():
            return ""
        
        # 对于可能的竖版视频，使用更保守的字符限制
        # 根据文本长度和字符类型进行更精确的估算
        chinese_char_count = sum(1 for char in text if ord(char) > 127)
        total_char_count = len(text)
        
        # 如果中文字符较多或文本较长，使用更保守的限制
        if chinese_char_count > total_char_count * 0.7 or len(text) > 35:
            max_chars_per_line = min(max_chars_per_line, 10)  # 中文为主的文本用极保守的限制
        elif len(text) > 25:
            max_chars_per_line = min(max_chars_per_line, 12)  # 一般较长文本的极保守限制
            
        # 按词分割文本进行换行
        words = text.split()
        lines = []
        current_line = ""
        
        for word in words:
            # 检查添加这个词后是否超出长度限制
            test_line = current_line + (" " if current_line else "") + word
            
            if len(test_line) <= max_chars_per_line:
                current_line = test_line
            else:
                # 如果当前行不为空，保存它
                if current_line:
                    lines.append(current_line)
                    current_line = word
                else:
                    # 如果单个词太长，强制拆分
                    while len(word) > max_chars_per_line:
                        lines.append(word[:max_chars_per_line])
                        word = word[max_chars_per_line:]
                    current_line = word
        
        # 添加最后一行
        if current_line:
            lines.append(current_line)
        
        # 允许更多行数以确保所有内容都能显示，移除省略号逻辑
        # ASS格式支持多行字幕，优先保证内容完整性
        
        return "\\N".join(lines)  # ASS格式使用\N表示换行


def add_user_edited_subtitles_to_video(video_path: str, output_path: str, subtitle_task_id: str, style: str, font_size: int) -> bool:
    """使用用户编辑的字幕合成视频"""
    try:
        # 读取字幕任务文件
        subtitle_tasks_dir = os.path.join(os.getcwd(), 'public', 'generated', 'subtitle-tasks')
        task_file = os.path.join(subtitle_tasks_dir, f"{subtitle_task_id}.json")
        
        logger.info(f"查找字幕任务文件: {task_file}")
        
        if not os.path.exists(task_file):
            logger.error(f"字幕任务文件不存在: {task_file}")
            return False
        
        with open(task_file, 'r', encoding='utf-8') as f:
            task_data = json.load(f)
        
        logger.info(f"字幕任务文件内容: {json.dumps(task_data, ensure_ascii=False, indent=2)}")
        
        subtitles = task_data.get('subtitles', [])
        if not subtitles:
            logger.error("字幕数据为空")
            return False
        
        logger.info(f"找到 {len(subtitles)} 条字幕，第一条内容: {subtitles[0] if subtitles else 'None'}")
        
        # 检查是否有双语字幕
        has_bilingual = any(subtitle.get('translated_text') for subtitle in subtitles)
        logger.info(f"检测到双语字幕: {has_bilingual}")
        
        # 转换用户编辑的字幕为API格式
        utterances = []
        for subtitle in subtitles:
            if has_bilingual and subtitle.get('translated_text'):
                # 双语字幕：上方原文，下方翻译
                combined_text = f"{subtitle['text']}\n{subtitle['translated_text']}"
                utterance = {
                    'start_time': subtitle['start_time'],  # 毫秒
                    'end_time': subtitle['end_time'],
                    'text': combined_text
                }
            else:
                # 单语字幕
                utterance = {
                    'start_time': subtitle['start_time'],  # 毫秒
                    'end_time': subtitle['end_time'],
                    'text': subtitle['text']
                }
            utterances.append(utterance)
            logger.info(f"转换字幕项: ID={subtitle.get('id', 'unknown')}, 时间={subtitle['start_time']}-{subtitle['end_time']}, 双语={has_bilingual and subtitle.get('translated_text') is not None}")
        
        subtitle_data = {'utterances': utterances}
        logger.info(f"字幕数据转换完成，共 {len(utterances)} 条字幕，双语模式: {has_bilingual}")
        
        # 生成临时文件路径
        base_name = os.path.splitext(os.path.basename(video_path))[0]
        temp_dir = tempfile.mkdtemp()
        temp_srt = os.path.join(temp_dir, f"{base_name}_subtitle.srt")
        temp_ass = os.path.join(temp_dir, f"{base_name}_subtitle.ass")

        try:
            # 创建字幕生成器（用于格式转换）
            generator = VideoSubtitleGenerator("", "")  # 不需要API认证，只用于格式转换
            
            # 尝试SRT格式
            success = False
            if generator.convert_to_srt(subtitle_data, temp_srt):
                logger.info("使用SRT格式字幕")
                success = generator.add_subtitles_to_video(video_path, temp_srt, output_path, style, font_size)
            
            # 如果SRT失败，尝试ASS格式
            if not success:
                logger.info("SRT格式失败，尝试ASS格式字幕")
                if generator.convert_to_ass(subtitle_data, temp_ass, style, font_size):
                    success = generator.add_subtitles_to_video_ass(video_path, temp_ass, output_path)
            
            # 如果ASS也失败，尝试硬编码字幕
            if not success:
                logger.info("ASS格式失败，尝试硬编码字幕")
                success = generator.add_hardcoded_subtitles(video_path, subtitle_data, output_path, style, font_size)
            
            return success

        finally:
            # 清理临时文件
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"删除临时目录: {temp_dir}")
            except Exception as e:
                logger.warning(f"清理临时目录失败: {str(e)}")
        
    except Exception as e:
        logger.exception(f"使用用户编辑字幕失败: {str(e)}")
        return False


def add_subtitles_to_composed_video(video_path: str, output_path: str, subtitle_config: Dict[str, Any], subtitle_task_id: str = None) -> Dict[str, Any]:
    """
    为已合成的视频添加字幕
    
    参数:
    video_path: 输入视频路径
    output_path: 输出视频路径  
    subtitle_config: 字幕配置
    subtitle_task_id: 字幕任务ID，如果提供则使用用户编辑的字幕
    
    返回:
    成功: {"success": True, "output_path": 输出路径}
    失败: {"success": False, "error": 错误信息}
    """
    try:
        # 检查是否启用字幕
        if not subtitle_config.get('enabled', True):
            logger.info("字幕功能已禁用，跳过字幕生成")
            # 如果不生成字幕，直接复制原文件到输出路径
            shutil.copy2(video_path, output_path)
            return {
                "success": True,
                "output_path": output_path,
                "message": "字幕功能已禁用"
            }

        # 获取字幕设置
        style = subtitle_config.get('style', 'default')
        font_size = subtitle_config.get('font_size', 24)
        
        # 检查是否有用户编辑的字幕
        if subtitle_task_id:
            logger.info(f"检测到字幕任务ID: {subtitle_task_id}，使用用户编辑的字幕")
            # 使用用户编辑的字幕
            success = add_user_edited_subtitles_to_video(
                video_path, 
                output_path, 
                subtitle_task_id, 
                style, 
                font_size
            )
            logger.info(f"用户编辑字幕处理结果: {success}")
        else:
            # 自动生成字幕（原有逻辑）
            # 从环境变量获取API认证信息
            appid = os.getenv('BYTEDANCE_APPID', '4269953601')
            access_token = os.getenv('BYTEDANCE_ACCESS_TOKEN', 'uAGE3iP8nJf3ewu-d6U1P6Jthv7i1DH7')
            
            if not appid or not access_token:
                return {
                    "success": False,
                    "error": "缺少ByteDance API认证信息，请配置环境变量BYTEDANCE_APPID和BYTEDANCE_ACCESS_TOKEN"
                }

            # 创建字幕生成器
            generator = VideoSubtitleGenerator(appid, access_token)

            # 生成字幕
            success = generator.generate_subtitle_for_video(
                video_path, 
                output_path,
                style=style,
                font_size=font_size
            )

        if success:
            return {
                "success": True,
                "output_path": output_path,
                "message": f"字幕生成成功，样式: {style}, 字体大小: {font_size}"
            }
        else:
            return {
                "success": False,
                "error": "字幕生成失败"
            }

    except Exception as e:
        logger.exception("字幕生成过程中发生异常:")
        return {
            "success": False,
            "error": f"字幕生成异常: {str(e)}"
        }


def check_dependencies():
    """检查依赖库和工具"""
    missing = []
    
    # 检查Python库
    try:
        import requests
    except ImportError:
        missing.append("requests库 (pip install requests)")
    
    # 检查FFmpeg
    try:
        ffmpeg_cmd = get_ffmpeg_tool_path('ffmpeg')
        result = subprocess.run([ffmpeg_cmd, '-version'], capture_output=True, text=True)
        if result.returncode != 0:
            missing.append("FFmpeg工具不可用")
    except FileNotFoundError:
        missing.append("FFmpeg工具未安装")
    except Exception:
        missing.append("FFmpeg工具检查失败")
    
    # 检查FFprobe
    try:
        ffprobe_cmd = get_ffmpeg_tool_path('ffprobe')
        result = subprocess.run([ffprobe_cmd, '-version'], capture_output=True, text=True)
        if result.returncode != 0:
            missing.append("FFprobe工具不可用")
    except FileNotFoundError:
        missing.append("FFprobe工具未安装")
    except Exception:
        missing.append("FFprobe工具检查失败")
    
    return missing

def main():
    """脚本调用入口 - 支持stdin输入"""
    try:
        # 检查依赖
        missing_deps = check_dependencies()
        if missing_deps:
            error_result = {
                "success": False,
                "error": f"缺少依赖: {', '.join(missing_deps)}"
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.exit(1)
        
        # 从stdin读取JSON配置
        config_json = sys.stdin.read().strip()
        
        if not config_json:
            error_result = {
                "success": False,
                "error": "未收到配置数据"
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.exit(1)
        
        # 解析JSON配置
        try:
            config = json.loads(config_json)
        except json.JSONDecodeError as e:
            error_result = {
                "success": False,
                "error": f"JSON配置解析失败: {str(e)}"
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.exit(1)
        
        video_path = config.get('video_path')
        output_path = config.get('output_path')
        subtitle_config = config.get('subtitle_config', {})
        subtitle_task_id = config.get('subtitle_task_id')
        
        if not video_path or not output_path:
            error_result = {
                "success": False,
                "error": "缺少必要参数: video_path 或 output_path"
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.exit(1)
        
        # 检查输入文件是否存在
        if not os.path.exists(video_path):
            error_result = {
                "success": False,
                "error": f"输入视频文件不存在: {video_path}"
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.exit(1)
        
        # 记录输入参数
        logger.info(f"接收到配置: 视频路径={video_path}, 输出路径={output_path}, 字幕配置={subtitle_config}, 字幕任务ID={subtitle_task_id}")
        
        # 生成字幕
        result = add_subtitles_to_composed_video(video_path, output_path, subtitle_config, subtitle_task_id)
        
        # 输出结果到stdout
        print(json.dumps(result, ensure_ascii=False))
        
        # 如果失败，返回错误码
        if not result.get('success', False):
            sys.exit(1)
        
    except Exception as e:
        logger.exception("脚本执行失败:")
        error_result = {
            "success": False,
            "error": f"脚本执行失败: {str(e)}"
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main() 