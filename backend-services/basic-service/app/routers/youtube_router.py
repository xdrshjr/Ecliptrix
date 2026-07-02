#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import re

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from app.logger import get_logger
from app.models.youtube_models import (
    YoutubeSearchRequest, YoutubeSearchResponse,
    YoutubeVideoInfoRequest, YoutubeVideoInfoResponse,
    YoutubeVideoDownloadRequest, YoutubeVideoDownloadResponse,
    YoutubeVideoDownloadAndUploadRequest, YoutubeVideoDownloadAndUploadResponse,
    YoutubePreviewStream,
)
from app.services.youtube_service import youtube_service, YoutubePreviewError

logger = get_logger(__name__)

router = APIRouter(prefix="/youtube", tags=["YouTube"])

# 11 位 YouTube 视频 ID 严格校验（拒绝任意 URL / 路径穿越，从源头收敛 SSRF，spec §2.5）。
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# 回代 googlevideo 直链的分片大小（64KB）。
_PREVIEW_STREAM_CHUNK = 64 * 1024


@router.post("/search", response_model=YoutubeSearchResponse)
async def search_youtube_videos(request: YoutubeSearchRequest) -> YoutubeSearchResponse:
    """
    搜索YouTube视频
    
    This endpoint allows users to search for YouTube videos with various filters.
    
    Args:
        request (YoutubeSearchRequest): YouTube搜索参数包括关键词、最大数量、方向等
    
    Returns:
        YoutubeSearchResponse: 搜索结果包含视频列表和元数据
    
    Raises:
        HTTPException: 400 for invalid request parameters, 500 for internal errors
    """
    logger.info(f"YouTube视频搜索请求 - 关键词: '{request.query}', 最大数量: {request.max_videos}, 方向: {request.orientation}")
    
    try:
        # 验证请求参数
        if not request.query.strip():
            logger.warning("空的搜索关键词")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="搜索关键词不能为空"
            )
        
        # 执行YouTube视频搜索（线程池运行 + 总超时，避免 yt-dlp 无限挂起）
        logger.debug(f"调用YouTube搜索服务，参数: {request.model_dump()}")
        result = await asyncio.wait_for(
            asyncio.to_thread(youtube_service.search_videos, request),
            timeout=45,
        )

        # 记录搜索结果
        logger.info(f"YouTube搜索完成 - 成功: {result.success}, 找到: {result.total_found} 个视频")

        if not result.success:
            logger.warning(f"YouTube搜索失败: {result.error}")
            return result

        logger.info(f"成功找到 {len(result.videos)} 个YouTube视频，关键词: '{request.query}'")
        return result

    except asyncio.TimeoutError:
        logger.error(f"YouTube搜索超时（45s），关键词: '{request.query}'")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="YouTube搜索超时，请检查服务器网络是否能访问YouTube",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"YouTube搜索过程中发生意外错误: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="YouTube搜索过程中发生内部服务器错误"
        )


@router.post("/info", response_model=YoutubeVideoInfoResponse)
async def get_youtube_video_info(request: YoutubeVideoInfoRequest) -> YoutubeVideoInfoResponse:
    """
    获取YouTube视频信息
    
    This endpoint retrieves detailed information about a specific YouTube video.
    
    Args:
        request (YoutubeVideoInfoRequest): 包含YouTube视频URL的请求
    
    Returns:
        YoutubeVideoInfoResponse: 视频详细信息
    
    Raises:
        HTTPException: 400 for invalid URL, 500 for internal errors
    """
    logger.info(f"获取YouTube视频信息请求 - URL: {request.url}")
    
    try:
        # 验证URL格式
        if not request.url.strip():
            logger.warning("空的视频URL")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="视频URL不能为空"
            )
        
        if "youtube.com" not in request.url and "youtu.be" not in request.url:
            logger.warning(f"无效的YouTube URL: {request.url}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="请提供有效的YouTube视频URL"
            )
        
        # 获取视频信息（线程池运行 + 总超时）
        logger.debug(f"调用YouTube信息服务，URL: {request.url}")
        result = await asyncio.wait_for(
            asyncio.to_thread(youtube_service.get_video_info, request),
            timeout=30,
        )

        logger.info(f"YouTube视频信息获取完成 - 成功: {result.success}")

        if not result.success:
            logger.warning(f"YouTube视频信息获取失败: {result.error}")
            return result

        logger.info(f"成功获取YouTube视频信息 - 标题: {result.video.title if result.video else 'Unknown'}")
        return result

    except asyncio.TimeoutError:
        logger.error(f"YouTube视频信息获取超时（30s），URL: {request.url}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="获取视频信息超时，请检查服务器网络是否能访问YouTube",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取YouTube视频信息过程中发生意外错误: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="获取视频信息过程中发生内部服务器错误"
        )


