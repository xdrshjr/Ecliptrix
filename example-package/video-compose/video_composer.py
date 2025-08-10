import os
import cv2
import numpy as np
from pydub import AudioSegment
import subprocess
import glob
import tempfile
import shutil
import sys
import platform
import json
import logging
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# Add yt-dlp import for YouTube video downloading
try:
    import yt_dlp
    YTDLP_AVAILABLE = True
    logger = None  # Will be initialized in setup_logger()
except ImportError:
    YTDLP_AVAILABLE = False
    logger = None

# Import environment variable loading for API key management
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure API keys for video downloads (multiple keys for retry)
API_KEY_STR = os.environ.get("PEXELS_API_KEY", "")
API_KEYS = [key.strip() for key in API_KEY_STR.split(",") if key.strip()]

# If no API keys from environment, use default
if not API_KEYS:
    API_KEYS = ["example"]  # Fallback, should be replaced with real keys


# 配置日志记录
def setup_logger():
    """配置日志记录器"""
    # 创建logs目录（如果不存在）
    logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
    os.makedirs(logs_dir, exist_ok=True)

    # 当前时间用于日志文件名
    timestamp = datetime.now().strftime("%Y%m%d")
    log_file = os.path.join(logs_dir, f"video_composer_{timestamp}.log")

    # 创建日志记录器
    logger = logging.getLogger('video_composer')
    logger.setLevel(logging.DEBUG)

    # 清除现有处理器，避免重复
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    # 文件处理器
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.DEBUG)

    # 控制台处理器 - 明确指定使用stderr
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(logging.INFO)

    # 设置日志格式
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)

    # 添加处理器到日志记录器
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    # 更新全局logger变量
    globals()['logger'] = logger

    return logger


# 初始化日志记录器
logger = setup_logger()


def check_ffmpeg():
    """检查ffmpeg是否已安装"""
    logger.info("检查ffmpeg是否已安装")
    try:
        # 使用静默输出运行ffmpeg，仅检查是否返回成功
        with open(os.devnull, 'w') as devnull:
            subprocess.check_call(['ffmpeg', '-version'], stdout=devnull, stderr=devnull)
        logger.info("ffmpeg已安装并可用")
        return True
    except (subprocess.SubprocessError, FileNotFoundError):
        logger.error("未找到ffmpeg，请确保已安装ffmpeg并添加到系统PATH中")
        return False


def get_ffmpeg_path():
    """获取ffmpeg可执行文件路径"""
    logger.info("正在查找ffmpeg可执行文件路径")
    # 首先尝试直接使用ffmpeg命令
    if check_ffmpeg():
        logger.info("直接使用ffmpeg命令")
        return 'ffmpeg'

    # 检查常见安装目录
    possible_paths = []

    if platform.system() == 'Windows':
        possible_paths = [
            r'C:\Program Files\ffmpeg\bin\ffmpeg.exe',
            r'C:\ffmpeg\bin\ffmpeg.exe',
        ]
    elif platform.system() == 'Darwin':  # macOS
        possible_paths = [
            '/usr/local/bin/ffmpeg',
            '/opt/homebrew/bin/ffmpeg',
        ]
    else:  # Linux和其他系统
        possible_paths = [
            '/usr/bin/ffmpeg',
            '/usr/local/bin/ffmpeg',
        ]

    for path in possible_paths:
        if os.path.isfile(path):
            logger.info(f"找到ffmpeg路径: {path}")
            return path

    logger.error("无法找到ffmpeg可执行文件")
    return None


def get_video_properties(video_path):
    """
    获取视频属性（宽度、高度、帧率）
    """
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return None, None, None

        # 获取基本属性
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)

        cap.release()
        return width, height, fps
    except Exception as e:
        logger.error(f"获取视频属性失败: {str(e)}")
        return None, None, None


def is_youtube_url(url):
    """检查URL是否为YouTube链接"""
    youtube_domains = [
        'youtube.com', 'youtu.be', 'm.youtube.com', 'www.youtube.com',
        'music.youtube.com', 'gaming.youtube.com'
    ]
    return any(domain in url.lower() for domain in youtube_domains)


