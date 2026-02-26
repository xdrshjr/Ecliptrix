"""
Text-to-Speech service using Volcano TTS API.
"""

import os
import uuid
import json
import base64
import time
import subprocess
from typing import Dict, Any, Optional, List
from datetime import datetime
import requests
from fastapi import HTTPException
from pathlib import Path
import yaml

from app.config import settings
from app.logger import get_logger
from app.models.tts_models import VoiceType, VoiceTypeInfo
from app.services.storage_service import storage_service

logger = get_logger(__name__)

# 是否启用模拟模式（仅用于开发测试，生产环境应设为False）
MOCK_MODE = getattr(settings, 'tts_mock_mode', False)


class TTSClient:
    """Volcano TTS API client."""
    
    def __init__(self, appid: str, access_token: str):
        self.appid = appid
        self.access_token = access_token
        self.base_url = "https://openspeech.bytedance.com/api/v1/tts"
    
    def synthesize_speech(
        self,
        text: str,
        output_file: str,
        voice_type: str = "zh_female_wanqudashu_moon_bigtts",
        speed_ratio: float = 1.0
    ) -> bool:
        """
        调用火山引擎语音合成API，将文本转换为语音并保存到本地
        
        Args:
            text: 要合成的文本
            output_file: 输出文件路径
            voice_type: 音色类型
            speed_ratio: 语速比例
            
        Returns:
            bool: 是否成功
        """
        global MOCK_MODE
        
        req_id = str(uuid.uuid4())
        
        # 构造请求参数
        request_data = {
            "app": {
                "appid": self.appid,
                "token": self.access_token,
                "cluster": "volcano_tts"
            },
            "user": {
                "uid": f"user_{uuid.uuid4().hex[:8]}"
            },
            "audio": {
                "voice_type": voice_type,
                "encoding": "mp3",
                "speed_ratio": speed_ratio,
                "rate": 24000,
                "bitrate": 160
            },
            "request": {
                "reqid": req_id,
                "text": text,
                "operation": "query"
            }
        }
        
        headers = {
            "Authorization": f"Bearer;{self.access_token}",
            "Content-Type": "application/json"
        }
        
        try:
            logger.info(f"开始语音合成", {
                "text_preview": text[:100] + "..." if len(text) > 100 else text,
                "request_id": req_id,
                "voice_type": voice_type,
                "speed_ratio": speed_ratio,
                "output_file": output_file,
                "mock_mode": MOCK_MODE
            })
            
            # 如果是模拟模式，直接生成模拟音频文件（仅用于开发测试）
            if MOCK_MODE:
                return self._create_mock_audio_file(output_file, text, req_id)
            
            response = requests.post(
                self.base_url,
                headers=headers,
                data=json.dumps(request_data),
                timeout=30
            )
            
            # 检查HTTP状态码
            if response.status_code != 200:
                response_body = response.text[:500] if response.text else "(empty)"
                logger.error(
                    f"TTS API HTTP错误: status={response.status_code}, "
                    f"appid={self.appid}, "
                    f"response={response_body}"
                )
                return False
            
            result = response.json()
            
            if result.get("code") != 3000:
                error_msg = f"API错误: {result.get('code')} - {result.get('message')}"
                logger.error(error_msg, {
                    "request_id": req_id,
                    "api_response": result
                })
                return False

            # 获取base64编码的音频数据
            audio_data_b64 = result.get("data")
            if not audio_data_b64:
                logger.error("未获取到音频数据", {"request_id": req_id})
                return False

            # base64解码并保存文件
            audio_data = base64.b64decode(audio_data_b64)
            
            # 验证解码后的音频数据
            if len(audio_data) == 0:
                logger.error("解码后的音频数据为空", {"request_id": req_id})
                return False
            
            # 确保输出目录存在
            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            
            try:
                # 写入音频文件并确保完全写入
                with open(output_file, "wb") as f:
                    f.write(audio_data)
                    f.flush()  # 确保数据写入磁盘
                    os.fsync(f.fileno())  # 强制同步到磁盘
                
                # 验证文件是否正确写入
                if not os.path.exists(output_file):
                    logger.error("音频文件写入失败 - 文件不存在", {
                        "request_id": req_id,
                        "output_file": output_file
                    })
                    return False
                
                # 验证文件大小
                written_size = os.path.getsize(output_file)
                if written_size != len(audio_data):
                    logger.error("音频文件写入失败 - 文件大小不匹配", {
                        "request_id": req_id,
                        "output_file": output_file,
                        "expected_size": len(audio_data),
                        "written_size": written_size
                    })
                    return False
                
                # 验证文件内容（读取前几个字节检查）
                with open(output_file, "rb") as f:
                    first_bytes = f.read(10)
                    if len(first_bytes) == 0:
                        logger.error("音频文件写入失败 - 无法读取文件内容", {
                            "request_id": req_id,
                            "output_file": output_file
                        })
                        return False
                
                logger.debug("音频文件写入验证成功", {
                    "request_id": req_id,
                    "output_file": output_file,
                    "file_size": written_size,
                    "first_bytes": first_bytes.hex()
                })
                
            except Exception as write_error:
                logger.error("音频文件写入异常", {
                    "request_id": req_id,
                    "output_file": output_file,
                    "error": str(write_error)
                })
                return False

            # 记录成功信息
            duration = result.get("addition", {}).get("duration", "未知")
            logger.info(f"语音合成成功", {
                "request_id": req_id,
                "output_file": output_file,
                "file_size": len(audio_data),
                "written_size": written_size,
                "duration_ms": duration
            })

            return True

        except requests.exceptions.RequestException as e:
            logger.error(f"语音合成请求失败", {
                "request_id": req_id,
                "error": str(e)
            })
            return False
        except json.JSONDecodeError as e:
            logger.error(f"语音合成响应解析失败", {
                "request_id": req_id,
                "error": str(e)
            })
            return False
        except Exception as e:
            logger.error(f"语音合成未知错误", {
                "request_id": req_id,
                "error": str(e)
            })
            return False
    
    def _create_mock_audio_file(self, output_file: str, text: str, req_id: str) -> bool:
        """创建模拟的音频文件用于测试"""
        try:
            # 确保输出目录存在
            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            
            # 创建一个简单的模拟MP3文件头（最小的有效MP3文件）
            # 这是一个几乎无声的短MP3文件
            mock_mp3_data = base64.b64decode(
                "SUQzBAAAAAAAI1RJVDIAAAAZAAABZm9vAFRQRTEAAAASAAABZm9vAFRBTEIAAAASAAABZm9v"
                "AFRZRVIAAAASAAABZW9vAFRDT04AAAASAAABZW9vAP/+xGQAAP+BAACAAQABAACAAQABAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            )
            
            with open(output_file, "wb") as f:
                f.write(mock_mp3_data)
            
            logger.info(f"模拟语音合成成功", {
                "request_id": req_id,
                "output_file": output_file,
                "file_size": len(mock_mp3_data),
                "text_length": len(text),
                "mock_mode": True
            })
            
            return True
            
        except Exception as e:
            logger.error(f"模拟语音文件创建失败", {
                "request_id": req_id,
                "error": str(e)
            })
            return False


class TTSService:
    """Text-to-Speech service."""
    
    def __init__(self):
        self.appid = settings.volcano_tts_appid
        self.access_token = ***REMOVED***
        self.audio_dir = "static/audio/generated"

        # 启动时记录 token 状态，方便排查 403 问题
        token_preview = f"{self.access_token[:6]}...{self.access_token[-4:]}" if len(self.access_token) > 10 else "(empty or short)"
        logger.info(f"TTSService 初始化: appid={self.appid}, token={token_preview}")

        # 确保音频目录存在
        os.makedirs(self.audio_dir, exist_ok=True)
        
        # 检查ffmpeg可用性
        self._check_ffmpeg()
    
    def _check_ffmpeg(self) -> bool:
        """检查ffmpeg是否可用"""
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
            logger.info("ffmpeg is available for audio duration detection")
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            logger.warning("ffmpeg not found - audio duration detection will use estimation")
            return False
    
    def _get_ffmpeg_path(self) -> Optional[str]:
        """获取ffmpeg可执行文件路径"""
        try:
            subprocess.run(['ffmpeg', '-version'], 
                         capture_output=True, check=True)
            return 'ffmpeg'
        except (subprocess.CalledProcessError, FileNotFoundError):
            logger.warning("ffmpeg not available for audio duration detection")
            return None
    
    def _get_audio_duration_with_ffmpeg(self, audio_file_path: str) -> Optional[float]:
        """
        使用ffmpeg获取音频文件的实际时长
        
        Args:
            audio_file_path: 音频文件路径
            
        Returns:
            Optional[float]: 音频时长（秒），如果获取失败则返回None
        """
        ffmpeg_path = self._get_ffmpeg_path()
        if not ffmpeg_path:
            logger.warning("ffmpeg不可用，无法获取音频实际时长", {
                "audio_file": os.path.basename(audio_file_path)
            })
            return None
        
        try:
            # 使用ffprobe（通常与ffmpeg一起安装）获取音频时长
            cmd = [
                'ffprobe',
                '-v', 'quiet',
                '-show_entries', 'format=duration',
                '-of', 'csv=p=0',
                audio_file_path
            ]
            
            logger.info("使用ffprobe获取音频时长", {
                "audio_file": os.path.basename(audio_file_path),
                "command": ' '.join(cmd)
            })
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            duration_str = result.stdout.strip()
            
            if duration_str:
                duration = float(duration_str)
                logger.info("成功获取音频实际时长", {
                    "audio_file": os.path.basename(audio_file_path),
                    "duration": duration
                })
                return duration
            else:
                logger.warning("ffprobe返回空时长", {
                    "audio_file": os.path.basename(audio_file_path)
                })
                return None
                
        except subprocess.CalledProcessError as e:
            logger.error("ffprobe执行失败", {
                "audio_file": os.path.basename(audio_file_path),
                "error": str(e),
                "stderr": e.stderr if hasattr(e, 'stderr') else None
            })
            return None
        except (ValueError, TypeError) as e:
            logger.error("解析音频时长失败", {
                "audio_file": os.path.basename(audio_file_path),
                "duration_str": duration_str if 'duration_str' in locals() else None,
                "error": str(e)
            })
            return None
        except Exception as e:
            logger.error("获取音频时长时发生未知错误", {
                "audio_file": os.path.basename(audio_file_path),
                "error": str(e)
            })
            return None
    
    def _estimate_audio_duration(self, text_length: int, speed_ratio: float = 1.0) -> float:
        """
        估算音频时长（备用方案）
        
        Args:
            text_length: 文本长度
            speed_ratio: 语速比例
            
        Returns:
            float: 估算的音频时长（秒）
        """
        # 基础估算：每个字符约0.15秒
        base_duration = text_length * 0.15
        # 根据语速调整
        estimated_duration = base_duration / speed_ratio
        
        logger.info("使用估算方式计算音频时长", {
            "text_length": text_length,
            "speed_ratio": speed_ratio,
            "base_duration": base_duration,
            "estimated_duration": estimated_duration
        })
        
        return estimated_duration
    
    def validate_config(self) -> None:
        """验证TTS配置是否完整"""
        if not self.appid or not self.access_token:
            raise HTTPException(
                status_code=500,
                detail="TTS配置不完整：请检查VOLCANO_TTS_APPID和VOLCANO_TTS_ACCESS_TOKEN环境变量"
            )
    
    def convert_text_to_speech(
        self,
        text: str,
        voice_type: str = "zh_male_shaonianzixin_moon_bigtts",
        speed_ratio: float = 1.0,
        segment_id: Optional[str] = None,
        task_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        将文本转换为语音
        
        Args:
            text: 要转换的文本
            voice_type: 音色类型
            speed_ratio: 语速比例
            segment_id: 脚本段落ID
            task_id: 任务ID
            
        Returns:
            Dict: 转换结果信息
        """
        # 验证配置
        self.validate_config()
        
        # 验证输入
        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="文本内容不能为空")
        
        text = text.strip()
        if len(text) > 5000:
            logger.warning(f"文本过长，将截断到5000字符", {
                "original_length": len(text),
                "segment_id": segment_id,
                "task_id": task_id
            })
            text = text[:5000]
        
        # 生成文件名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_id = uuid.uuid4().hex[:8]
        filename = f"tts_{timestamp}_{file_id}.mp3"
        
        if segment_id:
            filename = f"tts_{segment_id}_{timestamp}_{file_id}.mp3"
        
        output_path = os.path.join(self.audio_dir, filename)
        
        # 重试机制
        max_retries = 3
        for attempt in range(max_retries):
            try:
                logger.info(f"开始TTS转换 (尝试 {attempt + 1}/{max_retries})", {
                    "text_length": len(text),
                    "voice_type": voice_type,
                    "speed_ratio": speed_ratio,
                    "segment_id": segment_id,
                    "task_id": task_id,
                    "output_file": filename,
                    "mock_mode": MOCK_MODE
                })
                
                tts_client = TTSClient(self.appid, self.access_token)
                success = tts_client.synthesize_speech(
                    text=text,
                    output_file=output_path,
                    voice_type=voice_type,
                    speed_ratio=speed_ratio
                )
                
                if not success:
                    raise Exception("语音合成失败")

                # 验证文件
                if not os.path.exists(output_path):
                    raise Exception("音频文件生成失败")

                file_size = os.path.getsize(output_path)
                if file_size == 0:
                    raise Exception("音频文件为空")

                # 获取音频实际时长
                actual_duration = self._get_audio_duration_with_ffmpeg(output_path)
                if actual_duration is None:
                    # 如果ffmpeg获取失败，使用估算方式
                    actual_duration = self._estimate_audio_duration(len(text), speed_ratio)
                    logger.info("使用估算时长作为备用方案", {
                        "segment_id": segment_id,
                        "estimated_duration": actual_duration
                    })

                # 尝试上传到存储服务
                upload_url = None
                upload_success = False

                try:
                    # 在上传前验证文件完整性
                    if not os.path.exists(output_path):
                        logger.error("音频文件不存在，无法上传到存储服务", {
                            "audio_file": output_path,
                            "segment_id": segment_id,
                            "task_id": task_id
                        })
                        raise Exception(f"音频文件不存在: {output_path}")

                    file_size = os.path.getsize(output_path)
                    if file_size == 0:
                        logger.error("音频文件为空，无法上传到存储服务", {
                            "audio_file": output_path,
                            "file_size": file_size,
                            "segment_id": segment_id,
                            "task_id": task_id
                        })
                        raise Exception(f"音频文件为空: {output_path}")

                    # 验证文件可读性
                    try:
                        with open(output_path, "rb") as test_file:
                            first_bytes = test_file.read(10)
                            if len(first_bytes) == 0:
                                logger.error("音频文件无法读取，无法上传到存储服务", {
                                    "audio_file": output_path,
                                    "segment_id": segment_id,
                                    "task_id": task_id
                                })
                                raise Exception(f"音频文件无法读取: {output_path}")
                    except Exception as read_error:
                        logger.error("音频文件读取测试失败", {
                            "audio_file": output_path,
                            "error": str(read_error),
                            "segment_id": segment_id,
                            "task_id": task_id
                        })
                        raise Exception(f"音频文件读取测试失败: {str(read_error)}")

                    logger.info("开始上传音频文件到存储服务", {
                        "audio_file": output_path,
                        "file_size": file_size,
                        "segment_id": segment_id,
                        "task_id": task_id,
                        "voice_type": voice_type
                    })

                    with open(output_path, "rb") as f:
                        file_data = f.read()

                    import asyncio
                    loop = asyncio.get_event_loop()
                    upload_result = loop.run_until_complete(
                        storage_service.upload_audio_file(
                            file_data=file_data,
                            filename=filename,
                            content_type="audio/mpeg",
                            user_id="anonymous",
                            task_id=task_id,
                        )
                    )

                    if upload_result["success"]:
                        upload_url = upload_result["file_url"]
                        upload_success = True
                        logger.info("音频文件上传到存储服务成功", {
                            "audio_url": upload_url,
                            "file_size": upload_result["file_size"],
                            "segment_id": segment_id,
                            "task_id": task_id,
                            "upload_success": True
                        })
                    else:
                        logger.warning("音频文件上传到存储服务失败，使用本地URL", {
                            "error": upload_result.get("message"),
                            "segment_id": segment_id,
                            "task_id": task_id
                        })

                except Exception as e:
                    logger.warning("上传到存储服务时发生异常，使用本地URL", {
                        "error": str(e),
                        "segment_id": segment_id,
                        "task_id": task_id
                    })

                # 构造返回数据
                # 优先使用存储服务URL，如果上传失败则使用本地URL
                audio_url = upload_url if upload_success else f"/api/audio/generated/{filename}"

                result = {
                    "audio_url": audio_url,
                    "file_path": output_path,
                    "file_name": filename,
                    "file_size": file_size,
                    "duration": actual_duration,
                    "voice_type": voice_type,
                    "text_length": len(text),
                    "speed_ratio": speed_ratio,
                    "request_id": str(uuid.uuid4()),
                    "created_at": datetime.now().isoformat(),
                    "segment_id": segment_id,
                    "task_id": task_id,
                    "mock_mode": MOCK_MODE,
                    "duration_method": "ffmpeg" if self._get_ffmpeg_path() else "estimated",
                    "storage_upload": upload_success,
                    "audio_url": audio_url
                }

                logger.info("TTS转换成功", {
                    "audio_url": result["audio_url"],
                    "file_size": result["file_size"],
                    "duration": result["duration"],
                    "storage_upload": upload_success,
                    "segment_id": segment_id,
                    "task_id": task_id
                })
                return result

            except Exception as e:
                error_msg = str(e)
                logger.error(f"TTS转换失败 (尝试 {attempt + 1}/{max_retries})", {
                    "error": error_msg,
                    "segment_id": segment_id,
                    "task_id": task_id
                })

                # 清理失败的文件
                if os.path.exists(output_path) and os.path.getsize(output_path) == 0:
                    try:
                        os.remove(output_path)
                    except:
                        pass

                # 最后一次尝试失败
                if attempt == max_retries - 1:
                    raise HTTPException(
                        status_code=500,
                        detail=f"语音转换失败 (尝试{max_retries}次): {error_msg}"
                    )

                # 等待后重试
                time.sleep(2 * (attempt + 1))
    
    def convert_text_to_speech_local(
        self,
        text: str,
        voice_type: str = "zh_male_shaonianzixin_moon_bigtts",
        speed_ratio: float = 1.0,
        output_path: str = None,
        segment_id: Optional[str] = None,
        task_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        将文本转换为语音并保存到本地（不上传到存储服务）
        
        Args:
            text: 要转换的文本
            voice_type: 音色类型
            speed_ratio: 语速比例
            output_path: 指定的输出路径，如果为None则自动生成
            segment_id: 脚本段落ID
            task_id: 任务ID
            
        Returns:
            Dict: 转换结果信息
        """
        # 验证配置
        self.validate_config()
        
        # 验证输入
        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="文本内容不能为空")
        
        text = text.strip()
        if len(text) > 5000:
            logger.warning(f"文本过长，将截断到5000字符", {
                "original_length": len(text),
                "segment_id": segment_id,
                "task_id": task_id
            })
            text = text[:5000]
        
        # 生成文件名和路径
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            file_id = uuid.uuid4().hex[:8]
            filename = f"tts_{timestamp}_{file_id}.mp3"
            
            if segment_id:
                filename = f"tts_{segment_id}_{timestamp}_{file_id}.mp3"
            
            output_path = os.path.join(self.audio_dir, filename)
        else:
            filename = os.path.basename(output_path)
        
        # 重试机制
        max_retries = 3
        for attempt in range(max_retries):
            try:
                logger.info(f"开始TTS本地转换 (尝试 {attempt + 1}/{max_retries})", {
                    "text_length": len(text),
                    "voice_type": voice_type,
                    "speed_ratio": speed_ratio,
                    "segment_id": segment_id,
                    "task_id": task_id,
                    "output_path": output_path,
                    "mock_mode": MOCK_MODE
                })
                
                tts_client = TTSClient(self.appid, self.access_token)
                success = tts_client.synthesize_speech(
                    text=text,
                    output_file=output_path,
                    voice_type=voice_type,
                    speed_ratio=speed_ratio
                )
                
                if not success:
                    raise Exception("语音合成失败")

                # 验证文件
                if not os.path.exists(output_path):
                    raise Exception("音频文件生成失败")

                file_size = os.path.getsize(output_path)
                if file_size == 0:
                    raise Exception("音频文件为空")

                # 获取音频实际时长
                actual_duration = self._get_audio_duration_with_ffmpeg(output_path)
                if actual_duration is None:
                    # 如果ffmpeg获取失败，使用估算方式
                    actual_duration = self._estimate_audio_duration(len(text), speed_ratio)
                    logger.info("使用估算时长作为备用方案", {
                        "segment_id": segment_id,
                        "estimated_duration": actual_duration
                    })
                
                # 构造返回数据（本地保存，不上传到存储服务）
                result = {
                    "audio_url": f"/api/audio/generated/{filename}",
                    "file_path": output_path,
                    "file_name": filename,
                    "file_size": file_size,
                    "duration": actual_duration,
                    "voice_type": voice_type,
                    "text_length": len(text),
                    "speed_ratio": speed_ratio,
                    "request_id": str(uuid.uuid4()),
                    "created_at": datetime.now().isoformat(),
                    "segment_id": segment_id,
                    "task_id": task_id,
                    "mock_mode": MOCK_MODE,
                    "duration_method": "ffmpeg" if self._get_ffmpeg_path() else "estimated",
                    "storage_upload": False,
                    "local_only": True
                }

                logger.info("TTS本地转换成功", {
                    "output_path": output_path,
                    "file_size": result["file_size"],
                    "duration": result["duration"],
                    "segment_id": segment_id,
                    "task_id": task_id
                })
                return result

            except Exception as e:
                error_msg = str(e)
                logger.error(f"TTS本地转换失败 (尝试 {attempt + 1}/{max_retries})", {
                    "error": error_msg,
                    "output_path": output_path,
                    "segment_id": segment_id,
                    "task_id": task_id
                })

                # 清理失败的文件
                if os.path.exists(output_path) and os.path.getsize(output_path) == 0:
                    try:
                        os.remove(output_path)
                    except:
                        pass

                # 最后一次尝试失败
                if attempt == max_retries - 1:
                    raise HTTPException(
                        status_code=500,
                        detail=f"语音本地转换失败 (尝试{max_retries}次): {error_msg}"
                    )

                # 等待后重试
                time.sleep(2 * (attempt + 1))
    
    def get_available_voice_types(self, locale: str = "zh-CN") -> Dict[str, VoiceTypeInfo]:
        """获取可用的音色类型列表，从配置文件读取"""
        
        # 分类翻译映射
        category_translations = {
            'zh-CN': {
                '通用场景': '通用场景',
                '趣味方言': '趣味方言', 
                '角色扮演': '角色扮演',
                '播报解说': '播报解说',
                '有声阅读': '有声阅读',
                '其他': '其他'
            },
            'en': {
                '通用场景': 'General Scenes',
                '趣味方言': 'Fun Dialects',
                '角色扮演': 'Role Playing', 
                '播报解说': 'Broadcasting',
                '有声阅读': 'Audio Reading',
                '其他': 'Others'
            }
        }
        
        # 音色名称和描述的英文翻译映射
        voice_translations = {
            'en': {
                # 通用场景
                'zh_male_shaonianzixin_moon_bigtts': {
                    'name': 'Young Zixin/Brayan (Male)',
                    'description': 'Young Zixin, clear male voice, suitable for youthful content'
                },
                'zh_female_linjianvhai_moon_bigtts': {
                    'name': 'Girl Next Door (Female)',
                    'description': 'Girl next door, warm and natural female voice'
                },
                'zh_male_yuanboxiaoshu_moon_bigtts': {
                    'name': 'Knowledgeable Uncle (Male)',
                    'description': 'Knowledgeable uncle, wise male voice'
                },
                'zh_male_yangguangqingnian_moon_bigtts': {
                    'name': 'Sunny Youth (Male)',
                    'description': 'Sunny youth, positive and upbeat male voice'
                },
                'zh_female_shuangkuaisisi_moon_bigtts': {
                    'name': 'Straightforward Sisi/Skye (Female)',
                    'description': 'Straightforward Sisi, crisp and decisive female voice'
                },
                'zh_female_tianmeixiaoyuan_moon_bigtts': {
                    'name': 'Sweet Xiaoyuan (Female)',
                    'description': 'Sweet Xiaoyuan, sweet and lovely female voice'
                },
                'zh_female_qingchezizi_moon_bigtts': {
                    'name': 'Clear Zizi (Female)',
                    'description': 'Clear Zizi, crystal clear female voice'
                },
                'zh_male_jieshuoxiaoming_moon_bigtts': {
                    'name': 'Narrator Xiaoming (Male)',
                    'description': 'Narrator Xiaoming, professional commentary male voice'
                },
                'zh_female_kailangjiejie_moon_bigtts': {
                    'name': 'Cheerful Sister (Female)',
                    'description': 'Cheerful sister, lively and cheerful female voice'
                },
                'zh_male_linjiananhai_moon_bigtts': {
                    'name': 'Boy Next Door (Male)',
                    'description': 'Boy next door, warm and natural male voice'
                },
                'zh_female_tianmeiyueyue_moon_bigtts': {
                    'name': 'Sweet Yueyue (Female)',
                    'description': 'Sweet Yueyue, sweet and charming female voice'
                },
                'zh_female_xinlingjitang_moon_bigtts': {
                    'name': 'Soul Chicken Soup (Female)',
                    'description': 'Soul chicken soup, warm and healing female voice'
                },
                'zh_female_cancan_mars_bigtts': {
                    'name': 'Cancan (Female)',
                    'description': 'Cancan, bright and brilliant female voice'
                },
                'zh_female_zhixingnvsheng_mars_bigtts': {
                    'name': 'Intellectual Woman (Female)',
                    'description': 'Intellectual woman, elegant and wise female voice'
                },
                'zh_female_qingxinnvsheng_mars_bigtts': {
                    'name': 'Fresh Woman (Female)',
                    'description': 'Fresh woman, fresh and natural female voice'
                },
                'zh_male_qingshuangnanda_mars_bigtts': {
                    'name': 'Refreshing Big Guy (Male)',
                    'description': 'Refreshing big guy, clean and refreshing male voice'
                },
                'zh_female_tiexinnvsheng_mars_bigtts': {
                    'name': 'Caring Woman (Female)',
                    'description': 'Caring woman, thoughtful and warm female voice'
                },
                # 趣味方言
                'zh_female_wanqudashu_moon_bigtts': {
                    'name': 'Bay Area Uncle (Male)',
                    'description': 'Bay Area uncle, male voice with Bay Area characteristics'
                },
                'zh_female_daimengchuanmei_moon_bigtts': {
                    'name': 'Cute Sichuan Girl (Female)',
                    'description': 'Cute Sichuan girl, lovely female voice with Sichuan dialect'
                },
                'zh_male_guozhoudege_moon_bigtts': {
                    'name': 'Guangzhou Brother De (Male)',
                    'description': 'Guangzhou Brother De, male voice with Cantonese characteristics'
                },
                'zh_male_beijingxiaoye_moon_bigtts': {
                    'name': 'Beijing Young Master (Male)',
                    'description': 'Beijing young master, male voice with Beijing accent'
                },
                'zh_male_haoyuxiaoge_moon_bigtts': {
                    'name': 'Haoyu Brother (Male)',
                    'description': 'Haoyu brother, male voice with Northeast accent'
                },
                'zh_male_guangxiyuanzhou_moon_bigtts': {
                    'name': 'Guangxi Yuanzhou (Male)',
                    'description': 'Guangxi Yuanzhou, male voice with Guangxi dialect'
                },
                'zh_female_meituojieer_moon_bigtts': {
                    'name': 'Sister Meituo (Female)',
                    'description': 'Sister Meituo, female voice with Chongqing dialect'
                },
                'zh_male_yuzhouzixuan_moon_bigtts': {
                    'name': 'Yuzhou Zixuan (Male)',
                    'description': 'Yuzhou Zixuan, male voice with Henan dialect'
                },
                'zh_male_jingqiangkanye_moon_bigtts': {
                    'name': 'Beijing Accent Kanye/Harmony (Male)',
                    'description': 'Beijing accent Kanye, male voice with strong Beijing flavor'
                },
                # 角色扮演
                'zh_female_meilinvyou_moon_bigtts': {
                    'name': 'Charming Girlfriend (Female)',
                    'description': 'Charming girlfriend, charming female voice'
                },
                'zh_male_shenyeboke_moon_bigtts': {
                    'name': 'Late Night Podcaster (Male)',
                    'description': 'Late night podcaster, deep and magnetic male voice'
                },
                'zh_female_sajiaonvyou_moon_bigtts': {
                    'name': 'Gentle Girlfriend (Female)',
                    'description': 'Gentle girlfriend, soft and tender female voice'
                },
                'zh_female_yuanqinvyou_moon_bigtts': {
                    'name': 'Sweet Junior (Female)',
                    'description': 'Sweet junior, cute and playful female voice'
                },
                'zh_female_gaolengyujie_moon_bigtts': {
                    'name': 'Cool Queen (Female)',
                    'description': 'Cool queen, aloof and elegant female voice'
                },
                'zh_male_aojiaobazong_moon_bigtts': {
                    'name': 'Arrogant CEO (Male)',
                    'description': 'Arrogant CEO, domineering male voice'
                },
                # 播报解说
                'en_female_anna_mars_bigtts': {
                    'name': 'Anna (Female)',
                    'description': 'Anna, professional English female broadcasting voice'
                },
                'zh_male_changtianyi_mars_bigtts': {
                    'name': 'Mystery Narrator (Male)',
                    'description': 'Mystery narrator, male voice suitable for suspenseful content'
                },
                'zh_male_jieshuonansheng_mars_bigtts': {
                    'name': 'Magnetic Narrator Male (Male)',
                    'description': 'Magnetic narrator male voice, professional and magnetic commentary voice'
                },
                'zh_female_jitangmeimei_mars_bigtts': {
                    'name': 'Chicken Soup Sister (Female)',
                    'description': 'Chicken soup sister, warm and healing female commentary voice'
                },
                'zh_male_chunhui_mars_bigtts': {
                    'name': 'Advertisement Narrator (Male)',
                    'description': 'Advertisement narrator, professional male advertising voice'
                },
                # 有声阅读
                'zh_male_ruyaqingnian_mars_bigtts': {
                    'name': 'Elegant Youth (Male)',
                    'description': 'Elegant youth, refined male voice suitable for reading'
                },
                'zh_male_baqiqingshu_mars_bigtts': {
                    'name': 'Domineering Uncle (Male)',
                    'description': 'Domineering uncle, powerful male reading voice'
                },
                'zh_male_qingcang_mars_bigtts': {
                    'name': 'Qingcang (Male)',
                    'description': 'Qingcang, deep and powerful male reading voice'
                },
                'zh_male_yangguangqingnian_mars_bigtts': {
                    'name': 'Energetic Brother (Male)',
                    'description': 'Energetic brother, vibrant male reading voice'
                }
            }
        }
        
        try:
            # 获取配置文件路径
            config_path = Path(__file__).parent.parent.parent / "config" / "batch_tts_config.yaml"
            
            logger.info("开始从配置文件加载音色列表", {
                "config_path": str(config_path),
                "file_exists": config_path.exists()
            })
            
            if not config_path.exists():
                logger.error("音色配置文件不存在", {
                    "config_path": str(config_path)
                })
                return self._get_fallback_voice_types(locale)
            
            # 读取配置文件
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            
            voice_types = {}
            volcano_config = config.get('voice_types', {}).get('volcano', {})
            voices_list = volcano_config.get('voices', [])
            
            logger.info("从配置文件加载音色", {
                "total_voices": len(voices_list),
                "engine_name": volcano_config.get('name', 'Unknown')
            })
            
            # 获取当前语言的翻译映射
            translations = category_translations.get(locale, category_translations['zh-CN'])
            voice_trans = voice_translations.get(locale, {})
            
            for voice in voices_list:
                voice_id = voice.get('value')
                if voice_id:
                    original_category = voice.get('category', '其他')
                    translated_category = translations.get(original_category, original_category)
                    
                    # 获取翻译的名称和描述
                    voice_translation = voice_trans.get(voice_id, {})
                    translated_name = voice_translation.get('name', voice.get('label', voice_id))
                    translated_description = voice_translation.get('description', voice.get('description', ''))
                    
                    voice_types[voice_id] = VoiceTypeInfo(
                        id=voice_id,
                        name=translated_name,
                        language=voice.get('language', 'zh-CN'),
                        gender=voice.get('gender', 'unknown'),
                        description=translated_description,
                        category=translated_category
                    )
            
            logger.info("音色列表加载成功", {
                "loaded_voices": len(voice_types),
                "categories": list(set(v.category for v in voice_types.values()))
            })
            
            return voice_types
            
        except Exception as e:
            logger.error("从配置文件加载音色列表失败", {
                "error": str(e),
                "config_path": str(config_path) if 'config_path' in locals() else 'unknown'
            })
            return self._get_fallback_voice_types(locale)
    
    def _get_fallback_voice_types(self, locale: str = "zh-CN") -> Dict[str, VoiceTypeInfo]:
        """获取备用音色类型列表（硬编码）"""
        logger.warning("使用备用音色列表", {
            "locale": locale
        })
        
        # 分类翻译映射（与上面的保持一致）
        category_translations = {
            'zh-CN': {
                '通用场景': '通用场景',
                '趣味方言': '趣味方言', 
                '角色扮演': '角色扮演',
                '播报解说': '播报解说',
                '有声阅读': '有声阅读',
                '其他': '其他'
            },
            'en': {
                '通用场景': 'General Scenes',
                '趣味方言': 'Fun Dialects',
                '角色扮演': 'Role Playing', 
                '播报解说': 'Broadcasting',
                '有声阅读': 'Audio Reading',
                '其他': 'Others'
            }
        }
        
        # 获取当前语言的翻译映射
        translations = category_translations.get(locale, category_translations['zh-CN'])
        
        voice_types = {
            VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS.value: VoiceTypeInfo(
                id=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS.value,
                name="温柔女声",
                language="zh-CN",
                gender="female",
                description="温柔甜美的女性声音，适合讲解和叙述",
                category=translations.get("通用场景", "通用场景")
            ),
            VoiceType.ZH_FEMALE_SWEET.value: VoiceTypeInfo(
                id=VoiceType.ZH_FEMALE_SWEET.value,
                name="甜美女声",
                language="zh-CN",
                gender="female", 
                description="清甜可爱的女性声音，适合轻松愉快的内容",
                category=translations.get("通用场景", "通用场景")
            ),
            VoiceType.ZH_FEMALE_GENTLE.value: VoiceTypeInfo(
                id=VoiceType.ZH_FEMALE_GENTLE.value,
                name="温和女声",
                language="zh-CN",
                gender="female",
                description="温和亲切的女性声音，适合教育和介绍类内容",
                category=translations.get("通用场景", "通用场景")
            ),
            VoiceType.ZH_MALE_WARM.value: VoiceTypeInfo(
                id=VoiceType.ZH_MALE_WARM.value,
                name="温暖男声",
                language="zh-CN", 
                gender="male",
                description="温暖磁性的男性声音，适合深度内容和专业讲解",
                category=translations.get("通用场景", "通用场景")
            ),
            VoiceType.ZH_MALE_POWERFUL.value: VoiceTypeInfo(
                id=VoiceType.ZH_MALE_POWERFUL.value,
                name="有力男声",
                language="zh-CN",
                gender="male",
                description="有力坚定的男性声音，适合激励和宣传内容",
                category=translations.get("通用场景", "通用场景")
            ),
            VoiceType.ZH_MALE_STEADY.value: VoiceTypeInfo(
                id=VoiceType.ZH_MALE_STEADY.value,
                name="稳重男声",
                language="zh-CN",
                gender="male",
                description="稳重可靠的男性声音，适合新闻和正式内容",
                category=translations.get("通用场景", "通用场景")
            )
        }
        
        return voice_types


# 全局TTS服务实例
tts_service = TTSService() 