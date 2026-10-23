-- ============================================
-- 数据库: hbuilderchapter01
-- 说明: 物联网平台数据库建表脚本
-- 生成时间: 2026-09-18
-- 包含 24 张表（与 backend/app.js 自动建表一致）
-- ============================================

CREATE DATABASE IF NOT EXISTS hbuilderchapter01
    DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE hbuilderchapter01;

DROP TABLE IF EXISTS `devices`;
CREATE TABLE `devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `sensor_history`;
CREATE TABLE `sensor_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` int NOT NULL,
  `sensor_name` varchar(100) NOT NULL,
  `value` text NOT NULL,
  `timestamp` bigint NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `publish_history`;
CREATE TABLE `publish_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(50) NOT NULL,
  `type` varchar(10) DEFAULT 'mqtt',
  `topic` varchar(500) NOT NULL,
  `payload` text,
  `qos` varchar(10) DEFAULT '0',
  `ok` tinyint(1) DEFAULT '1',
  `status` varchar(20) DEFAULT '',
  `url` varchar(500) DEFAULT '',
  `response_data` text,
  `method` varchar(10) DEFAULT '',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `response_rules`;
CREATE TABLE `response_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(50) NOT NULL,
  `rule_name` varchar(100) DEFAULT '',
  `array_path` varchar(200) NOT NULL,
  `target_key` varchar(100) NOT NULL,
  `command_key` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='响应规则表';

DROP TABLE IF EXISTS `switch_configs`;
CREATE TABLE `switch_configs` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '开关配置ID',
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `key_name` varchar(100) NOT NULL COMMENT 'JSON键名',
  `display_name` varchar(255) NOT NULL COMMENT '显示名称',
  `publish_topic` varchar(255) NOT NULL COMMENT 'MQTT发布主题',
  `active_high` tinyint(1) DEFAULT '1' COMMENT '是否高电平点亮: 0-低电平, 1-高电平',
  `is_on` tinyint DEFAULT '0' COMMENT '当前开关状态: 0-关, 1-开',
  `resp_array_path` varchar(200) DEFAULT '' COMMENT 'HTTP响应数组路径',
  `resp_target_key` varchar(100) DEFAULT '' COMMENT '响应目标字段',
  `resp_command_key` varchar(100) DEFAULT '' COMMENT '响应命令字段',
  `resp_value_map` text COMMENT '响应值映射表',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='开关配置表';

DROP TABLE IF EXISTS `auto_switch_configs`;
CREATE TABLE `auto_switch_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `key_name` varchar(100) NOT NULL COMMENT '监测的键名',
  `auto_value` varchar(100) NOT NULL DEFAULT '' COMMENT '自动键值',
  `manual_value` varchar(100) NOT NULL DEFAULT '' COMMENT '手动键值',
  `publish_topic` varchar(255) DEFAULT '' COMMENT '发送指令的发布主题',
  `current_mode` varchar(10) DEFAULT 'manual' COMMENT '当前模式 auto/manual',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='自动/手动开关配置表';

DROP TABLE IF EXISTS `theme_configs`;
CREATE TABLE `theme_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `theme_code` varchar(20) NOT NULL COMMENT '主题类型编码',
  `display_name` varchar(255) NOT NULL COMMENT '显示名称',
  `http_key_name` varchar(200) DEFAULT '' COMMENT 'HTTP响应字段路径',
  `http_key_value` varchar(100) DEFAULT '' COMMENT 'HTTP触发值',
  `mqtt_key_name` varchar(100) DEFAULT '' COMMENT 'MQTT键名',
  `mqtt_key_value` varchar(100) DEFAULT '' COMMENT 'MQTT键值',
  `publish_topic` varchar(255) NOT NULL COMMENT 'MQTT发布主题',
  `is_active` tinyint(1) DEFAULT '0' COMMENT '是否当前生效',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='主题控制配置表';

DROP TABLE IF EXISTS `schedule_configs`;
CREATE TABLE `schedule_configs` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '定时任务ID',
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `key_name` varchar(100) NOT NULL COMMENT 'JSON键名',
  `display_name` varchar(255) NOT NULL COMMENT '显示名称',
  `publish_topic` varchar(255) NOT NULL COMMENT 'MQTT发布主题',
  `active_high` tinyint(1) DEFAULT '1' COMMENT '是否高电平点亮: 0-低电平, 1-高电平',
  `target_state` tinyint(1) NOT NULL COMMENT '目标状态: 0=关, 1=开',
  `schedule_time` varchar(10) NOT NULL COMMENT '间隔秒数',
  `enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用: 0-禁用, 1-启用',
  `last_executed` varchar(16) DEFAULT NULL COMMENT '上次执行时间戳 防重复',
  `resp_array_path` varchar(200) DEFAULT '' COMMENT 'HTTP响应数组路径',
  `resp_target_key` varchar(100) DEFAULT '' COMMENT '响应目标字段',
  `resp_command_key` varchar(100) DEFAULT '' COMMENT '响应命令字段',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='定时任务配置表';