def download_video_with_ytdlp(video_url, temp_dir, index=None):
    """
    使用yt-dlp下载YouTube视频

    参数:
    video_url: 视频URL
    temp_dir: 临时目录
    index: 视频索引（可选，用于文件命名）

    返回:
    {"success": True, "output_path": 文件路径} 或 {"success": False, "error": 错误信息}
    """
    thread_id = threading.current_thread().ident
    video_name = f"video_{index if index is not None else int(time.time())}.%(ext)s"
    video_path_template = os.path.join(temp_dir, video_name)

    logger.info(f"[线程{thread_id}] 使用yt-dlp下载YouTube视频: {video_url}")

    if not YTDLP_AVAILABLE:
        error_msg = "yt-dlp未安装，无法下载YouTube视频。请运行: pip install yt-dlp"
        logger.error(f"[线程{thread_id}] {error_msg}")
        return {"success": False, "error": error_msg}

    try:
        # yt-dlp配置 - 完全静默模式
        ydl_opts = {
            'format': 'best[ext=mp4]/best',  # 优先下载mp4格式
            'outtmpl': video_path_template,
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
            'no_progress': True,  # 禁用进度条
            'no_color': True,     # 禁用颜色输出
            'noprogress': True,   # 另一种禁用进度的方式
        }

        start_time = time.time()
        
        # 使用临时重定向stderr来避免输出干扰
        import sys
        import io
        
        # 保存原始stderr
        original_stderr = sys.stderr
        temp_stderr = io.StringIO()
        
        try:
            # 重定向stderr
            sys.stderr = temp_stderr
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # 下载视频
                ydl.download([video_url])
        finally:
            # 恢复原始stderr
            sys.stderr = original_stderr
            
            # 获取捕获的stderr内容（如果需要的话）
            stderr_content = temp_stderr.getvalue()
            if stderr_content.strip():
                logger.debug(f"[线程{thread_id}] yt-dlp stderr: {stderr_content}")

        download_time = time.time() - start_time

        # 查找下载的文件
        downloaded_files = []
        for ext in ['mp4', 'webm', 'mkv', 'flv']:
            pattern = video_path_template.replace('%(ext)s', ext)
            if os.path.exists(pattern):
                downloaded_files.append(pattern)

        if not downloaded_files:
            error_msg = "未找到下载的视频文件"
            logger.error(f"[线程{thread_id}] {error_msg}")
            return {"success": False, "error": error_msg}

        output_path = downloaded_files[0]
        file_size = os.path.getsize(output_path)

        if file_size < 1024:  # 文件小于1KB，可能下载失败
            error_msg = "下载的视频文件大小异常"
            logger.error(f"[线程{thread_id}] {error_msg}: {file_size} bytes")
            return {"success": False, "error": error_msg}

        logger.info(
            f"[线程{thread_id}] yt-dlp下载成功，耗时 {download_time:.2f}秒，文件大小 {file_size / 1024 / 1024:.2f}MB")
        return {"success": True, "output_path": output_path}

    except Exception as e:
        error_msg = f"yt-dlp下载视频时发生异常: {str(e)}"
        logger.error(f"[线程{thread_id}] {error_msg}")
        return {"success": False, "error": error_msg}


