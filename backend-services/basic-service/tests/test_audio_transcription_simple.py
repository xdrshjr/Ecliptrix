#!/usr/bin/env python3
"""
简单的音频转字幕功能测试脚本
直接运行测试，无需复杂的模块导入
"""

import os
import sys
import requests
import json
from datetime import datetime

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = current_dir
sys.path.insert(0, project_root)

# 禁用代理，避免localhost请求通过代理
PROXIES = {
    'http': None,
    'https': None
}

def test_audio_transcription_api():
    """测试音频转字幕API"""
    print("=" * 60)
    print("音频转字幕API测试")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    
    # 1. 测试健康检查
    print("\n1. 测试健康检查接口...")
    try:
        response = requests.get(f"{base_url}/api/audio/health", timeout=10, proxies=PROXIES)
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"服务状态: {data.get('status', 'unknown')}")
            print(f"配置状态: {data.get('config', {})}")
            print("✓ 健康检查通过")
        else:
            print(f"✗ 健康检查失败: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("✗ 无法连接到服务器，请确保服务器正在运行")
        print("  启动命令: python run.py")
        return False
    except Exception as e:
        print(f"✗ 健康检查异常: {str(e)}")
        return False
    
    # 2. 测试本地音频文件转字幕
    print("\n2. 测试本地音频文件转字幕...")
    
    # 检查测试音频文件是否存在
    test_audio_path = "../datas/audio/audio-01.mp3"
    if not os.path.exists(test_audio_path):
        print(f"✗ 测试音频文件不存在: {test_audio_path}")
        print("  请确保测试音频文件存在")
        return False
    
    print(f"使用测试音频文件: {test_audio_path}")
    
    # 准备请求数据（全部使用Form格式）
    form_data = {
        "file_path": test_audio_path,
        "language": "zh-CN",
        "use_itn": "true",
        "use_punc": "false",
        "max_lines": "2",
        "words_per_line": "15",
        "generate_srt_file": "true"
    }
    
    try:
        print("发送转字幕请求...")
        response = requests.post(
            f"{base_url}/api/audio/transcribe-local",
            data=form_data,
            timeout=120,  # 2分钟超时
            proxies=PROXIES
        )
        
        print(f"响应状态码: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"请求成功: {result.get('success', False)}")
            
            if result.get('success'):
                print(f"✓ 音频转字幕成功!")
                print(f"  任务ID: {result.get('job_id', 'N/A')}")
                print(f"  字幕数量: {len(result.get('subtitles', []))}")
                print(f"  处理时间: {result.get('processing_time', 0):.2f}秒")
                print(f"  音频时长: {result.get('audio_duration', 0):.2f}秒")
                
                # 显示前几条字幕
                subtitles = result.get('subtitles', [])
                if subtitles:
                    print("\n  前3条字幕内容:")
                    for i, subtitle in enumerate(subtitles[:3], 1):
                        start_time = subtitle.get('start_time', 0) / 1000
                        end_time = subtitle.get('end_time', 0) / 1000
                        text = subtitle.get('text', '')
                        print(f"    {i}. [{start_time:.1f}s-{end_time:.1f}s] {text}")
                
                # 显示SRT文件信息
                if result.get('srt_file_url'):
                    print(f"  SRT文件URL: {result.get('srt_file_url')}")
                    
                return True
            else:
                print(f"✗ 音频转字幕失败: {result.get('error', 'Unknown error')}")
                print(f"  错误代码: {result.get('error_code', 'N/A')}")
                return False
        else:
            print(f"✗ 请求失败: {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        print("✗ 请求超时，音频文件可能较大或网络较慢")
        return False
    except Exception as e:
        print(f"✗ 请求异常: {str(e)}")
        return False

def test_file_upload():
    """测试文件上传接口"""
    print("\n3. 测试文件上传接口...")
    
    base_url = "http://localhost:8000"
    
    # 创建一个小的测试音频文件（实际上是文本文件，用于测试文件类型验证）
    test_content = b"This is not a real audio file"
    
    try:
        response = requests.post(
            f"{base_url}/api/audio/transcribe",
            files={"file": ("test.txt", test_content, "text/plain")},
            data={
                "language": "zh-CN",
                "use_itn": "true",
                "use_punc": "false",
                "max_lines": "2",
                "words_per_line": "15",
                "generate_srt_file": "true"
            },
            timeout=30,
            proxies=PROXIES
        )
        
        print(f"响应状态码: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            if not result.get('success') and result.get('error_code') == 'INVALID_FILE_TYPE':
                print("✓ 文件类型验证正常工作")
                return True
            else:
                print(f"✗ 预期文件类型验证失败，但得到: {result}")
                return False
        else:
            print(f"✗ 请求失败: {response.text}")
            return False
            
    except Exception as e:
        print(f"✗ 测试异常: {str(e)}")
        return False

def main():
    """主测试函数"""
    print(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # 检查当前工作目录
    print(f"当前工作目录: {os.getcwd()}")
    
    success_count = 0
    total_tests = 3
    
    # 运行测试
    if test_audio_transcription_api():
        success_count += 1
    
    if test_file_upload():
        success_count += 1
    
    # 总结
    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    print(f"总测试数: {total_tests}")
    print(f"成功: {success_count}")
    print(f"失败: {total_tests - success_count}")
    print(f"成功率: {success_count/total_tests*100:.1f}%")
    
    if success_count == total_tests:
        print("🎉 所有测试通过!")
    else:
        print("⚠️  部分测试失败，请检查日志")
    
    print(f"结束时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main() 