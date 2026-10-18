"""分析沙箱的注入前导源码字符串。

spec §3.4 R-31：`-I` 模式与 embeddable 的 `python311._pth` 都不保证脚本目录在
`sys.path` 里，所以这段源码**必须内联拼接**进同一个临时脚本，不能
`import analysis_prelude`。
"""

PRELUDE = r'''
def _install_helpers(OUT, IN):
    """在闭包里构造 helper，只把公开名字交回脚本全局。

    为什么不是一个平铺的模块级 `import os as _os`：前导与用户代码共用同一个
    模块命名空间（`analysis_sandbox.build_script` 拼接），平铺会把 `_os` 暴露给
    用户代码 —— `_os.system(...)` 不受 `validate_code` 的 `import os` 规则约束，
    等于绕开整张 AST 白名单（spec §10 R1）。闭包让 `_os` 只存在于 `__closure__`
    里，而任何 `_` 开头的属性访问都会被 `validate_code` 拒绝。
    """
    import json as _json
    import os as _os
    import re as _re

    _FILE_NAME = _re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

    def _checked(base, name):
        if not isinstance(name, str) or not _FILE_NAME.match(name):
            raise ValueError("invalid output file name: %r" % (name,))
        target = _os.path.realpath(_os.path.join(base, name))
        root = _os.path.realpath(base)
        if _os.path.commonpath([root, target]) != root:
            raise ValueError("output escapes the sandbox directory")
        return target

    def write_text(name, text):
        """写入 UTF-8 文本产物到 OUT。"""
        target = _checked(OUT, name)
        with open(target, "w", encoding="utf-8", newline="") as handle:
            handle.write("" if text is None else str(text))
        return target

    def write_json(name, obj):
        """写入 JSON 产物到 OUT。"""
        return write_text(name, _json.dumps(obj, ensure_ascii=False, indent=2))

    def write_csv(name, rows):
        """把二维序列写成 CSV（无需 import csv）。"""
        def cell(value):
            text = "" if value is None else str(value)
            if any(char in text for char in ',"\n\r'):
                return '"' + text.replace('"', '""') + '"'
            return text
        body = "\n".join(",".join(cell(c) for c in row) for row in rows)
        return write_text(name, body + ("\n" if body else ""))

    def write_svg(name, body):
        """写入 SVG 产物（可直接导入素材库当图片用）。"""
        text = body if "xmlns=" in str(body) else (
            '<svg xmlns="http://www.w3.org/2000/svg" '
            'width="1920" height="1080" viewBox="0 0 1920 1080">'
            + str(body) + "</svg>"
        )
        return write_text(name, text)

    def read_text(name, limit=4 * 1024 * 1024):
        """读取工作区 files/ 内的只读文本（超限截断）。"""
        target = _checked(IN, name)
        with open(target, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read(limit)

    return {
        "write_text": write_text,
        "write_json": write_json,
        "write_csv": write_csv,
        "write_svg": write_svg,
        "read_text": read_text,
    }


globals().update(_install_helpers(OUT, IN))
del _install_helpers
'''.lstrip('\n')