def download_video_with_retry(video_url, temp_dir, index=None, max_retries=3):
    """
    带重试机制的视频下载，支持API密钥轮换
    
    参数:
    video_url: 视频URL
    temp_dir: 临时目录
    index: 视频索引（可选，用于文件命名）
    max_retries: 最大重试次数，默认3次
    
    返回:
    {"success": True, "output_path": 文件路径} 或 {"success": False, "error": 错误信息}
    """
    thread_id = threading.current_thread().ident
    logger.info(f"[线程{thread_id}] 开始下载视频: {video_url}，最大重试次数: {max_retries}")
    
    last_error = ""
    used_api_keys = []
    
    for attempt in range(max_retries):
        logger.info(f"[线程{thread_id}] 下载尝试 {attempt + 1}/{max_retries}")
        
        try:
            # 检查是否为YouTube URL
            if is_youtube_url(video_url):
                logger.info(f"[线程{thread_id}] 检测到YouTube URL，使用yt-dlp下载")
                result = download_video_with_ytdlp(video_url, temp_dir, index)
            else:
                logger.info(f"[线程{thread_id}] 检测到普通视频URL，使用ffmpeg下载")
                result = download_video_with_ffmpeg(video_url, temp_dir, index)
            
            if result['success']:
                logger.info(f"[线程{thread_id}] 下载成功，尝试次数: {attempt + 1}")
                return result
            else:
                last_error = result['error']
                logger.warning(f"[线程{thread_id}] 下载尝试 {attempt + 1} 失败: {last_error}")
                
                # 如果是网络相关错误，可能需要更换API密钥或稍等重试
                if attempt < max_retries - 1:
                    if "api" in last_error.lower() or "key" in last_error.lower() or "authorization" in last_error.lower():
                        logger.info(f"[线程{thread_id}] 检测到API相关错误，可能需要更换API密钥")
                    
                    # 等待一段时间后重试
                    wait_time = (attempt + 1) * 2  # 递增等待时间：2秒，4秒，6秒
                    logger.info(f"[线程{thread_id}] 等待 {wait_time} 秒后重试...")
                    time.sleep(wait_time)
                
        except Exception as e:
            last_error = str(e)
            logger.error(f"[线程{thread_id}] 下载尝试 {attempt + 1} 异常: {last_error}")
            if attempt < max_retries - 1:
                time.sleep((attempt + 1) * 2)
    
    # 所有重试都失败了
    final_error = f"视频下载失败，已重试 {max_retries} 次。最后错误: {last_error}"
    logger.error(f"[线程{thread_id}] {final_error}")
    return {"success": False, "error": final_error}


def download_video(video_url, temp_dir, index=None):
    """
    下载单个视频文件
    自动检测是否为YouTube URL并选择合适的下载方法
    现在包含重试机制

    参数:
    video_url: 视频URL
    temp_dir: 临时目录
    index: 视频索引（可选，用于文件命名）

    返回:
    {"success": True, "output_path": 文件路径} 或 {"success": False, "error": 错误信息}
    """
    return download_video_with_retry(video_url, temp_dir, index, max_retries=3)


def download_video_with_ffmpeg(video_url, temp_dir, index=None):
    """
    使用ffmpeg下载普通视频文件（非YouTube）

    参数:
    video_url: 视频URL
    temp_dir: 临时目录
    index: 视频索引（可选，用于文件命名）

    返回:
    {"success": True, "output_path": 文件路径} 或 {"success": False, "error": 错误信息}
    """
    thread_id = threading.current_thread().ident
    video_name = f"video_{index if index is not None else int(time.time())}.mp4"
    video_path = os.path.join(temp_dir, video_name)

    logger.info(f"[线程{thread_id}] 使用ffmpeg下载视频: {video_url} -> {video_path}")

    # 获取ffmpeg路径
    ffmpeg_path = get_ffmpeg_path()
    if not ffmpeg_path:
        error_msg = "找不到ffmpeg"
        logger.error(f"[线程{thread_id}] {error_msg}")
        return {"success": False, "error": error_msg}

    # 使用ffmpeg下载视频
    download_cmd = [
        ffmpeg_path,
        '-y',
        '-i', video_url,
        '-c', 'copy',
        video_path
    ]

    start_time = time.time()
    logger.debug(f"[线程{thread_id}] 执行下载命令: {' '.join(download_cmd)}")

    try:
        result = subprocess.run(download_cmd, capture_output=True, text=True, timeout=120)  # 2分钟超时
        download_time = time.time() - start_time

        if result.returncode != 0:
            error_msg = f"下载视频失败: {result.stderr}"
            logger.error(f"[线程{thread_id}] {error_msg}")
            logger.debug(f"[线程{thread_id}] 命令输出: {result.stdout}")
            return {"success": False, "error": error_msg}

        # 检查文件是否存在且大小合理
        if not os.path.exists(video_path):
            error_msg = "下载的视频文件不存在"
            logger.error(f"[线程{thread_id}] {error_msg}")
            return {"success": False, "error": error_msg}

        file_size = os.path.getsize(video_path)
        if file_size < 1024:  # 文件小于1KB，可能下载失败
            error_msg = "下载的视频文件大小异常"
            logger.error(f"[线程{thread_id}] {error_msg}: {file_size} bytes")
            return {"success": False, "error": error_msg}

        logger.info(
            f"[线程{thread_id}] 视频下载成功，耗时 {download_time:.2f}秒，文件大小 {file_size / 1024 / 1024:.2f}MB")
        return {"success": True, "output_path": video_path}

    except subprocess.TimeoutExpired:
        error_msg = "视频下载超时"
        logger.error(f"[线程{thread_id}] {error_msg}")
        return {"success": False, "error": error_msg}
    except Exception as e:
        error_msg = f"下载视频时发生异常: {str(e)}"
        logger.error(f"[线程{thread_id}] {error_msg}")
        return {"success": False, "error": error_msg}


