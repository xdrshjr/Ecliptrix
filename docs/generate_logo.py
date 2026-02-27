"""
Ecliptrix Logo Generator — Liminal Flux design philosophy  (v2 refined)
Circular flat logo, transparent background, 512x512 PNG
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

FONT_DIR = "C:/Users/Administrator/.claude/skills/canvas-design/canvas-fonts/"
OUT_PATH = "G:/projects/takoAI/Ecliptrix/public/logo.png"

SIZE = 512
CX, CY = SIZE // 2, SIZE // 2

# ── Palette ──────────────────────────────────────────────────────────────────
SPACE_BG    = (11, 13, 24, 255)
SOLAR_GOLD  = (251, 191, 36, 255)
MOON_BODY   = (22, 20, 58, 255)
TEXT_WHITE  = (255, 255, 255, 255)
TEXT_DIM    = (148, 132, 212, 200)

# ── Pass 1: blurred glow layer ────────────────────────────────────────────────
glow_layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow_layer)

EC_Y   = CY - 34
R_SUN  = 74
SUN_X  = CX - 20
MOON_X = CX + 38

# Soft solar glow — large ellipse, very transparent, blurred after
gd.ellipse(
    [SUN_X - R_SUN - 30, EC_Y - R_SUN - 30,
     SUN_X + R_SUN + 30, EC_Y + R_SUN + 30],
    fill=(251, 191, 36, 50)
)
glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=18))

# Soft violet glow around moon
glow2 = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
gd2 = ImageDraw.Draw(glow2)
gd2.ellipse(
    [MOON_X - R_SUN - 22, EC_Y - R_SUN - 22,
     MOON_X + R_SUN + 22, EC_Y + R_SUN + 22],
    fill=(80, 70, 200, 60)
)
glow2 = glow2.filter(ImageFilter.GaussianBlur(radius=16))

# ── Pass 2: crisp elements ────────────────────────────────────────────────────
crisp = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(crisp)

# Badge circle
R = 228
draw.ellipse([CX-R, CY-R, CX+R, CY+R], fill=SPACE_BG)

# Outer ring — barely-visible electric violet
draw.ellipse([CX-R,   CY-R,   CX+R,   CY+R],   outline=(99, 102, 241, 40), width=2)
draw.ellipse([CX-R+4, CY-R+4, CX+R-4, CY+R-4], outline=(99, 102, 241, 15), width=1)

# Subtle star field — 5 pinprick dots inside the badge
stars = [
    (CX - 110, CY - 90,  2),
    (CX + 130, CY - 120, 1),
    (CX - 145, CY + 50,  1),
    (CX + 100, CY + 85,  2),
    (CX - 60,  CY + 140, 1),
]
for sx, sy, sr in stars:
    # Only draw if inside badge
    if math.hypot(sx - CX, sy - CY) < R - 10:
        draw.ellipse([sx-sr, sy-sr, sx+sr, sy+sr], fill=(255, 255, 255, 60))

# Sun — solar gold
draw.ellipse(
    [SUN_X-R_SUN, EC_Y-R_SUN, SUN_X+R_SUN, EC_Y+R_SUN],
    fill=SOLAR_GOLD
)

# Moon shadow — deep indigo, same layer as crisp
draw.ellipse(
    [MOON_X-R_SUN, EC_Y-R_SUN, MOON_X+R_SUN, EC_Y+R_SUN],
    fill=MOON_BODY
)

# Moon outline — electric violet, clean 2px ring
draw.ellipse(
    [MOON_X-R_SUN,   EC_Y-R_SUN,   MOON_X+R_SUN,   EC_Y+R_SUN],
    outline=(99, 102, 241, 180), width=2
)

# Crisp corona arc — single arc on sun's exposed crescent edge
# The exposed crescent spans roughly 148°–352° as seen from sun center
draw.arc(
    [SUN_X - R_SUN - 5, EC_Y - R_SUN - 5,
     SUN_X + R_SUN + 5, EC_Y + R_SUN + 5],
    start=148, end=352,
    fill=(251, 191, 36, 200), width=2
)

# ── Typography ────────────────────────────────────────────────────────────────
try:
    font_name = ImageFont.truetype(FONT_DIR + "BricolageGrotesque-Bold.ttf", 48)
    font_tag  = ImageFont.truetype(FONT_DIR + "Jura-Light.ttf", 14)

    NAME = "ECLIPTRIX"
    bbox = draw.textbbox((0, 0), NAME, font=font_name)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = CX - tw // 2
    ty = EC_Y + R_SUN + 32
    draw.text((tx, ty), NAME, fill=TEXT_WHITE, font=font_name)

    TAG = "L I G H T  ·  S H A D O W  ·  C R E A T I O N"
    tbbox = draw.textbbox((0, 0), TAG, font=font_tag)
    ttw = tbbox[2] - tbbox[0]
    draw.text((CX - ttw // 2, ty + th + 12), TAG, fill=TEXT_DIM, font=font_tag)

except Exception as e:
    print(f"[Font error] {e}")

# ── Composite: glow → badge → glow2 → crisp elements ────────────────────────
# Start from transparent
canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))

# 1. Solar glow behind badge
canvas = Image.alpha_composite(canvas, glow_layer)

# 2. Badge background (cuts out glow outside circle naturally via alpha)
canvas = Image.alpha_composite(canvas, crisp)

# 3. Violet glow over badge (within circle only)
canvas = Image.alpha_composite(canvas, glow2)

# 4. Re-composite crisp on top (so crisp elements are always sharp above glow)
canvas = Image.alpha_composite(canvas, crisp)

canvas.save(OUT_PATH, format='PNG')
print(f"Logo saved → {OUT_PATH}")

check = Image.open(OUT_PATH)
print(f"  Size: {check.size}, Mode: {check.mode}")
