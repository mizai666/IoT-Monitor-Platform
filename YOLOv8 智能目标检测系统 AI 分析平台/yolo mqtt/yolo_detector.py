import os
import threading
# 设置环境变量，避免Ultralytics写入配置文件
os.environ['YOLO_CONFIG_DIR'] = './'
os.environ['YOLO_CACHE_DIR'] = './'

from ultralytics import YOLO
import cv2
import torch
from utils import setup_logger, exception_handler

logger = setup_logger('yolo_detector', 'yolo.log')

class YOLODetector:
    """YOLO目标检测器"""
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls, model_path, device='cuda:0'):
        """单例模式"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(YOLODetector, cls).__new__(cls)
        return cls._instance
    
    def __init__(self, model_path, device='cuda:0'):
        """初始化检测器"""
        if not hasattr(self, 'initialized'):
            self.model_path = model_path
            self.device = device
            self.model = None
            self.initialized = False
            self._initialize_model()
    
    @exception_handler
    def _initialize_model(self):
        """初始化模型"""
        try:
            # 检查设备
            if self.device.startswith('cuda') and not torch.cuda.is_available():
                logger.warning("CUDA不可用，使用CPU")
                self.device = 'cpu'
            
            # 加载模型
            logger.info(f"加载模型: {self.model_path} 到 {self.device}")
            self.model = YOLO(self.model_path)
            self.model.to(self.device)
            self.initialized = True
            logger.info("模型加载成功")
        except Exception as e:
            logger.error(f"模型加载失败: {str(e)}")
            self.initialized = False
    
    @exception_handler
    def detect(self, frame, confidence_threshold=0.4, iou_threshold=0.45):
        """执行目标检测"""
        if not self.initialized or self.model is None:
            logger.error("模型未初始化")
            return [], frame
        
        try:
            # 执行推理
            results = self.model(frame, 
                                conf=confidence_threshold, 
                                iou=iou_threshold, 
                                device=self.device)
            
            # 处理结果
            objects = []
            for result in results:
                boxes = result.boxes
                for box in boxes:
                    # 获取边界框
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    # 获取类别和置信度
                    class_id = int(box.cls[0])
                    confidence = float(box.conf[0])
                    class_name = self.model.names[class_id]
                    
                    # 构建对象信息
                    obj = {
                        "class": class_name,
                        "conf": round(confidence, 2),
                        "bbox": [int(x1), int(y1), int(x2), int(y2)]
                    }
                    objects.append(obj)
                    
                    # 绘制边界框
                    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                    label = f"{class_name}: {confidence:.2f}"
                    cv2.putText(frame, label, (int(x1), int(y1) - 10), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            
            return objects, frame
        except Exception as e:
            logger.error(f"检测失败: {str(e)}")
            return [], frame
    
    @exception_handler
    def clear_cache(self):
        """清理缓存"""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            logger.info("清理CUDA缓存")

# 导入threading
import threading
