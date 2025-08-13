"""
Audio transcription service for converting audio to subtitles using Volcano Engine API.
"""

import os
import time
import requests
import tempfile
import shutil
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime

from app.config import settings
from app.logger import get_logger
from app.models.audio_models import SubtitleItem

logger = get_logger(__name__)


class AudioTranscriptionService:
    """音频转字幕服务类"""
    
    def __init__(self):
        """初始化音频转字幕服务"""
        self.appid = settings.volcano_tts_appid
        self.access_token = settings.volcano_tts_access_token
        self.secret_key = settings.volcano_tts_secret_key
        self.base_url = 'https://openspeech.bytedance.com/api/v1/vc'
        self.headers = {
            'Authorization': f'Bearer; {self.access_token}',
            'Content-Type': 'application/json'
        }
        
        # 验证配置
        if not all([self.appid, self.access_token, self.secret_key]):
            logger.error("火山引擎API配置不完整")
            raise ValueError("火山引擎API配置不完整，请检查环境变量")
        
        logger.info("音频转字幕服务初始化完成")

    def submit_audio(self, audio_path: str, language: str = "zh-CN", 
                    use_itn: bool = True, use_punc: bool = False,
                    max_lines: int = 2, words_per_line: int = 15) -> Optional[str]:
        """
        提交音频到字幕生成API
        
        Args:
            audio_path: 音频文件路径
            language: 语言代码
            use_itn: 是否使用逆文本规范化
            use_punc: 是否使用标点符号
            max_lines: 最大行数
            words_per_line: 每行最大字数
            
        Returns:
            任务ID，失败返回None
        """
        try:
            url = f"{self.base_url}/submit"
            params = {
                'appid': self.appid,
                'language': language,
                'use_itn': str(use_itn),
                'use_punc': str(use_punc),
                'max_lines': max_lines,
                'words_per_line': words_per_line
            }

            logger.info(f"提交音频转字幕请求: {audio_path}, 参数: {params}")

            # 读取音频文件并提交
            with open(audio_path, 'rb') as audio_file:
                audio_data = audio_file.read()
                
                headers = {
                    'Authorization': f'Bearer; {self.access_token}',
                    'Content-Type': 'audio/wav'
                }

                response = requests.post(
                    url,
                    params=params,
                    data=audio_data,
                    headers=headers,
                    timeout=30
                )

            logger.info(f"API响应状态码: {response.status_code}")
            logger.debug(f"API响应内容: {response.text}")

            if response.status_code == 200:
                result = response.json()
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

        except Exception as e:
            logger.error(f"提交音频失败: {str(e)}")
            return None

    def query_result(self, job_id: str, max_retries: int = 30) -> Optional[Dict[str, Any]]:
        """
        查询字幕生成结果
        
        Args:
            job_id: 任务ID
            max_retries: 最大重试次数
            
        Returns:
            字幕数据，失败返回None
        """
        try:
            url = f"{self.base_url}/query"
            params = {
                'appid': self.appid,
                'id': job_id,
                'blocking': '1'  # 使用阻塞模式
            }

            logger.info(f"查询字幕生成结果，任务ID: {job_id}")

            for attempt in range(max_retries):
                response = requests.get(
                    url,
                    params=params,
                    headers={'Authorization': f'Bearer; {self.access_token}'},
                    timeout=30
                )

                if response.status_code == 200:
                    result = response.json()
                    logger.debug(f"查询结果: {result}")
                    
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

        except Exception as e:
            logger.error(f"查询结果失败: {str(e)}")
            return None

    def convert_to_srt(self, subtitle_data: Dict[str, Any]) -> Optional[str]:
        """
        将API返回的字幕数据转换为SRT格式
        
        Args:
            subtitle_data: API返回的字幕数据
            
        Returns:
            SRT格式字幕内容，失败返回None
        """
        try:
            if not subtitle_data or 'utterances' not in subtitle_data:
                logger.error("无字幕数据")
                return None

            srt_content = []
            for i, utterance in enumerate(subtitle_data['utterances'], 1):
                start_time = self.ms_to_srt_time(utterance['start_time'])
                end_time = self.ms_to_srt_time(utterance['end_time'])
                text = utterance['text']

                srt_content.append(f"{i}")
                srt_content.append(f"{start_time} --> {end_time}")
                srt_content.append(f"{text}")
                srt_content.append("")  # 空行分隔

            result = "\n".join(srt_content)
            logger.info(f"SRT字幕内容生成成功，共{len(subtitle_data['utterances'])}条字幕")
            return result

        except Exception as e:
            logger.error(f"SRT格式转换失败: {str(e)}")
            return None

    def ms_to_srt_time(self, milliseconds: int) -> str:
        """将毫秒转换为SRT时间格式"""
        hours = milliseconds // 3600000
        minutes = (milliseconds % 3600000) // 60000
        seconds = (milliseconds % 60000) // 1000
        ms = milliseconds % 1000
        return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"

    def save_srt_file(self, srt_content: str, filename: str) -> Tuple[str, str]:
        """
        保存SRT字幕文件
        
        Args:
            srt_content: SRT字幕内容
            filename: 文件名（不含扩展名）
            
        Returns:
            (文件路径, 访问URL)
        """
        try:
            # 确保目录存在
            srt_dir = os.path.join("static", "audio", "subtitles")
            os.makedirs(srt_dir, exist_ok=True)
            
            # 生成文件路径
            srt_filename = f"{filename}_{int(time.time())}.srt"
            srt_path = os.path.join(srt_dir, srt_filename)
            
            # 保存文件
            with open(srt_path, 'w', encoding='utf-8') as f:
                f.write(srt_content)
            
            # 生成访问URL
            srt_url = f"/static/audio/subtitles/{srt_filename}"
            
            logger.info(f"SRT文件保存成功: {srt_path}")
            return srt_path, srt_url

        except Exception as e:
            logger.error(f"保存SRT文件失败: {str(e)}")
            raise

    def get_audio_duration(self, audio_path: str) -> Optional[float]:
        """
        获取音频时长
        
        Args:
            audio_path: 音频文件路径
            
        Returns:
            音频时长（秒），失败返回None
        """
        try:
            import subprocess
            import json
            
            cmd = [
                'ffprobe', '-v', 'quiet', '-print_format', 'json',
                '-show_format', audio_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            info = json.loads(result.stdout)
            
            duration = float(info['format']['duration'])
            logger.info(f"音频时长: {duration}秒")
            return duration
            
        except Exception as e:
            logger.warning(f"获取音频时长失败: {str(e)}")
            return None

    def process_audio_file(self, audio_path: str, language: str = "zh-CN",
                          use_itn: bool = True, use_punc: bool = False,
                          max_lines: int = 2, words_per_line: int = 15,
                          generate_srt_file: bool = True) -> Dict[str, Any]:
        """
        处理音频文件，完整的音频转字幕流程
        
        Args:
            audio_path: 音频文件路径
            language: 语言代码
            use_itn: 是否使用逆文本规范化
            use_punc: 是否使用标点符号
            max_lines: 最大行数
            words_per_line: 每行最大字数
            generate_srt_file: 是否生成SRT文件
            
        Returns:
            处理结果字典
        """
        start_time = time.time()
        
        try:
            logger.info(f"开始处理音频文件: {audio_path}")
            
            # 检查文件是否存在
            if not os.path.exists(audio_path):
                raise FileNotFoundError(f"音频文件不存在: {audio_path}")
            
            # 获取音频时长
            audio_duration = self.get_audio_duration(audio_path)
            
            # 1. 提交音频到API
            job_id = self.submit_audio(
                audio_path, language, use_itn, use_punc, max_lines, words_per_line
            )
            if not job_id:
                raise Exception("提交音频失败")

            # 2. 查询字幕结果
            subtitle_data = self.query_result(job_id)
            if not subtitle_data:
                raise Exception("查询字幕结果失败")

            # 3. 解析字幕数据
            subtitles = []
            if 'utterances' in subtitle_data:
                for utterance in subtitle_data['utterances']:
                    subtitle_item = SubtitleItem(
                        start_time=utterance['start_time'],
                        end_time=utterance['end_time'],
                        text=utterance['text']
                    )
                    subtitles.append(subtitle_item)

            # 4. 生成SRT内容
            srt_content = None
            srt_file_path = None
            srt_file_url = None
            
            if generate_srt_file and subtitles:
                srt_content = self.convert_to_srt(subtitle_data)
                if srt_content:
                    # 生成文件名
                    base_name = os.path.splitext(os.path.basename(audio_path))[0]
                    srt_file_path, srt_file_url = self.save_srt_file(srt_content, base_name)

            processing_time = time.time() - start_time
            
            result = {
                "success": True,
                "job_id": job_id,
                "subtitles": subtitles,
                "srt_content": srt_content,
                "srt_file_path": srt_file_path,
                "srt_file_url": srt_file_url,
                "processing_time": processing_time,
                "audio_duration": audio_duration,
                "subtitle_count": len(subtitles)
            }
            
            logger.info(f"音频转字幕完成，耗时: {processing_time:.2f}秒，字幕数量: {len(subtitles)}")
            return result

        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"音频转字幕失败: {str(e)}, 耗时: {processing_time:.2f}秒")
            return {
                "success": False,
                "error": str(e),
                "processing_time": processing_time
            }

    def transcribe_audio_urls(self, audio_items: List[Dict[str, Any]], 
                             language: str = "zh-CN", use_itn: bool = True, 
                             use_punc: bool = False, max_lines: int = 2, 
                             words_per_line: int = 15) -> List[Dict[str, Any]]:
        """
        批量转录音频URL列表
        
        Args:
            audio_items: 音频项目列表，每个项目包含id, name, url, start_time, duration, track_id等信息
            language: 语言代码
            use_itn: 是否使用逆文本规范化
            use_punc: 是否使用标点符号
            max_lines: 最大行数
            words_per_line: 每行最大字数
            
        Returns:
            转录结果列表
        """
        logger.info(f"开始批量音频转录，共{len(audio_items)}个音频项目")
        start_time = time.time()
        
        results = []
        successful_count = 0
        failed_count = 0
        
        for i, audio_item in enumerate(audio_items):
            item_start_time = time.time()
            audio_item_id = audio_item.get('id', f'audio_{i}')
            audio_item_name = audio_item.get('name', f'Audio {i+1}')
            audio_url = audio_item.get('url', '')
            track_id = audio_item.get('track_id', '')
            timeline_start_time = audio_item.get('start_time', 0.0)
            timeline_duration = audio_item.get('duration', 0.0)
            
            logger.info(f"处理音频项目 {i+1}/{len(audio_items)}: {audio_item_name} ({audio_item_id})")
            
            try:
                if not audio_url:
                    raise ValueError(f"音频项目 {audio_item_id} 缺少URL")
                
                # 下载音频文件
                temp_file_path = None
                try:
                    # 如果是本地文件路径，直接使用
                    if audio_url.startswith('/') or audio_url.startswith('static/'):
                        # 本地文件路径
                        if audio_url.startswith('/api/'):
                            # 去掉API前缀，转换为实际文件路径
                            temp_file_path = audio_url.replace('/api/', '')
                        else:
                            temp_file_path = audio_url
                        
                        if not os.path.exists(temp_file_path):
                            raise FileNotFoundError(f"本地音频文件不存在: {temp_file_path}")
                            
                        logger.info(f"使用本地音频文件: {temp_file_path}")
                        
                    else:
                        # 远程URL，需要下载
                        logger.info(f"下载远程音频文件: {audio_url}")
                        response = requests.get(audio_url, timeout=30)
                        response.raise_for_status()
                        
                        # 创建临时文件
                        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp3')
                        temp_file.write(response.content)
                        temp_file.close()
                        temp_file_path = temp_file.name
                        
                        logger.info(f"音频文件下载完成: {temp_file_path}")
                    
                    # 转录音频
                    transcription_result = self.process_audio_file(
                        temp_file_path, language, use_itn, use_punc, max_lines, words_per_line
                    )
                    
                    item_processing_time = time.time() - item_start_time
                    
                    if transcription_result.get('success', False):
                        successful_count += 1
                        
                        # 调整字幕时间戳，加上在时间轴上的开始时间
                        adjusted_subtitles = []
                        for subtitle in transcription_result.get('subtitles', []):
                            adjusted_subtitle = {
                                'start_time': subtitle.start_time + int(timeline_start_time * 1000),
                                'end_time': subtitle.end_time + int(timeline_start_time * 1000),
                                'text': subtitle.text
                            }
                            adjusted_subtitles.append(adjusted_subtitle)
                        
                        # 重新生成调整后的SRT内容
                        srt_content = ""
                        if adjusted_subtitles:
                            srt_lines = []
                            for idx, subtitle in enumerate(adjusted_subtitles, 1):
                                start_time_str = self._format_srt_time(subtitle['start_time'])
                                end_time_str = self._format_srt_time(subtitle['end_time'])
                                srt_lines.append(f"{idx}")
                                srt_lines.append(f"{start_time_str} --> {end_time_str}")
                                srt_lines.append(subtitle['text'])
                                srt_lines.append("")
                            srt_content = "\n".join(srt_lines)
                        
                        result = {
                            'audio_item_id': audio_item_id,
                            'audio_item_name': audio_item_name,
                            'track_id': track_id,
                            'start_time': timeline_start_time,
                            'duration': timeline_duration,
                            'success': True,
                            'subtitles': adjusted_subtitles,
                            'srt_content': srt_content,
                            'processing_time': item_processing_time,
                            'audio_duration': transcription_result.get('audio_duration'),
                            'error_message': None
                        }
                        
                        logger.info(f"音频项目 {audio_item_id} 转录成功，生成 {len(adjusted_subtitles)} 条字幕")
                        
                    else:
                        failed_count += 1
                        result = {
                            'audio_item_id': audio_item_id,
                            'audio_item_name': audio_item_name,
                            'track_id': track_id,
                            'start_time': timeline_start_time,
                            'duration': timeline_duration,
                            'success': False,
                            'subtitles': [],
                            'srt_content': None,
                            'processing_time': item_processing_time,
                            'audio_duration': None,
                            'error_message': transcription_result.get('error', '转录失败')
                        }
                        
                        logger.error(f"音频项目 {audio_item_id} 转录失败: {result['error_message']}")
                    
                finally:
                    # 清理临时文件（仅删除下载的临时文件，不删除本地文件）
                    if temp_file_path and not audio_url.startswith('/') and not audio_url.startswith('static/'):
                        try:
                            if os.path.exists(temp_file_path):
                                os.unlink(temp_file_path)
                                logger.debug(f"清理临时文件: {temp_file_path}")
                        except Exception as cleanup_error:
                            logger.warning(f"清理临时文件失败: {cleanup_error}")
                
            except Exception as e:
                failed_count += 1
                item_processing_time = time.time() - item_start_time
                error_message = str(e)
                
                result = {
                    'audio_item_id': audio_item_id,
                    'audio_item_name': audio_item_name,
                    'track_id': track_id,
                    'start_time': timeline_start_time,
                    'duration': timeline_duration,
                    'success': False,
                    'subtitles': [],
                    'srt_content': None,
                    'processing_time': item_processing_time,
                    'audio_duration': None,
                    'error_message': error_message
                }
                
                logger.error(f"音频项目 {audio_item_id} 处理异常: {error_message}")
            
            results.append(result)
        
        total_processing_time = time.time() - start_time
        logger.info(f"批量音频转录完成，总耗时: {total_processing_time:.2f}秒，成功: {successful_count}，失败: {failed_count}")
        
        return results

    def _format_srt_time(self, milliseconds: int) -> str:
        """
        将毫秒时间戳格式化为SRT时间格式
        
        Args:
            milliseconds: 毫秒时间戳
            
        Returns:
            SRT格式的时间字符串 (HH:MM:SS,mmm)
        """
        total_seconds = milliseconds // 1000
        ms = milliseconds % 1000
        
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        
        return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"


# 创建全局服务实例
audio_transcription_service = AudioTranscriptionService() 