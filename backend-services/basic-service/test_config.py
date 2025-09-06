#!/usr/bin/env python3
"""
Test script to verify RUNNING_HUB_API_KEY configuration loading.
"""

import os
import sys
from pathlib import Path

# Add the app directory to Python path
app_dir = Path(__file__).parent / "app"
sys.path.insert(0, str(app_dir))

def test_config_loading():
    """Test if the configuration loads correctly."""
    print("Testing configuration loading...")
    
    # Check if .env file exists
    env_file = Path(__file__).parent / ".env"
    print(f"Checking .env file: {env_file}")
    print(f".env exists: {env_file.exists()}")
    
    if env_file.exists():
        print("\n.env file contents:")
        with open(env_file, 'r') as f:
            for line_num, line in enumerate(f, 1):
                if 'RUNNING_HUB_API_KEY' in line:
                    print(f"  Line {line_num}: {line.strip()}")
    
    # Check environment variable
    api_key = os.getenv("RUNNING_HUB_API_KEY")
    print(f"\nEnvironment variable RUNNING_HUB_API_KEY: {'SET' if api_key else 'NOT SET'}")
    if api_key:
        print(f"Value: {api_key[:10]}...")
    
    # Try to load settings
    try:
        from app.config import get_settings
        settings = get_settings()
        print(f"\nSettings loaded successfully!")
        print(f"running_hub_api_key: {'SET' if settings.running_hub_api_key else 'NOT SET'}")
        if settings.running_hub_api_key:
            print(f"Value: {settings.running_hub_api_key[:10]}...")
        
        # Try to create RunningHub service
        try:
            from app.services.runninghub_service import RunningHubService
            service = RunningHubService()
            print(f"\nRunningHubService created successfully!")
            print(f"API Key: {service.api_key[:10]}...")
            print(f"Workflow ID: {service.workflow_id}")
            print(f"Base URL: {service.base_url}")
            
        except Exception as e:
            print(f"\nFailed to create RunningHubService: {e}")
            
    except Exception as e:
        print(f"\nFailed to load settings: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_config_loading()