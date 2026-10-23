# 系统配置文件

# RTSP摄像头配置
RTSP_CAMERAS = [
    {
        "id": 1,
        "url": "rtsp://admin:123456@192.168.10.208:554/stream1",
        "name": "摄像头1"
    },
    {
        "id": 2,
        "url": "rtsp://admin:123456@192.168.10.43:554/stream1",
        "name": "摄像头2"
    },
    {
        "id": 3,
        "url": "rtsp://admin:123456@192.168.10.48:554/stream1",
        "name": "摄像头3"
    }
]

# YOLO模型配置
YOLO_CONFIG = {
    "model_path": "./models/yolov8x.pt",
    "device": "cuda:0",  # 使用GPU
    "confidence_threshold": 0.4,
    "iou_threshold": 0.45
}

# MQTT配置
MQTT_CONFIG = {
    "broker": "localhost",
    "port": 1883,
    "client_id": "yolov8-detector",
    "username": None,
    "password": None,
    "topic_prefix": "yolov8/camera",
    "qos": 1
}

# Web服务配置
WEB_CONFIG = {
    "host": "0.0.0.0",
    "port": 9000,
    "debug": False
}

# 系统配置
SYSTEM_CONFIG = {
    "frame_buffer_size": 10,  # 每路摄像头的帧缓冲区大小
    "max_threads": 10,  # 最大线程数
    "log_level": "INFO",
    "log_file": "system.log"
}
