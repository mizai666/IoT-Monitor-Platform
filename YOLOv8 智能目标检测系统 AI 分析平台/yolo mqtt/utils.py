import logging
import time
import json
from datetime import datetime

# 配置日志
def setup_logger(name, log_file, level=logging.INFO):
    """设置日志记录器"""
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    # 文件处理器
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setFormatter(formatter)
    
    # 控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    
    logger = logging.getLogger(name)
    logger.setLevel(level)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

# 时间戳格式化
def get_timestamp():
    """获取当前时间戳，格式：YYYY-MM-DD HH:MM:SS"""
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

# 构建MQTT消息
def build_mqtt_message(cam_id, objects):
    """构建MQTT消息"""
    return {
        "time": get_timestamp(),
        "cam": cam_id,
        "count": len(objects),
        "objects": objects
    }

# 异常处理装饰器
def exception_handler(func):
    """异常处理装饰器"""
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            logger = logging.getLogger(func.__name__)
            logger.error(f"Error in {func.__name__}: {str(e)}")
            return None
    return wrapper

# 计算FPS
def calculate_fps(frame_count, start_time):
    """计算FPS"""
    if frame_count == 0:
        return 0
    elapsed = time.time() - start_time
    return frame_count / elapsed
