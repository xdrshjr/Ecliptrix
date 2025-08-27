#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简化版字幕合成脚本
"""

import os
import re
from moviepy import *


def simple_typewriter_subtitle():
    """简化版打字机字幕合成"""

    # 文件路径
    base_path = "backend-services/basic-service/tests/subtitle-style-compose/materials"
    video_path = os.path.join(base_path, "horizontal-video.mp4")
    subtitle_path = os.path.join(base_path, "basic-subtitle.srt")
    output_path = os.path.join(base_path, "simple_typewriter_output.mp4")

    try:
        print("🎬 加载视频...")
        video = VideoFileClip(video_path)

        print("📝 读取字幕...")
        with open(subtitle_path, 'r', encoding='utf-8') as f:
            srt_content = f.read()

        # 简单解析第一条字幕作为示例
        lines = srt_content.strip().split('\n')
        if len(lines) >= 4:
            time_line = lines[1]
            text_line = lines[2]

            # 解析时间
            times = time_line.split(' --> ')
            start_time = times[0].replace(',', '.')
            end_time = times[1].replace(',', '.')

            def time_to_seconds(time_str):
                h, m, s = time_str.split(':')
                return int(h) * 3600 + int(m) * 60 + float(s)

            start_sec = time_to_seconds(start_time)
            end_sec = time_to_seconds(end_time)
            duration = end_sec - start_sec

            print(f"📄 字幕内容: {text_line}")
            print(f"⏰ 时间: {start_sec}s - {end_sec}s")

            # 创建打字机效果字幕
            def make_textclip(txt):
                return TextClip(
                    txt,
                    fontsize=45,
                    color='white',
                    font='Arial-Bold',
                    stroke_color='black',
                    stroke_width=2
                ).set_position(('center', 'bottom')).set_margin(40)

            # 创建逐字显示的片段
            subtitle_clips = []
            text = text_line.strip()
            char_duration = duration / len(text) if len(text) > 0 else 0.1

            for i in range(1, len(text) + 1):
                partial_text = text[:i]
                clip = make_textclip(partial_text)
                clip = clip.set_start(start_sec + (i - 1) * char_duration).set_duration(char_duration)
                subtitle_clips.append(clip)

            print("🔧 合成视频...")
            final_video = CompositeVideoClip([video] + subtitle_clips)

            print("💾 导出视频...")
            final_video.write_videofile(
                output_path,
                codec='libx264',
                fps=24,
                verbose=False,
                logger=None
            )

            print(f"✅ 完成！输出文件: {output_path}")

        else:
            print("❌ 字幕文件格式不正确")

    except Exception as e:
        print(f"❌ 错误: {e}")


if __name__ == "__main__":
    simple_typewriter_subtitle()
