import os
import time  
# Install SDK:  pip install 'volcengine-python-sdk[ark]'
from volcenginesdkarkruntime import Ark 

# Make sure that you have stored the API Key in the environment variable ARK_API_KEY
# Initialize the Ark client to read your API Key from an environment variable
client = Ark(
    # This is the default path. You can configure it based on the service location
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    # Get API Key：https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)
  
if __name__ == "__main__": 
    print("----- create request -----") 
    try:
        create_result = client.content_generation.tasks.create( 
            model="",  # Replace with Model ID 
            content=[ 
                { 
                    # Combination of text prompt and parameters 
                    "type": "text", 
                    "text": "[图1]戴着眼镜穿着蓝色T恤的男生和[图2]的柯基小狗，坐在[图3]的草坪上，视频卡通风格" 
                },
                { 
                    # The URL of the first reference image  
                    # 1-4 reference images need to be provided
                    "type": "image_url", 
                    "image_url": { 
                        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seelite_ref_1.png"
                    },
                    "role": "reference_image"  
                },
                { 
                    # The URL of the second reference image  
                    "type": "image_url", 
                    "image_url": { 
                        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seelite_ref_2.png" 
                    },
                    "role": "reference_image"  
                },
                { 
                    # The URL of the third reference image  
                    "type": "image_url", 
                    "image_url": { 
                        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seelite_ref_3.png" 
                    },
                    "role": "reference_image"  
                } 
            ],
            ratio="16:9",
            duration=5,
            watermark=True,
        ) 
        print(create_result) 
    
        # Polling query section 
        print("----- polling task status -----") 
        task_id = create_result.id 
        while True: 
            get_result = client.content_generation.tasks.get(task_id=task_id) 
            status = get_result.status 
            if status == "succeeded": 
                print("----- task succeeded -----") 
                print(get_result) 
                break 
            elif status == "failed": 
                print("----- task failed -----") 
                print(f"Error: {get_result.error}") 
                break 
            else: 
                print(f"Current status: {status}, Retrying after 10 seconds...") 
                time.sleep(10)
    except Exception as e:
        print(f"An error occurred: {e}")