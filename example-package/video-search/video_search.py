import requests
import os
import time
import json
import sys
import os
import io
import random
from dotenv import load_dotenv

# 在Windows上设置stdout为UTF-8编码
if sys.platform.startswith('win'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 启用详细日志
DEBUG = True

def log(message):
    if DEBUG:
        print(f"[DEBUG] {message}", file=sys.stderr)

# 尝试加载环境变量
log("尝试加载环境变量...")
load_dotenv()  # 从.env文件加载环境变量

# 从环境变量获取Pexels API密钥列表
API_KEY_STR = os.environ.get("PEXELS_API_KEY", "")
# 分割多个API密钥（以逗号分隔）
API_KEYS = [key.strip() for key in API_KEY_STR.split(",") if key.strip()]

# 如果环境变量中没有API密钥，使用默认值
if not API_KEYS:
    log("警告：未从环境变量中找到PEXELS_API_KEY，使用默认值")
    API_KEYS = ["example"]  # 默认值，建议使用环境变量替换

log(f"已加载 {len(API_KEYS)} 个API密钥")

def get_random_api_key():
    """
    随机选择一个API密钥
    
    返回:
        str: 随机选择的API密钥
    """
    api_key = random.choice(API_KEYS)
    log(f"随机选择API密钥: {api_key[:5]}...（部分隐藏）")
    return api_key

def is_landscape_video(width, height):
    """
    判断视频是否为横屏
    
    参数:
        width (int): 视频宽度
        height (int): 视频高度
    
    返回:
        bool: 是否为横屏视频
    """
    return width > height

def search_videos(query, max_videos=10, orientation='mixed'):
    """
    搜索Pexels视频

    参数:
        query (str): 搜索关键词
        max_videos (int): 最大视频数量
        orientation (str): 视频方向，可选值：'landscape'(横屏),'portrait'(竖屏),'mixed'(混合)
    
    返回:
        dict: 包含检索到的视频信息
    """
    try:
        log(f"开始搜索视频，关键词: '{query}', 最大数量: {max_videos}, 方向: {orientation}")
        
        # 随机选择一个API密钥
        selected_api_key = get_random_api_key()
        headers = {
            "Authorization": selected_api_key
        }

        # 搜索视频
        search_url = "https://api.pexels.com/videos/search"
        params = {
            "query": query,
            "per_page": max_videos * 2  # 获取更多视频以便根据方向过滤
        }

        log(f"发送API请求: {search_url}")
        response = requests.get(search_url, headers=headers, params=params)
        log(f"API响应状态码: {response.status_code}")
        
        # 如果请求失败并且有多个API密钥，尝试另一个密钥
        if response.status_code != 200 and len(API_KEYS) > 1:
            log(f"API请求失败，尝试使用另一个API密钥...")
            # 移除当前API密钥
            current_index = API_KEYS.index(selected_api_key) if selected_api_key in API_KEYS else -1
            
            # 最多尝试3次其他密钥
            for _ in range(min(3, len(API_KEYS) - 1)):
                # 选择一个不同的密钥
                selected_api_key = random.choice([key for key in API_KEYS if key != selected_api_key])
                headers = {
                    "Authorization": selected_api_key
                }
                
                log(f"重试API请求，使用新密钥...")
                response = requests.get(search_url, headers=headers, params=params)
                log(f"API响应状态码: {response.status_code}")
                
                if response.status_code == 200:
                    log("使用新API密钥请求成功")
                    break
        
        response.raise_for_status()  # 检查请求是否成功

        data = response.json()
        videos = data.get("videos", [])
        log(f"获取到 {len(videos)} 个视频")

        if not videos:
            log("未找到相关视频")
            return {"success": False, "message": f"没有找到与'{query}'相关的视频", "videos": []}

        # 提取视频信息
        video_results = []
        for index, video in enumerate(videos):
            video_id = video.get("id")
            log(f"处理视频 {index+1}/{len(videos)}, ID: {video_id}")
            
            user = video.get("user", {}).get("name", "unknown")
            duration = video.get("duration")
            
            # 获取视频文件链接，选择中等质量的视频（避免太大）
            video_files = video.get("video_files", [])
            if not video_files:
                log(f"视频 {video_id} 没有可用的视频文件，跳过")
                continue
            
            log(f"视频 {video_id} 有 {len(video_files)} 个视频文件")
                
            # 选择适当质量的视频
            # 优先选择HD(1280x720)质量的视频，如果没有则选择SD质量
            hd_files = [f for f in video_files if f.get("width") == 1280 and f.get("height") == 720]
            sd_files = [f for f in video_files if f.get("width") == 640 and f.get("height") == 360]
            
            if hd_files:
                log(f"选择HD质量视频文件")
                video_file = hd_files[0]
            elif sd_files:
                log(f"选择SD质量视频文件")
                video_file = sd_files[0]
            else:
                # 按质量排序（选择文件大小适中的）
                log(f"未找到标准质量文件，选择中等质量文件")
                video_files.sort(key=lambda x: x.get("width", 0) * x.get("height", 0))
                mid_index = len(video_files) // 2
                video_file = video_files[mid_index]
            
            width = video_file.get("width", 0)
            height = video_file.get("height", 0)
            
            # 根据方向过滤视频
            if orientation != 'mixed':
                if orientation == 'landscape' and not is_landscape_video(width, height):
                    log(f"视频 {video_id} 不是横屏视频，跳过")
                    continue
                if orientation == 'portrait' and is_landscape_video(width, height):
                    log(f"视频 {video_id} 不是竖屏视频，跳过")
                    continue
            
            video_url = video_file.get("link")
            if not video_url:
                log(f"视频 {video_id} 没有可用的链接，跳过")
                continue
                
            log(f"视频URL: {video_url}")
                
            # 获取预览图片
            pictures = video.get("video_pictures", [])
            thumbnail = pictures[0].get("picture") if pictures else ""
            
            video_results.append({
                "id": video_id,
                "title": f"Video by {user}",
                "author": user,
                "duration": duration,
                "video_url": video_url,
                "thumbnail": thumbnail,
                "width": width,
                "height": height
            })

            # 如果已经收集了足够的视频，就停止
            if len(video_results) >= max_videos:
                log(f"已收集足够视频数量 ({max_videos}), 停止处理")
                break

        log(f"成功处理 {len(video_results)} 个视频")
        result = {
            "success": True,
            "message": f"找到 {len(video_results)} 个视频",
            "videos": video_results
        }
        
        # 输出最终结果，确保使用UTF-8编码
        try:
            json_str = json.dumps(result, ensure_ascii=False)
            print(json_str)
        except Exception as json_err:
            log(f"JSON序列化失败: {str(json_err)}")
            # 尝试一个更安全的方式
            safe_result = {
                "success": True,
                "message": f"找到 {len(video_results)} 个视频 (数据已安全处理)",
                "videos": []
            }
            # 逐个添加经过安全处理的视频数据
            for video in video_results:
                try:
                    # 使用ASCII编码确保不会有编码问题
                    safe_video = {
                        "id": str(video.get("id", "")),
                        "title": "Video",
                        "author": str(video.get("author", ""))[:100],
                        "duration": video.get("duration", 0),
                        "video_url": str(video.get("video_url", "")),
                        "thumbnail": str(video.get("thumbnail", "")),
                        "width": video.get("width", 0),
                        "height": video.get("height", 0)
                    }
                    safe_result["videos"].append(safe_video)
                except:
                    # 如果单个视频处理失败，继续处理其他视频
                    continue
            
            print(json.dumps(safe_result))
        
        return result

    except requests.exceptions.RequestException as e:
        error_message = f"API请求错误: {str(e)}"
        log(error_message)
        result = {"success": False, "message": error_message, "videos": []}
        try:
            print(json.dumps(result, ensure_ascii=False))
        except:
            print('{"success": false, "message": "API请求错误", "videos": []}')
        return result
    except Exception as e:
        error_message = f"发生错误: {str(e)}"
        log(error_message)
        result = {"success": False, "message": error_message, "videos": []}
        try:
            print(json.dumps(result, ensure_ascii=False))
        except:
            print('{"success": false, "message": "处理视频时发生错误", "videos": []}')
        return result

if __name__ == "__main__":
    log("脚本直接运行")
    try:
        # 从标准输入读取搜索关键词
        log("等待输入搜索关键词...")
        search_term = input().strip()
        log(f"接收到搜索关键词: '{search_term}'")
        
        # 从标准输入读取视频数量
        log("等待输入搜索数量...")
        num_videos_input = input().strip()
        log(f"接收到视频数量: '{num_videos_input}'")
        
        try:
            num_videos = int(num_videos_input)
            log(f"解析视频数量: {num_videos}")
        except ValueError:
            log(f"视频数量格式错误，使用默认值10")
            num_videos = 10
            
        # 从标准输入读取视频方向
        log("等待输入视频方向...")
        orientation = input().strip()
        if orientation not in ['landscape', 'portrait', 'mixed']:
            log(f"视频方向格式错误，使用默认值'mixed'")
            orientation = 'mixed'
        log(f"接收到视频方向: '{orientation}'")

        # 调用搜索函数
        log(f"开始搜索: '{search_term}', 数量: {num_videos}, 方向: {orientation}")
        search_videos(search_term, num_videos, orientation)
        
    except Exception as e:
        log(f"脚本运行错误: {str(e)}")
        result = {"success": False, "message": f"脚本运行错误: {str(e)}", "videos": []}
        print(json.dumps(result))
        sys.exit(1) 