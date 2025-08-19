import requests
import json
import os
import urllib.parse
from typing import Optional, Dict, Any, List

# 音乐类型定义
MUSIC_CATEGORIES = {
    "1": {
        "name": "纯音乐/器乐 (Instrumental)",
        "filters": ["tag:instrumental", "tag:music"],
        "keywords": ["instrumental", "music", "melody", "piano", "guitar", "orchestral"]
    },
    "2": {
        "name": "音效 (Sound Effects)",
        "filters": ["tag:sfx", "tag:sound-effect", "tag:foley"],
        "keywords": ["sfx", "sound-effect", "foley", "impact", "whoosh", "explosion"]
    },
    "3": {
        "name": "环境音/氛围音 (Ambient)",
        "filters": ["tag:ambient", "tag:atmosphere"],
        "keywords": ["ambient", "nature", "rain", "wind", "forest", "background"]
    },
    "4": {
        "name": "电子音乐 (Electronic)",
        "filters": ["tag:electronic", "tag:synth"],
        "keywords": ["electronic", "synth", "techno", "house", "edm", "digital"]
    },
    "5": {
        "name": "循环/节拍 (Loops & Beats)",
        "filters": ["tag:loop", "tag:beat"],
        "keywords": ["loop", "beat", "drum", "rhythm", "percussion", "cycle"]
    },
    "6": {
        "name": "人声 (Vocal)",
        "filters": ["tag:voice", "tag:vocal"],
        "keywords": ["voice", "vocal", "speech", "singing", "human", "talk"]
    },
    "7": {
        "name": "自然音效 (Nature Sounds)",
        "filters": ["tag:nature", "tag:field-recording"],
        "keywords": ["nature", "bird", "water", "ocean", "forest", "animal"]
    },
    "8": {
        "name": "机械音效 (Mechanical)",
        "filters": ["tag:mechanical", "tag:machine"],
        "keywords": ["mechanical", "machine", "motor", "engine", "industrial", "tech"]
    }
}

# 排序选项定义
SORT_OPTIONS = {
    "1": {
        "name": "🔥 热度排序 (按下载次数)",
        "value": "downloads_desc",
        "description": "最受欢迎的音频"
    },
    "2": {
        "name": "⭐ 评分排序 (按用户评分)",
        "value": "rating_desc",
        "description": "质量最高的音频"
    },
    "3": {
        "name": "🆕 时间排序 (最新上传)",
        "value": "created_desc",
        "description": "最新发布的音频"
    },
    "4": {
        "name": "⏱️ 时长排序 (从长到短)",
        "value": "duration_desc",
        "description": "按音频长度排序"
    },
    "5": {
        "name": "⏱️ 时长排序 (从短到长)",
        "value": "duration_asc",
        "description": "按音频长度排序"
    },
    "6": {
        "name": "🎯 相关性排序 (默认)",
        "value": "score",
        "description": "按搜索相关性排序"
    }
}


def search_sounds(api_key: str, query: str = "", filters: List[str] = None,
                  sort_by: str = "score", page_size: int = 15) -> Optional[Dict[Any, Any]]:
    """Search for sounds using text query, filters and sorting."""
    url = "https://freesound.org/apiv2/search/text/"
    params = {
        'token': api_key,
        'page_size': page_size,
        'format': 'json',
        'sort': sort_by,  # 添加排序参数
        'fields': 'id,name,username,description,duration,tags,previews,download,num_downloads,avg_rating,created'
        # 获取热度相关信息
    }

    # 添加查询词
    if query:
        params['query'] = query

    # 添加过滤器
    if filters:
        filter_string = " OR ".join(filters)
        params['filter'] = filter_string

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error searching sounds: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_detail = e.response.json().get('detail', 'Unknown error')
                print(f"API Error: {error_detail}")
            except:
                print(f"HTTP {e.response.status_code}: {e.response.text}")
        return None


def get_sound_details(api_key: str, sound_id: int) -> Optional[Dict[Any, Any]]:
    """Get detailed information about a specific sound."""
    url = f"https://freesound.org/apiv2/sounds/{sound_id}/"
    params = {
        'token': api_key,
        'format': 'json'
    }

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error getting sound details: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_detail = e.response.json().get('detail', 'Unknown error')
                print(f"API Error: {error_detail}")
            except:
                print(f"HTTP {e.response.status_code}: {e.response.text}")
        return None


