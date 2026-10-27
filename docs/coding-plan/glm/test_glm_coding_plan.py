"""
测试 GLM Coding Plan 接口调用 (glm-5.1 / glm-5-turbo)

发现:
  - OpenAI Chat Completions 格式 (/chat/completions)
    端点: https://open.bigmodel.cn/api/coding/paas/v4
    认证: Authorization: Bearer {ZHIPU_API_KEY}
    → opencode 中 zhipuai-coding-plan 使用此方式 (npm: @ai-sdk/openai-compatible)

  - Anthropic Messages API 格式 (/v1/messages)
    端点: https://open.bigmodel.cn/api/coding/
    认证: x-api-key: {ZHIPU_API_KEY} + anthropic-version + User-Agent: claude-code
    → 类似 Kimi Coding Plan 的调用方式

本脚本同时测试两种格式, 确认哪种可用。

Coding Plan 模型:
  - glm-5.1     (最新旗舰, 支持 reasoning, 2026-03-27)
  - glm-5-turbo (推理加速版, 支持 reasoning, 2026-03-16)
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
API_KEY = os.getenv("ZHIPU_API_KEY", "")

# 要测试的模型
MODELS = ["glm-5.1", "glm-5-turbo"]

# 推荐参数
TEMPERATURE = 1.0

# 代理设置 - None 使用系统代理, {} 直连
PROXIES = None


def mask_key(key):
    return f"{key[:8]}...{key[-6:]}"


def make_session():
    """创建 requests session"""
    s = requests.Session()
    if PROXIES is not None:
        s.proxies = PROXIES
    s.timeout = 120
    return s


# ============================================================
# 方式 A: Anthropic Messages API 格式 (类似 Kimi Coding Plan)
# ============================================================
# 尝试多个可能的 Anthropic 兼容端点
ANTHROPIC_BASE_URLS = [
    "https://open.bigmodel.cn/api/coding",
    "https://open.bigmodel.cn/api/coding/paas",
]


def test_anthropic_format(model, base_url):
    """
    Anthropic Messages API 格式 (Claude Code 调用方式)

    POST {base_url}/v1/messages
    Headers:
      x-api-key: {API_KEY}
      anthropic-version: 2023-06-01
      User-Agent: claude-code/1.0
    """
    url = f"{base_url}/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "User-Agent": "claude-code/1.0",
    }

    payload = {
        "model": model,
        "max_tokens": 512,
        "messages": [
            {"role": "user", "content": "Write a quicksort in Python, keep it concise."}
        ],
        "temperature": TEMPERATURE,
    }

    print("=" * 60)
    print(f"[测试] Anthropic Messages API - {model}")
    print("=" * 60)
    print(f"  URL:     {url}")
    print(f"  Model:   {model}")
    print(f"  Headers:")
    print(f"    x-api-key:         {mask_key(API_KEY)}")
    print(f"    anthropic-version: 2023-06-01")
    print(f"    User-Agent:        claude-code/1.0")
    print(f"\nRequest Body:\n{json.dumps(payload, indent=2, ensure_ascii=False)}\n")
    print("发送请求中...")

    session = make_session()
    try:
        resp = session.post(url, headers=headers, json=payload, timeout=120)
        print(f"HTTP Status: {resp.status_code}")

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
            print(f"\n[Anthropic 非流式成功] {model}")
            return True
        else:
            print(f"错误响应 (前 500 字):\n{resp.text[:500]}")
            return False

    except requests.exceptions.ProxyError as e:
        print(f"代理错误: {e}")
        return False
    except Exception as e:
        print(f"异常: {type(e).__name__}: {e}")
        return False


def test_anthropic_streaming(model, base_url):
    """Anthropic Messages API 流式调用"""
    url = f"{base_url}/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "User-Agent": "claude-code/1.0",
    }

    payload = {
        "model": model,
        "max_tokens": 256,
        "messages": [
            {"role": "user", "content": "1+1=? 简短回答"}
        ],
        "temperature": TEMPERATURE,
        "stream": True,
    }

    print("\n" + "=" * 60)
    print(f"[测试] Anthropic Messages API 流式 - {model}")
    print("=" * 60)
    print(f"  URL:    {url}")
    print(f"  Stream: true")
    print()
    print("发送请求中...")

    session = make_session()
    try:
        resp = session.post(url, headers=headers, json=payload, timeout=120, stream=True)
        print(f"HTTP Status: {resp.status_code}")

        if resp.status_code != 200:
            print(f"错误响应 (前 500 字):\n{resp.text[:500]}")
            return False

        print("流式输出:\n---")
        full_content = ""
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
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
                        elif delta.get("type") == "thinking_delta":
                            pass  # thinking 内容, 忽略

                    elif event_type == "message_delta":
                        usage = chunk.get("usage", {})
                        if usage:
                            print(f"\n--- usage: {json.dumps(usage)}")

                except json.JSONDecodeError:
                    pass

        print(f"\n---\n完整回复: {full_content}")
        print(f"\n[Anthropic 流式成功] {model}")
        return True

    except requests.exceptions.ProxyError as e:
        print(f"代理错误: {e}")
        return False
    except Exception as e:
        print(f"异常: {type(e).__name__}: {e}")
        return False


# ============================================================
# 方式 B: OpenAI Chat Completions 格式 (opencode 实际使用的方式)
# ============================================================
OPENAI_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4"


def test_openai_format(model):
    """
    OpenAI Chat Completions 格式 (opencode zhipuai-coding-plan 实际调用方式)

    POST {OPENAI_BASE_URL}/chat/completions
    Headers:
      Authorization: Bearer {API_KEY}
      Content-Type: application/json

    opencode 配置:
      npm: @ai-sdk/openai-compatible
      api: https://open.bigmodel.cn/api/coding/paas/v4
    """
    url = f"{OPENAI_BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }

    payload = {
        "model": model,
        "max_tokens": 512,
        "messages": [
            {"role": "user", "content": "Write a quicksort in Python, keep it concise."}
        ],
        "temperature": TEMPERATURE,
    }

    print("=" * 60)
    print(f"[测试] OpenAI Completions (opencode 实际方式) - {model}")
    print("=" * 60)
    print(f"  URL:     {url}")
    print(f"  Model:   {model}")
    print(f"  Auth:    Bearer {mask_key(API_KEY)}")
    print(f"\nRequest Body:\n{json.dumps(payload, indent=2, ensure_ascii=False)}\n")
    print("发送请求中...")

    session = make_session()
    try:
        resp = session.post(url, headers=headers, json=payload, timeout=120)
        print(f"HTTP Status: {resp.status_code}")

        if resp.status_code == 200:
            data = resp.json()
            print(f"完整响应 JSON:\n{json.dumps(data, indent=2, ensure_ascii=False)}\n")

            choices = data.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                content = msg.get("content", "")
                reasoning = msg.get("reasoning_content", "")
                if reasoning:
                    print(f"[Thinking]:\n{reasoning[:500]}{'...' if len(reasoning) > 500 else ''}\n")
                print(f"模型回复:\n{content}\n")

            usage = data.get("usage", {})
            print(f"Token 用量:")
            print(f"  prompt_tokens:     {usage.get('prompt_tokens', 'N/A')}")
            print(f"  completion_tokens: {usage.get('completion_tokens', 'N/A')}")
            print(f"  total_tokens:      {usage.get('total_tokens', 'N/A')}")
            print(f"\n[OpenAI 非流式成功] {model}")
            return True
        else:
            print(f"错误响应:\n{resp.text[:500]}")
            return False

    except requests.exceptions.ProxyError as e:
        print(f"代理错误: {e}")
        return False
    except Exception as e:
        print(f"异常: {type(e).__name__}: {e}")
        return False


def test_openai_streaming(model):
    """OpenAI Chat Completions 流式调用"""
    url = f"{OPENAI_BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }

    payload = {
        "model": model,
        "max_tokens": 256,
        "messages": [
            {"role": "user", "content": "1+1=? 简短回答"}
        ],
        "temperature": TEMPERATURE,
        "stream": True,
    }

    print("\n" + "=" * 60)
    print(f"[测试] OpenAI Completions 流式 - {model}")
    print("=" * 60)
    print(f"  URL:    {url}")
    print(f"  Stream: true")
    print()
    print("发送请求中...")

    session = make_session()
    try:
        resp = session.post(url, headers=headers, json=payload, timeout=120, stream=True)
        print(f"HTTP Status: {resp.status_code}")

        if resp.status_code != 200:
            print(f"错误响应:\n{resp.text[:500]}")
            return False

        print("流式输出:\n---")
        full_content = ""
        full_reasoning = ""
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("data: "):
                data_str = line[len("data: "):]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    choices = chunk.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        text = delta.get("content", "")
                        if text:
                            print(text, end="", flush=True)
                            full_content += text
                        reasoning = delta.get("reasoning_content", "")
                        if reasoning:
                            full_reasoning += reasoning

                    usage = chunk.get("usage")
                    if usage:
                        print(f"\n--- usage: {json.dumps(usage)}")

                except json.JSONDecodeError:
                    pass

        if full_reasoning:
            print(f"\n--- [Thinking]: {full_reasoning[:300]}...")
        print(f"\n---\n完整回复: {full_content}")
        print(f"\n[OpenAI 流式成功] {model}")
        return True

    except requests.exceptions.ProxyError as e:
        print(f"代理错误: {e}")
        return False
    except Exception as e:
        print(f"异常: {type(e).__name__}: {e}")
        return False


# ============================================================
# Main
# ============================================================
if __name__ == "__main__":
    print("=" * 60)
    print("GLM Coding Plan API 调用测试")
    print("=" * 60)
    print()
    print("连接信息:")
    print(f"  API Key:    {mask_key(API_KEY)}")
    print(f"  Models:     {', '.join(MODELS)}")
    print(f"  Temp:       {TEMPERATURE}")
    print(f"  Proxies:    {'系统代理' if PROXIES is None else ('直连' if PROXIES == {} else PROXIES)}")
    print()
    print("测试两种 API 格式:")
    print("  A) Anthropic Messages API (Claude Code 标准方式)")
    for url in ANTHROPIC_BASE_URLS:
        print(f"     - {url}/v1/messages")
    print(f"  B) OpenAI Chat Completions (opencode zhipuai-coding-plan 实际方式)")
    print(f"     - {OPENAI_BASE_URL}/chat/completions")
    print()

    results = {}

    # --- 测试 Anthropic 格式 ---
    print("\n" + "#" * 60)
    print("# 方式 A: Anthropic Messages API 格式")
    print("#" * 60)
    anthropic_ok = False
    working_anthropic_url = None
    for base_url in ANTHROPIC_BASE_URLS:
        print(f"\n尝试端点: {base_url}")
        model = MODELS[0]  # 先用第一个模型探测
        ok = test_anthropic_format(model, base_url)
        if ok:
            anthropic_ok = True
            working_anthropic_url = base_url
            print(f"\n>>> 找到可用 Anthropic 端点: {base_url}")
            break
        else:
            print(f">>> 端点不可用: {base_url}")

    if anthropic_ok and working_anthropic_url:
        for model in MODELS:
            r1 = test_anthropic_format(model, working_anthropic_url)
            r2 = test_anthropic_streaming(model, working_anthropic_url)
            results[f"Anthropic-{model}"] = {"非流式": r1, "流式": r2}
    else:
        print("\n>>> Anthropic Messages API 格式不被 GLM Coding Plan 端点支持")
        for model in MODELS:
            results[f"Anthropic-{model}"] = {"非流式": False, "流式": False}

    # --- 测试 OpenAI 格式 ---
    print("\n\n" + "#" * 60)
    print("# 方式 B: OpenAI Chat Completions 格式 (opencode 实际方式)")
    print("#" * 60)
    for model in MODELS:
        r1 = test_openai_format(model)
        r2 = test_openai_streaming(model)
        results[f"OpenAI-{model}"] = {"非流式": r1, "流式": r2}
        print()

    # 汇总
    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    for key, res in results.items():
        print(f"\n  {key}:")
        for test_name, passed in res.items():
            status = "通过" if passed else "失败"
            print(f"    {test_name}: {status}")

    print("\n" + "-" * 60)
    print("结论:")
    any_anthropic = any(v for k, r in results.items() if k.startswith("Anthropic") for v in r.values())
    any_openai = any(v for k, r in results.items() if k.startswith("OpenAI") for v in r.values())

    if any_anthropic:
        print(f"  Anthropic Messages API: 支持 (端点: {working_anthropic_url})")
        print(f"    配置: ANTHROPIC_BASE_URL={working_anthropic_url}/")
        print(f"           ANTHROPIC_API_KEY={mask_key(API_KEY)}")
    else:
        print("  Anthropic Messages API: 不支持")
        print("    GLM Coding Plan 不像 Kimi 那样兼容 Anthropic 格式")

    if any_openai:
        print(f"  OpenAI Chat Completions: 支持 (端点: {OPENAI_BASE_URL})")
        print(f"    这是 opencode zhipuai-coding-plan 实际使用的方式")
        print(f"    配置: provider=zhipuai-coding-plan, env=ZHIPU_API_KEY")

    if not any_anthropic and not any_openai:
        print()
        print("排查建议:")
        print("  1. 确认 API key 有效且 Coding Plan 已激活")
        print("  2. 如果出现代理错误，修改脚本中 PROXIES = {} 跳过代理")
        print("  3. 确认网络可达 open.bigmodel.cn")
        print("  4. 参考文档: https://docs.bigmodel.cn/cn/coding-plan/overview")
        sys.exit(1)
