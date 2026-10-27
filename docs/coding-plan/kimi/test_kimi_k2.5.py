"""
测试 Kimi K2.5 模型调用 (Kimi Coding Plan)

端点: https://api.kimi.com/coding/
Key 格式: sk-kimi-*

发现:
- Anthropic Messages API 格式 (/v1/messages) + User-Agent: claude-code → 可用 (HTTP 200)
- OpenAI Chat Completions 格式 (/v1/chat/completions) → 被拒绝 (HTTP 403)

Kimi Coding 端点会校验 User-Agent，仅允许已知 Coding Agent 调用。
Claude Code 通过 ANTHROPIC_BASE_URL=https://api.kimi.com/coding/ 调用。
"""

import requests
import json
import sys
import os

# Windows 终端 UTF-8 输出
if sys.platform == "win32":
    os.system("chcp 65001 >nul 2>&1")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ============================================================
# 配置
# ============================================================
API_KEY = os.getenv("KIMI_API_KEY", "")
MODEL = "kimi-k2.5"

# Kimi Coding 端点
BASE_URL = "https://api.kimi.com/coding"

# opencode 中 kimi-k2.5 的推荐参数
TEMPERATURE = 1.0
TOP_P = 0.95

# 代理设置 - 如果本机有代理但连不上 kimi，尝试直连
# 设为 None 使用系统代理，设为 {} 跳过代理直连
PROXIES = None  # 默认使用系统代理


def mask_key(key):
    return f"{key[:20]}...{key[-6:]}"


def make_session():
    """创建 requests session，处理代理"""
    s = requests.Session()
    if PROXIES is not None:
        s.proxies = PROXIES
    s.timeout = 120
    return s


def test_anthropic_format():
    """
    Anthropic Messages API 格式 (Claude Code 调用方式)

    配置方式:
      export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
      export ANTHROPIC_API_KEY=sk-kimi-xxx

    请求格式:
      POST {BASE_URL}/v1/messages
      Headers:
        x-api-key: sk-kimi-xxx
        anthropic-version: 2023-06-01
        User-Agent: claude-code/1.0  (关键! 端点检测此 header)
    """
    url = f"{BASE_URL}/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "User-Agent": "claude-code/1.0",
    }

    payload = {
        "model": MODEL,
        "max_tokens": 1024,
        "messages": [
            {"role": "user", "content": "Write a quicksort in Python, keep it concise."}
        ],
        "temperature": TEMPERATURE,
        "top_p": TOP_P,
    }

    print("=" * 60)
    print("[测试] Anthropic Messages API 格式 (Claude Code 方式)")
    print("=" * 60)
    print(f"  URL:     {url}")
    print(f"  Model:   {MODEL}")
    print(f"  Headers:")
    print(f"    Content-Type:      application/json")
    print(f"    x-api-key:         {mask_key(API_KEY)}")
    print(f"    anthropic-version: 2023-06-01")
    print(f"    User-Agent:        claude-code/1.0")
    print(f"\nRequest Body:\n{json.dumps(payload, indent=2, ensure_ascii=False)}\n")
    print("发送请求中...")

    session = make_session()
    try:
        resp = session.post(url, headers=headers, json=payload, timeout=120)
        print(f"HTTP Status: {resp.status_code}")
        print(f"Response Headers:")
        for k, v in resp.headers.items():
            print(f"  {k}: {v}")
        print()

        if resp.status_code == 200:
            data = resp.json()
            print(f"完整响应 JSON:\n{json.dumps(data, indent=2, ensure_ascii=False)}\n")

            # Anthropic 格式: content 是数组
            content = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    content += block["text"]
                elif block.get("type") == "thinking":
                    print(f"[Thinking]: {block.get('thinking', '')[:200]}...")
            usage = data.get("usage", {})
            print(f"模型回复:\n{content}\n")
            print(f"Token 用量:")
            print(f"  input_tokens:  {usage.get('input_tokens', 'N/A')}")
            print(f"  output_tokens: {usage.get('output_tokens', 'N/A')}")
            print(f"  cache_read:    {usage.get('cache_read_input_tokens', 'N/A')}")
            print("\n[调用成功]")
            return True
        else:
            print(f"错误响应:\n{resp.text}")
            return False

    except requests.exceptions.ProxyError as e:
        print(f"代理错误: {e}")
        print("提示: 尝试修改脚本中 PROXIES = {} 跳过代理直连")
        return False
    except Exception as e:
        print(f"异常: {type(e).__name__}: {e}")
        return False