@router.post("/download", response_model=YoutubeVideoDownloadResponse)
async def download_youtube_video(request: YoutubeVideoDownloadRequest) -> YoutubeVideoDownloadResponse:
    """
    下载YouTube视频
    
    This endpoint downloads a YouTube video with specified quality and format options.
    
    Args:
        request (YoutubeVideoDownloadRequest): 下载参数包括URL、质量、格式等
    
    Returns:
        YoutubeVideoDownloadResponse: 下载结果包含文件路径和大小
    
    Raises:
        HTTPException: 400 for invalid parameters, 500 for internal errors
    """
    logger.info(f"YouTube视频下载请求 - URL: {request.url}, 质量: {request.video_quality}")
    
    try:
        # 验证URL格式
        if not request.url.strip():
            logger.warning("空的视频URL")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="视频URL不能为空"
            )
        
        if "youtube.com" not in request.url and "youtu.be" not in request.url:
            logger.warning(f"无效的YouTube URL: {request.url}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="请提供有效的YouTube视频URL"
            )
        
        # 执行视频下载（线程池运行 + 总超时）
        logger.debug(f"调用YouTube下载服务，参数: {request.model_dump()}")
        result = await asyncio.wait_for(
            asyncio.to_thread(youtube_service.download_video, request),
            timeout=300,  # 下载允许更长时间
        )

        logger.info(f"YouTube视频下载完成 - 成功: {result.success}")

        if not result.success:
            logger.warning(f"YouTube视频下载失败: {result.error}")
            return result

        logger.info(f"成功下载YouTube视频 - 文件: {result.file_path}")
        return result

    except asyncio.TimeoutError:
        logger.error(f"YouTube视频下载超时（300s），URL: {request.url}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="视频下载超时，请检查服务器网络是否能访问YouTube",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"YouTube视频下载过程中发生意外错误: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="视频下载过程中发生内部服务器错误"
        )


@router.post("/download-and-upload", response_model=YoutubeVideoDownloadAndUploadResponse)
async def download_and_upload_youtube_video(request: YoutubeVideoDownloadAndUploadRequest) -> YoutubeVideoDownloadAndUploadResponse:
    """
    下载YouTube视频并上传到存储服务

    This endpoint downloads a YouTube video and automatically uploads it to storage.
    
    Args:
        request (YoutubeVideoDownloadAndUploadRequest): 下载并上传参数
    
    Returns:
        YoutubeVideoDownloadAndUploadResponse: 操作结果包含存储URL等信息
    
    Raises:
        HTTPException: 400 for invalid parameters, 500 for internal errors
    """
    logger.info(f"YouTube视频下载并上传请求 - URL: {request.url}, 任务ID: {request.task_id}")
    
    try:
        # 验证URL格式
        if not request.url.strip():
            logger.warning("空的视频URL")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="视频URL不能为空"
            )
        
        if "youtube.com" not in request.url and "youtu.be" not in request.url:
            logger.warning(f"无效的YouTube URL: {request.url}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="请提供有效的YouTube视频URL"
            )
        
        # 执行下载并上传
        logger.debug(f"调用YouTube下载并上传服务，参数: {request.model_dump()}")
        result = await youtube_service.download_and_upload_video(request)
        
        # 记录操作结果
        logger.info(f"YouTube视频下载并上传完成 - 成功: {result.success}")
        
        if not result.success:
            logger.warning(f"YouTube视频下载并上传失败: {result.error}")
            return result
        
        logger.info(f"成功下载并上传YouTube视频 - URL: {result.video_url}")
        return result
        
    except HTTPException:
        # 重新抛出HTTP异常
        raise
        
    except Exception as e:
        logger.error(f"YouTube视频下载并上传过程中发生意外错误: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="视频下载并上传过程中发生内部服务器错误"
        )


async def _open_preview_upstream(
    stream: YoutubePreviewStream, range_header: str | None
):
    """打开对 googlevideo 直链的上游流（经 YOUTUBE_PROXY），返回 ``(client, response)``。

    使用「所选 format 的 http_headers」而非顶层桌面 UA（P1-1），转发浏览器 Range。
    出错时负责关闭 client 后再抛出，避免连接泄漏。
    """
    # follow_redirects=True：googlevideo 边缘节点存在 302；直链源自 yt-dlp 解析
    # 结果（非客户端输入）且经受信代理出网，SSRF 面已在「只传 11 位 id」处收敛（spec §8 P2-4）。
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=15, read=30, write=30, pool=15),
        follow_redirects=True,
        proxy=(youtube_service.proxy or None),
    )
    upstream_headers = dict(stream.http_headers)
    if range_header:
        upstream_headers["Range"] = range_header

    try:
        req = client.build_request("GET", stream.url, headers=upstream_headers)
        response = await client.send(req, stream=True)
    except Exception:
        await client.aclose()
        raise
    return client, response


