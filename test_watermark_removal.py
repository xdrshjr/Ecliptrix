#!/usr/bin/env python3
"""
Simple test script for watermark removal functionality.
"""

import requests
import json
import time

def test_watermark_removal():
    """Test the watermark removal API endpoint."""
    
    # Test data
    test_request = {
        "task_id": f"test_watermark_{int(time.time())}",
        "video_url": "https://videos.pexels.com/video-files/855564/855564-hd_1280_720_24fps.mp4",
        "watermark_area": {
            "x1": 500,
            "y1": 300,
            "x2": 800,
            "y2": 400
        },
        "inpaint_method": "telea",
        "inpaint_radius": 5,
        "custom_filename": "test_no_watermark.mp4"
    }
    
    print("🚀 Testing watermark removal API...")
    print(f"📋 Test request: {json.dumps(test_request, indent=2)}")
    
    try:
        # Send request to Next.js API (which proxies to FastAPI)
        response = requests.post(
            "http://localhost:3000/api/video/watermark-removal",
            json=test_request,
            timeout=300  # 5 minutes timeout
        )
        
        print(f"📊 Response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Response: {json.dumps(result, indent=2)}")
            
            if result.get("success"):
                print("🎉 Watermark removal successful!")
                print(f"📹 Processed video URL: {result.get('processed_video_url')}")
                print(f"⏱️ Processing time: {result.get('processing_time', 0):.2f}s")
                print(f"🎬 Total frames: {result.get('total_frames', 0)}")
            else:
                print(f"❌ Watermark removal failed: {result.get('message')}")
                if result.get('error_code'):
                    print(f"🔍 Error code: {result.get('error_code')}")
        else:
            print(f"❌ HTTP Error: {response.status_code}")
            print(f"📄 Response: {response.text}")
            
    except requests.exceptions.Timeout:
        print("⏰ Request timed out (this is normal for video processing)")
    except Exception as e:
        print(f"💥 Error: {str(e)}")

if __name__ == "__main__":
    test_watermark_removal() 