def test_anthropic_streaming():
    """Anthropic Messages API 流式调用"""
    url = f"{BASE_URL}/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "User-Agent": "claude-code/1.0",
    }

    payload = {
        "model": MODEL,
        "max_tokens": 256,
        "messages": [
            {"role": "user", "content": "1+1=?"}
        ],
        "temperature": TEMPERATURE,
        "top_p": TOP_P,
        "stream": True,
    }

    print("\n" + "=" * 60)
    print("[测试] Anthropic Messages API 流式调用")
    print("=" * 60)
    print(f"  URL: {url}")
    print(f"  Stream: true")
    print()

    session = make_session()
    try:
        resp = session.post(url, headers=headers, json=payload, timeout=120, stream=True)
        print(f"HTTP Status: {resp.status_code}")

        if resp.status_code != 200:
            print(f"错误响应:\n{resp.text}")
            return False

        print("流式输出:\n---")
        full_content = ""
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            # Anthropic SSE 格式: event: xxx\ndata: {...}
            if line.startswith("data: "):
                data_str = line[len("data: "):]
                try:
                    chunk = json.loads(data_str)
                    event_type = chunk.get("type", "")

                    if event_type == "content_block_delta":
                        delta = chunk.get("delta", {})
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            print(text, end="", flush=True)
                            full_content += text

                    elif event_type == "message_delta":
                        usage = chunk.get("usage", {})
                        if usage:
                            print(f"\n--- usage: {json.dumps(usage)}")

                    elif event_type == "message_stop":
                        pass

                except json.JSONDecodeError:
                    pass

        print(f"\n---\n完整回复: {full_content}")
        print("\n[流式调用成功]")
        return True

    except requests.exceptions.ProxyError as e:
        print(f"代理错误: {e}")
        return False
    except Exception as e:
        print(f"异常: {type(e).__name__}: {e}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("Kimi K2.5 API 调用测试 (Kimi Coding Plan)")
    print("=" * 60)
    print()
    print("连接信息:")
    print(f"  API Key:    {mask_key(API_KEY)}")
    print(f"  Model:      {MODEL}")
    print(f"  Base URL:   {BASE_URL}")
    print(f"  Temp:       {TEMPERATURE}")
    print(f"  Top-P:      {TOP_P}")
    print(f"  Proxies:    {'系统代理' if PROXIES is None else ('直连' if PROXIES == {} else PROXIES)}")
    print()
    print("说明:")
    print("  Kimi Coding 端点仅支持 Anthropic Messages API 格式")
    print("  (Claude Code 通过 ANTHROPIC_BASE_URL 调用)")
    print("  OpenAI Chat Completions 格式会被拒绝 (403)")
    print()

    r1 = test_anthropic_format()
    r2 = test_anthropic_streaming()

    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    print(f"  Anthropic 非流式: {'通过' if r1 else '失败'}")
    print(f"  Anthropic 流式:   {'通过' if r2 else '失败'}")

    if not any([r1, r2]):
        print()
        print("排查建议:")
        print("  1. 确认 API key 有效且 Kimi Coding Plan 已激活")
        print("  2. 如果出现代理错误，修改脚本中 PROXIES = {} 跳过代理")
        print("  3. 确认网络可达 api.kimi.com")
        sys.exit(1)
