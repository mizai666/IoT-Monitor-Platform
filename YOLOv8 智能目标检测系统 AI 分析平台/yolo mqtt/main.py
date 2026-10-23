import threading
import time
import torch
from config import RTSP_CAMERAS, YOLO_CONFIG, MQTT_CONFIG, WEB_CONFIG, SYSTEM_CONFIG
from rtsp_processor import RTSPStreamProcessor
from yolo_detector import YOLODetector
from mqtt_publisher import MQTTPublisher
from web_server import WebServer
from utils import setup_logger, calculate_fps, get_timestamp

logger = setup_logger('main', 'system.log')

class SystemManager:
    """系统管理器"""
    def __init__(self):
        self.stream_processors = []
        self.detector = None
        self.mqtt_publisher = None
        self.web_server = None
        self.running = False
        self.process_threads = []
    
    def initialize(self):
        """初始化系统"""
        logger.info("初始化系统")
        
        # 初始化YOLO检测器
        try:
            self.detector = YOLODetector(
                model_path=YOLO_CONFIG['model_path'],
                device=YOLO_CONFIG['device']
            )
        except Exception as e:
            logger.error(f"初始化YOLO检测器失败: {str(e)}")
            return False
        
        # 初始化MQTT发布器
        try:
            self.mqtt_publisher = MQTTPublisher(
                broker=MQTT_CONFIG['broker'],
                port=MQTT_CONFIG['port'],
                client_id=MQTT_CONFIG['client_id'],
                username=MQTT_CONFIG['username'],
                password=MQTT_CONFIG['password']
            )
        except Exception as e:
            logger.error(f"初始化MQTT发布器失败: {str(e)}")
            return False
        
        # 初始化Web服务器
        try:
            self.web_server = WebServer(
                host=WEB_CONFIG['host'],
                port=WEB_CONFIG['port'],
                debug=WEB_CONFIG['debug']
            )
        except Exception as e:
            logger.error(f"初始化Web服务器失败: {str(e)}")
            return False
        
        # 初始化RTSP流处理器
        for camera in RTSP_CAMERAS:
            try:
                processor = RTSPStreamProcessor(
                    cam_id=camera['id'],
                    rtsp_url=camera['url'],
                    buffer_size=SYSTEM_CONFIG['frame_buffer_size']
                )
                self.stream_processors.append(processor)
            except Exception as e:
                logger.error(f"初始化摄像头 {camera['id']} 流处理器失败: {str(e)}")
        
        return True
    
    def start(self):
        """启动系统"""
        logger.info("启动系统")
        
        # 初始化系统组件
        try:
            # 初始化YOLO检测器
            self.detector = YOLODetector(
                model_path=YOLO_CONFIG['model_path'],
                device=YOLO_CONFIG['device']
            )
            logger.info("YOLO检测器初始化成功")
        except Exception as e:
            logger.error(f"初始化YOLO检测器失败: {str(e)}")
            return False
        
        # 初始化Web服务器
        try:
            self.web_server = WebServer(
                host=WEB_CONFIG['host'],
                port=WEB_CONFIG['port'],
                debug=WEB_CONFIG['debug']
            )
            logger.info("Web服务器初始化成功")
        except Exception as e:
            logger.error(f"初始化Web服务器失败: {str(e)}")
            return False
        
        try:
            # 初始化MQTT发布器，传递web_server参数
            self.mqtt_publisher = MQTTPublisher(
                broker=MQTT_CONFIG['broker'],
                port=MQTT_CONFIG['port'],
                client_id=MQTT_CONFIG['client_id'],
                username=MQTT_CONFIG['username'],
                password=MQTT_CONFIG['password'],
                web_server=self.web_server
            )
            logger.info("MQTT发布器初始化成功")
        except Exception as e:
            logger.warning(f"初始化MQTT发布器失败: {str(e)}")
            # MQTT连接失败不影响系统启动
            self.mqtt_publisher = None
        
        # 将MQTT发布器传递给Web服务器
        self.web_server.mqtt_publisher = self.mqtt_publisher
        
        try:
            # 初始化RTSP流处理器
            for camera in RTSP_CAMERAS:
                processor = RTSPStreamProcessor(
                    cam_id=camera['id'],
                    rtsp_url=camera['url'],
                    buffer_size=SYSTEM_CONFIG['frame_buffer_size']
                )
                self.stream_processors.append(processor)
            logger.info("RTSP流处理器初始化成功")
        except Exception as e:
            logger.error(f"初始化RTSP流处理器失败: {str(e)}")
            return False
        
        self.running = True
        
        # 启动Web服务器
        self.web_server.start()
        time.sleep(2)  # 等待Web服务器启动
        
        # 启动RTSP流处理器
        for processor in self.stream_processors:
            processor.start()
            time.sleep(0.5)  # 避免同时启动所有线程
        
        # 启动处理线程
        for processor in self.stream_processors:
            thread = threading.Thread(
                target=self._process_camera,
                args=(processor,)
            )
            thread.daemon = True
            thread.start()
            self.process_threads.append(thread)
            time.sleep(0.5)  # 避免同时启动所有线程
        
        # 启动系统监控线程
        monitor_thread = threading.Thread(target=self._monitor_system)
        monitor_thread.daemon = True
        monitor_thread.start()
        
        logger.info("系统启动成功")
        return True
    
    def _process_camera(self, processor):
        """处理单个摄像头"""
        cam_id = processor.cam_id
        frame_count = 0
        start_time = time.time()
        
        while self.running:
            try:
                # 获取帧
                frame = processor.get_frame(block=True, timeout=1)
                if frame is None:
                    continue
                
                # 执行检测
                detect_start = time.time()
                objects, detected_frame = self.detector.detect(
                    frame,
                    confidence_threshold=YOLO_CONFIG['confidence_threshold'],
                    iou_threshold=YOLO_CONFIG['iou_threshold']
                )
                detect_time = int((time.time() - detect_start) * 1000)
                
                # 发布检测结果
                if objects:
                    # 发送日志
                    self.web_server.send_log(f"摄像头 {cam_id} 检测到 {len(objects)} 个目标")
                    # 发送检测结果到前端
                    self.web_server.send_detection(cam_id, objects)
                    # 只有当MQTT发布器可用时才发布消息
                    if self.mqtt_publisher:
                        self.mqtt_publisher.publish_detection(
                            cam_id=cam_id,
                            objects=objects,
                            topic_prefix=MQTT_CONFIG['topic_prefix']
                        )
                
                # 更新Web界面
                self.web_server.update_frame(cam_id, detected_frame, detect_time)
                
                # 计算FPS
                frame_count += 1
                if frame_count % 30 == 0:
                    fps = calculate_fps(frame_count, start_time)
                    logger.info(f"摄像头 {cam_id} FPS: {fps:.2f}")
                    frame_count = 0
                    start_time = time.time()
                
            except Exception as e:
                logger.error(f"处理摄像头 {cam_id} 异常: {str(e)}")
                time.sleep(1)
    
    def _monitor_system(self):
        """监控系统状态"""
        while self.running:
            try:
                # 每10秒清理一次缓存
                if self.detector:
                    self.detector.clear_cache()
                
                # 发送GPU使用率
                if torch.cuda.is_available():
                    import pynvml
                    try:
                        pynvml.nvmlInit()
                        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                        utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                        gpu_usage = utilization.gpu
                        self.web_server.socketio.emit('gpu_usage', {'usage': gpu_usage})
                    except Exception as e:
                        logger.warning(f"获取GPU使用率失败: {str(e)}")
                
                # 打印系统状态
                logger.info(f"系统运行中 - {get_timestamp()}")
                time.sleep(10)
            except Exception as e:
                logger.error(f"监控系统异常: {str(e)}")
                time.sleep(10)
    
    def stop(self):
        """停止系统"""
        logger.info("停止系统")
        
        self.running = False
        
        # 停止RTSP流处理器
        for processor in self.stream_processors:
            processor.stop()
        
        # 停止MQTT发布器
        if self.mqtt_publisher:
            self.mqtt_publisher.stop()
        
        # 停止Web服务器
        if self.web_server:
            self.web_server.stop()
        
        # 等待线程结束
        for thread in self.process_threads:
            thread.join(timeout=5)
        
        logger.info("系统已停止")

if __name__ == "__main__":
    # 创建系统管理器
    manager = SystemManager()
    
    try:
        # 启动系统
        if manager.start():
            # 保持运行
            print("系统启动成功，按Ctrl+C停止...")
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        logger.info("接收到中断信号，停止系统")
        manager.stop()
    except Exception as e:
        logger.error(f"系统运行异常: {str(e)}")
        import traceback
        traceback.print_exc()
        manager.stop()
