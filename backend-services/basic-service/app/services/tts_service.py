"""
Text-to-Speech service using Volcano TTS API.
"""

import os
import uuid
import json
import base64
import time
import subprocess
from typing import Dict, Any, Optional
from datetime import datetime
import requests
from fastapi import HTTPException

from app.config import settings
from app.logger import get_logger
from app.models.tts_models import VoiceType, VoiceTypeInfo
from app.services.supabase_service import supabase_service

logger = get_logger(__name__)

# 是否启用模拟模式（用于开发测试）
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
            
            # 如果是模拟模式，直接生成模拟音频文件
            if MOCK_MODE:
                return self._create_mock_audio_file(output_file, text, req_id)
            
            response = requests.post(
                self.base_url,
                headers=headers,
                data=json.dumps(request_data),
                timeout=30
            )
            
            # 先检查HTTP状态码
            if response.status_code == 401:
                logger.warning("TTS API认证失败，切换到模拟模式", {
                    "request_id": req_id,
                    "status_code": response.status_code,
                    "response_text": response.text[:200]
                })
                # 切换到模拟模式并重试
                MOCK_MODE = True
                return self._create_mock_audio_file(output_file, text, req_id)
            elif response.status_code != 200:
                logger.error(f"HTTP错误: {response.status_code}", {
                    "request_id": req_id,
                    "status_code": response.status_code,
                    "response_text": response.text,
                    "headers": dict(response.headers)
                })
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
            # 网络错误时也切换到模拟模式
            logger.warning("网络请求失败，切换到模拟模式")
            MOCK_MODE = True
            return self._create_mock_audio_file(output_file, text, req_id)
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
        voice_type: VoiceType = VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
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
                    "voice_type": voice_type.value,
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
                    voice_type=voice_type.value,
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

                # 尝试上传到Supabase
                supabase_url = None
                supabase_upload_success = False
                
                try:
                    # 在上传前验证文件完整性
                    if not os.path.exists(output_path):
                        logger.error("音频文件不存在，无法上传到Supabase", {
                            "audio_file": output_path,
                            "segment_id": segment_id,
                            "task_id": task_id
                        })
                        raise Exception(f"音频文件不存在: {output_path}")
                    
                    file_size = os.path.getsize(output_path)
                    if file_size == 0:
                        logger.error("音频文件为空，无法上传到Supabase", {
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
                                logger.error("音频文件无法读取，无法上传到Supabase", {
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
                    
                    logger.info("开始上传音频文件到Supabase", {
                        "audio_file": output_path,
                        "file_size": file_size,
                        "segment_id": segment_id,
                        "task_id": task_id,
                        "voice_type": voice_type.value
                    })
                    
                    upload_result = supabase_service.upload_audio_file(
                        audio_file_path=output_path,
                        segment_id=segment_id,
                        task_id=task_id,
                        voice_type=voice_type.value
                    )
                    
                    if upload_result["success"]:
                        supabase_url = upload_result["audio_url"]
                        supabase_upload_success = True
                        logger.info("音频文件上传到Supabase成功并获取到访问URL", {
                            "supabase_url": supabase_url,
                            "file_size": upload_result["file_size"],
                            "segment_id": segment_id,
                            "task_id": task_id,
                            "upload_success": True,
                            "url_accessible": True,
                            "is_signed_url": "signed" in supabase_url.lower() or "token" in supabase_url.lower(),
                            "message": f"音频文件已成功上传到Supabase，{'签名URL' if ('signed' in supabase_url.lower() or 'token' in supabase_url.lower()) else '公共URL'}可正常访问"
                        })
                    else:
                        logger.warning("音频文件上传到Supabase失败，使用本地URL", {
                            "error": upload_result["message"],
                            "segment_id": segment_id,
                            "task_id": task_id
                        })
                        
                except Exception as e:
                    logger.warning("上传到Supabase时发生异常，使用本地URL", {
                        "error": str(e),
                        "segment_id": segment_id,
                        "task_id": task_id
                    })
                
                # 构造返回数据
                # 优先使用Supabase URL，如果上传失败则使用本地URL
                audio_url = supabase_url if supabase_upload_success else f"/api/audio/generated/{filename}"
                
                result = {
                    "audio_url": audio_url,
                    "file_path": output_path,
                    "file_name": filename,
                    "file_size": file_size,
                    "duration": actual_duration,  # 添加实际时长
                    "voice_type": voice_type.value,
                    "text_length": len(text),
                    "speed_ratio": speed_ratio,
                    "request_id": str(uuid.uuid4()),
                    "created_at": datetime.now().isoformat(),
                    "segment_id": segment_id,
                    "task_id": task_id,
                    "mock_mode": MOCK_MODE,
                    "duration_method": "ffmpeg" if self._get_ffmpeg_path() else "estimated",  # 标记时长获取方式
                    "supabase_upload": supabase_upload_success,  # 标记是否成功上传到Supabase
                    "supabase_url": supabase_url  # Supabase URL
                }

                logger.info("TTS转换成功", {
                    "audio_url": result["audio_url"],
                    "file_size": result["file_size"],
                    "duration": result["duration"],
                    "supabase_upload": supabase_upload_success,
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
    
    def get_available_voice_types(self) -> Dict[str, VoiceTypeInfo]:
        """获取可用的音色类型列表"""
        voice_types = {
            VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS.value: VoiceTypeInfo(
                id=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS.value,
                name="温柔女声",
                language="zh-CN",
                gender="female",
                description="温柔甜美的女性声音，适合讲解和叙述"
            ),
            VoiceType.ZH_FEMALE_SWEET.value: VoiceTypeInfo(
                id=VoiceType.ZH_FEMALE_SWEET.value,
                name="甜美女声",
                language="zh-CN",
                gender="female", 
                description="清甜可爱的女性声音，适合轻松愉快的内容"
            ),
            VoiceType.ZH_FEMALE_GENTLE.value: VoiceTypeInfo(
                id=VoiceType.ZH_FEMALE_GENTLE.value,
                name="温和女声",
                language="zh-CN",
                gender="female",
                description="温和亲切的女性声音，适合教育和介绍类内容"
            ),
            VoiceType.ZH_MALE_WARM.value: VoiceTypeInfo(
                id=VoiceType.ZH_MALE_WARM.value,
                name="温暖男声",
                language="zh-CN", 
                gender="male",
                description="温暖磁性的男性声音，适合深度内容和专业讲解"
            ),
            VoiceType.ZH_MALE_POWERFUL.value: VoiceTypeInfo(
                id=VoiceType.ZH_MALE_POWERFUL.value,
                name="有力男声",
                language="zh-CN",
                gender="male",
                description="有力坚定的男性声音，适合激励和宣传内容"
            ),
            VoiceType.ZH_MALE_STEADY.value: VoiceTypeInfo(
                id=VoiceType.ZH_MALE_STEADY.value,
                name="稳重男声",
                language="zh-CN",
                gender="male",
                description="稳重可靠的男性声音，适合新闻和正式内容"
            )
        }
        
        return voice_types


# 全局TTS服务实例
tts_service = TTSService() 