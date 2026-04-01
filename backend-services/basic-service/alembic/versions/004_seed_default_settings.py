"""Seed system_settings with default values from YAML config files.

Uses INSERT ... ON CONFLICT DO NOTHING for idempotency — safe to run multiple times.

Revision ID: 004
Revises: 003
Create Date: 2026-03-23

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Default values extracted from YAML config files.
# Each entry: (category, key, value, value_type, description)
DEFAULT_SETTINGS = [
    # ── TTS (batch_tts_config.yaml) ──
    (
        "tts", "concurrency",
        {
            "concurrent_threads": 3,
            "max_concurrent_threads": 10,
            "request_timeout": 30,
            "batch_timeout": 300,
        },
        "object",
        "TTS concurrent processing and timeout settings",
    ),
    (
        "tts", "retry",
        {
            "max_attempts": 3,
            "delay_seconds": 1,
            "backoff_factor": 2,
        },
        "object",
        "TTS retry configuration",
    ),
    (
        "tts", "logging",
        {
            "enable_detailed_logs": True,
            "log_progress_interval": 1,
            "log_level": "INFO",
        },
        "object",
        "TTS logging configuration",
    ),
    (
        "tts", "limits",
        {
            "max_segments_per_batch": 50,
            "max_text_length_per_segment": 5000,
            "max_total_text_length": 100000,
        },
        "object",
        "TTS resource limits",
    ),
    (
        "tts", "voices",
        [
            {"value": "zh_male_shaonianzixin_moon_bigtts", "label": "少年梓辛/Brayan (男声)", "category": "通用场景", "gender": "male", "language": "zh-CN", "description": "少年梓辛，清澈的男性声音，适合年轻化内容"},
            {"value": "zh_female_linjianvhai_moon_bigtts", "label": "邻家女孩 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "邻家女孩，亲切自然的女性声音"},
            {"value": "zh_male_yuanboxiaoshu_moon_bigtts", "label": "渊博小叔 (男声)", "category": "通用场景", "gender": "male", "language": "zh-CN", "description": "渊博小叔，知识渊博的男性声音"},
            {"value": "zh_male_yangguangqingnian_moon_bigtts", "label": "阳光青年 (男声)", "category": "通用场景", "gender": "male", "language": "zh-CN", "description": "阳光青年，积极向上的男性声音"},
            {"value": "zh_female_shuangkuaisisi_moon_bigtts", "label": "爽快思思/Skye (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "爽快思思，干脆利落的女性声音"},
            {"value": "zh_female_tianmeixiaoyuan_moon_bigtts", "label": "甜美小源 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "甜美小源，甜美可爱的女性声音"},
            {"value": "zh_female_qingchezizi_moon_bigtts", "label": "清澈梓梓 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "清澈梓梓，清澈透明的女性声音"},
            {"value": "zh_male_jieshuoxiaoming_moon_bigtts", "label": "解说小明 (男声)", "category": "通用场景", "gender": "male", "language": "zh-CN", "description": "解说小明，专业的解说男声"},
            {"value": "zh_female_kailangjiejie_moon_bigtts", "label": "开朗姐姐 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "开朗姐姐，开朗活泼的女性声音"},
            {"value": "zh_male_linjiananhai_moon_bigtts", "label": "邻家男孩 (男声)", "category": "通用场景", "gender": "male", "language": "zh-CN", "description": "邻家男孩，亲切自然的男性声音"},
            {"value": "zh_female_tianmeiyueyue_moon_bigtts", "label": "甜美悦悦 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "甜美悦悦，甜美动人的女性声音"},
            {"value": "zh_female_xinlingjitang_moon_bigtts", "label": "心灵鸡汤 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "心灵鸡汤，温暖治愈的女性声音"},
            {"value": "zh_female_cancan_mars_bigtts", "label": "灿灿 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "灿灿，明亮灿烂的女性声音"},
            {"value": "zh_female_zhixingnvsheng_mars_bigtts", "label": "知性女声 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "知性女声，优雅知性的女性声音"},
            {"value": "zh_female_qingxinnvsheng_mars_bigtts", "label": "清新女声 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "清新女声，清新自然的女性声音"},
            {"value": "zh_male_qingshuangnanda_mars_bigtts", "label": "清爽男大 (男声)", "category": "通用场景", "gender": "male", "language": "zh-CN", "description": "清爽男大，清爽干净的男性声音"},
            {"value": "zh_female_tiexinnvsheng_mars_bigtts", "label": "贴心女声 (女声)", "category": "通用场景", "gender": "female", "language": "zh-CN", "description": "贴心女声，贴心温暖的女性声音"},
            {"value": "zh_female_wanqudashu_moon_bigtts", "label": "湾区大叔 (男声)", "category": "趣味方言", "gender": "male", "language": "zh-CN", "description": "湾区大叔，带有湾区特色的男性声音"},
            {"value": "zh_female_daimengchuanmei_moon_bigtts", "label": "呆萌川妹 (女声)", "category": "趣味方言", "gender": "female", "language": "zh-CN", "description": "呆萌川妹，四川方言的可爱女性声音"},
            {"value": "zh_male_guozhoudege_moon_bigtts", "label": "广州德哥 (男声)", "category": "趣味方言", "gender": "male", "language": "zh-CN", "description": "广州德哥，粤语特色的男性声音"},
            {"value": "zh_male_beijingxiaoye_moon_bigtts", "label": "北京小爷 (男声)", "category": "趣味方言", "gender": "male", "language": "zh-CN", "description": "北京小爷，京腔特色的男性声音"},
            {"value": "zh_male_haoyuxiaoge_moon_bigtts", "label": "浩宇小哥 (男声)", "category": "趣味方言", "gender": "male", "language": "zh-CN", "description": "浩宇小哥，东北口音的男性声音"},
            {"value": "zh_male_guangxiyuanzhou_moon_bigtts", "label": "广西远舟 (男声)", "category": "趣味方言", "gender": "male", "language": "zh-CN", "description": "广西远舟，广西方言的男性声音"},
            {"value": "zh_female_meituojieer_moon_bigtts", "label": "妹坨洁儿 (女声)", "category": "趣味方言", "gender": "female", "language": "zh-CN", "description": "妹坨洁儿，重庆方言的女性声音"},
            {"value": "zh_male_yuzhouzixuan_moon_bigtts", "label": "豫州子轩 (男声)", "category": "趣味方言", "gender": "male", "language": "zh-CN", "description": "豫州子轩，河南方言的男性声音"},
            {"value": "zh_male_jingqiangkanye_moon_bigtts", "label": "京腔侃爷/Harmony (男声)", "category": "趣味方言", "gender": "male", "language": "zh-CN", "description": "京腔侃爷，京味十足的男性声音"},
            {"value": "zh_female_meilinvyou_moon_bigtts", "label": "魅力女友 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "魅力女友，充满魅力的女性声音"},
            {"value": "zh_male_shenyeboke_moon_bigtts", "label": "深夜播客 (男声)", "category": "角色扮演", "gender": "male", "language": "zh-CN", "description": "深夜播客，深沉磁性的男性声音"},
            {"value": "zh_female_sajiaonvyou_moon_bigtts", "label": "柔美女友 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "柔美女友，柔美温柔的女性声音"},
            {"value": "zh_female_yuanqinvyou_moon_bigtts", "label": "撒娇学妹 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "撒娇学妹，撒娇可爱的女性声音"},
            {"value": "zh_female_gaolengyujie_moon_bigtts", "label": "高冷御姐 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "高冷御姐，高冷优雅的女性声音"},
            {"value": "zh_male_aojiaobazong_moon_bigtts", "label": "傲娇霸总 (男声)", "category": "角色扮演", "gender": "male", "language": "zh-CN", "description": "傲娇霸总，霸道总裁的男性声音"},
            {"value": "ICL_zh_female_bingruoshaonv_tob", "label": "病弱少女 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "病弱少女，柔弱娇嫩的女性声音"},
            {"value": "ICL_zh_female_huoponvhai_tob", "label": "活泼女孩 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "活泼女孩，活泼开朗的女性声音"},
            {"value": "ICL_zh_female_heainainai_tob", "label": "和蔼奶奶 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "和蔼奶奶，慈祥和蔼的老年女性声音"},
            {"value": "ICL_zh_female_linjuayi_tob", "label": "邻居阿姨 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "邻居阿姨，亲切的中年女性声音"},
            {"value": "zh_female_wenrouxiaoya_moon_bigtts", "label": "温柔小雅 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "温柔小雅，温柔优雅的女性声音"},
            {"value": "zh_male_dongfanghaoran_moon_bigtts", "label": "东方浩然 (男声)", "category": "角色扮演", "gender": "male", "language": "zh-CN", "description": "东方浩然，正气凛然的男性声音"},
            {"value": "zh_male_tiancaitongsheng_mars_bigtts", "label": "天才童声 (男声)", "category": "角色扮演", "gender": "male", "language": "zh-CN", "description": "天才童声，聪慧的儿童男性声音"},
            {"value": "zh_male_naiqimengwa_mars_bigtts", "label": "奶气萌娃 (男声)", "category": "角色扮演", "gender": "male", "language": "zh-CN", "description": "奶气萌娃，奶声奶气的儿童男性声音"},
            {"value": "zh_male_sunwukong_mars_bigtts", "label": "猴哥 (男声)", "category": "角色扮演", "gender": "male", "language": "zh-CN", "description": "猴哥，孙悟空角色的男性声音"},
            {"value": "zh_male_xionger_mars_bigtts", "label": "熊二 (男声)", "category": "角色扮演", "gender": "male", "language": "zh-CN", "description": "熊二，憨厚可爱的卡通角色声音"},
            {"value": "zh_female_peiqi_mars_bigtts", "label": "佩奇猪 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "佩奇猪，小猪佩奇的女性声音"},
            {"value": "zh_female_popo_mars_bigtts", "label": "婆婆 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "婆婆，慈祥的老年女性声音"},
            {"value": "zh_female_wuzetian_mars_bigtts", "label": "武则天 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "武则天，威严的古代女性声音"},
            {"value": "zh_female_shaoergushi_mars_bigtts", "label": "少儿故事 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "少儿故事，适合讲故事的女性声音"},
            {"value": "zh_male_silang_mars_bigtts", "label": "四郎 (男声)", "category": "角色扮演", "gender": "male", "language": "zh-CN", "description": "四郎，古代书生的男性声音"},
            {"value": "zh_female_gujie_mars_bigtts", "label": "顾姐 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "顾姐，成熟稳重的女性声音"},
            {"value": "zh_female_yingtaowanzi_mars_bigtts", "label": "樱桃丸子 (女声)", "category": "角色扮演", "gender": "female", "language": "zh-CN", "description": "樱桃丸子，可爱的动漫角色女性声音"},
            {"value": "en_female_anna_mars_bigtts", "label": "Anna (女声)", "category": "播报解说", "gender": "female", "language": "en-US", "description": "Anna，专业的英语女性播报声音"},
            {"value": "zh_male_changtianyi_mars_bigtts", "label": "悬疑解说 (男声)", "category": "播报解说", "gender": "male", "language": "zh-CN", "description": "悬疑解说，适合悬疑内容的男性声音"},
            {"value": "zh_male_jieshuonansheng_mars_bigtts", "label": "磁性解说男声 (男声)", "category": "播报解说", "gender": "male", "language": "zh-CN", "description": "磁性解说男声，磁性专业的解说声音"},
            {"value": "zh_female_jitangmeimei_mars_bigtts", "label": "鸡汤妹妹 (女声)", "category": "播报解说", "gender": "female", "language": "zh-CN", "description": "鸡汤妹妹，温暖治愈的女性解说声音"},
            {"value": "zh_male_chunhui_mars_bigtts", "label": "广告解说 (男声)", "category": "播报解说", "gender": "male", "language": "zh-CN", "description": "广告解说，专业的广告男性声音"},
            {"value": "zh_male_ruyaqingnian_mars_bigtts", "label": "儒雅青年 (男声)", "category": "有声阅读", "gender": "male", "language": "zh-CN", "description": "儒雅青年，适合阅读的儒雅男性声音"},
            {"value": "zh_male_baqiqingshu_mars_bigtts", "label": "霸气青叔 (男声)", "category": "有声阅读", "gender": "male", "language": "zh-CN", "description": "霸气青叔，有力量感的男性阅读声音"},
            {"value": "zh_male_qingcang_mars_bigtts", "label": "擎苍 (男声)", "category": "有声阅读", "gender": "male", "language": "zh-CN", "description": "擎苍，深沉有力的男性阅读声音"},
            {"value": "zh_male_yangguangqingnian_mars_bigtts", "label": "活力小哥 (男声)", "category": "有声阅读", "gender": "male", "language": "zh-CN", "description": "活力小哥，充满活力的男性阅读声音"},
        ],
        "array",
        "TTS voice list (Volcano engine voices)",
    ),

    # ── YouTube (youtube.yaml) ──
    (
        "youtube", "download",
        {
            "max_concurrent_downloads": 20,
            "download_timeout": 300,
            "max_retries": 3,
            "retry_delay": 5,
        },
        "object",
        "YouTube download configuration",
    ),
    (
        "youtube", "upload",
        {
            "upload_timeout": 600,
            "max_retries": 3,
            "retry_delay": 10,
        },
        "object",
        "YouTube upload configuration",
    ),
    (
        "youtube", "quality",
        {
            "default_video_quality": "720p",
            "default_audio_quality": "best",
            "default_format": "mp4",
        },
        "object",
        "YouTube quality configuration",
    ),
    (
        "youtube", "file_management",
        {
            "auto_cleanup": True,
            "temp_file_retention_hours": 24,
            "generate_thumbnail": True,
        },
        "object",
        "YouTube file management configuration",
    ),
    (
        "youtube", "logging",
        {
            "enable_detailed_logging": True,
            "log_download_progress": True,
            "progress_log_interval": 10,
        },
        "object",
        "YouTube logging configuration",
    ),

    # ── Upload (upload-config.yaml) ──
    (
        "upload", "concurrent_upload",
        {
            "max_concurrent_uploads": 3,
            "max_queue_size": 0,
            "upload_timeout": 300,
            "enable_queue": True,
        },
        "object",
        "Concurrent upload settings",
    ),
    (
        "upload", "file_size_limits",
        {
            "max_video_size_mb": 500,
            "max_audio_size_mb": 100,
            "max_image_size_mb": 50,
        },
        "object",
        "File size limits",
    ),
    (
        "upload", "retry",
        {
            "max_retries": 3,
            "retry_delay": 5,
            "exponential_backoff": True,
        },
        "object",
        "Upload retry configuration",
    ),
    (
        "upload", "thumbnail",
        {
            "auto_generate_video_thumbnail": True,
            "thumbnail_quality": 2,
            "thumbnail_max_width": 320,
            "thumbnail_max_height": 180,
        },
        "object",
        "Thumbnail generation configuration",
    ),
    (
        "upload", "temp_file_management",
        {
            "auto_cleanup": True,
            "temp_file_retention_hours": 24,
            "temp_file_directory": "temp",
        },
        "object",
        "Temporary file management configuration",
    ),
    (
        "upload", "logging",
        {
            "enable_detailed_logging": True,
            "log_upload_progress": True,
            "progress_log_interval": 10,
            "log_upload_statistics": True,
        },
        "object",
        "Upload logging configuration",
    ),

    # ── Watermark (watermark_removal_config.yaml) ──
    (
        "watermark", "removal",
        {
            "concurrent_threads": 5,
            "max_concurrent_threads": 10,
            "batch_size": 50,
            "batch_timeout": 60,
        },
        "object",
        "Watermark removal processing configuration",
    ),
    (
        "watermark", "logging",
        {
            "enable_detailed_logs": True,
            "log_progress_interval": 100,
            "log_level": "INFO",
            "enable_thread_logging": True,
        },
        "object",
        "Watermark removal logging configuration",
    ),

    # ── Video Analysis (video-analysis-config.yaml) ──
    (
        "video_analysis", "queue_management",
        {
            "queue_name": "video_analysis",
            "max_concurrent": 2,
            "enable_for_single_analysis": True,
        },
        "object",
        "Video analysis queue management configuration",
    ),
    (
        "video_analysis", "vlm_processing",
        {
            "concurrent_threads": 3,
            "api_timeout": 30,
            "max_retries": 2,
        },
        "object",
        "VLM processing configuration",
    ),
    (
        "video_analysis", "frame_extraction",
        {
            "default_frame_interval_seconds": 5,
            "max_frames_per_video": 5,
            "duration_based_strategy": {
                "short_videos": {
                    "duration_threshold_seconds": 60,
                    "frame_interval_seconds": 3,
                    "max_frames": 5,
                },
                "medium_videos": {
                    "duration_threshold_seconds": 300,
                    "frame_interval_seconds": 10,
                    "max_frames": 5,
                },
                "long_videos": {
                    "frame_interval_seconds": 30,
                    "max_frames": 5,
                },
            },
            "supported_formats": ["mp4", "avi", "mov", "mkv", "webm", "flv"],
        },
        "object",
        "Frame extraction configuration with duration-based strategy",
    ),
    (
        "video_analysis", "performance",
        {
            "enable_performance_logging": True,
            "log_concurrent_stats": True,
            "max_video_duration_seconds": 3600,
        },
        "object",
        "Video analysis performance configuration",
    ),
    (
        "video_analysis", "temp_files",
        {
            "video_download_dir": "video_analysis",
            "frames_dir_prefix": "frames_",
            "auto_cleanup": True,
            "cleanup_timeout": 300,
        },
        "object",
        "Video analysis temporary file configuration",
    ),
    (
        "video_analysis", "logging",
        {
            "log_level": "INFO",
            "log_analysis_content": False,
            "log_base64_content": False,
            "log_frame_processing_time": True,
        },
        "object",
        "Video analysis logging configuration",
    ),
]


def upgrade() -> None:
    """Seed default settings using raw SQL with ON CONFLICT DO NOTHING for idempotency."""
    conn = op.get_bind()

    for category, key, value, value_type, description in DEFAULT_SETTINGS:
        import json
        value_json = json.dumps(value)
        conn.execute(
            sa.text(
                """
                INSERT INTO system_settings (id, category, key, value, default_value, value_type, description)
                VALUES (gen_random_uuid(), :category, :key, :value::jsonb, :default_value::jsonb, :value_type, :description)
                ON CONFLICT ON CONSTRAINT uq_system_settings_category_key DO NOTHING
                """
            ),
            {
                "category": category,
                "key": key,
                "value": value_json,
                "default_value": value_json,
                "value_type": value_type,
                "description": description,
            },
        )


def downgrade() -> None:
    """Remove all seeded default settings."""
    op.execute("DELETE FROM system_settings")
