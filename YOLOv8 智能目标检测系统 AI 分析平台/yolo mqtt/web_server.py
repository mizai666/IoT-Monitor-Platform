from flask import Flask, render_template, Response, request, jsonify
from flask_socketio import SocketIO, emit
import cv2
import base64
import threading
import time
import numpy as np
from utils import setup_logger, exception_handler

logger = setup_logger('web_server', 'web.log')

class WebServer:
    """Web服务器"""
    def __init__(self, host='0.0.0.0', port=9000, debug=False, mqtt_publisher=None):
        self.host = host
        self.port = port
        self.debug = debug
        self.app = Flask(__name__)
        self.socketio = SocketIO(self.app, cors_allowed_origins="*")
        self.camera_frames = {}
        self.running = False
        self.thread = None
        self.mqtt_publisher = mqtt_publisher
        self._setup_routes()
        self._setup_socketio()
    
    def _setup_routes(self):
        """设置路由"""
        @self.app.route('/')
        def index():
            return render_template('index.html')
        
        @self.app.route('/upload', methods=['POST'])
        def upload():
            """上传图片检测"""
            if 'file' not in request.files:
                return jsonify({'error': 'No file part'})
            
            file = request.files['file']
            if file.filename == '':
                return jsonify({'error': 'No selected file'})
            
            if file:
                # 读取图片
                img = cv2.imdecode(np.frombuffer(file.read(), np.uint8), cv2.IMREAD_COLOR)
                if img is not None:
                    # 调用检测
                    from yolo_detector import YOLODetector
                    from config import YOLO_CONFIG
                    detector = YOLODetector(
                        model_path=YOLO_CONFIG['model_path'],
                        device=YOLO_CONFIG['device']
                    )
                    objects, detected_frame = detector.detect(
                        img,
                        confidence_threshold=YOLO_CONFIG['confidence_threshold'],
                        iou_threshold=YOLO_CONFIG['iou_threshold']
                    )
                    
                    # 编码结果
                    ret, buffer = cv2.imencode('.jpg', detected_frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    if ret:
                        frame_base64 = base64.b64encode(buffer).decode('utf-8')
                        
                        # MQTT发布检测结果
                        if self.mqtt_publisher:
                            try:
                                # 使用publish_detection方法发布检测结果
                                success = self.mqtt_publisher.publish_detection(0, objects)
                                if success:
                                    logger.info(f"MQTT发布上传图片检测结果: {len(objects)}个目标")
                                else:
                                    logger.warning(f"MQTT发布上传图片检测结果失败")
                            except Exception as e:
                                logger.warning(f"MQTT发布上传图片检测结果失败: {str(e)}")
                        
                        return jsonify({
                            'success': True,
                            'objects': objects,
                            'image': frame_base64
                        })
            
            return jsonify({'error': 'Failed to process image'})
    
    def _setup_socketio(self):
        """设置SocketIO"""
        @self.socketio.on('connect')
        def on_connect():
            logger.info('客户端连接')
            emit('message', {'data': '已连接到服务器'})
        
        @self.socketio.on('disconnect')
        def on_disconnect():
            logger.info('客户端断开连接')
    
    @exception_handler
    def update_frame(self, cam_id, frame, detect_time=0):
        """更新摄像头帧"""
        if frame is not None:
            # 编码为JPEG
            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if ret:
                # 转换为base64
                frame_base64 = base64.b64encode(buffer).decode('utf-8')
                # 存储帧
                self.camera_frames[cam_id] = frame_base64
                # 发送到客户端
                self.socketio.emit('frame', {'cam_id': cam_id, 'frame': frame_base64, 'detect_time': detect_time})
    
    @exception_handler
    def send_log(self, message):
        """发送日志消息"""
        self.socketio.emit('log', {'message': message})
    
    @exception_handler
    def send_detection(self, cam_id, objects):
        """发送检测结果"""
        self.socketio.emit('detection', {'cam': cam_id, 'objects': objects})
    
    @exception_handler
    def send_mqtt_message(self, topic, payload):
        """发送MQTT消息"""
        self.socketio.emit('mqtt_message', {'topic': topic, 'payload': payload})
    
    @exception_handler
    def start(self):
        """启动Web服务器"""
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._run_server)
            self.thread.daemon = True
            self.thread.start()
            logger.info(f"Web服务器启动在 http://{self.host}:{self.port}")
    
    @exception_handler
    def _run_server(self):
        """运行Web服务器"""
        try:
            logger.info(f"启动Web服务器在 http://{self.host}:{self.port}")
            # 使用更可靠的启动方式
            self.socketio.run(self.app, host=self.host, port=self.port, debug=self.debug, use_reloader=False)
        except Exception as e:
            logger.error(f"Web服务器运行异常: {str(e)}")
            self.running = False
    
    def stop(self):
        """停止Web服务器"""
        if self.running:
            self.running = False
            # SocketIO会自动处理停止
            logger.info("Web服务器已停止")