DROP TABLE IF EXISTS `threshold_configs`;
CREATE TABLE `threshold_configs` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '阈值配置ID',
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `sensor_key` varchar(100) NOT NULL COMMENT '监测的JSON键名',
  `display_name` varchar(255) NOT NULL COMMENT '显示名称',
  `min_value` double NOT NULL COMMENT '最小值',
  `max_value` double NOT NULL COMMENT '最大值',
  `alarm_message` varchar(255) DEFAULT NULL COMMENT '报警消息',
  `send_to_device` tinyint(1) DEFAULT '0' COMMENT '是否发送阈值设定至设备',
  `upper_key` varchar(100) DEFAULT NULL COMMENT '上限键名',
  `lower_key` varchar(100) DEFAULT NULL COMMENT '下限键名',
  `publish_topic` varchar(255) DEFAULT NULL COMMENT '阈值设定发布主题',
  `alarm_send_json` text COMMENT '报警时发送的JSON指令',
  `resp_max_path` varchar(200) DEFAULT '' COMMENT 'HTTP响应上限数据路径',
  `resp_min_path` varchar(200) DEFAULT '' COMMENT 'HTTP响应下限数据路径',
  `enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阈值配置表';

DROP TABLE IF EXISTS `threshold_alarms`;
CREATE TABLE `threshold_alarms` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '报警记录ID',
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `threshold_id` int NOT NULL COMMENT '阈值配置ID',
  `sensor_key` varchar(100) NOT NULL COMMENT '传感器键名',
  `current_value` varchar(100) NOT NULL COMMENT '当前值',
  `alarm_message` varchar(255) NOT NULL COMMENT '报警消息',
  `min_value` double NOT NULL COMMENT '阈值下限',
  `max_value` double NOT NULL COMMENT '阈值上限',
  `alarm_time` bigint NOT NULL COMMENT '报警时间戳(毫秒)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_threshold_id` (`threshold_id`),
  KEY `idx_alarm_time` (`alarm_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阈值报警记录表';

DROP TABLE IF EXISTS `alarm_history`;
CREATE TABLE `alarm_history` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `project_id` int NOT NULL COMMENT '项目ID',
  `sensor_name` varchar(100) NOT NULL COMMENT '传感器名称',
  `alarm_message` text NOT NULL COMMENT '报警消息内容',
  `timestamp` bigint NOT NULL COMMENT 'Unix时间戳(毫秒)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报警历史数据表';

DROP TABLE IF EXISTS `webview_configs`;
CREATE TABLE `webview_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(50) NOT NULL,
  `page_url` varchar(255) NOT NULL COMMENT '网页地址',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `device_id` (`device_id`),
  KEY `idx_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `webview_screenshots`;
CREATE TABLE `webview_screenshots` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '截图ID',
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `source` varchar(50) DEFAULT '' COMMENT '截图来源',
  `image_base64` longtext NOT NULL COMMENT '截图base64',
  `json_data` text COMMENT '检测结果JSON',
  `timestamp` bigint NOT NULL COMMENT '截图时间戳(毫秒)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='网页截图记录表';

DROP TABLE IF EXISTS `mqtt_config`;
CREATE TABLE `mqtt_config` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '配置ID',
  `config_type` enum('subscribe','publish') NOT NULL DEFAULT 'subscribe' COMMENT '配置类型: subscribe-订阅配置, publish-发布配置',
  `client_id` varchar(100) NOT NULL COMMENT '客户端ID',
  `broker_url` varchar(255) NOT NULL COMMENT 'MQTT服务器地址',
  `port` int NOT NULL COMMENT '端口号',
  `qos` int DEFAULT '0' COMMENT 'QoS等级',
  `topic` varchar(255) NOT NULL COMMENT '主题',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_config_type` (`config_type`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MQTT配置信息表';

DROP TABLE IF EXISTS `mqtt_messages`;
CREATE TABLE `mqtt_messages` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '消息ID',
  `device_id` int DEFAULT NULL COMMENT '设备ID',
  `device_type` varchar(10) DEFAULT NULL COMMENT '设备类型',
  `json_data` text NOT NULL COMMENT 'JSON数据内容',
  `time` varchar(50) NOT NULL COMMENT '格式化时间字符串 yyyy-MM-dd HH:mm:ss',
  `timestamp_ms` bigint DEFAULT NULL COMMENT 'Unix时间戳(毫秒)，可为空',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_time` (`time`),
  KEY `idx_timestamp_ms` (`timestamp_ms`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MQTT消息统一存储表';

DROP TABLE IF EXISTS `cloud_configs`;
CREATE TABLE `cloud_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `platform` varchar(50) NOT NULL COMMENT 'huawei/aliyun/tencent/onenet/gizwits',
  `config_json` text NOT NULL COMMENT '平台认证配置JSON',
  `enabled` tinyint(1) DEFAULT '1',
  `connected` tinyint(1) DEFAULT '0',
  `poll_interval_sec` int DEFAULT '10' COMMENT '轮询间隔秒',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform` (`platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='云服务平台配置表';

DROP TABLE IF EXISTS `special_devices`;
CREATE TABLE `special_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `content_hash` varchar(64) DEFAULT NULL,
  `last_timestamp` bigint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `special_data`;
CREATE TABLE `special_data` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` int NOT NULL,
  `json_data` text NOT NULL,
  `timestamp` bigint NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `sensor_display_names`;
CREATE TABLE `sensor_display_names` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` int NOT NULL,
  `sensor_key` varchar(100) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_sensor` (`device_id`,`sensor_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `flag_configs`;
CREATE TABLE `flag_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(50) NOT NULL,
  `show_key` varchar(100) NOT NULL DEFAULT '' COMMENT '显示标志位键名',
  `hide_key` varchar(100) NOT NULL DEFAULT '' COMMENT '隐藏标志位键名',
  `online_key` varchar(100) NOT NULL DEFAULT '' COMMENT '在线标志位键名',
  `offline_timeout` int NOT NULL DEFAULT 0 COMMENT '离线判定秒数，0=不启用',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标志位配置表';

DROP TABLE IF EXISTS `camera_configs`;
CREATE TABLE `camera_configs` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '配置ID',
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `yolo_url` varchar(255) NOT NULL COMMENT 'YOLOv8服务器地址',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_id` (`device_id`),
  KEY `idx_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='摄像头配置表';

DROP TABLE IF EXISTS `camera_records`;
CREATE TABLE `camera_records` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `project_id` int NOT NULL COMMENT '项目ID',
  `json_data` text NOT NULL COMMENT 'JSON数据内容',
  `timestamp` bigint NOT NULL COMMENT 'Unix时间戳(毫秒)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_project_timestamp` (`project_id`,`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='摄像头数据记录表';

DROP TABLE IF EXISTS `camera_screenshots`;
CREATE TABLE `camera_screenshots` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '截图ID',
  `device_id` varchar(50) NOT NULL COMMENT '设备ID',
  `cam_id` int NOT NULL COMMENT '摄像头编号',
  `image_base64` longtext NOT NULL COMMENT '截图base64',
  `json_data` text NOT NULL COMMENT '检测结果JSON',
  `timestamp` bigint NOT NULL COMMENT '截图时间戳(毫秒)',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='摄像头截图记录表';

DROP TABLE IF EXISTS `special_json_records`;
CREATE TABLE `special_json_records` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `project_id` int NOT NULL COMMENT '项目ID',
  `json_data` text NOT NULL COMMENT 'JSON数据内容',
  `timestamp` bigint NOT NULL COMMENT 'Unix时间戳(毫秒)',
  `created_at` bigint NOT NULL COMMENT '创建时间戳(毫秒) - 由应用层提供',
  `created_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '数据库记录创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_project_timestamp` (`project_id`,`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='特殊JSON数据表';

DROP TABLE IF EXISTS `projects`;
CREATE TABLE `projects` (
  `project_id` int NOT NULL COMMENT '项目ID',
  `display_name` varchar(255) NOT NULL COMMENT '显示名称',
  `schema_keys` text COMMENT 'Schema键值定义(JSON格式)',
  `is_special` tinyint(1) DEFAULT '0' COMMENT '是否为特殊项目: 0-否, 1-是',
  `pinned` tinyint(1) DEFAULT '0' COMMENT '是否置顶: 0-否, 1-是',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间',
  PRIMARY KEY (`project_id`),
  KEY `idx_pinned` (`pinned`),
  KEY `idx_is_special` (`is_special`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目管理表';
