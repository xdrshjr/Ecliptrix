#!/usr/bin/env python3
"""
Simple test script for video aspect ratio conversion.
Run this script to test the video composition API with different aspect ratios.

Usage:
    python test_aspect_ratios.py                    # Test composing all videos with all aspect ratios
    python test_aspect_ratios.py 16:9              # Test composing all videos with specific aspect ratio  
    python test_aspect_ratios.py 9:16 30           # Test with specific aspect ratio and duration
"""

import os
import json
import time
import requests
import sys
from pathlib import Path

def test_video_composition(aspect_ratio: str, total_duration: float = 20.0, base_url: str = "http://localhost:8000"):
    """Test video composition with multiple videos and specific aspect ratio."""
    
    print(f"🎬 Testing: Multiple videos composition -> {aspect_ratio}")
    
    # Get all video files
    videos_dir = Path("../datas/videos")
    video_files = list(videos_dir.glob("*.mp4"))
    
    if not video_files:
        print(f"❌ No video files found in {videos_dir}")
        return False
    
    print(f"📹 Found {len(video_files)} videos: {[v.name for v in video_files]}")
    
    # Create video items for composition
    video_items = []
    duration_per_video = total_duration / len(video_files)  # 平均分配时长
    
    for i, video_file in enumerate(video_files):
        start_time = i * duration_per_video
        video_items.append({
            "id": f"video_{i+1}",
            "name": video_file.name,
            "url": f"videos/{video_file.name}",
            "start_time": start_time,
            "duration": duration_per_video,
            "track_id": "track1",
            "volume": 1.0,
            "opacity": 1.0,
            "clip_start": 0.0,
            "clip_end": min(duration_per_video, 10.0)  # 最多使用10秒
        })
    
    # Create test request
    task_id = f"test_multi_video_{aspect_ratio.replace(':', '_')}_{int(time.time())}"
    
    request_data = {
        "task_id": task_id,
        "aspect_ratio": aspect_ratio,
        "video_items": video_items,
        "audio_items": [],
        "subtitle_items": [],
        "total_duration": total_duration,
        "output_fps": 30,
        "output_format": "mp4"
    }
    
    print(f"📊 Composition details:")
    print(f"   - Total duration: {total_duration}s")
    print(f"   - Videos: {len(video_items)}")
    print(f"   - Duration per video: {duration_per_video:.1f}s")
    for item in video_items:
        print(f"   - {item['name']}: {item['start_time']:.1f}s - {item['start_time'] + item['duration']:.1f}s")
    
    try:
        # Start composition
        print(f"📤 Sending composition request...")
        response = requests.post(f"{base_url}/api/video/compose", json=request_data, timeout=30)
        
        if response.status_code != 200:
            print(f"❌ Request failed: {response.status_code} - {response.text}")
            return False
        
        result = response.json()
        composition_id = result.get("composition_id")
        
        if not composition_id:
            print(f"❌ No composition_id returned: {result}")
            return False
        
        print(f"✅ Composition started: {composition_id}")
        
        # Monitor progress
        max_wait = 600  # 10 minutes for multiple videos
        check_interval = 5
        elapsed = 0
        
        while elapsed < max_wait:
            time.sleep(check_interval)
            elapsed += check_interval
            
            # Check status
            status_response = requests.get(f"{base_url}/api/video/compose/{composition_id}/status", timeout=10)
            
            if status_response.status_code != 200:
                print(f"⚠️  Status check failed: {status_response.status_code}")
                continue
            
            status_data = status_response.json()
            status = status_data.get("status", "unknown")
            progress = status_data.get("progress", 0.0)
            
            print(f"⏳ Status: {status}, Progress: {progress:.1%} ({elapsed}s)")
            
            if status == "completed":
                output_size = status_data.get("output_file_size", 0)
                print(f"🎉 Composition completed in {elapsed}s!")
                print(f"📁 Output size: {output_size:,} bytes ({output_size/1024/1024:.1f} MB)")
                print(f"📂 Output file: static/video/composed/composed_{composition_id}.mp4")
                return True
            elif status == "failed":
                error_details = status_data.get("error_details", {})
                print(f"❌ Composition failed: {error_details}")
                return False
        
        print(f"⏰ Composition timed out after {max_wait}s")
        return False
        
    except Exception as e:
        print(f"❌ Test failed with exception: {str(e)}")
        return False