def download_file(url: str, filename: str) -> bool:
    """Download a file from URL and save it locally."""
    try:
        response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()

        with open(filename, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        print(f"Successfully downloaded: {filename}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error downloading file: {e}")
        return False


def sanitize_filename(filename: str) -> str:
    """Remove or replace invalid characters for filename."""
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, '_')
    return filename[:100]


def display_categories():
    """Display available music categories."""
    print("\n=== 🎵 音乐类型选择 / Music Categories ===")
    for key, category in MUSIC_CATEGORIES.items():
        print(f"{key}. {category['name']}")
    print("9. 自定义搜索 (Custom Search)")
    print("0. 退出 (Exit)")


def display_sort_options():
    """Display available sorting options."""
    print("\n=== 📊 排序方式选择 / Sort Options ===")
    for key, option in SORT_OPTIONS.items():
        print(f"{key}. {option['name']}")
        print(f"   {option['description']}")
    print("0. 使用默认排序 (Use default)")


def get_search_parameters():
    """Get search parameters from user."""
    while True:
        display_categories()
        choice = input("\n请选择音乐类型 (Please select category): ").strip()

        if choice == "0":
            return None, None, None, None
        elif choice == "9":
            # 自定义搜索
            custom_query = input("请输入搜索关键词 (Enter search keywords): ").strip()
            if not custom_query:
                print("未输入关键词，请重试。")
                continue

            # 获取排序选项
            sort_option = get_sort_option()
            return custom_query, [], "自定义搜索", sort_option

        elif choice in MUSIC_CATEGORIES:
            category = MUSIC_CATEGORIES[choice]
            print(f"\n已选择: {category['name']}")

            # 询问是否添加额外关键词
            additional_query = input("添加额外关键词 (可选，直接回车跳过): ").strip()

            # 获取排序选项
            sort_option = get_sort_option()

            return additional_query, category['filters'], category['name'], sort_option
        else:
            print("无效选择，请重试。")


def get_sort_option():
    """Get sorting option from user."""
    while True:
        display_sort_options()
        choice = input("\n请选择排序方式 (推荐选择1-热度排序): ").strip()

        if choice == "0" or choice == "":
            return "downloads_desc"  # 默认按热度排序
        elif choice in SORT_OPTIONS:
            selected_option = SORT_OPTIONS[choice]
            print(f"已选择: {selected_option['name']}")
            return selected_option['value']
        else:
            print("无效选择，请重试。")


def format_rating(rating):
    """Format rating with stars."""
    if rating is None or rating == 0:
        return "暂无评分"
    stars = "⭐" * int(rating)
    return f"{stars} ({rating:.1f})"


def format_downloads(downloads):
    """Format download count."""
    if downloads is None:
        return "未知"
    if downloads >= 1000:
        return f"{downloads / 1000:.1f}k"
    return str(downloads)


def display_sound_info(sound, index):
    """Display detailed sound information with popularity metrics."""
    print(f"{index}. 【{sound.get('name', 'Unnamed')}】")
    print(f"   👤 作者: {sound.get('username', 'Unknown')}")
    print(f"   ⏱️  时长: {sound.get('duration', 'Unknown')}秒")

    # 显示热度信息
    downloads = sound.get('num_downloads', 0)
    rating = sound.get('avg_rating', 0)
    print(f"   🔥 下载: {format_downloads(downloads)} 次")
    print(f"   ⭐ 评分: {format_rating(rating)}")

    # 显示上传时间
    created = sound.get('created', '')
    if created:
        try:
            from datetime import datetime
            created_date = datetime.fromisoformat(created.replace('Z', '+00:00'))
            print(f"   📅 上传: {created_date.strftime('%Y-%m-%d')}")
        except:
            print(f"   📅 上传: {created[:10]}")

    # 显示标签
    tags = sound.get('tags', [])
    if tags:
        tag_str = ', '.join(tags[:6])  # 显示前6个标签
        if len(tags) > 6:
            tag_str += f" (还有{len(tags) - 6}个...)"
        print(f"   🏷️  标签: {tag_str}")

    # 显示描述（截取前80字符）
    description = sound.get('description', 'No description')
    if len(description) > 80:
        description = description[:80] + "..."
    print(f"   📝 描述: {description}")
    print()


