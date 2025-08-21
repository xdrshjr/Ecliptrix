#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from fastapi import APIRouter, HTTPException, status
from app.logger import get_logger
from app.models.youtube_models import (
    YoutubeSearchRequest, YoutubeSearchResponse,
    YoutubeVideoInfoRequest, YoutubeVideoInfoResponse,
    YoutubeVideoDownloadRequest, YoutubeVideoDownloadResponse
)
from app.services.youtube_service import youtube_service

logger = get_logger(__name__)

router = APIRouter(prefix="/youtube", tags=["YouTube"])


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
        
        # 执行YouTube视频搜索
        logger.debug(f"调用YouTube搜索服务，参数: {request.model_dump()}")
        result = youtube_service.search_videos(request)
        
        # 记录搜索结果
        logger.info(f"YouTube搜索完成 - 成功: {result.success}, 找到: {result.total_found} 个视频")
        
        if not result.success:
            logger.warning(f"YouTube搜索失败: {result.error}")
            # 返回服务响应，即使不成功（包含错误信息）
            return result
        
        logger.info(f"成功找到 {len(result.videos)} 个YouTube视频，关键词: '{request.query}'")
        return result
        
    except HTTPException:
        # 重新抛出HTTP异常
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
        
        # 获取视频信息
        logger.debug(f"调用YouTube信息服务，URL: {request.url}")
        result = youtube_service.get_video_info(request)
        
        # 记录结果
        logger.info(f"YouTube视频信息获取完成 - 成功: {result.success}")
        
        if not result.success:
            logger.warning(f"YouTube视频信息获取失败: {result.error}")
            return result
        
        logger.info(f"成功获取YouTube视频信息 - 标题: {result.video.title if result.video else 'Unknown'}")
        return result
        
    except HTTPException:
        # 重新抛出HTTP异常
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
        
        # 执行视频下载
        logger.debug(f"调用YouTube下载服务，参数: {request.model_dump()}")
        result = youtube_service.download_video(request)
        
        # 记录下载结果
        logger.info(f"YouTube视频下载完成 - 成功: {result.success}")
        
        if not result.success:
            logger.warning(f"YouTube视频下载失败: {result.error}")
            return result
        
        logger.info(f"成功下载YouTube视频 - 文件: {result.file_path}")
        return result
        
    except HTTPException:
        # 重新抛出HTTP异常
        raise
        
    except Exception as e:
        logger.error(f"YouTube视频下载过程中发生意外错误: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="视频下载过程中发生内部服务器错误"
        )


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