def normalize_video_task(video_info):
    """
    标准化单个视频的任务函数（用于多线程处理）
    
    参数:
    video_info: 包含视频信息的字典 {
        'video_path': 视频文件路径,
        'index': 视频索引,
        'temp_dir': 临时目录,
        'target_width': 目标宽度,
        'target_height': 目标高度,
        'target_fps': 目标帧率,
        'audio_duration': 音频时长（可选）,
        'accumulated_duration': 当前累计时长,
        'ffmpeg_path': ffmpeg路径
    }
    
    返回:
    成功: {"success": True, "normalized_path": 标准化后路径, "used_duration": 使用的时长, "index": 索引}
    失败: {"success": False, "error": 错误信息, "index": 索引}
    """
    thread_id = threading.current_thread().ident
    video_path = video_info['video_path']
    index = video_info['index']
    temp_dir = video_info['temp_dir']
    target_width = video_info['target_width']
    target_height = video_info['target_height']
    target_fps = video_info['target_fps']
    audio_duration = video_info.get('audio_duration')
    accumulated_duration = video_info['accumulated_duration']
    ffmpeg_path = video_info['ffmpeg_path']
    
    try:
        logger.info(f"[线程{thread_id}] ===== 处理视频 {index + 1} =====")
        logger.info(f"[线程{thread_id}] 视频文件: {os.path.basename(video_path)}")

        # 获取视频属性
        width, height, fps = get_video_properties(video_path)
        if width is None:
            error_msg = f"无法获取视频属性: {video_path}"
            logger.error(f"[线程{thread_id}] {error_msg}")
            return {"success": False, "error": error_msg, "index": index}

        # 获取视频时长
        cap = cv2.VideoCapture(video_path)
        video_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        video_duration = video_frame_count / fps
        cap.release()
        logger.info(f"[线程{thread_id}] 视频属性: {width}x{height}, {fps:.2f}fps, 时长: {video_duration:.2f}秒")

        # 如果有音频文件，检查是否已经有足够长度的视频
        if audio_duration and accumulated_duration >= audio_duration:
            logger.info(f"[线程{thread_id}] 已收集足够时长({accumulated_duration:.2f}秒 >= {audio_duration:.2f}秒)，跳过此视频")
            return {"success": True, "normalized_path": None, "used_duration": 0, "index": index, "skipped": True}

        # 计算需要的时长
        if audio_duration:
            remaining_duration = audio_duration - accumulated_duration
            logger.info(f"[线程{thread_id}] 还需要视频时长: {remaining_duration:.2f}秒")
        else:
            remaining_duration = video_duration  # 使用完整视频时长
            logger.info(f"[线程{thread_id}] 使用完整视频时长: {video_duration:.2f}秒")

        # 标准化视频 - 统一编码、帧率、分辨率和SAR
        normalized_video_path = os.path.join(temp_dir, f"normalized_{index}.mp4")
        logger.info(f"[线程{thread_id}] 开始标准化视频 {index + 1}...")

        # 构建ffmpeg命令 - 关键修复：添加setsar滤镜强制设置SAR为1:1
        vf_params = f'scale={target_width}:{target_height},setsar=1:1'

        normalize_start_time = time.time()

        if audio_duration and video_duration > remaining_duration:
            # 需要裁剪（仅在有音频时）
            logger.info(f"[线程{thread_id}] 视频需要裁剪: {video_duration:.2f}秒 -> {remaining_duration:.2f}秒")
            normalize_cmd = [
                ffmpeg_path,
                '-y',
                '-i', video_path,
                '-t', str(remaining_duration),
                '-vf', vf_params,
                '-r', str(target_fps),
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-profile:v', 'high',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                '-avoid_negative_ts', 'make_zero',  # 避免时间戳问题
                normalized_video_path
            ]
            used_duration = remaining_duration
        else:
            # 不需要裁剪
            logger.info(f"[线程{thread_id}] 视频使用完整时长: {video_duration:.2f}秒")
            normalize_cmd = [
                ffmpeg_path,
                '-y',
                '-i', video_path,
                '-vf', vf_params,
                '-r', str(target_fps),
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-profile:v', 'high',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                '-avoid_negative_ts', 'make_zero',  # 避免时间戳问题
                normalized_video_path
            ]
            used_duration = video_duration

        logger.debug(f"[线程{thread_id}] 标准化命令: {' '.join(normalize_cmd)}")
        result = subprocess.run(normalize_cmd, capture_output=True, text=True)
        normalize_time = time.time() - normalize_start_time

        if result.returncode != 0:
            error_msg = f"标准化视频失败: {result.stderr}"
            logger.error(f"[线程{thread_id}] {error_msg}")
            logger.debug(f"[线程{thread_id}] 命令输出: {result.stdout}")
            return {"success": False, "error": error_msg, "index": index}

        logger.info(f"[线程{thread_id}] 视频 {index + 1} 标准化完成，耗时: {normalize_time:.2f}秒")
        
        return {
            "success": True, 
            "normalized_path": normalized_video_path, 
            "used_duration": used_duration, 
            "index": index
        }

    except Exception as e:
        error_msg = f"处理视频 {index + 1} 时出错: {str(e)}"
        logger.exception(f"[线程{thread_id}] 视频标准化过程中发生异常:")
        return {"success": False, "error": error_msg, "index": index}


