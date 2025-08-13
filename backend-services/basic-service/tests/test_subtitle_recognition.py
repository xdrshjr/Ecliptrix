#!/usr/bin/env python3
"""
字幕识别功能测试脚本
测试通配符文件路径查找和音频转字幕功能
"""

import os
import sys
import requests
import json
import glob
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

def test_wildcard_file_search():
    """测试通配符文件路径查找功能"""
    print("=" * 60)
    print("通配符文件路径查找测试")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    
    # 1. 首先检查static/audio/generated目录中是否有文件
    audio_dir = "static/audio/generated"
    print(f"\n1. 检查音频目录: {audio_dir}")
    
    if os.path.exists(audio_dir):
        audio_files = glob.glob(os.path.join(audio_dir, "*.mp3"))
        print(f"找到 {len(audio_files)} 个音频文件:")
        for file in audio_files[:5]:  # 只显示前5个
            print(f"  - {os.path.basename(file)}")
        
        if len(audio_files) > 5:
            print(f"  ... 还有 {len(audio_files) - 5} 个文件")
    else:
        print(f"音频目录不存在: {audio_dir}")
        return False
    
    # 2. 测试通配符路径查找
    print(f"\n2. 测试通配符路径查找...")
    
    # 构造通配符路径
    wildcard_patterns = [
        "static/audio/generated/tts_segment-1_*.mp3",
        "static/audio/generated/*segment-1*.mp3",
        "static/audio/generated/tts_*.mp3"
    ]
    
    for pattern in wildcard_patterns:
        print(f"\n测试模式: {pattern}")
        matching_files = glob.glob(pattern)
        
        if matching_files:
            print(f"  找到 {len(matching_files)} 个匹配文件:")
            for file in matching_files[:3]:  # 只显示前3个
                print(f"    - {os.path.basename(file)}")
            
            # 测试API调用
            test_file = matching_files[0]
            print(f"\n  使用文件测试API: {os.path.basename(test_file)}")
            
            form_data = {
                "file_path": pattern,  # 使用通配符路径
                "language": "zh-CN",
                "use_itn": "true",
                "use_punc": "false",
                "max_lines": "2",
                "words_per_line": "15",
                "generate_srt_file": "true"
            }
            
            try:
                response = requests.post(
                    f"{base_url}/api/audio/transcribe-local",
                    data=form_data,
                    timeout=60,
                    proxies=PROXIES
                )
                
                print(f"  API响应状态码: {response.status_code}")
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get('success'):
                        print(f"  ✓ 通配符路径识别成功!")
                        print(f"    任务ID: {result.get('job_id', 'N/A')}")
                        print(f"    字幕数量: {len(result.get('subtitles', []))}")
                        print(f"    处理时间: {result.get('processing_time', 0):.2f}秒")
                        return True
                    else:
                        print(f"  ✗ 识别失败: {result.get('error', 'Unknown error')}")
                else:
                    print(f"  ✗ API请求失败: {response.text}")
                    
            except Exception as e:
                print(f"  ✗ 请求异常: {str(e)}")
        else:
            print(f"  未找到匹配文件")
    
    return False

def test_direct_file_path():
    """测试直接文件路径"""
    print("\n" + "=" * 60)
    print("直接文件路径测试")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    
    # 查找第一个可用的音频文件
    audio_dir = "static/audio/generated"
    audio_files = glob.glob(os.path.join(audio_dir, "*.mp3"))
    
    if not audio_files:
        print("未找到音频文件进行测试")
        return False
    
    test_file = audio_files[0]
    print(f"使用测试文件: {os.path.basename(test_file)}")
    
    form_data = {
        "file_path": test_file,
        "language": "zh-CN",
        "use_itn": "true",
        "use_punc": "false",
        "max_lines": "2",
        "words_per_line": "15",
        "generate_srt_file": "true"
    }
    
    try:
        response = requests.post(
            f"{base_url}/api/audio/transcribe-local",
            data=form_data,
            timeout=60,
            proxies=PROXIES
        )
        
        print(f"API响应状态码: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                print(f"✓ 直接路径识别成功!")
                print(f"  任务ID: {result.get('job_id', 'N/A')}")
                print(f"  字幕数量: {len(result.get('subtitles', []))}")
                print(f"  处理时间: {result.get('processing_time', 0):.2f}秒")
                
                # 显示前几条字幕
                subtitles = result.get('subtitles', [])
                if subtitles:
                    print("\n  前3条字幕内容:")
                    for i, subtitle in enumerate(subtitles[:3], 1):
                        start_time = subtitle.get('start_time', 0) / 1000
                        end_time = subtitle.get('end_time', 0) / 1000
                        text = subtitle.get('text', '')
                        print(f"    {i}. [{start_time:.1f}s-{end_time:.1f}s] {text}")
                
                return True
            else:
                print(f"✗ 识别失败: {result.get('error', 'Unknown error')}")
        else:
            print(f"✗ API请求失败: {response.text}")
            
    except Exception as e:
        print(f"✗ 请求异常: {str(e)}")
    
    return False

def test_health_check():
    """测试健康检查接口"""
    print("=" * 60)
    print("健康检查测试")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    
    try:
        response = requests.get(f"{base_url}/api/audio/health", timeout=10, proxies=PROXIES)
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"服务状态: {data.get('status', 'unknown')}")
            print(f"服务名称: {data.get('service', 'unknown')}")
            print(f"配置状态: {data.get('config', {})}")
            print("✓ 健康检查通过")
            return True
        else:
            print(f"✗ 健康检查失败: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("✗ 无法连接到服务器，请确保服务器正在运行")
        print("  启动命令: python run.py")
        return False
    except Exception as e:
        print(f"✗ 健康检查异常: {str(e)}")
        return False

def main():
    """主测试函数"""
    print(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"当前工作目录: {os.getcwd()}")
    
    success_count = 0
    total_tests = 3
    
    # 运行测试
    if test_health_check():
        success_count += 1
    
    if test_wildcard_file_search():
        success_count += 1
    
    if test_direct_file_path():
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