import requests
import json
import base64
import uuid
import os
import sys
import time


class TTSClient:
    def __init__(self, appid, access_token):
        self.appid = appid
        self.access_token = access_token
        self.base_url = "https://openspeech.bytedance.com/api/v1/tts"

    def synthesize_speech(self, text, output_file="output.mp3", voice_type="zh_female_wanqudashu_moon_bigtts"):
        """
        调用火山引擎语音合成API，将文本转换为语音并保存到本地

        Args:
            text (str): 要合成的文本
            output_file (str): 输出文件名
            voice_type (str): 音色类型

        Returns:
            bool: 是否成功
        """
        # 生成唯一的请求ID
        req_id = str(uuid.uuid4())

        # 构造请求参数
        request_data = {
            "app": {
                "appid": self.appid,
                "token": self.access_token,
                "cluster": "volcano_tts"
            },
            "user": {
                "uid": "user123"  # 可以是任意非空字符串
            },
            "audio": {
                "voice_type": voice_type,
                "encoding": "mp3",  # 音频格式
                "speed_ratio": 1.0,  # 语速
                "rate": 24000,  # 采样率
                "bitrate": 160  # 比特率
            },
            "request": {
                "reqid": req_id,
                "text": text,
                "operation": "query"  # HTTP只能使用query
            }
        }

        # 设置请求头
        headers = {
            "Authorization": f"Bearer;{self.access_token}",
            "Content-Type": "application/json"
        }

        try:
            print(f"正在合成语音: {text[:50]}{'...' if len(text) > 50 else ''}", file=sys.stderr)
            print(f"请求ID: {req_id}", file=sys.stderr)
            print(f"使用音色: {voice_type}", file=sys.stderr)

            # 发送POST请求
            response = requests.post(
                self.base_url,
                headers=headers,
                data=json.dumps(request_data),
                timeout=30
            )

            # 检查HTTP状态码
            response.raise_for_status()

            # 解析响应JSON
            result = response.json()

            # 检查API返回码
            if result.get("code") != 3000:
                print(f"API错误: {result.get('code')} - {result.get('message')}", file=sys.stderr)
                return False

            # 获取base64编码的音频数据
            audio_data_b64 = result.get("data")
            if not audio_data_b64:
                print("未获取到音频数据", file=sys.stderr)
                return False

            # base64解码
            audio_data = base64.b64decode(audio_data_b64)

            # 保存到文件
            with open(output_file, "wb") as f:
                f.write(audio_data)

            # 打印额外信息
            if "addition" in result:
                duration = result["addition"].get("duration", "未知")
                print(f"音频时长: {duration}ms", file=sys.stderr)

            print(f"语音合成成功，已保存到: {output_file}", file=sys.stderr)
            print(f"文件大小: {len(audio_data)} 字节", file=sys.stderr)

            return True

        except requests.exceptions.RequestException as e:
            print(f"请求错误: {e}", file=sys.stderr)
            return False
        except json.JSONDecodeError as e:
            print(f"JSON解析错误: {e}", file=sys.stderr)
            return False
        except Exception as e:
            print(f"未知错误: {e}", file=sys.stderr)
            return False


def synthesize_speech(text, output_path, appid=None, access_token=None, voice_name='zh_female_wanqudashu_moon_bigtts'):
    """
    使用火山引擎语音合成接口合成语音

    参数:
    text: 要合成的文本
    output_path: 输出的音频文件路径
    appid: 火山引擎应用ID，如果为None则从环境变量获取
    access_token: 火山引擎访问令牌，如果为None则从环境变量获取
    voice_name: 语音音色，默认为'zh_female_wanqudashu_moon_bigtts'

    返回:
    成功: {"success": True, "output_path": 输出路径, "request_id": 请求ID}
    失败: {"success": False, "error": 错误信息}
    """
    max_retries = 3
    retry_delay = 2  # 2秒延迟

    for attempt in range(max_retries):
        try:
            # 设置认证信息，优先使用传入的值，否则使用环境变量
            if appid is None:
                appid = os.environ.get('VOLCANO_TTS_APPID')
            if access_token is None:
                access_token = os.environ.get('VOLCANO_TTS_ACCESS_TOKEN')

            if not appid or not access_token:
                return {"success": False, "error": "未提供火山引擎认证信息"}

            # 验证文本内容
            if not text or not text.strip():
                return {"success": False, "error": "文本内容为空"}

            # 限制文本长度
            if len(text) > 5000:
                text = text[:5000]
                print(f"警告：文本过长，已截断至5000字符", file=sys.stderr)

            # 创建语音合成器实例
            tts_client = TTSClient(appid, access_token)

            # 调用语音合成接口
            print(f"尝试第 {attempt + 1} 次合成语音，音色: {voice_name}", file=sys.stderr)
            success = tts_client.synthesize_speech(text, output_path, voice_name)

            if not success:
                raise Exception("语音合成失败")

            # 验证文件是否写入成功
            if not os.path.exists(output_path):
                raise Exception("音频文件写入失败")

            if os.path.getsize(output_path) == 0:
                raise Exception("音频文件为空")

            print(f"语音合成成功，文件大小: {os.path.getsize(output_path)} bytes", file=sys.stderr)

            # 返回成功信息
            return {
                "success": True,
                "output_path": output_path,
                "request_id": str(uuid.uuid4()),
                "file_size": os.path.getsize(output_path)
            }

        except Exception as e:
            error_msg = str(e)
            print(f"第 {attempt + 1} 次尝试失败: {error_msg}", file=sys.stderr)

            # 如果是最后一次尝试，返回错误
            if attempt == max_retries - 1:
                # 清理可能存在的空文件
                if os.path.exists(output_path) and os.path.getsize(output_path) == 0:
                    try:
                        os.remove(output_path)
                    except:
                        pass

                return {"success": False, "error": f"语音合成失败 (尝试{max_retries}次): {error_msg}"}

            # 等待后重试
            print(f"等待 {retry_delay} 秒后重试...", file=sys.stderr)
            time.sleep(retry_delay)
            retry_delay *= 1.5  # 递增延迟时间


# 当作为独立脚本运行时的入口点
if __name__ == "__main__":
    # 从命令行参数获取输入
    if len(sys.argv) < 3:
        print(json.dumps({"success": False,
                          "error": "参数不足。用法: python volcano_tts.py <文本或文本文件路径> <输出路径> [应用ID] [访问令牌] [音色名称]"}))
        sys.exit(1)

    text_param = sys.argv[1]
    output_file = sys.argv[2]
    appid = sys.argv[3] if len(sys.argv) > 3 else None
    access_token = sys.argv[4] if len(sys.argv) > 4 else None
    voice_name = sys.argv[5] if len(sys.argv) > 5 else 'zh_female_wanqudashu_moon_bigtts'

    # 检查第一个参数是否是文件路径，如果是，则读取文件内容
    if os.path.isfile(text_param):
        try:
            with open(text_param, 'r', encoding='utf-8') as f:
                text_to_synthesize = f.read()
        except Exception as e:
            print(json.dumps({"success": False, "error": f"读取文本文件失败: {str(e)}"}))
            sys.exit(1)
    else:
        # 如果不是文件路径，则直接使用参数值作为文本
        text_to_synthesize = text_param

    # 调用语音合成函数
    result = synthesize_speech(text_to_synthesize, output_file, appid, access_token, voice_name)

    # 将结果信息输出到标准输出，作为脚本的输出
    print(json.dumps(result, ensure_ascii=False))