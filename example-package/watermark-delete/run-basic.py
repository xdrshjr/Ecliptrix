import cv2
import numpy as np


def main():
    # --- 参数设置 ---
    # 输入和输出文件路径
    input_video_path = './videos/videoplayback.mp4'
    output_video_path = './videos/output_video_no_watermark.mp4'
    final_output_path = './videos/final_video_with_audio.mp4'

    # 水印区域坐标 (x1, y1, x2, y2)
    watermark_x1, watermark_y1 = 10, 10
    watermark_x2, watermark_y2 = 300, 250

    # 修复算法参数
    inpaint_radius = 5
    inpaint_method = cv2.INPAINT_TELEA  # 可选择 cv2.INPAINT_NS

    # --- 1. 打开视频文件 ---
    cap = cv2.VideoCapture(input_video_path)

    if not cap.isOpened():
        print("错误：无法打开视频文件")
        return

    # --- 2. 获取视频属性 ---
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"视频信息：{frame_width}x{frame_height}, {fps:.2f}fps, 总帧数：{total_frames}")

    # --- 3. 设置视频编码器并创建VideoWriter对象 ---
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_video_path, fourcc, fps, (frame_width, frame_height))

    # --- 4. 创建水印区域的蒙版 ---
    mask = np.zeros((frame_height, frame_width), dtype=np.uint8)
    mask[watermark_y1:watermark_y2, watermark_x1:watermark_x2] = 255

    print(f"开始处理视频，水印区域：({watermark_x1},{watermark_y1}) 到 ({watermark_x2},{watermark_y2})")

    # --- 5. 逐帧处理视频 ---
    frame_count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break  # 视频读取完毕

        frame_count += 1

        # 应用修复算法去除水印
        processed_frame = cv2.inpaint(frame, mask, inpaint_radius, inpaint_method)

        # 写入处理后的帧
        out.write(processed_frame)

        # 显示进度
        if frame_count % 100 == 0:
            progress = (frame_count / total_frames) * 100
            print(f"处理进度：{frame_count}/{total_frames} ({progress:.1f}%)")

    # --- 6. 释放资源 ---
    cap.release()
    out.release()
    cv2.destroyAllWindows()

    print(f"视频处理完成！已保存为：{output_video_path}")
    print("注意：输出的视频不包含音频。")

    # --- 7. 使用 MoviePy 合并音频 ---
    try:
        from moviepy.editor import VideoFileClip

        print("\n正在合并音频...")

        # 加载原视频和处理后的视频
        original_video = VideoFileClip(input_video_path)
        processed_video = VideoFileClip(output_video_path)

        # 将原视频的音轨赋给新视频
        if original_video.audio is not None:
            final_video = processed_video.set_audio(original_video.audio)
            final_video.write_videofile(final_output_path, codec='libx264', audio_codec='aac')
            print(f"带有音频的最终视频已保存为：{final_output_path}")

            # 清理资源
            original_video.close()
            processed_video.close()
            final_video.close()
        else:
            print("原视频没有音轨，跳过音频合并步骤。")
            original_video.close()
            processed_video.close()

    except ImportError:
        print("\nMoviePy库未安装。")
        print("要自动合并音频，请运行：pip install moviepy")
    except Exception as e:
        print(f"\n音频合并过程中出现错误：{e}")


if __name__ == "__main__":
    main()