@router.get("/preview/stream")
async def preview_stream(video_id: str, request: Request):
    """渐进式预览流：解析渐进式 mp4 直链并经代理回代字节（支持 Range 206）。

    前端左侧预览面板的同源 ``<video>`` 指向本端点（经 Next.js BFF），从而规避
    ``<iframe youtube.com/embed>`` 触发的反机器人「请登录…」挑战（spec §1）。

    Args:
        video_id: YouTube 11 位视频 ID（``^[A-Za-z0-9_-]{11}$``）。
        request: 用于读取浏览器透传的 ``Range`` 请求头。

    Returns:
        StreamingResponse: 200/206 视频字节流；含 Content-Type/Length/Range、
        Accept-Ranges、Cache-Control: no-store。

    Raises:
        HTTPException: 400 非法 video_id；502 解析/上游失败；504 解析超时。
    """
    if not video_id or not _VIDEO_ID_RE.match(video_id):
        logger.warning(f"非法的预览 video_id: {video_id!r}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的 video_id，需为 11 位 YouTube 视频 ID",
        )

    # 1) 解析渐进式直链（线程池 + 超时，避免阻塞事件循环 / yt-dlp 无限挂起）。
    try:
        stream = await asyncio.wait_for(
            asyncio.to_thread(youtube_service.resolve_preview_stream, video_id),
            timeout=30,
        )
    except asyncio.TimeoutError:
        logger.error(f"预览直链解析超时（30s） - video_id: {video_id}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="解析预览直链超时，请检查服务器网络/代理是否能访问 YouTube",
        )
    except YoutubePreviewError as exc:
        logger.warning(f"预览直链解析失败 - video_id: {video_id}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"无法解析预览直链: {exc}",
        )

    range_header = request.headers.get("range")

    # 2) 打开上游流；上游 403/410（直链过期或 IP 变化）时失效缓存、重解析一次（R2）。
    #    信号量限制并发 preview 上游流（R6 / 落地条件 3），断连/异常时在 finally 释放。
    semaphore = youtube_service.preview_semaphore
    await semaphore.acquire()
    ownership_transferred = False
    try:
        try:
            client, upstream = await _open_preview_upstream(stream, range_header)
            if upstream.status_code in (403, 410):
                logger.info(
                    f"预览上游 {upstream.status_code}，失效缓存并重解析一次 - video_id: {video_id}"
                )
                await upstream.aclose()
                await client.aclose()
                youtube_service.invalidate_preview_cache(video_id)
                stream = await asyncio.wait_for(
                    asyncio.to_thread(
                        youtube_service.resolve_preview_stream, video_id, True
                    ),
                    timeout=30,
                )
                client, upstream = await _open_preview_upstream(stream, range_header)
        except asyncio.TimeoutError:
            logger.error(f"预览重解析超时（30s） - video_id: {video_id}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="解析预览直链超时，请检查服务器网络/代理是否能访问 YouTube",
            )
        except YoutubePreviewError as exc:
            logger.warning(f"预览直链重解析失败 - video_id: {video_id}: {exc}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"无法解析预览直链: {exc}",
            )
        except httpx.TimeoutException as exc:
            logger.error(f"预览上游连接超时 - video_id: {video_id}: {exc}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="预览上游连接超时",
            )
        except httpx.HTTPError as exc:
            logger.error(f"预览上游连接失败 - video_id: {video_id}: {exc}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="预览上游连接失败",
            )

        # 上游仍报错（非 2xx/206）→ 502，先关闭连接。
        if upstream.status_code >= 400:
            upstream_status = upstream.status_code
            await upstream.aclose()
            await client.aclose()
            logger.warning(
                f"预览上游返回 {upstream_status} - video_id: {video_id}"
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"预览上游返回 {upstream_status}",
            )

        # 3) 拷贝上游响应头并回代。
        response_headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        }
        for name in ("content-type", "content-length", "content-range"):
            value = upstream.headers.get(name)
            if value:
                response_headers[name.title()] = value
        response_headers.setdefault("Content-Type", stream.content_type)

        async def _body():
            # P2-2 断连清理：浏览器快速切换/关闭预览会中断请求，Starlette 会
            # aclose() 本生成器并抛 GeneratorExit；finally 确保关闭 httpx 连接、
            # 释放信号量，避免到 googlevideo 的连接/代理堆积。
            try:
                async for chunk in upstream.aiter_bytes(_PREVIEW_STREAM_CHUNK):
                    yield chunk
            finally:
                try:
                    await upstream.aclose()
                finally:
                    await client.aclose()
                    semaphore.release()

        # 信号量释放责任移交给生成器 finally。
        ownership_transferred = True
        return StreamingResponse(
            _body(),
            status_code=upstream.status_code,
            headers=response_headers,
        )
    finally:
        if not ownership_transferred:
            semaphore.release()


@router.get("/health")
async def youtube_service_health():
    """
    YouTube服务健康检查
    
    Returns:
        dict: 服务状态信息
    """
    try:
        # 简单的健康检查，验证yt-dlp是否可用
        import yt_dlp
        
        return {
            "status": "healthy",
            "service": "YouTube Service",
            "yt_dlp_version": yt_dlp.version.__version__,
            "message": "YouTube服务运行正常"
        }
    except ImportError:
        logger.error("yt-dlp未安装或不可用")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="YouTube服务不可用：yt-dlp未安装"
        )
    except Exception as e:
        logger.error(f"YouTube服务健康检查失败: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="YouTube服务不可用"
        ) 