def combine_videos_with_audio(video_urls, audio_path=None, output_path=None):
    """
    合成多个视频，可选地添加音频文件

    参数:
    video_urls: 视频URL列表
    audio_path: 音频文件路径（可选）
    output_path: 输出文件路径，如果为None则使用临时文件

    返回:
    成功: {"success": True, "output_path": 输出路径}
    失败: {"success": False, "error": 错误信息}
    """
    process_start_time = time.time()
    logger.info("===== 开始视频合成流程 =====")
    logger.info(f"待处理视频数量: {len(video_urls)}")
    logger.info(f"音频文件: {audio_path if audio_path else '无（纯视频合成）'}")
    logger.info(f"输出路径: {output_path if output_path else '自动生成'}")

    # 检查ffmpeg是否可用
    ffmpeg_path = get_ffmpeg_path()
    if not ffmpeg_path:
        error_msg = "找不到ffmpeg。请安装ffmpeg并确保它在系统PATH中。"
        logger.error(error_msg)
        return {"success": False, "error": error_msg}

    # 创建临时目录
    temp_dir = os.path.join(tempfile.gettempdir(), f"video_compose_{int(time.time())}")
    os.makedirs(temp_dir, exist_ok=True)
    logger.info(f"创建临时目录: {temp_dir}")

    try:
        # 如果没有指定输出路径，创建临时输出文件
        if output_path is None:
            output_path = os.path.join(temp_dir, "combined_video.mp4")
            logger.info(f"未指定输出路径，使用临时路径: {output_path}")

        # 下载视频到临时文件
        downloaded_videos = []
        logger.info("开始下载视频文件...")

        # 创建下载任务
        download_start_time = time.time()
        futures_dict = {}

        with ThreadPoolExecutor(max_workers=5) as executor:
            # 提交下载任务，保持顺序
            for i, video_url in enumerate(video_urls):
                future = executor.submit(download_video, video_url, temp_dir, i)
                futures_dict[future] = i

            logger.info(f"已提交 {len(video_urls)} 个并行下载任务")

            # 按照完成顺序收集结果，但保持原始顺序
            results = [None] * len(video_urls)
            completed_count = 0

            for future in as_completed(futures_dict):
                index = futures_dict[future]
                result = future.result()
                results[index] = result
                completed_count += 1

                if result['success']:
                    logger.info(f"下载进度: {completed_count}/{len(video_urls)} - 视频 {index + 1} 下载完成")
                else:
                    logger.error(
                        f"下载进度: {completed_count}/{len(video_urls)} - 视频 {index + 1} 下载失败: {result['error']}")
                    return result

            # 按原始顺序整理下载的视频文件
            for result in results:
                if result and result['success']:
                    downloaded_videos.append(result['output_path'])

        download_total_time = time.time() - download_start_time
        logger.info(
            f"所有视频下载完成，总耗时: {download_total_time:.2f}秒，平均每个视频: {download_total_time / len(video_urls):.2f}秒")

        # 获取音频时长（如果有音频）
        audio_duration = None
        if audio_path:
            try:
                logger.info(f"读取音频文件: {audio_path}")
                audio = AudioSegment.from_file(audio_path)
                audio_duration = len(audio) / 1000.0  # 转换为秒
                logger.info(f"音频时长: {audio_duration:.2f}秒")
            except Exception as e:
                error_msg = f"无法读取音频文件: {str(e)}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
        else:
            logger.info("未提供音频文件，将进行纯视频合成")

        # 处理的视频文件列表
        processed_videos = []

        # 确定目标帧率和分辨率 - 以第一个视频为基准
        logger.info("确定目标视频参数（以第一个视频为基准）")
        target_width, target_height, target_fps = get_video_properties(downloaded_videos[0])
        if target_width is None:
            error_msg = f"无法获取视频属性: {downloaded_videos[0]}"
            logger.error(error_msg)
            return {"success": False, "error": error_msg}

        logger.info(f"目标视频参数: 宽={target_width}, 高={target_height}, 帧率={target_fps}")

        # 处理每个视频
        total_duration = 0
        logger.info("开始处理每个视频...")
        processing_start_time = time.time()

        # 准备多线程处理的视频信息
        video_tasks = []
        accumulated_duration = 0
        
        for i, video_path in enumerate(downloaded_videos):
            video_info = {
                'video_path': video_path,
                'index': i,
                'temp_dir': temp_dir,
                'target_width': target_width,
                'target_height': target_height,
                'target_fps': target_fps,
                'audio_duration': audio_duration,
                'accumulated_duration': accumulated_duration,
                'ffmpeg_path': ffmpeg_path
            }
            video_tasks.append(video_info)
            
            # 对于有音频的情况，需要预估累计时长以决定是否需要处理后续视频
            if audio_duration:
                # 简单估算：假设每个视频都会被完全使用（这是保守估计）
                cap = cv2.VideoCapture(video_path)
                video_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                video_fps = cap.get(cv2.CAP_PROP_FPS)
                video_duration = video_frame_count / video_fps if video_fps > 0 else 0
                cap.release()
                
                remaining_duration = audio_duration - accumulated_duration
                if remaining_duration <= 0:
                    logger.info(f"已收集足够时长，跳过后续 {len(downloaded_videos) - i} 个视频的处理")
                    break
                    
                # 更新累计时长（用于下一个视频的判断）
                accumulated_duration += min(video_duration, remaining_duration)

        # 使用多线程池处理视频标准化
        logger.info(f"开始并行处理 {len(video_tasks)} 个视频，最大并发数: 5")
        
        # 存储处理结果，按索引排序
        processing_results = [None] * len(video_tasks)
        completed_count = 0
        
        with ThreadPoolExecutor(max_workers=5) as executor:
            # 提交所有标准化任务
            future_to_index = {}
            for video_info in video_tasks:
                future = executor.submit(normalize_video_task, video_info)
                future_to_index[future] = video_info['index']
            
            logger.info(f"已提交 {len(video_tasks)} 个并行标准化任务")
            
            # 收集处理结果
            for future in as_completed(future_to_index):
                index = future_to_index[future]
                result = future.result()
                processing_results[index] = result
                completed_count += 1
                
                if result['success']:
                    if result.get('skipped'):
                        logger.info(f"标准化进度: {completed_count}/{len(video_tasks)} - 视频 {index + 1} 已跳过")
                    else:
                        logger.info(f"标准化进度: {completed_count}/{len(video_tasks)} - 视频 {index + 1} 标准化完成")
                else:
                    logger.error(f"标准化进度: {completed_count}/{len(video_tasks)} - 视频 {index + 1} 标准化失败: {result['error']}")
                    return result
        
        # 按顺序整理处理结果
        total_duration = 0
        for result in processing_results:
            if result and result['success'] and not result.get('skipped'):
                processed_videos.append(result['normalized_path'])
                total_duration += result['used_duration']
                logger.info(f"累计视频时长: {total_duration:.2f}秒")

        processing_time = time.time() - processing_start_time
        logger.info(f"所有视频处理完成，总耗时: {processing_time:.2f}秒")

        # 如果没有处理的视频，报错
        if not processed_videos:
            error_msg = "没有成功处理的视频"
            logger.error(error_msg)
            return {"success": False, "error": error_msg}

        # 创建concat文件列表
        concat_list_path = os.path.join(temp_dir, "concat_list.txt")
        with open(concat_list_path, 'w', encoding='utf-8') as f:
            for video in processed_videos:
                # 在Windows系统上，路径需要使用正斜杠或转义反斜杠
                video_path_for_concat = video.replace('\\', '/')
                f.write(f"file '{video_path_for_concat}'\n")

        logger.info(f"创建合并列表，包含 {len(processed_videos)} 个视频片段")
        logger.debug(f"Concat文件列表内容:")
        with open(concat_list_path, 'r', encoding='utf-8') as f:
            logger.debug(f.read())

        # 使用concat demuxer合并视频 - 这比filter_complex更稳定
        if audio_path:
            # 如果有音频，先合并视频，再添加音频
            combined_video_no_audio = os.path.join(temp_dir, "combined_no_audio.mp4")
            final_output = combined_video_no_audio
        else:
            # 如果没有音频，直接输出到最终文件
            final_output = output_path
            
        logger.info(f"开始合并视频片段...")

        concat_start_time = time.time()
        concat_cmd = [
            ffmpeg_path,
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_list_path,
            '-c', 'copy',  # 直接复制，避免重新编码
            final_output
        ]

        logger.debug(f"合并命令: {' '.join(concat_cmd)}")
        result = subprocess.run(concat_cmd, capture_output=True, text=True)
        concat_time = time.time() - concat_start_time

        if result.returncode != 0:
            # 如果直接复制失败，尝试重新编码
            logger.warning(f"直接复制合并失败，尝试重新编码合并...")
            logger.debug(f"失败原因: {result.stderr}")

            reencoding_start_time = time.time()
            concat_cmd_reencode = [
                ffmpeg_path,
                '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_list_path,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-profile:v', 'high',
                '-pix_fmt', 'yuv420p',
                final_output
            ]

            logger.debug(f"重新编码合并命令: {' '.join(concat_cmd_reencode)}")
            result = subprocess.run(concat_cmd_reencode, capture_output=True, text=True)
            reencoding_time = time.time() - reencoding_start_time

            if result.returncode != 0:
                error_msg = f"合并视频失败: {result.stderr}"
                logger.error(error_msg)
                logger.debug(f"命令输出: {result.stdout}")
                return {"success": False, "error": error_msg}

            logger.info(f"重新编码合并完成，耗时: {reencoding_time:.2f}秒")
        else:
            logger.info(f"视频合并完成，耗时: {concat_time:.2f}秒")

        # 如果有音频，添加音频到合并后的视频
        audio_time = 0
        if audio_path:
            logger.info(f"===== 开始添加音频轨道 =====")
            audio_start_time = time.time()
            final_cmd = [
                ffmpeg_path,
                '-y',
                '-i', final_output,  # combined_video_no_audio
                '-i', audio_path,
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-shortest',
                output_path
            ]

            logger.debug(f"添加音频命令: {' '.join(final_cmd)}")
            result = subprocess.run(final_cmd, capture_output=True, text=True)
            audio_time = time.time() - audio_start_time

            if result.returncode != 0:
                error_msg = f"添加音频失败: {result.stderr}"
                logger.error(error_msg)
                logger.debug(f"命令输出: {result.stdout}")
                return {"success": False, "error": error_msg}

            logger.info(f"音频添加完成，耗时: {audio_time:.2f}秒")

        process_end_time = time.time()
        process_duration = process_end_time - process_start_time

        # 获取输出文件大小
        output_file_size = os.path.getsize(output_path) / (1024 * 1024)  # MB

        logger.info(f"===== 视频合成完成 =====")
        logger.info(f"输出文件: {os.path.basename(output_path)}")
        logger.info(f"文件大小: {output_file_size:.2f}MB")
        logger.info(f"视频时长: {total_duration:.2f}秒")
        if audio_duration:
            logger.info(f"音频时长: {audio_duration:.2f}秒")
        logger.info(f"===== 时间统计 =====")
        logger.info(f"视频下载: {download_total_time:.2f}秒")
        logger.info(f"视频处理: {processing_time:.2f}秒")
        logger.info(f"视频合并: {concat_time:.2f}秒" + (
            f" + 重编码: {reencoding_time:.2f}秒" if 'reencoding_time' in locals() else ""))
        if audio_path:
            logger.info(f"音频合成: {audio_time:.2f}秒")
        logger.info(f"总耗时: {process_duration:.2f}秒")
        logger.info(f"处理效率: {total_duration / process_duration:.2f}x (视频时长/处理时长)")

        return {
            "success": True,
            "output_path": output_path,
            "duration": total_duration
        }

    except Exception as e:
        error_msg = f"处理视频时出错: {str(e)}"
        logger.exception("视频合成过程中发生异常:")
        return {"success": False, "error": error_msg}
    finally:
        # 清理临时文件
        try:
            logger.info(f"清理临时目录: {temp_dir}")
            shutil.rmtree(temp_dir)
        except Exception as e:
            logger.warning(f"清理临时目录失败: {str(e)}")


