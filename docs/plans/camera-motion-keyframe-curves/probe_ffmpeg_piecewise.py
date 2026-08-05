"""Probe FFmpeg expression features a multi-keyframe camera design depends on.

Every claim the spec makes about FFmpeg must be measured, not assumed
(the iteration-1/2 review nodes rejected unverified FFmpeg claims).
"""
import subprocess, time, sys

FF = "ffmpeg"


def run(vf, dur="0.5", size="320x180", extra=None):
    cmd = [FF, "-hide_banner", "-loglevel", "error",
           "-f", "lavfi", "-i", f"testsrc=size={size}:rate=30:d={dur}",
           "-vf", vf, "-f", "null", "-"]
    if extra:
        cmd[1:1] = extra
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    dt = time.time() - t0
    err = (p.stderr or "").strip()
    return p.returncode, err.splitlines()[0] if err else "", dt


def report(name, vf, **kw):
    rc, err, dt = run(vf, **kw)
    ok = rc == 0 and not err
    print(f"[{'OK ' if ok else 'FAIL'}] {name}  rc={rc} {dt:.2f}s  len(vf)={len(vf)}")
    if not ok:
        print(f"        -> {err[:300]}")
    return ok


# U = linear progress over a 0..3s window at 30fps, per-filter frame var.
def U(var):
    return f"clip(({var}/30-0)/3,0,1)"


def ease_inout(u):
    return f"if(lt({u},0.5),4*pow({u},3),1-pow(2-2*{u},3)/2)"


# ---------------------------------------------------------------- 1. baseline
print("=== 1. Today's shipped shapes (control) ===")
e = ease_inout(U("on"))
z = f"clip(1+(0.5)*({e}),1,8)"
report("zoompan 2-kf (current shape)",
       f"setpts=PTS-STARTPTS,fps=30,scale=320:180:flags=bicubic,"
       f"zoompan=z='{z}':x='clip((0.5)*iw*({z})-ow/2,0,iw*({z})-ow)'"
       f":y='clip((0.5)*ih*({z})-oh/2,0,ih*({z})-oh)':d=1:fps=30:s=320x180")

# ------------------------------------------------- 2. nested-if piecewise (N kf)
print("\n=== 2. Nested-if piecewise in U (multi-keyframe) ===")


def piecewise(uexpr, stops):
    """stops = [(at, value), ...]; build nested if over segments."""
    def seg(i):
        a0, v0 = stops[i]
        a1, v1 = stops[i + 1]
        ul = f"clip(({uexpr}-{a0})/{a1 - a0},0,1)"
        el = ease_inout(ul)
        return f"({v0}+({v1 - v0})*({el}))"
    expr = seg(len(stops) - 2)
    for i in range(len(stops) - 3, -1, -1):
        expr = f"if(lt({uexpr},{stops[i + 1][0]}),{seg(i)},{expr})"
    return expr


for n in (3, 5, 8, 12):
    stops = [(round(i / (n - 1), 6), 1.0 + 0.25 * (i % 3)) for i in range(n)]
    zp = piecewise(U("on"), stops)
    zc = f"clip({zp},1,8)"
    vf = (f"setpts=PTS-STARTPTS,fps=30,scale=320:180:flags=bicubic,"
          f"zoompan=z='{zc}':x='clip((0.5)*iw*({zc})-ow/2,0,iw*({zc})-ow)'"
          f":y='clip((0.5)*ih*({zc})-oh/2,0,ih*({zc})-oh)':d=1:fps=30:s=320x180")
    report(f"zoompan piecewise n={n} keyframes", vf)

# ------------------------------------------------------------ 3. st()/ld() vars
print("\n=== 3. st()/ld() expression variables (hoisting U) ===")
report("zoompan with st/ld",
       f"setpts=PTS-STARTPTS,fps=30,scale=320:180:flags=bicubic,"
       f"zoompan=z='st(0,{U('on')});clip(1+0.5*ld(0),1,8)':d=1:fps=30:s=320x180")
report("zoompan with st/ld comma-sequence",
       f"setpts=PTS-STARTPTS,fps=30,scale=320:180:flags=bicubic,"
       f"zoompan=z='st(0\\,{U('on')})+0*ld(0)':d=1:fps=30:s=320x180")

# --------------------------------------------------------------- 4. rotate/roll
print("\n=== 4. rotate piecewise (roll; uses n, NOT on) ===")
stops = [(round(i / 4, 6), (-1) ** i * 10.0) for i in range(5)]
rp = piecewise(U("n"), stops)
report("rotate piecewise n=5",
       f"setpts=PTS-STARTPTS,fps=30,scale=320:180:flags=bicubic,"
       f"rotate=a='({rp})*PI/180':c=black:ow=iw:oh=ih,"
       f"crop=iw/1.4:ih/1.4:(iw-iw/1.4)/2:(ih-ih/1.4)/2,scale=320:180:flags=bicubic")

# ------------------------------------------------------- 5. perspective long fit
print("\n=== 5. perspective with a long piecewise corner expr ===")
parts = []
for idx, (kx, ky) in enumerate([("x0", "y0"), ("x1", "y1"), ("x2", "y2"), ("x3", "y3")]):
    sx = [(round(i / 4, 6), 10.0 * i + idx) for i in range(5)]
    sy = [(round(i / 4, 6), 5.0 * i + idx) for i in range(5)]
    parts.append(f"{kx}='{piecewise(U('on'), sx)}'")
    parts.append(f"{ky}='{piecewise(U('on'), sy)}'")
report("perspective piecewise n=5 all 8 corners",
       f"setpts=PTS-STARTPTS,fps=30,scale=320:180:flags=bicubic,"
       + "perspective=" + ":".join(parts) + ":sense=destination:eval=frame:interpolation=linear")

# ------------------------------------------------------------------ 6. 3-arg if
print("\n=== 6. between()/lt() forms + expression length ceiling ===")
huge = piecewise(U("on"), [(round(i / 31, 6), 1.0 + (i % 4) * 0.2) for i in range(32)])
print(f"    32-keyframe expr length = {len(huge)} chars")
report("zoompan piecewise n=32 (length stress)",
       f"setpts=PTS-STARTPTS,fps=30,scale=320:180:flags=bicubic,"
       f"zoompan=z='clip({huge},1,8)':d=1:fps=30:s=320x180")

print("\n=== 7. Timing: 1080p 3s, 2-kf vs 8-kf piecewise ===")
for label, n in (("2kf", 2), ("8kf", 8)):
    stops = [(round(i / (n - 1), 6), 1.0 + 0.3 * (i % 3)) for i in range(n)]
    zc = f"clip({piecewise(U('on'), stops)},1,8)"
    vf = (f"setpts=PTS-STARTPTS,fps=30,scale=1920:1080:flags=bicubic,"
          f"zoompan=z='{zc}':x='clip((0.5)*iw*({zc})-ow/2,0,iw*({zc})-ow)'"
          f":y='clip((0.5)*ih*({zc})-oh/2,0,ih*({zc})-oh)':d=1:fps=30:s=1920x1080")
    rc, err, dt = run(vf, dur="3", size="1920x1080")
    print(f"    {label}: rc={rc} {dt:.2f}s exprlen={len(zc)} {err[:120]}")