def main():
    # Hardcoded API key
    API_KEY = "***REMOVED***"

    print("=== 🎵 Freesound 音效下载工具 (支持热度排序) ===")
    print("支持按音乐类型搜索和按热度排序下载音频文件")

    # 获取搜索参数
    query, filters, category_name, sort_option = get_search_parameters()
    if query is None and filters is None:
        print("退出程序。")
        return

    # 显示搜索配置
    print(f"\n🔍 搜索配置:")
    print(f"   类型: {category_name}")
    if query:
        print(f"   关键词: '{query}'")

    # 显示排序方式
    sort_name = next((opt['name'] for opt in SORT_OPTIONS.values() if opt['value'] == sort_option), sort_option)
    print(f"   排序: {sort_name}")

    if filters:
        print(f"   过滤器: {', '.join(filters)}")

    print("\n正在搜索...")

    # 搜索音频
    search_results = search_sounds(API_KEY, query, filters, sort_option)
    if not search_results:
        print("搜索失败，程序退出。")
        return

    sounds = search_results.get('results', [])
    if not sounds:
        print("未找到符合条件的音频文件。")
        print("\n💡 建议：")
        print("1. 尝试其他音乐类型")
        print("2. 使用更通用的关键词")
        print("3. 选择自定义搜索")
        print("4. 尝试不同的排序方式")
        return

    total_count = search_results.get('count', len(sounds))
    print(f"\n✅ 找到 {total_count} 个音频文件，显示前 {len(sounds)} 个:")
    print("=" * 80)

    # 显示搜索结果
    for i, sound in enumerate(sounds[:10], 1):  # 显示前10个结果
        display_sound_info(sound, i)

    # 让用户选择音频
    while True:
        try:
            choice = input(f"请选择要下载的音频 (1-{min(10, len(sounds))}): ").strip()
            if not choice:
                print("未选择，程序退出。")
                return

            choice_idx = int(choice) - 1
            if 0 <= choice_idx < min(10, len(sounds)):
                selected_sound = sounds[choice_idx]
                break
            else:
                print(f"请输入 1 到 {min(10, len(sounds))} 之间的数字")
        except ValueError:
            print("请输入有效数字。")

    print(f"\n🎯 已选择: 【{selected_sound.get('name', 'Unnamed')}】")
    print(f"🔥 热度: {format_downloads(selected_sound.get('num_downloads', 0))} 下载")

    # 获取详细音频信息
    sound_id = selected_sound['id']
    sound_details = get_sound_details(API_KEY, sound_id)
    if not sound_details:
        print("获取音频详细信息失败，程序退出。")
        return

    # 提取预览URL
    previews = sound_details.get('previews', {})
    if not previews:
        print("该音频没有可用的预览文件。")
        return

    # 选择最佳质量的预览格式
    preview_url = None
    preferred_formats = ['preview-hq-mp3', 'preview-lq-mp3', 'preview-hq-ogg', 'preview-lq-ogg']

    for format_name in preferred_formats:
        if format_name in previews:
            preview_url = previews[format_name]
            print(f"📄 使用预览格式: {format_name}")
            break

    if not preview_url:
        # 如果没有首选格式，使用任何可用格式
        format_name = list(previews.keys())[0]
        preview_url = previews[format_name]
        print(f"📄 使用可用格式: {format_name}")

    # 创建文件名
    sound_name = sanitize_filename(selected_sound.get('name', f'sound_{sound_id}'))
    file_extension = '.mp3' if 'mp3' in preview_url else '.ogg'
    filename = f"{sound_name}_{sound_id}{file_extension}"

    # 检查文件是否已存在
    if os.path.exists(filename):
        overwrite = input(f"文件 '{filename}' 已存在，是否覆盖? (y/n): ").strip().lower()
        if overwrite != 'y':
            print("下载取消。")
            return

    # 下载音频文件
    print(f"\n⬇️ 开始下载: {filename}")
    print("请稍候...")

    if download_file(preview_url, filename):
        print(f"\n✅ 下载完成!")
        print(f"📁 文件保存为: {filename}")
        print(f"📊 文件大小: {os.path.getsize(filename)} 字节")
        print(f"🎵 音频信息:")
        print(f"   - 类型: {category_name}")
        print(f"   - 时长: {selected_sound.get('duration', 'Unknown')} 秒")
        print(f"   - 作者: {selected_sound.get('username', 'Unknown')}")
        print(f"   - 热度: {format_downloads(selected_sound.get('num_downloads', 0))} 下载")
        print(f"   - 评分: {format_rating(selected_sound.get('avg_rating', 0))}")
    else:
        print("❌ 下载失败。")


if __name__ == "__main__":
    main()