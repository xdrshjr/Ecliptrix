"""
Text-to-Speech service using Volcano TTS API.
"""

import os
import asyncio
import re
import uuid
import json
import base64
import time
import subprocess
from typing import Dict, Any, Optional
from datetime import datetime
import requests
from fastapi import HTTPException
from pathlib import Path
import yaml

from app.config import settings
from app.logger import get_logger
from app.models.tts_models import VoiceType, VoiceTypeInfo
from app.services.local_media_resolver import audio_generated_dir
from app.services.storage_service import storage_service
from app.services.tts_errors import (
    TTSServiceError, ProviderFailureContext, make_tts_error,
    provider_failure, safe_identifier,
)

logger = get_logger(__name__)

# 是否启用模拟模式（仅用于开发测试，生产环境应设为False）
MOCK_MODE = getattr(settings, 'tts_mock_mode', False)


def cleanup_failed_audio(output_path: str) -> None:
    """仅由拥有本次输出文件的调用者调用，不覆盖首要异常。"""
    try:
        Path(output_path).unlink(missing_ok=True)
    except OSError:
        logger.warning('清理本次失败的语音文件失败', {
            'error_code': 'TTS_LOCAL_IO_ERROR',
        })


class TTSClient:
    """
    Volcano TTS API client — V3 大模型语音合成.

    Migrated on 2026-05-15 from the legacy /api/v1/tts (Authorization:
    Bearer;<token> + app.appid/token/cluster body) to V3 HTTP Chunked
    /api/v3/tts/unidirectional. The new console issues a single API Key
    that is passed via X-Api-Key; X-Api-Resource-Id picks the product
    tier (seed-tts-1.0 character-billed, seed-tts-2.0, etc.) and also
    selects which voice family is acceptable.
    """

    def __init__(self, api_key: str, resource_id: str = "seed-tts-1.0"):
        self.api_key = api_key
        self.resource_id = resource_id
        self.base_url = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"

    def synthesize_speech(
        self, text: str, output_file: str,
        voice_type: str = "zh_female_qingxinnvsheng_uranus_bigtts",
        speed_ratio: float = 1.0,
    ) -> bool:
        """完整校验响应后才落盘；失败抛出可公开的结构化异常。"""
        request_id = str(uuid.uuid4())
        context = ProviderFailureContext(
            200, request_id, (self.api_key, text, output_file),
        )
        try:
            if MOCK_MODE:
                if not self._create_mock_audio_file(output_file, text,
                                                    request_id):
                    raise make_tts_error('TTS_LOCAL_IO_ERROR', attempts=0)
                return True
            payload = {
                'user': {'uid': f'user_{uuid.uuid4().hex[:8]}'},
                'req_params': {
                    'text': text, 'speaker': voice_type,
                    'audio_params': {
                        'format': 'mp3', 'sample_rate': 24000,
                        'speech_rate': max(-50, min(
                            100, round((speed_ratio - 1.0) * 100))),
                    },
                },
            }
            logger.info('开始语音合成', {
                'text_length': len(text), 'request_id': request_id,
            })
            response = requests.post(
                self.base_url, data=json.dumps(payload), timeout=30,
                headers={'X-Api-Key': self.api_key,
                         'X-Api-Resource-Id': self.resource_id,
                         'X-Api-Connect-Id': request_id,
                         'Content-Type': 'application/json'},
            )
            response_id = self._response_request_id(response, request_id)
            context = ProviderFailureContext(
                response.status_code, response_id, context.sensitive_values,
            )
            audio = self._parse_response(response, context)
            self._write_audio(output_file, audio)
            return True
        except TTSServiceError:
            raise
        except requests.exceptions.Timeout:
            raise make_tts_error('TTS_TIMEOUT', 'provider', 1) from None
        except requests.exceptions.RequestException:
            raise make_tts_error('TTS_NETWORK_ERROR', 'provider', 1) from None
        except OSError:
            raise make_tts_error('TTS_LOCAL_IO_ERROR', attempts=1) from None
        except Exception:
            raise make_tts_error('TTS_UNKNOWN_ERROR', 'local', 1) from None

    @staticmethod
    def _response_request_id(response: requests.Response,
                             fallback: str) -> str:
        for header in ('X-Tt-Logid', 'X-Request-Id', 'X-Api-Connect-Id'):
            value = response.headers.get(header)
            if isinstance(value, str) and value:
                return value
        return fallback

    def _parse_response(self, response: requests.Response,
                        context: ProviderFailureContext) -> bytes:
        if response.status_code != 200:
            try:
                payload = response.json()
            except ValueError:
                payload = None
            raise provider_failure(payload, context)
        chunks = []
        try:
            for line in response.text.splitlines():
                if not line.strip():
                    continue
                frame = json.loads(line)
                code = self._validate_frame(frame)
                if code not in {0, 20000000}:
                    raise provider_failure(frame, context)
                data = frame.get('data')
                if data:
                    chunks.append(base64.b64decode(data, validate=True))
        except (ValueError, TypeError):
            raise make_tts_error(
                'TTS_INVALID_RESPONSE', 'provider', 1,
            ) from None
        audio = b''.join(chunks)
        if not audio:
            raise make_tts_error('TTS_INVALID_RESPONSE', 'provider', 1)
        return audio

    @staticmethod
    def _validate_frame(frame: object) -> int:
        if not isinstance(frame, dict):
            raise ValueError('无效语音帧')
        code = frame.get('code')
        if isinstance(code, str) and re.fullmatch(r'-?[0-9]+', code):
            code = int(code)
        if isinstance(code, bool) or not isinstance(code, int):
            raise ValueError('无效业务码')
        if 'message' in frame and not isinstance(frame['message'], str):
            raise ValueError('无效语音消息')
        data = frame.get('data')
        if data is not None and not isinstance(data, str):
            raise ValueError('无效语音载荷')
        return code

    @staticmethod
    def _write_audio(output_file: str, audio: bytes) -> None:
        # 排他创建避免覆盖旧素材；仅清理本次成功创建的失败文件。
        created = False
        try:
            Path(output_file).parent.mkdir(parents=True, exist_ok=True)
            with open(output_file, 'xb') as output:
                created = True
                output.write(audio)
                output.flush()
                os.fsync(output.fileno())
            if os.path.getsize(output_file) != len(audio):
                raise OSError('文件大小不一致')
            with open(output_file, 'rb') as output:
                if not output.read(1):
                    raise OSError('文件为空')
        except OSError:
            if created:
                cleanup_failed_audio(output_file)
            raise make_tts_error('TTS_LOCAL_IO_ERROR', attempts=1) from None

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
            
            self._write_audio(output_file, mock_mp3_data)
            
            logger.info(f"模拟语音合成成功", {
                "request_id": req_id,
                "file_size": len(mock_mp3_data),
                "text_length": len(text),
                "mock_mode": True
            })
            
            return True
            
        except Exception as e:
            logger.error(f"模拟语音文件创建失败", {
                "request_id": req_id,
                "error_code": "TTS_LOCAL_IO_ERROR"
            })
            return False


