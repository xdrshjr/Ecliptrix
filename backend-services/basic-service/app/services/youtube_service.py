#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import time
import re
import unicodedata
import hashlib
import asyncio
import random
from pathlib import Path
from typing import Optional, Dict, Any, List
import shutil
import uuid
from .youtube_runtime import youtube_runtime, cancellable_call, YoutubeOperationError
from .youtube_worker import progressive_format
from app.logger import get_logger
from app.config import get_settings
from app.models.youtube_models import (
    YoutubeSearchRequest, YoutubeSearchResponse, YoutubeVideoInfo,
    YoutubeVideoDownloadRequest, YoutubeVideoDownloadResponse,
    YoutubeVideoInfoRequest, YoutubeVideoInfoResponse,
    YoutubeVideoDownloadAndUploadRequest, YoutubeVideoDownloadAndUploadResponse,
    YoutubePreviewStream,
    youtube_watch_url,
)

logger = get_logger(__name__)

# 获取配置并创建全局并发控制信号量
_settings = get_settings()
_max_concurrent_downloads = _settings.youtube.download.max_concurrent_downloads
_download_semaphore = asyncio.Semaphore(_max_concurrent_downloads)

# 左侧预览「渐进式直链回代」用的并发信号量（spec §7 R6 / 评审落地条件 3）：
# 限制同时进行的 preview 上游拉流数，避免用户快速切换预览时把代理打爆。
_PREVIEW_MAX_CONCURRENT = 4
_preview_semaphore = asyncio.Semaphore(_PREVIEW_MAX_CONCURRENT)

# 预览解析结果缓存 TTL（秒）。取保守值 1h，短于 googlevideo 直链真实 ~6h 过期，
# 使同一视频的多段 Range 请求复用同一签名 URL、Content-Length 一致（spec §2.3）。
_PREVIEW_CACHE_TTL = 3600

# 常见渐进式容器 → HTTP Content-Type 映射。
_PREVIEW_CONTENT_TYPES = {
    "mp4": "video/mp4",
    "webm": "video/webm",
    "3gp": "video/3gpp",
}

_youtube_proxy = _settings.youtube_proxy
logger.info(f"YouTube服务初始化 - 最大并发下载数: {_max_concurrent_downloads}, 代理: {'已配置' if _youtube_proxy else '未配置'}")


class YoutubePreviewError(Exception):
    """预览直链解析失败（无可用渐进式格式 / yt-dlp 抽取失败 / 被反机器人拦截到 yt-dlp 层）。

    路由层据此返回 502，前端 <video> onError 降级为缩略图 + 「在浏览器中打开」。
    """


async def retry_with_exponential_backoff(
    func,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    backoff_factor: float = 2.0,
    jitter: bool = True
):
    """
    带指数退避的重试装饰器
    
    Args:
        func: 要重试的异步函数
        max_retries: 最大重试次数
        base_delay: 基础延迟时间（秒）
        max_delay: 最大延迟时间（秒）
        backoff_factor: 退避因子
        jitter: 是否添加随机抖动
    
    Returns:
        函数执行结果
    """
    last_exception = None
    
    for attempt in range(max_retries + 1):
        try:
            logger.info(f"执行尝试 {attempt + 1}/{max_retries + 1}")
            return await func()
            
        except Exception as e:
            last_exception = e
            if any(code in str(e) for code in ("SIGN_IN_REQUIRED", "RATE_LIMITED", "PREVIEW_LIMIT", "UNSUPPORTED_MEDIA", "MERGE_FAILED", "CANCELLED")):
                raise
            
            if attempt == max_retries:
                logger.error(f"所有重试尝试失败，最终错误: {str(e)}", exc_info=True)
                break
                
            # 计算延迟时间
            delay = min(base_delay * (backoff_factor ** attempt), max_delay)
            
            # 添加随机抖动以避免雷群效应
            if jitter:
                delay = delay * (0.5 + random.random() * 0.5)
            
            logger.warning(
                f"尝试 {attempt + 1} 失败: {str(e)}, "
                f"{delay:.2f}秒后重试 (剩余重试次数: {max_retries - attempt})"
            )
            
            await asyncio.sleep(delay)
    
    # 如果所有重试都失败，抛出最后一个异常
    raise last_exception


