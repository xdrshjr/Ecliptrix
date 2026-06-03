"""
Minimal, dependency-free reproduction for the subtitle "no auto-wrap / overflow" bug.

It copies the EXACT character-budget math from
  backend-services/basic-service/app/services/subtitle_service.py
    -> SubtitleService._calculate_max_line_width(...)
and then estimates the rendered pixel width of a CJK (full-width) subtitle line
that uses that budget.

CJK ideographs render at ~1.0 em advance (font_size px) in Noto Sans CJK /
WenQuanYi (the fonts installed by the round-1 fix). The backend budget, however,
assumes 0.6 em (landscape/square) or 0.8 em (portrait) per character — calibrated
for narrow Latin glyphs. The result: the allowed line is far wider than the frame,
so a long Chinese line is never split and overflows the video width.

Run:  python repro_wrap_overflow.py
"""


def calc_max_line_width(video_width, font_size, margin_horizontal, video_height):
    """Verbatim port of SubtitleService._calculate_max_line_width (subtitle_service.py:141)."""
    available_width = video_width - (2 * margin_horizontal)

    if video_height is not None:
        aspect_ratio = video_width / video_height
        if aspect_ratio < 1.0:  # portrait
            char_width = font_size * 0.8
            base_max_chars = int(available_width / char_width)
            if font_size >= 100:
                max_chars = min(base_max_chars, 10)
            elif font_size >= 72:
                max_chars = min(base_max_chars, 12)
            elif font_size >= 50:
                max_chars = min(base_max_chars, 18)
            elif font_size >= 30:
                max_chars = min(base_max_chars, 25)
            else:
                max_chars = min(base_max_chars, 35)
        elif aspect_ratio < 1.5:  # near-square
            char_width = font_size * 0.6
            max_chars = int(available_width / char_width * 0.8)
        else:  # landscape
            char_width = font_size * 0.6
            max_chars = int(available_width / char_width)

    if video_height and video_width / video_height < 1.0:
        min_chars = 2
    else:
        min_chars = 20

    max_chars = max(min_chars, min(max_chars, 100))
    return max_chars, available_width


# Full-width CJK advance ~= 1.0 * font_size (em) for Noto Sans CJK / WenQuanYi.
CJK_EM = 1.0

CASES = [
    (1920, 1080, "16:9 landscape"),
    (1280, 720, "16:9 landscape"),
    (1080, 1080, "1:1 square"),
    (1080, 1920, "9:16 portrait"),
    (720, 1280, "9:16 portrait"),
]

if __name__ == "__main__":
    print("=== Chinese subtitle line width vs frame, using the backend's own char budget ===")
    print(f"{'aspect':16s} {'WxH':>10s} {'fs':>3s}  {'max_chars':>9s}  {'est_line_px':>11s}  "
          f"{'avail_px':>8s}  {'frame_px':>8s}  verdict")
    for (w, h, label) in CASES:
        for fs in (24, 40, 72):
            mc, avail = calc_max_line_width(w, fs, 50, h)
            line_px = mc * fs * CJK_EM
            verdict = "OK"
            if line_px > w:
                verdict = "EXCEEDS FULL FRAME"
            elif line_px > avail:
                verdict = "overflows margin"
            print(f"{label:16s} {w}x{h:>4d} {fs:3d}  {mc:9d}  {line_px:11.0f}  "
                  f"{avail:8d}  {w:8d}  {verdict}")
    print()
    print("Interpretation: any pure-Chinese line up to 'max_chars' characters is NOT wrapped.")
    print("Because est_line_px > frame_px in every landscape/square row, such lines overflow")
    print("the video width. x=(w-text_w)/2 then goes negative, so text spills off both edges.")