class TTSService:
    """Text-to-Speech service."""
    
    def __init__(self):
        # V3 凭据（X-Api-Key + X-Api-Resource-Id）。legacy appid/access_token
        # 保留只为旧的 ASR / 声音克隆调用链兜底，本服务不再使用。
        self.api_key = ***REMOVED***
        self.resource_id = settings.volcano_tts_resource_id
        # Generated audio lives under the persistent, writable STORAGE_ROOT so it
        # survives packaged-desktop installs (the service install dir is volatile/
        # read-only). Bug B / B1 — see local_media_resolver.audio_generated_dir.
        self.audio_dir = str(audio_generated_dir())

        logger.info('TTSService 初始化', {
            'configured': bool(self.api_key),
        })

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
    
    def _get_audio_duration_with_ffmpeg(
        self, audio_file_path: str,
    ) -> Optional[float]:
        """探测失败沿用估算时长；日志不包含文件路径及进程原文。"""
        if not self._get_ffmpeg_path():
            return None
        try:
            result = subprocess.run(
                ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
                 '-of', 'csv=p=0', audio_file_path],
                capture_output=True, text=True, check=True,
            )
            output = result.stdout.strip()
            return float(output) if output else None
        except (subprocess.SubprocessError, OSError, ValueError, TypeError):
            logger.warning('音频时长探测失败，使用估算时长')
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
        if not self.api_key or not self.api_key.strip():
            raise make_tts_error('TTS_CONFIG_MISSING', attempts=0)

    def convert_text_to_speech(
        self, text: str,
        voice_type: str = "zh_male_shaonianzixin_uranus_bigtts",
        speed_ratio: float = 1.0, segment_id: Optional[str] = None,
        task_id: Optional[str] = None, *,
        storage_loop: Optional[asyncio.AbstractEventLoop] = None,
    ) -> Dict[str, Any]:
        # 保留既有位置参数；可选持久循环只供工作线程内的存储桥接。
        options = dict(voice_type=voice_type, speed_ratio=speed_ratio,
                       segment_id=segment_id, task_id=task_id)
        result = self._convert_audio(text, options, retries=3)
        return self._store_audio_result(result, storage_loop)

    def convert_text_to_speech_local(
        self, text: str,
        voice_type: str = "zh_male_shaonianzixin_uranus_bigtts",
        speed_ratio: float = 1.0, output_path: str = None,
        segment_id: Optional[str] = None, task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        # 句子服务负责外层调度与重试，保持兼容签名且此处仅合成一次。
        options = dict(voice_type=voice_type, speed_ratio=speed_ratio,
                       segment_id=segment_id, task_id=task_id,
                       output_path=output_path)
        result = self._convert_audio(text, options, retries=1)
        result.pop('_attempts', None)
        result['local_only'] = True
        return result

    def _convert_audio(self, text: str, options: dict,
                       retries: int) -> Dict[str, Any]:
        self.validate_config()
        if not text or not text.strip():
            raise HTTPException(status_code=400, detail='文本内容不能为空')
        text = text.strip()
        if len(text) > 5000:
            raise make_tts_error('TTS_INVALID_REQUEST', attempts=0)
        output_path = options.get('output_path')
        if output_path is None:
            identifier = safe_identifier(options.get('segment_id'),
                                         (self.api_key, text), True)
            prefix = f'tts_{identifier}_' if identifier else 'tts_'
            filename = prefix + uuid.uuid4().hex + '.mp3'
            output_path = os.path.join(self.audio_dir, filename)
        if os.path.lexists(output_path):
            raise make_tts_error('TTS_LOCAL_IO_ERROR', attempts=0)
        attempts = self._synthesize_with_retries(text, output_path,
                                                options, retries)
        try:
            file_size = os.path.getsize(output_path)
            with open(output_path, 'rb') as audio:
                if file_size == 0 or not audio.read(1):
                    raise OSError('文件为空')
            result = self._audio_result(text, output_path, options, file_size)
            result['_attempts'] = attempts
            return result
        except Exception:
            cleanup_failed_audio(output_path)
            raise make_tts_error('TTS_LOCAL_IO_ERROR',
                                 attempts=attempts) from None

    def _synthesize_with_retries(self, text: str, output_path: str,
                                options: dict, retries: int) -> int:
        client = TTSClient(self.api_key, self.resource_id)
        for attempt in range(1, retries + 1):
            try:
                if not client.synthesize_speech(
                    text, output_path, options['voice_type'],
                    options['speed_ratio'],
                ):
                    raise make_tts_error('TTS_LOCAL_IO_ERROR')
                return 0 if MOCK_MODE else attempt
            except TTSServiceError as error:
                failure = error.with_attempts(0 if MOCK_MODE else attempt)
            except OSError:
                failure = make_tts_error('TTS_LOCAL_IO_ERROR',
                                         attempts=attempt)
            except Exception:
                failure = make_tts_error('TTS_UNKNOWN_ERROR',
                                         attempts=attempt)
            logger.warning(
                '语音合成失败 error_code=%s retryable=%s '
                'attempts=%s request_id=%s',
                failure.error_code, failure.error_details.retryable,
                failure.error_details.attempts,
                failure.error_details.request_id,
            )
            if not failure.error_details.retryable or attempt == retries:
                raise failure from None
            time.sleep(2 * attempt)
        raise make_tts_error('TTS_UNKNOWN_ERROR')

    def _audio_result(self, text: str, output_path: str,
                      options: dict, file_size: int) -> Dict[str, Any]:
        duration = self._get_audio_duration_with_ffmpeg(output_path)
        duration_method = 'ffmpeg' if duration is not None else 'estimated'
        if duration is None:
            duration = self._estimate_audio_duration(len(text),
                                                     options['speed_ratio'])
        filename = os.path.basename(output_path)
        return {
            'audio_url': f'/api/audio/generated/{filename}',
            'file_path': output_path, 'file_name': filename,
            'file_size': file_size, 'duration': duration,
            'voice_type': options['voice_type'], 'text_length': len(text),
            'speed_ratio': options['speed_ratio'],
            'request_id': str(uuid.uuid4()),
            'created_at': datetime.now().isoformat(),
            'segment_id': options.get('segment_id'),
            'task_id': options.get('task_id'), 'mock_mode': MOCK_MODE,
            'duration_method': duration_method, 'storage_upload': False,
        }

    def _store_audio_result(
        self, result: dict,
        storage_loop: Optional[asyncio.AbstractEventLoop] = None,
    ) -> Dict[str, Any]:
        attempts = result.pop('_attempts', None)
        try:
            with open(result['file_path'], 'rb') as audio:
                file_data = audio.read()
            if not file_data:
                raise OSError('文件为空')
        except OSError:
            cleanup_failed_audio(result['file_path'])
            raise make_tts_error('TTS_LOCAL_IO_ERROR',
                                 attempts=attempts) from None
        try:
            upload = self._upload_audio_result(result, file_data, storage_loop)
            if upload.get('success'):
                result['audio_url'] = upload['file_url']
                result['storage_upload'] = True
            else:
                logger.warning('语音存储登记失败，保留已验证的本地素材')
        except Exception:
            logger.warning('语音存储登记异常，保留已验证的本地素材')
        return result

    @staticmethod
    def _upload_audio_result(
        result: dict, file_data: bytes,
        storage_loop: Optional[asyncio.AbstractEventLoop],
    ) -> Dict[str, Any]:
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None
        if running_loop is not None and (
            storage_loop is None or storage_loop is running_loop
        ):
            # 兼容误在事件循环内直接调用的同步入口，保留本地音频避免自等。
            raise RuntimeError('同步存储必须在工作线程中执行')
        if storage_loop is not None and not storage_loop.is_running():
            raise RuntimeError('语音存储事件循环已停止')
        arguments = dict(
            file_data=file_data, filename=result['file_name'],
            content_type='audio/mpeg', user_id='anonymous',
            task_id=result['task_id'],
        )
        if storage_loop is None:
            # 兼容独立同步调用；临时循环只保存文件，不占用共享波形队列。
            return asyncio.run(storage_service.upload_file(
                folder='audio', **arguments,
            ))
        # 后台波形任务必须归属路由的持久循环，不能随工作线程循环退出。
        upload = storage_service.upload_audio_file(**arguments)
        try:
            future = asyncio.run_coroutine_threadsafe(upload, storage_loop)
        except Exception:
            upload.close()
            raise
        return future.result()

    def get_available_voice_types(self, locale: str = "zh-CN") -> Dict[str, VoiceTypeInfo]:
        """获取可用的音色类型列表，从配置文件读取"""
        # 既有静态音色翻译表使函数超长；本次仅修改失败链路，保留映射。
        
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
        # 既有备用音色表超出函数行数限制，保持音色兼容性不在此轮拆分。
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
        
        # Curated fallback — the authoritative voice catalog lives in DB
        # (system_settings.tts.voices) and in scripts/migrate_voices_to_2_0.py.
        # This fallback only fires when YAML is missing AND DB read failed;
        # six well-distributed 2.0 voices keep the UI usable in that case.
        # Uses literal value strings to avoid coupling to the VoiceType enum,
        # which still carries legacy 1.0 (`*_moon_bigtts`) entries.
        general = translations.get("通用场景", "通用场景")
        roleplay = translations.get("角色扮演", "角色扮演")
        voice_types = {
            "zh_female_qingxinnvsheng_uranus_bigtts": VoiceTypeInfo(
                id="zh_female_qingxinnvsheng_uranus_bigtts",
                name="清新女声 2.0",
                language="zh-CN",
                gender="female",
                description="清新自然的女性声音，适合讲解和叙述",
                category=general,
            ),
            "zh_female_linjianvhai_uranus_bigtts": VoiceTypeInfo(
                id="zh_female_linjianvhai_uranus_bigtts",
                name="邻家女孩 2.0",
                language="zh-CN",
                gender="female",
                description="亲切自然的女性声音",
                category=general,
            ),
            "zh_female_wenroushunv_uranus_bigtts": VoiceTypeInfo(
                id="zh_female_wenroushunv_uranus_bigtts",
                name="温柔淑女 2.0",
                language="zh-CN",
                gender="female",
                description="温柔知性的女性声音",
                category=general,
            ),
            "zh_male_shaonianzixin_uranus_bigtts": VoiceTypeInfo(
                id="zh_male_shaonianzixin_uranus_bigtts",
                name="少年梓辛 2.0",
                language="zh-CN",
                gender="male",
                description="清澈的男性声音，适合年轻化内容",
                category=general,
            ),
            "zh_male_yangguangqingnian_uranus_bigtts": VoiceTypeInfo(
                id="zh_male_yangguangqingnian_uranus_bigtts",
                name="阳光青年 2.0",
                language="zh-CN",
                gender="male",
                description="积极向上的男性声音",
                category=general,
            ),
            "zh_male_aojiaobazong_uranus_bigtts": VoiceTypeInfo(
                id="zh_male_aojiaobazong_uranus_bigtts",
                name="傲娇霸总 2.0",
                language="zh-CN",
                gender="male",
                description="霸道总裁的男性声音",
                category=roleplay,
            ),
        }

        return voice_types


# 全局TTS服务实例
tts_service = TTSService()
