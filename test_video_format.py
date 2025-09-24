#!/usr/bin/env python3
"""
Test script to verify video format compatibility after watermark removal.
"""

import requests
import json
import time
import subprocess

def check_video_format(video_url):
    """Check video format using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_format', '-show_streams', video_url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            data = json.loads(result.stdout)
            
            print("📹 Video Format Analysis:")
            print("-" * 40)
            
            # Check format
            format_info = data.get('format', {})
            print(f"📄 Container: {format_info.get('format_name', 'unknown')}")
            print(f"⏱️ Duration: {format_info.get('duration', 'unknown')}s")
            print(f"📊 Bitrate: {format_info.get('bit_rate', 'unknown')} bps")
            
            # Check video streams
            for stream in data.get('streams', []):
                if stream.get('codec_type') == 'video':
                    print(f"🎬 Video Codec: {stream.get('codec_name', 'unknown')}")
                    print(f"📐 Resolution: {stream.get('width', '?')}x{stream.get('height', '?')}")
                    print(f"🎞️ Frame Rate: {stream.get('r_frame_rate', 'unknown')}")
                    print(f"🎨 Pixel Format: {stream.get('pix_fmt', 'unknown')}")
                    
                    # Check web compatibility
                    codec = stream.get('codec_name', '').lower()
                    pix_fmt = stream.get('pix_fmt', '').lower()
                    
                    web_compatible = (codec == 'h264' and pix_fmt == 'yuv420p')
                    print(f"🌐 Web Compatible: {'✅ YES' if web_compatible else '❌ NO'}")
                    
                    if not web_compatible:
                        print(f"⚠️ Recommended: H.264 codec with yuv420p pixel format")
                
                elif stream.get('codec_type') == 'audio':
                    print(f"🔊 Audio Codec: {stream.get('codec_name', 'unknown')}")
            
            return True
        else:
            print(f"❌ Failed to analyze video: {result.stderr}")
            return False
            
    except Exception as e:
        print(f"💥 Error analyzing video: {str(e)}")
        return False

def test_watermark_removal_with_format_check():
    """Test watermark removal and check the output video format."""
    
    test_request = {
        "task_id": f"format_test_{int(time.time())}",
        "video_url": "https://videos.pexels.com/video-files/855564/855564-hd_1280_720_24fps.mp4",
        "watermark_area": {
            "x1": 500,
            "y1": 300,
            "x2": 800,
            "y2": 400
        },
        "inpaint_method": "telea",
        "inpaint_radius": 5,
        "custom_filename": "format_test_no_watermark.mp4"
    }
    
    print("🚀 Testing watermark removal with format verification...")
    print(f"📋 Test request: {json.dumps(test_request, indent=2)}")
    print("\n" + "="*50)
    
    try:
        # Check original video format
        print("📹 Original Video Analysis:")
        check_video_format(test_request["video_url"])
        print("\n" + "="*50)
        
        # Send watermark removal request
        print("⏳ Processing watermark removal...")
        response = requests.post(
            "http://localhost:3000/api/video/watermark-removal",
            json=test_request,
            timeout=300  # 5 minutes timeout
        )
        
        print(f"📊 Response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            
            if result.get("success"):
                print("🎉 Watermark removal successful!")
                processed_url = result.get('processed_video_url')
                print(f"📹 Processed video URL: {processed_url}")
                print(f"⏱️ Processing time: {result.get('processing_time', 0):.2f}s")
                
                print("\n" + "="*50)
                print("📹 Processed Video Analysis:")
                
                # Check processed video format
                if processed_url:
                    format_ok = check_video_format(processed_url)
                    
                    if format_ok:
                        print("\n✅ Video format analysis completed!")
                        print("💡 Try playing the video in a browser to test compatibility.")
                    else:
                        print("\n❌ Could not analyze processed video format.")
                else:
                    print("❌ No processed video URL returned.")
            else:
                print(f"❌ Watermark removal failed: {result.get('message')}")
                if result.get('error_code'):
                    print(f"🔍 Error code: {result.get('error_code')}")
        else:
            print(f"❌ HTTP Error: {response.status_code}")
            print(f"📄 Response: {response.text}")
            
    except requests.exceptions.Timeout:
        print("⏰ Request timed out")
    except Exception as e:
        print(f"💥 Error: {str(e)}")

if __name__ == "__main__":
    test_watermark_removal_with_format_check() 