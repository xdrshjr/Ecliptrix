"""研究服务采用惰性导入；导入包不启动浏览器或后台任务。"""
def __getattr__(name):
    import importlib
    modules = {
        "get_web_search_service": "web_search_service",
        "get_web_fetch_service": "web_fetch_service",
        "get_web_image_service": "web_image_service",
        "get_web_research_service": "web_research_service",
    }
    if name in modules:
        return getattr(importlib.import_module(f"{__name__}.{modules[name]}"), name)
    raise AttributeError(name)