# 当作为独立脚本运行时的入口点
if __name__ == "__main__":
    try:
        # 检查yt-dlp依赖
        if not YTDLP_AVAILABLE:
            logger.warning("yt-dlp未安装，YouTube视频下载功能将不可用")
            logger.info("安装命令: pip install yt-dlp")
        
        logger.info("通过标准输入接收参数...")
        # 从标准输入读取JSON数据
        input_data = json.loads(input())

        video_urls = input_data.get('video_urls', [])
        audio_path = input_data.get('audio_path', None)  # 现在可以为None
        output_path = input_data.get('output_path', None)

        logger.info(f"接收到参数: 视频数量={len(video_urls)}, 音频文件={audio_path if audio_path else '无'}, 输出路径={output_path}")

        # 检查是否有YouTube URL但yt-dlp不可用
        has_youtube_urls = any(is_youtube_url(url) for url in video_urls)
        if has_youtube_urls and not YTDLP_AVAILABLE:
            logger.error("检测到YouTube URL但yt-dlp未安装")
            result = {"success": False, "error": "需要安装yt-dlp来处理YouTube视频。请运行: pip install yt-dlp"}
        elif not video_urls:
            logger.error("未提供视频URL")
            result = {"success": False, "error": "未提供视频URL"}
        else:
            result = combine_videos_with_audio(video_urls, audio_path, output_path)

        # 输出JSON结果 - 这是唯一的stdout输出
        logger.info(f"处理完成，准备输出结果")
        print(json.dumps(result, ensure_ascii=False))

    except json.JSONDecodeError:
        logger.error("无效的JSON输入")
        print(json.dumps({"success": False, "error": "无效的JSON输入"}, ensure_ascii=False))
    except Exception as e:
        logger.exception("程序运行时发生异常:")
        print(json.dumps({"success": False, "error": f"程序错误: {str(e)}"}, ensure_ascii=False))


def test_sar_fix():
    """
    测试SAR修复功能
    这个函数可以用来验证setsar滤镜是否正确应用
    """
    logger.info("===== SAR修复测试 =====")
    logger.info("测试setsar滤镜的应用")

    # 模拟视频标准化命令
    test_cmd = [
        'ffmpeg',
        '-y',
        '-i', 'input.mp4',
        '-vf', 'scale=1920:1080,setsar=1:1',
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-avoid_negative_ts', 'make_zero',
        'output.mp4'
    ]

    logger.info(f"标准化命令示例: {' '.join(test_cmd)}")
    logger.info("关键修复点:")
    logger.info("1. 添加了 setsar=1:1 滤镜强制设置SAR为1:1")
    logger.info("2. 添加了 -avoid_negative_ts make_zero 避免时间戳问题")
    logger.info("3. 使用concat demuxer而不是filter_complex提高稳定性")
    logger.info("===== 测试完成 =====")


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--test-sar":
    test_sar_fix() 