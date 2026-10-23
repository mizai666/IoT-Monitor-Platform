import paho.mqtt.client as mqtt
import json
import threading
import time
from utils import setup_logger, build_mqtt_message, exception_handler

logger = setup_logger('mqtt_publisher', 'mqtt.log')

class MQTTPublisher:
    """MQTT发布器"""
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls, broker, port=1883, client_id=None, username=None, password=None, web_server=None):
        """单例模式"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(MQTTPublisher, cls).__new__(cls)
        return cls._instance
    
    def __init__(self, broker, port=1883, client_id=None, username=None, password=None, web_server=None):
        """初始化MQTT客户端"""
        if not hasattr(self, 'initialized'):
            self.broker = broker
            self.port = port
            self.client_id = client_id
            self.username = username
            self.password = password
            self.client = None
            self.connected = False
            self.initialized = False
            self.message_cache = []
            self.web_server = web_server
            self._initialize_client()
        else:
            # 如果实例已经初始化，更新web_server属性
            if web_server is not None:
                self.web_server = web_server
                logger.info("MQTT发布器Web服务器更新成功")
    
    @exception_handler
    def _initialize_client(self):
        """初始化MQTT客户端"""
        try:
            # 创建客户端
            self.client = mqtt.Client(client_id=self.client_id)
            
            # 设置认证信息
            if self.username and self.password:
                self.client.username_pw_set(self.username, self.password)
            
            # 设置回调函数
            self.client.on_connect = self._on_connect
            self.client.on_disconnect = self._on_disconnect
            self.client.on_publish = self._on_publish
            self.client.on_message = self._on_message
            
            # 连接到 broker
            try:
                self._connect()
            except Exception as e:
                logger.error(f"MQTT连接失败: {str(e)}")
                # 即使连接失败，也继续初始化
                self.connected = False
            
            # 启动客户端循环
            try:
                self.client.loop_start()
            except Exception as e:
                logger.error(f"MQTT循环启动失败: {str(e)}")
                
            self.initialized = True
            logger.info("MQTT客户端初始化成功")
        except Exception as e:
            logger.error(f"MQTT客户端初始化失败: {str(e)}")
            self.initialized = False
            self.client = None
    
    def _on_connect(self, client, userdata, flags, rc):
        """连接回调"""
        if rc == 0:
            self.connected = True
            logger.info(f"MQTT连接成功: {self.broker}:{self.port}")
            # 发送缓存的消息
            self._send_cached_messages()
            # 订阅所有主题
            try:
                # 订阅所有主题
                client.subscribe("#")
                logger.info("已订阅所有MQTT主题")
            except Exception as e:
                logger.error(f"订阅主题失败: {str(e)}")
        else:
            logger.error(f"MQTT连接失败，错误码: {rc}")
            self.connected = False
    
    def _on_disconnect(self, client, userdata, rc):
        """断开连接回调"""
        logger.warning(f"MQTT断开连接，错误码: {rc}")
        self.connected = False
        # 尝试重连
        self._reconnect()
    
    def _on_publish(self, client, userdata, mid):
        """发布回调"""
        pass
    
    def _on_message(self, client, userdata, message):
        """消息回调"""
        try:
            # 解析消息
            payload = message.payload.decode('utf-8')
            topic = message.topic
            
            # 记录日志
            logger.debug(f"收到MQTT消息: {topic} - {payload}")
            
            # 通过Web服务器发送到前端
            if self.web_server:
                try:
                    # 解析消息为JSON
                    payload_json = json.loads(payload)
                    self.web_server.send_mqtt_message(topic, payload_json)
                except Exception as e:
                    logger.warning(f"发送MQTT消息到前端失败: {str(e)}")
        except Exception as e:
            logger.error(f"处理MQTT消息异常: {str(e)}")
    
    @exception_handler
    def _connect(self):
        """连接到MQTT broker"""
        try:
            logger.info(f"连接到MQTT broker: {self.broker}:{self.port}")
            self.client.connect(self.broker, self.port, keepalive=60)
            logger.info("MQTT broker连接成功")
        except Exception as e:
            logger.error(f"连接MQTT broker失败: {str(e)}")
            # 即使MQTT连接失败，也允许系统继续运行
            self.connected = False
    
    @exception_handler
    def _reconnect(self):
        """重连MQTT broker"""
        delay = 1
        max_delay = 30
        
        while not self.connected and self.initialized:
            try:
                logger.info(f"尝试重连MQTT broker，延迟 {delay} 秒")
                time.sleep(delay)
                self._connect()
                delay = min(delay * 2, max_delay)
            except Exception as e:
                logger.error(f"重连失败: {str(e)}")
                delay = min(delay * 2, max_delay)
    
    @exception_handler
    def publish(self, topic, message, qos=1, retain=False):
        """发布消息"""
        if not self.initialized:
            logger.error("MQTT客户端未初始化")
            # 缓存消息
            self._cache_message(topic, message, qos, retain)
            return False
        
        if not self.connected:
            logger.warning("MQTT未连接，缓存消息")
            # 缓存消息
            self._cache_message(topic, message, qos, retain)
            return False
        
        try:
            # 发布消息
            result = self.client.publish(topic, message, qos=qos, retain=retain)
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.debug(f"消息发布成功: {topic}")
                # 通过Web服务器发送到前端
                if self.web_server:
                    try:
                        # 解析消息为JSON
                        payload = json.loads(message)
                        self.web_server.send_mqtt_message(topic, payload)
                    except Exception as e:
                        logger.warning(f"发送MQTT消息到前端失败: {str(e)}")
                return True
            else:
                logger.error(f"消息发布失败，错误码: {result.rc}")
                # 缓存消息
                self._cache_message(topic, message, qos, retain)
                return False
        except Exception as e:
            logger.error(f"发布消息异常: {str(e)}")
            # 缓存消息
            self._cache_message(topic, message, qos, retain)
            return False
    
    def _cache_message(self, topic, message, qos, retain):
        """缓存消息"""
        if len(self.message_cache) > 1000:  # 限制缓存大小
            self.message_cache.pop(0)
        
        self.message_cache.append((topic, message, qos, retain))
        logger.info(f"消息缓存，当前缓存数量: {len(self.message_cache)}")
    
    def _send_cached_messages(self):
        """发送缓存的消息"""
        if not self.connected:
            return
        
        logger.info(f"发送缓存的消息，数量: {len(self.message_cache)}")
        
        while self.message_cache:
            topic, message, qos, retain = self.message_cache.pop(0)
            try:
                result = self.client.publish(topic, message, qos=qos, retain=retain)
                if result.rc != mqtt.MQTT_ERR_SUCCESS:
                    logger.error(f"发送缓存消息失败: {topic}")
                    # 重新缓存
                    self.message_cache.insert(0, (topic, message, qos, retain))
                    break
            except Exception as e:
                logger.error(f"发送缓存消息异常: {str(e)}")
                # 重新缓存
                self.message_cache.insert(0, (topic, message, qos, retain))
                break
    
    def publish_detection(self, cam_id, objects, topic_prefix="yolov8/camera"):
        """发布检测结果"""
        if not objects:
            return False
        
        # 构建消息
        message = build_mqtt_message(cam_id, objects)
        message_str = json.dumps(message, ensure_ascii=False)
        
        # 构建主题
        topic = f"{topic_prefix}/{cam_id}"
        
        # 发布消息
        return self.publish(topic, message_str)
    
    def stop(self):
        """停止MQTT客户端"""
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()
            logger.info("MQTT客户端已停止")