def main():
    """Main function."""
    # Check if server is running
    base_url = "http://localhost:8000"
    try:
        response = requests.get(f"{base_url}/api/video/compose/health", timeout=5)
        if response.status_code != 200:
            print(f"❌ Server health check failed: {response.status_code}")
            print("Make sure the backend server is running on http://localhost:8000")
            sys.exit(1)
    except Exception as e:
        print(f"❌ Cannot connect to server: {str(e)}")
        print("Make sure the backend server is running on http://localhost:8000")
        sys.exit(1)
    
    print("✅ Server is running")
    
    # Check available videos
    videos_dir = Path("../datas/videos")
    if not videos_dir.exists():
        print(f"❌ Videos directory not found: {videos_dir}")
        sys.exit(1)
    
    video_files = list(videos_dir.glob("*.mp4"))
    if not video_files:
        print(f"❌ No video files found in {videos_dir}")
        sys.exit(1)
    
    print(f"📹 Found videos: {[v.name for v in video_files]}")
    
    # Parse command line arguments
    aspect_ratios = ["16:9", "9:16", "4:3", "1:1", "21:9"]
    
    if len(sys.argv) == 1:
        # Test all aspect ratios
        print(f"\n🚀 Testing multi-video composition with all aspect ratios...")
        
        results = []
        total_tests = len(aspect_ratios)
        
        for i, aspect_ratio in enumerate(aspect_ratios):
            print(f"\n📊 Test {i+1}/{total_tests}")
            print("=" * 60)
            
            success = test_video_composition(aspect_ratio, total_duration=20.0, base_url=base_url)
            results.append({
                "aspect_ratio": aspect_ratio,
                "success": success
            })
            
            if i < total_tests - 1:
                print("⏸️  Waiting 5 seconds before next test...")
                time.sleep(5)
        
        # Print summary
        successful = [r for r in results if r["success"]]
        failed = [r for r in results if not r["success"]]
        
        print("\n" + "="*60)
        print("📊 MULTI-VIDEO COMPOSITION TEST SUMMARY")
        print("="*60)
        print(f"Total tests: {len(results)}")
        print(f"Successful: {len(successful)}")
        print(f"Failed: {len(failed)}")
        print(f"Success rate: {len(successful)/len(results)*100:.1f}%")
        
        if successful:
            print("\n✅ SUCCESSFUL TESTS:")
            for result in successful:
                print(f"   Multi-video -> {result['aspect_ratio']}")
        
        if failed:
            print("\n❌ FAILED TESTS:")
            for result in failed:
                print(f"   Multi-video -> {result['aspect_ratio']}")
    
    elif len(sys.argv) == 2:
        # Test specific aspect ratio
        aspect_ratio = sys.argv[1]
        
        if aspect_ratio not in aspect_ratios:
            print(f"❌ Invalid aspect ratio: {aspect_ratio}")
            print(f"Supported ratios: {aspect_ratios}")
            sys.exit(1)
        
        print(f"\n🚀 Testing multi-video composition -> {aspect_ratio}")
        print("=" * 60)
        
        success = test_video_composition(aspect_ratio, total_duration=20.0, base_url=base_url)
        
        if success:
            print(f"\n🎉 Multi-video composition test completed successfully!")
        else:
            print(f"\n❌ Multi-video composition test failed!")
    
    elif len(sys.argv) == 3:
        # Test specific aspect ratio with custom duration
        aspect_ratio = sys.argv[1]
        try:
            duration = float(sys.argv[2])
        except ValueError:
            print(f"❌ Invalid duration: {sys.argv[2]}")
            sys.exit(1)
        
        if aspect_ratio not in aspect_ratios:
            print(f"❌ Invalid aspect ratio: {aspect_ratio}")
            print(f"Supported ratios: {aspect_ratios}")
            sys.exit(1)
        
        print(f"\n🚀 Testing multi-video composition -> {aspect_ratio} ({duration}s)")
        print("=" * 60)
        
        success = test_video_composition(aspect_ratio, total_duration=duration, base_url=base_url)
        
        if success:
            print(f"\n🎉 Multi-video composition test completed successfully!")
        else:
            print(f"\n❌ Multi-video composition test failed!")
    
    else:
        print("Usage:")
        print("  python test_aspect_ratios.py                    # Test all aspect ratios")
        print("  python test_aspect_ratios.py 16:9              # Test specific aspect ratio")
        print("  python test_aspect_ratios.py 9:16 30           # Test with custom duration")
        sys.exit(1)

if __name__ == "__main__":
    main() 