class YouTubeService:
    """
    YouTube视频服务类
    支持视频搜索、信息获取和下载功能
    基于yt-dlp实现
    """

    def __init__(self, output_dir: str = None):
        """
        初始化YouTube服务

        Args:
            output_dir: 下载文件保存目录
        """
        self.runtime = youtube_runtime
        self.output_dir = Path(output_dir) if output_dir else self.runtime.root / "downloads"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.proxy = _youtube_proxy or None
        self.runtime.proxy = self.proxy
        self._preview_jobs = {}
        self._preview_sessions = {}
        self._preview_reaper = None
        # video_id -> YoutubePreviewStream。进程内内存缓存，单用户本地应用无需分布式缓存。
        self._preview_stream_cache: Dict[str, YoutubePreviewStream] = {}
        logger.info("YouTube服务初始化完成，下载目录: %s", self.output_dir)

    @property
    def preview_semaphore(self) -> asyncio.Semaphore:
        """预览上游拉流并发信号量（供路由层限制并发 preview 流）。"""
        return _preview_semaphore

    def progress_hook(self, d: Dict[str, Any]) -> None:
        """下载进度回调函数"""
        if d['status'] == 'downloading':
            percent = d.get('_percent_str', 'N/A')
            speed = d.get('_speed_str', 'N/A')
            logger.debug(f"下载进度: {percent} 速度: {speed}")
        elif d['status'] == 'finished':
            logger.info(f"下载完成: {d['filename']}")

    def _get_robust_ydl_options(self, base_opts: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        获取增强的yt-dlp配置选项，专门处理YouTube的nsig提取问题
        
        Args:
            base_opts: 基础配置选项
            
        Returns:
            Dict[str, Any]: 增强的配置选项
        """
        robust_opts = {
            'extract_flat': False,
            'no_warnings': False,
            'ignoreerrors': False,
            'retries': 1,
            'fragment_retries': 1,
            # Spec 03 §3.2 — keep TLS validation on (default in yt-dlp,
            # but pinned here for safety) and cap socket timeouts so a
            # malicious / slow upstream cannot stall the worker.
            'nocheckcertificate': False,
            'socket_timeout': 30,
            'extractor_args': {
                'youtube': {
                    'max_comments': [0],  # 不提取评论
                    'comment_sort': ['top'],  # 如果需要评论，只要热门的
                }
            },
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-us,en;q=0.5',
                'Accept-Encoding': 'gzip,deflate',
                'Accept-Charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.7',
                'Keep-Alive': '300',
                'Connection': 'keep-alive',
            }
        }
        
        if self.proxy:
            robust_opts['proxy'] = self.proxy

        if base_opts:
            robust_opts.update(base_opts)

        return robust_opts

    def _pick_progressive_format(self, formats: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """从 yt-dlp ``formats`` 中挑选浏览器 ``<video>`` 可直接播放的渐进式合流格式。

        浏览器原生 ``<video>`` 需要「单文件、音视频合流」的格式；YouTube 高清多为
        DASH（音视频分离）不适合预览。优先级对应 spec §2.2 的选择器：
        ``best[ext=mp4][acodec!=none][vcodec!=none][height<=720]/22/18/best[渐进式]``。

        Args:
            formats: ``extract_info(download=False)`` 返回的 ``info['formats']``。

        Returns:
            选中的 format dict（含 ``url`` 与 ``http_headers``）；无可用渐进式则返回 None。
        """
        return progressive_format(formats)

    def _preview_key(self, video_id):
        return (self.runtime.generation, hashlib.sha256((self.proxy or "").encode()).hexdigest(), video_id)

    def resolve_preview_stream(self, video_id: str, force_refresh: bool = False) -> YoutubePreviewStream:
        key = self._preview_key(video_id)
        if not force_refresh:
            cached = self._preview_stream_cache.get(key)
            if cached and cached.expire_at > time.time():
                return cached
        output = self.runtime.root / "previews" / uuid.uuid4().hex
        try:
            data = self.runtime.run("preview", dict(url=f"https://www.youtube.com/watch?v={video_id}",
                options=self._get_robust_ydl_options({"quiet": True}), output_dir=str(output)),
                timeout=180, byte_limit=384 * 1024**2)
        except Exception as exc:
            if output.exists():
                shutil.rmtree(output, ignore_errors=True)
            raise YoutubePreviewError(str(exc)) from exc
        ext = data.get("ext", "mp4")
        identity = f"{data.get('format_id', '')}:{data.get('filesize', '')}:{ext}"
        stream = YoutubePreviewStream(url=data.get("url", ""), local_path=data.get("local_path"),
            proxy=self.proxy,
            http_headers=data.get("http_headers", {}), content_type=_PREVIEW_CONTENT_TYPES.get(ext, "video/mp4"),
            ext=ext, filesize=data.get("filesize") or data.get("file_size"), identity=identity,
            expire_at=time.time() + _PREVIEW_CACHE_TTL)
        # 旧代请求不能在更新或代理切换后写入新代缓存。
        if key == self._preview_key(video_id):
            self._preview_stream_cache[key] = stream
        return stream

    def invalidate_preview_cache(self, video_id: str) -> None:
        for key in list(self._preview_stream_cache):
            if key[-1] == video_id:
                self._preview_stream_cache.pop(key, None)

    def reap_previews(self):
        now = time.time()
        # 无会话和读者的文件才可清理；同时限制排队任务数。
        for token, entry in list(self._preview_sessions.items()):
            if now - entry["touched"] > _PREVIEW_CACHE_TTL:
                self.release_preview(token)
        for key, job in list(self._preview_jobs.items()):
            if not job["sessions"] and not job["readers"] and job["task"].done():
                self._preview_jobs.pop(key, None)
                stream = job.get("stream")
                if stream and stream.local_path:
                    shutil.rmtree(Path(stream.local_path).parent, ignore_errors=True)
                    self.invalidate_preview_cache(job["video_id"])
        # 重启后遗留的预览文件没有读者；只清理 TTL 外、未被当前会话引用的目录。
        active_paths = {str(Path(j["stream"].local_path).parent) for j in self._preview_jobs.values()
                        if j.get("stream") and j["stream"].local_path}
        directory = self.runtime.root / "previews"
        if directory.exists():
            for path in directory.iterdir():
                if path.is_dir() and str(path) not in active_paths and now - path.stat().st_mtime > _PREVIEW_CACHE_TTL:
                    shutil.rmtree(path, ignore_errors=True)

    def start(self):
        self.runtime.start()
        async def reap():
            while True:
                self.reap_previews()
                await asyncio.sleep(60)
        self._preview_reaper = asyncio.create_task(reap())

    def prepare_preview(self, video_id, retry=False):
        self.reap_previews()
        now = time.time()
        key = self._preview_key(video_id)
        if len(self._preview_sessions) >= 24:
            raise YoutubePreviewError("PREVIEW_LIMIT")
        if retry:
            self.invalidate_preview_cache(video_id)
        job = None if retry else self._preview_jobs.get(key)
        if job and (job["task"].cancelling() or job["task"].cancelled()):
            job = None
        if job is None:
            job = dict(video_id=video_id, sessions=set(), readers=0, status="preparing", code=None, stream=None)
            async def prepare():
                try:
                    job["stream"] = await cancellable_call(self.resolve_preview_stream, video_id, retry)
                    job["status"] = "ready"
                except asyncio.CancelledError:
                    job.update(status="error", code="CANCELLED")
                    raise
                except Exception as error:
                    from .youtube_worker import error_code
                    code = next((code for code in ("SIGN_IN_REQUIRED", "RATE_LIMITED", "PREVIEW_LIMIT", "UNSUPPORTED_MEDIA", "MERGE_FAILED") if code in str(error)), None)
                    job.update(status="error", code=code or error_code(error))
            job["task"] = asyncio.create_task(prepare())
            # 重试建立新身份，保留仍被旧播放器使用的字节。
            self._preview_jobs[(key, uuid.uuid4().hex) if retry else key] = job
        token = uuid.uuid4().hex
        job["sessions"].add(token)
        self._preview_sessions[token] = dict(job=job, touched=now)
        return self.preview_status(token)

    def preview_job(self, token, video_id):
        """返回会话对应的准备任务；会话不存在或视频不匹配时返回 None。"""
        entry = self._preview_sessions.get(token)
        if not entry or entry["job"]["video_id"] != video_id:
            return None
        self.preview_status(token)  # 触碰 TTL：正在播放的会话不被回收
        return entry["job"]

    async def cancel_preview(self, token):
        """释放会话；最后一个使用者离开后等待任务（含 worker 子进程）真正结束。"""
        entry = self._preview_sessions.get(token)
        task = entry["job"]["task"] if entry else None
        self.release_preview(token)
        if task is not None and not task.done():
            await asyncio.gather(task, return_exceptions=True)

    def preview_status(self, token):
        from .youtube_runtime import ERRORS
        entry = self._preview_sessions.get(token)
        if not entry:
            raise KeyError(token)
        entry["touched"] = time.time()
        job = entry["job"]
        return dict(session=token, status=job["status"], code=job["code"], message=ERRORS.get(job["code"]),
            stream_url=f"/api/youtube/preview-stream?video_id={job['video_id']}&session={token}" if job["status"] == "ready" else None)

    def release_preview(self, token):
        entry = self._preview_sessions.pop(token, None)
        if entry:
            job = entry["job"]
            job["sessions"].discard(token)
            if not job["sessions"] and not job["task"].done():
                job["task"].cancel()

    async def close(self):
        if self._preview_reaper:
            self._preview_reaper.cancel()
            await asyncio.gather(self._preview_reaper, return_exceptions=True)
        tasks = [j["task"] for j in self._preview_jobs.values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.runtime.close()

    def sanitize_filename(self, title: str, max_length: int = 200) -> str:
        """
        文件名规范化函数，移除特殊字符、emoji和不安全字符
        将中文字符转换为ASCII安全的替代字符，确保云存储兼容性
        
        Args:
            title: 原始标题
            max_length: 最大文件名长度
            
        Returns:
            str: 规范化后的文件名
        """
        if not title or not title.strip():
            return "video"
            
        # 保存原始标题用于生成备用名称
        original_title = title.strip()
        
        # Unicode规范化，将组合字符转换为分解形式
        title = unicodedata.normalize('NFKD', title)
        
        # 移除emoji和其他符号字符，并处理中文字符
        # 只保留ASCII字母、数字、常见标点符号
        allowed_chars = []
        for char in title:
            # 获取字符的Unicode类别
            category = unicodedata.category(char)
            
            # 只保留ASCII范围内的安全字符
            if (ord(char) < 128 and  # ASCII范围内
                (category.startswith('L') or  # Letters
                 category.startswith('N') or  # Numbers
                 char in ' .-_()[]{}' or      # Safe punctuation
                 category == 'Zs')):         # Space separators
                allowed_chars.append(char)
            else:
                # 将非ASCII字符（包括中文）替换为下划线
                # 这确保了云存储的兼容性
                allowed_chars.append('_')
        
        title = ''.join(allowed_chars)
        
        # 移除或替换文件系统不支持的字符
        problematic_chars = r'[<>:"/\\|?*\x00-\x1f\x7f-\x9f]'
        title = re.sub(problematic_chars, '_', title)
        
        # 替换一些特殊字符为更合适的替代
        replacements = {
            '？': '_', '！': '_', '：': '_', '；': '_',
            '【': '[', '】': ']', '（': '(', '）': ')',
        }
        
        for old, new in replacements.items():
            title = title.replace(old, new)
        
        # 移除多余的空格和下划线
        title = re.sub(r'[\s_]+', '_', title).strip('_').strip()
        
        # 移除开头和结尾的点号（Windows系统不允许）
        title = title.strip('.')
        
        # 如果清理后为空或只有下划线，生成基于原始标题长度的备用名称
        if not title or title == '_':
            # 使用原始标题的哈希值生成唯一标识符
            import hashlib
            hash_obj = hashlib.md5(original_title.encode('utf-8'))
            hash_str = hash_obj.hexdigest()[:8]  # 取前8位
            title = f"video_{hash_str}"
            
        # 截断过长的文件名，预留扩展名和唯一标识符的空间
        max_base_length = max_length - 20  # 为 .mp4 和时间戳预留空间
        if len(title) > max_base_length:
            title = title[:max_base_length].rstrip('_').rstrip('.')
            
        return title

    def search_videos(self, request: YoutubeSearchRequest) -> YoutubeSearchResponse:
        """
        搜索YouTube视频
        
        Args:
            request: 搜索请求参数
            
        Returns:
            YoutubeSearchResponse: 搜索结果
        """
        logger.info(f"开始YouTube视频搜索 - 关键词: '{request.query}', 最大数量: {request.max_videos}")
        
        try:
            # 如果有过滤条件，搜索更多结果以便过滤
            search_limit = request.max_videos
            if any([request.min_duration, request.max_duration, request.min_views, request.max_views]):
                search_limit = min(request.max_videos * 3, 150)  # 搜索3倍数量，但不超过150
                
            search_url = f"ytsearch{search_limit}:{request.query}"
            
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': True,
                'default_search': 'ytsearch',
                'socket_timeout': 15,
                'retries': 1,
                'fragment_retries': 1,
                # Spec 03 §3.2 — keep TLS validation on; search target is
                # always YouTube's own host so the URL guard is not needed
                # here (the query is interpolated into ``ytsearch{N}:``).
                'nocheckcertificate': False,
            }

            if self.proxy:
                ydl_opts['proxy'] = self.proxy

            search_results = self.runtime.run("extract", dict(url=search_url, options=ydl_opts), timeout=40)

            videos = []
            if search_results and 'entries' in search_results:
                for entry in search_results['entries']:
                    if entry:
                        try:
                            # 安全地处理可能为None的数值字段
                            duration = entry.get('duration')
                            if duration is None or not isinstance(duration, (int, float)):
                                duration = 0
                            else:
                                duration = int(duration)

                            view_count = entry.get('view_count')
                            if view_count is None or not isinstance(view_count, (int, float)):
                                view_count = 0
                            else:
                                view_count = int(view_count)

                            video_id = entry.get('id', '')
                            if not video_id:
                                logger.warning(f"跳过没有ID的视频条目: {entry.get('title', 'Unknown')}")
                                continue

                            video_info = YoutubeVideoInfo(
                                id=video_id,
                                title=entry.get('title', 'Unknown'),
                                url=f"https://www.youtube.com/watch?v={video_id}",
                                duration=duration,
                                uploader=entry.get('uploader', 'Unknown'),
                                upload_date=entry.get('upload_date', 'Unknown'),
                                view_count=view_count,
                                thumbnail_url=entry.get('thumbnail', ''),
                                description=entry.get('description', '')[:200] if entry.get('description') else ''
                            )
                            videos.append(video_info)

                        except Exception as e:
                            logger.warning(f"处理视频条目时出错，跳过: {str(e)}, 条目: {entry.get('title', 'Unknown')}")
                            continue

            # 应用过滤条件
            filtered_videos = self._filter_videos(
                videos, request.min_duration, request.max_duration,
                request.min_views, request.max_views
            )

            # 限制返回结果数量
            final_videos = filtered_videos[:request.max_videos]

            logger.info(f"YouTube搜索完成 - 找到: {len(final_videos)} 个视频")

            return YoutubeSearchResponse(
                success=True,
                videos=final_videos,
                total_found=len(final_videos),
                message=f"成功找到 {len(final_videos)} 个视频",
                query=request.query
            )

        except Exception as e:
            error_msg = f"YouTube搜索失败: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return YoutubeSearchResponse(
                success=False,
                videos=[],
                total_found=0,
                error=error_msg,
                query=request.query
            )

    def _filter_videos(
        self, 
        videos: List[YoutubeVideoInfo], 
        min_duration: Optional[int] = None,
        max_duration: Optional[int] = None, 
        min_views: Optional[int] = None,
        max_views: Optional[int] = None
    ) -> List[YoutubeVideoInfo]:
        """
        根据条件过滤视频列表
        
        Args:
            videos: 视频列表
            min_duration: 最小时长（秒）
            max_duration: 最大时长（秒）
            min_views: 最小播放量
            max_views: 最大播放量
            
        Returns:
            List[YoutubeVideoInfo]: 过滤后的视频列表
        """
        filtered = []
        
        for video in videos:
            # 时长过滤
            video_duration = video.duration or 0
            if min_duration is not None and video_duration < min_duration:
                continue
            if max_duration is not None and video_duration > max_duration:
                continue
                
            # 播放量过滤
            video_view_count = video.view_count or 0
            if min_views is not None and video_view_count < min_views:
                continue
            if max_views is not None and video_view_count > max_views:
                continue
                
            filtered.append(video)
            
        return filtered

    def get_video_info(self, request: YoutubeVideoInfoRequest) -> YoutubeVideoInfoResponse:
        """
        获取YouTube视频信息
        
        Args:
            request: 视频信息请求
            
        Returns:
            YoutubeVideoInfoResponse: 视频信息响应
        """
        logger.info(f"获取YouTube视频信息 - URL: {request.url}")

        # 仅重建固定 YouTube 主机和合法视频 ID，拒绝任意 URL/重定向入口。
        # 兼容 TUN 的 fake-IP DNS，不放宽通用 URL guard。
        try:
            safe_url = youtube_watch_url(request.url)
        except ValueError as guard_exc:
            logger.warning(f"YouTube info URL rejected by url_guard: {guard_exc}")
            return YoutubeVideoInfoResponse(
                success=False,
                error=f"URL rejected: {guard_exc}",
            )

        try:
            base_opts = {'quiet': True}
            ydl_opts = self._get_robust_ydl_options(base_opts)

            info = self.runtime.run("extract", dict(url=safe_url, options=ydl_opts), timeout=25)

            # 安全地处理可能为None的数值字段
            duration = info.get('duration')
            if duration is None or not isinstance(duration, (int, float)):
                duration = 0
            else:
                duration = int(duration)

            view_count = info.get('view_count')
            if view_count is None or not isinstance(view_count, (int, float)):
                view_count = 0
            else:
                view_count = int(view_count)

            video_info = YoutubeVideoInfo(
                id=info.get('id', ''),
                title=info.get('title', 'Unknown'),
                url=safe_url,
                duration=duration,
                uploader=info.get('uploader', 'Unknown'),
                upload_date=info.get('upload_date', 'Unknown'),
                view_count=view_count,
                thumbnail_url=info.get('thumbnail', ''),
                description=info.get('description', '')[:200] if info.get('description') else '',
                width=info.get('width'),
                height=info.get('height')
            )

            logger.info(f"成功获取视频信息 - 标题: {video_info.title}")

            return YoutubeVideoInfoResponse(
                success=True,
                video=video_info,
                message="成功获取视频信息"
            )

        except Exception as e:
            error_msg = f"获取视频信息失败: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return YoutubeVideoInfoResponse(
                success=False,
                error=error_msg
            )

    def download_video(self, request: YoutubeVideoDownloadRequest) -> YoutubeVideoDownloadResponse:
        try:
            safe_url = youtube_watch_url(request.url)
        except ValueError as error:
            return YoutubeVideoDownloadResponse(success=False, message="URL rejected", error=str(error))
        output = self.output_dir.resolve() / uuid.uuid4().hex
        try:
            data = self.runtime.run("download", dict(url=safe_url, options=self._get_robust_ydl_options(),
                request=request.model_dump(), output_dir=str(output)), timeout=280, byte_limit=4 * 1024**3)
            return YoutubeVideoDownloadResponse(success=True,
                message="视频下载成功（源视频无音轨）" if data.get("has_audio") is False else "视频下载成功",
                file_path=data["file_path"], file_size=data["file_size"], has_audio=data.get("has_audio"))
        except Exception as error:
            if output.exists():
                shutil.rmtree(output, ignore_errors=True)
            return YoutubeVideoDownloadResponse(success=False, message="视频下载失败", error=str(error))

    async def download_video_async(self, request: YoutubeVideoDownloadRequest) -> YoutubeVideoDownloadResponse:
        return await cancellable_call(self.download_video, request)

    async def download_and_upload_video(self, request: YoutubeVideoDownloadAndUploadRequest) -> YoutubeVideoDownloadAndUploadResponse:
        """
        下载YouTube视频并上传到存储服务
        支持并发控制（最多5个并发）和自动重试（最多3次）
        
        Args:
            request: 下载并上传请求参数
            
        Returns:
            YoutubeVideoDownloadAndUploadResponse: 操作结果
        """
        from app.models.youtube_models import YoutubeVideoDownloadAndUploadResponse
        from app.services.storage_service import storage_service
        from datetime import datetime
        import tempfile
        import os
        import subprocess
        import json

        # 获取信号量状态信息
        semaphore_available = _download_semaphore._value
        try:
            # 安全地获取等待队列长度
            if hasattr(_download_semaphore, '_waiters') and _download_semaphore._waiters is not None:
                semaphore_waiters = len(_download_semaphore._waiters)
            else:
                semaphore_waiters = 0
        except (AttributeError, TypeError):
            semaphore_waiters = 0
        
        logger.info(f"YouTube视频下载请求 - URL: {request.url}, "
                   f"并发控制状态: 可用槽位={semaphore_available}, 等待队列={semaphore_waiters}")
        
        # 使用信号量控制并发
        async with _download_semaphore:
            current_concurrent = _max_concurrent_downloads - _download_semaphore._value
            logger.info(f"🚀 获得下载槽位 - URL: {request.url}, "
                       f"当前并发数: {current_concurrent}/{_max_concurrent_downloads}, "
                       f"剩余槽位: {_download_semaphore._value}")
            
            # 使用重试机制执行下载和上传
            async def download_and_upload_with_retry():
                return await self._download_and_upload_internal(request)
            
            try:
                # 从配置读取重试参数
                max_retries = _settings.youtube.download.max_retries
                base_delay = float(_settings.youtube.download.retry_delay)
                
                result = await retry_with_exponential_backoff(
                    download_and_upload_with_retry, max_retries=max_retries, base_delay=base_delay, max_delay=60.0)

                logger.info(f"YouTube视频下载并上传成功 - URL: {request.url}, "
                           f"视频URL: {result.video_url}")
                return result
                
            except Exception as e:
                error_msg = f"YouTube视频下载并上传失败: {str(e)}"
                logger.error(error_msg, exc_info=True)
                return YoutubeVideoDownloadAndUploadResponse(
                    success=False,
                    message=error_msg,
                    error=error_msg,
                    original_youtube_url=request.url
                )
            finally:
                logger.info(f"🔓 释放下载槽位 - URL: {request.url}, "
                           f"释放后可用槽位: {_download_semaphore._value + 1}")

    async def _download_and_upload_internal(self, request: YoutubeVideoDownloadAndUploadRequest) -> YoutubeVideoDownloadAndUploadResponse:
        """
        内部下载和上传实现（用于重试机制）
        
        Args:
            request: 下载并上传请求参数
            
        Returns:
            YoutubeVideoDownloadAndUploadResponse: 操作结果
        """
        from app.models.youtube_models import YoutubeVideoDownloadAndUploadResponse
        from app.services.storage_service import storage_service
        from datetime import datetime
        import tempfile
        import os
        import subprocess
        import json

        start_time = time.time()
        logger.info(f"开始内部下载流程 - URL: {request.url}")
        
        try:
            # 第一步：下载YouTube视频
            download_request = YoutubeVideoDownloadRequest(
                url=request.url,
                video_quality=request.video_quality,
                audio_quality=request.audio_quality,
                format_type=request.format_type
            )
            
            step_start = time.time()
            logger.info(f"步骤1: 开始下载YouTube视频 - URL: {request.url}")
            download_result = await self.download_video_async(download_request)
            step_duration = time.time() - step_start
            logger.info(f"步骤1: 视频下载完成，耗时: {step_duration:.2f}秒")
            
            if not download_result.success:
                error_msg = f"YouTube视频下载失败: {download_result.error}"
                logger.error(error_msg)
                raise Exception(error_msg)
            
            if not download_result.file_path or not os.path.exists(download_result.file_path):
                error_msg = "下载的视频文件不存在或路径无效"
                logger.error(error_msg)
                raise Exception(error_msg)
            
            logger.info(f"YouTube视频下载成功: {download_result.file_path}, "
                       f"文件大小: {download_result.file_size} bytes")
            
            # 第二步：获取视频元数据
            step_start = time.time()
            logger.info(f"步骤2: 开始获取视频元数据 - URL: {request.url}")
            duration = None
            width = None
            height = None
            video_metadata = {
                "original_youtube_url": request.url,
                "download_time": datetime.now().isoformat(),
                "file_size": download_result.file_size,
                "has_audio": download_result.has_audio,
            }
            
            try:
                # 使用ffprobe获取视频信息
                cmd = [
                    'ffprobe', '-v', 'quiet', '-print_format', 'json',
                    '-show_format', '-show_streams', download_result.file_path
                ]
                
                # 明确指定UTF-8编码，避免Windows系统上的GBK编码问题
                result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
                
                if result.returncode == 0:
                    probe_data = json.loads(result.stdout)
                    
                    # 查找视频流
                    for stream in probe_data.get('streams', []):
                        if stream.get('codec_type') == 'video':
                            width = stream.get('width')
                            height = stream.get('height')
                            break
                    
                    # 获取时长
                    format_data = probe_data.get('format', {})
                    duration_str = format_data.get('duration')
                    if duration_str:
                        duration = float(duration_str)
                    
                    video_metadata.update({
                        "width": width,
                        "height": height,
                        "duration": duration,
                        "ffprobe_success": True
                    })
                    
                    logger.info(f"成功获取视频元数据 - 时长: {duration}s, "
                               f"分辨率: {width}x{height}")
                else:
                    logger.warning(f"无法获取视频元数据 - ffprobe错误: {result.stderr}")
                    video_metadata["ffprobe_success"] = False
                    
            except Exception as probe_error:
                logger.warning(f"获取视频元数据时出错: {str(probe_error)}")
                video_metadata["ffprobe_error"] = str(probe_error)
            
            step_duration = time.time() - step_start
            logger.info(f"步骤2: 视频元数据获取完成，耗时: {step_duration:.2f}秒")
            
            # 第三步：上传视频到存储服务
            step_start = time.time()
            logger.info(f"步骤3: 开始上传视频到存储服务 - URL: {request.url}")

            # 构建自定义文件名
            custom_filename = request.custom_filename
            if not custom_filename:
                base_name = os.path.splitext(os.path.basename(download_result.file_path))[0]
                sanitized_name = self.sanitize_filename(base_name)
                custom_filename = f"youtube_{sanitized_name}.{request.format_type}"

            custom_filename = f"{Path(custom_filename).stem}.{request.format_type}"

            with open(download_result.file_path, "rb") as f:
                file_data = f.read()

            upload_result = await storage_service.upload_file(
                file_data=file_data,
                filename=custom_filename,
                content_type={"mp4": "video/mp4", "webm": "video/webm", "mkv": "video/x-matroska"}[request.format_type],
                folder="video",
                user_id="anonymous",
                task_id=request.task_id,
            )

            if not upload_result.get("success", False):
                error_msg = upload_result.get("message", "未知错误")
                logger.error(f"存储服务上传失败: {error_msg}")
                raise Exception(f"视频上传到存储服务失败: {error_msg}")

            video_url = upload_result.get("file_url", "")
            step_duration = time.time() - step_start
            logger.info(f"步骤3: 视频成功上传到存储服务，耗时: {step_duration:.2f}秒, URL: {video_url}")
            
            # 第四步：生成缩略图（如果需要且有时长信息）
            thumbnail_url = None
            thumbnail_path = None
            
            if request.generate_thumbnail and duration is not None:
                step_start = time.time()
                logger.info(f"步骤4: 开始生成并上传缩略图 - URL: {request.url}")
                try:
                    # 生成缩略图
                    thumbnail_filename = f"thumb_{os.path.splitext(custom_filename)[0]}.jpg"
                    
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as thumb_file:
                        thumbnail_path = thumb_file.name
                    
                    # 使用ffmpeg生成缩略图（在视频中间位置）
                    thumbnail_time = duration / 2 if duration > 2 else 1
                    
                    cmd = [
                        'ffmpeg', '-i', download_result.file_path, '-ss', str(thumbnail_time),
                        '-vframes', '1', '-q:v', '2', '-y', thumbnail_path
                    ]
                    
                    result = subprocess.run(cmd, capture_output=True, timeout=30)
                    
                    if result.returncode == 0 and os.path.exists(thumbnail_path):
                        # 上传缩略图到存储服务
                        with open(thumbnail_path, "rb") as f:
                            thumb_data = f.read()

                        thumb_result = await storage_service.upload_file(
                            file_data=thumb_data,
                            filename=thumbnail_filename,
                            content_type="image/jpeg",
                            folder="video",
                            user_id="anonymous",
                            task_id=request.task_id,
                        )

                        if thumb_result.get("success", False):
                            thumbnail_url = thumb_result.get("file_url", "")
                            step_duration = time.time() - step_start
                            logger.info(f"步骤4: 缩略图生成并上传成功，耗时: {step_duration:.2f}秒, URL: {thumbnail_url}")
                        else:
                            logger.warning(f"缩略图上传失败: {thumb_result.get('message', '未知错误')}")
                    else:
                        ffmpeg_error = result.stderr.decode() if result.stderr else "Unknown error"
                        logger.warning(f"缩略图生成失败: {ffmpeg_error}")
                        
                except Exception as thumb_error:
                    logger.warning(f"生成缩略图时出错: {str(thumb_error)}")
                    
            else:
                logger.info("跳过缩略图生成（未启用或无时长信息）")
            
            # 每个任务独占一个输出目录；整个目录回收，避免空目录长期堆积。
            try:
                task_dir = Path(download_result.file_path).parent
                output_root = self.output_dir.resolve()
                if task_dir != output_root and task_dir.is_relative_to(output_root):
                    shutil.rmtree(task_dir, ignore_errors=True)
                elif os.path.exists(download_result.file_path):
                    os.remove(download_result.file_path)
                logger.info(f"已清理任务下载目录: {task_dir}")

                if thumbnail_path and os.path.exists(thumbnail_path):
                    os.remove(thumbnail_path)
                    logger.info(f"已清理临时缩略图文件: {thumbnail_path}")

            except Exception as cleanup_error:
                logger.warning(f"清理临时文件失败: {cleanup_error}")
            
            # 记录总体完成情况
            total_duration = time.time() - start_time
            logger.info(f"YouTube视频下载并上传完成 - 总耗时: {total_duration:.2f}秒, "
                       f"文件大小: {download_result.file_size} bytes, "
                       f"分辨率: {width}x{height}, 时长: {duration}s")
            
            return YoutubeVideoDownloadAndUploadResponse(
                success=True,
                message="YouTube视频下载并上传成功",
                video_url=video_url,
                thumbnail_url=thumbnail_url,
                file_size=download_result.file_size,
                duration=duration,
                width=width,
                height=height,
                original_youtube_url=request.url,
                has_audio=download_result.has_audio,
            )
            
        except Exception as e:
            total_duration = time.time() - start_time
            error_msg = f"内部下载流程失败（耗时: {total_duration:.2f}秒）: {str(e)}"
            logger.error(error_msg, exc_info=True)
            # 重新抛出异常以便重试机制处理
            raise Exception(error_msg)


# 创建全局YouTube服务实例
youtube_service = YouTubeService()
