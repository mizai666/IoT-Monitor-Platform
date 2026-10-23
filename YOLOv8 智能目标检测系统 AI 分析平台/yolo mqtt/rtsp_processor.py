import cv2
import threading
import queue
import time
from utils import setup_logger, exception_handler

logger = setup_logger('rtsp_processor', 'rtsp.log')

class RTSPStreamProcessor:
    """RTSP流处理器"""
    def __init__(self, cam_id, rtsp_url, buffer_size=10):
        self.cam_id = cam_id
        self.rtsp_url = rtsp_url
        self.buffer = queue.Queue(maxsize=buffer_size)
        self.running = False
        self.thread = None
        self.reconnect_delay = 1  # 重连延迟（秒）
        self.max_reconnect_delay = 60  # 最大重连延迟
    
    @exception_handler
    def start(self):
        """启动流处理线程"""
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._process_stream)
            self.thread.daemon = True
            self.thread.start()
            logger.info(f"启动摄像头 {self.cam_id} 流处理线程")
    
    @exception_handler
    def stop(self):
        """停止流处理线程"""
        if self.running:
            self.running = False
            if self.thread:
                self.thread.join(timeout=5)
            logger.info(f"停止摄像头 {self.cam_id} 流处理线程")
    
    @exception_handler
    def _process_stream(self):
        """处理RTSP流"""
        cap = None
        reconnect_delay = self.reconnect_delay
        
        while self.running:
            try:
                if cap is None or not cap.isOpened():
                    # 打开RTSP流
                    logger.info(f"连接摄像头 {self.cam_id}: {self.rtsp_url}")
                    cap = cv2.VideoCapture(self.rtsp_url)
                    
                    # 设置低延迟
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    cap.set(cv2.CAP_PROP_FPS, 30)
                    
                    if cap.isOpened():
                        logger.info(f"摄像头 {self.cam_id} 连接成功")
                        reconnect_delay = self.reconnect_delay
                    else:
                        logger.error(f"摄像头 {self.cam_id} 连接失败")
                        time.sleep(reconnect_delay)
                        reconnect_delay = min(reconnect_delay * 2, self.max_reconnect_delay)
                        continue
                
                # 读取帧
                ret, frame = cap.read()
                if not ret:
                    logger.error(f"摄像头 {self.cam_id} 读取帧失败")
                    cap.release()
                    cap = None
                    time.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 2, self.max_reconnect_delay)
                    continue
                
                # 将帧放入缓冲区，丢弃旧帧
                if self.buffer.full():
                    try:
                        self.buffer.get_nowait()
                    except queue.Empty:
                        pass
                
                self.buffer.put(frame)
                
            except Exception as e:
                logger.error(f"摄像头 {self.cam_id} 处理异常: {str(e)}")
                if cap:
                    cap.release()
                cap = None
                time.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 2, self.max_reconnect_delay)
        
        if cap:
            cap.release()
    
    @exception_handler
    def get_frame(self, block=False, timeout=None):
        """获取帧"""
        try:
            return self.buffer.get(block=block, timeout=timeout)
        except queue.Empty:
            return None
