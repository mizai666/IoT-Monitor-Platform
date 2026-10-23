const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// 云平台轮询服务
const cloudPoller = require('./services/cloud-poller');
const AliyunIoTService = require('./services/aliyun-iot');

app.set('etag', false);
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 自动建库
(async () => {
  const temp = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'root' });
  await temp.query('CREATE DATABASE IF NOT EXISTS hbuilderchapter01');
  await temp.end();
})();

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'hbuilderchapter01',
    waitForConnections: true,
    connectionLimit: 10,
    multipleStatements: true,
});

pool.getConnection().then(async conn => {
    console.log('数据库连接成功');
    await conn.query(`CREATE TABLE IF NOT EXISTS devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS sensor_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        sensor_name VARCHAR(100) NOT NULL,
        value TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id),
        INDEX idx_timestamp (timestamp)
    )`);
    // 兼容旧表：sensor_history 旧结构用 project_id，且 project_id NOT NULL 会拦新插入，迁移为 device_id
    try { await conn.query("ALTER TABLE sensor_history ADD COLUMN device_id INT NOT NULL DEFAULT 0"); } catch (e) { /* 列已存在 */ }
    try { await conn.query("UPDATE sensor_history SET device_id = project_id WHERE project_id > 0 AND device_id = 0"); } catch (e) {}
    try { await conn.query("ALTER TABLE sensor_history MODIFY COLUMN project_id INT NULL"); } catch (e) {}
    try { await conn.query("ALTER TABLE sensor_history ADD INDEX idx_device_id (device_id)"); } catch (e) {}
    await conn.query(`CREATE TABLE IF NOT EXISTS publish_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        type VARCHAR(10) DEFAULT 'mqtt',
        topic VARCHAR(500) NOT NULL,
        payload TEXT,
        qos VARCHAR(10) DEFAULT '0',
        ok TINYINT(1) DEFAULT 1,
        status VARCHAR(20) DEFAULT '',
        url VARCHAR(500) DEFAULT '',
        response_data TEXT,
        method VARCHAR(10) DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // 兼容旧表：尝试添加新列，已存在的列会报错忽略
    const newCols = [
        "ALTER TABLE publish_history ADD COLUMN type VARCHAR(10) DEFAULT 'mqtt'",
        "ALTER TABLE publish_history ADD COLUMN ok TINYINT(1) DEFAULT 1",
        "ALTER TABLE publish_history ADD COLUMN status VARCHAR(20) DEFAULT ''",
        "ALTER TABLE publish_history ADD COLUMN url VARCHAR(500) DEFAULT ''",
        "ALTER TABLE publish_history ADD COLUMN response_data TEXT",
        "ALTER TABLE publish_history MODIFY COLUMN topic VARCHAR(500) NOT NULL",
        "ALTER TABLE publish_history MODIFY COLUMN qos VARCHAR(10) DEFAULT '0'",
        "ALTER TABLE publish_history ADD COLUMN method VARCHAR(10) DEFAULT ''",
        "ALTER TABLE switch_configs ADD COLUMN resp_array_path VARCHAR(200) DEFAULT ''",
        "ALTER TABLE switch_configs ADD COLUMN resp_target_key VARCHAR(100) DEFAULT ''",
        "ALTER TABLE switch_configs ADD COLUMN resp_command_key VARCHAR(100) DEFAULT ''",
        "ALTER TABLE switch_configs ADD COLUMN resp_value_map TEXT",
        "ALTER TABLE switch_configs ADD COLUMN is_on TINYINT DEFAULT 0",
        "ALTER TABLE schedule_configs MODIFY COLUMN schedule_time VARCHAR(10)",
        "ALTER TABLE schedule_configs ADD COLUMN resp_array_path VARCHAR(200) DEFAULT ''",
        "ALTER TABLE schedule_configs ADD COLUMN resp_target_key VARCHAR(100) DEFAULT ''",
        "ALTER TABLE schedule_configs ADD COLUMN resp_command_key VARCHAR(100) DEFAULT ''",
        "ALTER TABLE threshold_configs ADD COLUMN resp_max_path VARCHAR(200) DEFAULT ''",
        "ALTER TABLE threshold_configs ADD COLUMN resp_min_path VARCHAR(200) DEFAULT ''",
        "ALTER TABLE threshold_configs ADD COLUMN alarm_send_json TEXT",
        "ALTER TABLE auto_switch_configs ADD COLUMN auto_value VARCHAR(100) DEFAULT ''",
        "ALTER TABLE auto_switch_configs ADD COLUMN manual_value VARCHAR(100) DEFAULT ''",
        "ALTER TABLE auto_switch_configs DROP COLUMN key_value",
        "ALTER TABLE auto_switch_configs DROP COLUMN enabled",
        "ALTER TABLE auto_switch_configs ADD COLUMN publish_topic VARCHAR(255) DEFAULT ''",
        "ALTER TABLE auto_switch_configs DROP COLUMN auto_send_json",
        "ALTER TABLE auto_switch_configs DROP COLUMN manual_send_json",
        "ALTER TABLE auto_switch_configs ADD COLUMN current_mode VARCHAR(10) DEFAULT 'manual'",
        "ALTER TABLE flag_configs ADD COLUMN online_key VARCHAR(100) DEFAULT ''",
        "ALTER TABLE flag_configs ADD COLUMN offline_timeout INT DEFAULT 0"
    ];
    for (const sql of newCols) {
        try { await conn.query(sql); } catch (e) { /* 列已存在则跳过 */ }
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS response_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        rule_name VARCHAR(100) DEFAULT '',
        array_path VARCHAR(200) NOT NULL,
        target_key VARCHAR(100) NOT NULL,
        command_key VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS switch_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        key_name VARCHAR(100) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        publish_topic VARCHAR(255) NOT NULL,
        active_high TINYINT(1) DEFAULT 1,
        is_on TINYINT DEFAULT 0,
        resp_array_path VARCHAR(200) DEFAULT '',
        resp_target_key VARCHAR(100) DEFAULT '',
        resp_command_key VARCHAR(100) DEFAULT '',
        resp_value_map TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS auto_switch_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        key_name VARCHAR(100) NOT NULL COMMENT '监测的键名',
        auto_value VARCHAR(100) NOT NULL DEFAULT '' COMMENT '自动键值',
        manual_value VARCHAR(100) NOT NULL DEFAULT '' COMMENT '手动键值',
        publish_topic VARCHAR(255) DEFAULT '' COMMENT '发送指令的发布主题',
        current_mode VARCHAR(10) DEFAULT 'manual' COMMENT '当前模式 auto/manual',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS theme_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        theme_code VARCHAR(20) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        http_key_name VARCHAR(200) DEFAULT '',
        http_key_value VARCHAR(100) DEFAULT '',
        mqtt_key_name VARCHAR(100) DEFAULT '',
        mqtt_key_value VARCHAR(100) DEFAULT '',
        publish_topic VARCHAR(255) NOT NULL,
        is_active TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS schedule_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        key_name VARCHAR(100) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        publish_topic VARCHAR(255) NOT NULL,
        active_high TINYINT(1) DEFAULT 1,
        target_state TINYINT(1) NOT NULL COMMENT '0=关, 1=开',
        schedule_time VARCHAR(10) NOT NULL COMMENT '秒数倒计时',
        enabled TINYINT(1) DEFAULT 1,
        last_executed VARCHAR(16) DEFAULT NULL,
        resp_array_path VARCHAR(200) DEFAULT '',
        resp_target_key VARCHAR(100) DEFAULT '',
        resp_command_key VARCHAR(100) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS threshold_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        sensor_key VARCHAR(100) NOT NULL COMMENT '监测的JSON键名',
        display_name VARCHAR(255) NOT NULL COMMENT '显示名称',
        min_value DOUBLE NOT NULL COMMENT '最小值',
        max_value DOUBLE NOT NULL COMMENT '最大值',
        alarm_message VARCHAR(255) DEFAULT NULL COMMENT '报警消息',
        send_to_device TINYINT(1) DEFAULT 0 COMMENT '是否发送阈值设定至设备',
        upper_key VARCHAR(100) DEFAULT NULL COMMENT '上限键名',
        lower_key VARCHAR(100) DEFAULT NULL COMMENT '下限键名',
        publish_topic VARCHAR(255) DEFAULT NULL COMMENT '阈值设定发布主题',
        alarm_send_json TEXT COMMENT '报警时发送的JSON指令',
        resp_max_path VARCHAR(200) DEFAULT '' COMMENT 'HTTP响应上限数据路径',
        resp_min_path VARCHAR(200) DEFAULT '' COMMENT 'HTTP响应下限数据路径',
        enabled TINYINT(1) DEFAULT 1 COMMENT '是否启用',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS threshold_alarms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        threshold_id INT NOT NULL,
        sensor_key VARCHAR(100) NOT NULL,
        current_value VARCHAR(100) NOT NULL,
        alarm_message VARCHAR(255) NOT NULL,
        min_value DOUBLE NOT NULL,
        max_value DOUBLE NOT NULL,
        alarm_time BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id),
        INDEX idx_threshold_id (threshold_id),
        INDEX idx_alarm_time (alarm_time)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS alarm_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        sensor_name VARCHAR(100) NOT NULL,
        alarm_message TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        INDEX idx_timestamp (timestamp)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS webview_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL UNIQUE,
        page_url VARCHAR(255) NOT NULL COMMENT '网页地址',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS webview_screenshots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        source VARCHAR(50) DEFAULT '' COMMENT '截图来源标识',
        image_base64 LONGTEXT NOT NULL COMMENT '截图base64',
        json_data TEXT COMMENT '附加JSON数据',
        timestamp BIGINT NOT NULL COMMENT '截图时间戳',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id),
        INDEX idx_timestamp (timestamp)
    )`);
    // ===== 以下为部署时必需的自动建表（共11张，原 SQL 文件有但 app.js 漏了） =====
    await conn.query(`CREATE TABLE IF NOT EXISTS mqtt_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        config_type ENUM('subscribe','publish') NOT NULL DEFAULT 'subscribe',
        client_id VARCHAR(100) NOT NULL,
        broker_url VARCHAR(255) NOT NULL,
        port INT NOT NULL,
        qos INT DEFAULT 0,
        topic VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_config_type (config_type),
        INDEX idx_created_at (created_at)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS mqtt_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT DEFAULT NULL,
        device_type VARCHAR(10) DEFAULT NULL,
        json_data TEXT NOT NULL,
        time VARCHAR(50) NOT NULL,
        timestamp_ms BIGINT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_time (time),
        INDEX idx_timestamp_ms (timestamp_ms),
        INDEX idx_device_id (device_id),
        INDEX idx_created_at (created_at)
    )`);
    // 兼容旧表：添加 device_type 列
    try { await conn.query("ALTER TABLE mqtt_messages ADD COLUMN device_type VARCHAR(10) DEFAULT NULL"); } catch (e) { /* 列已存在 */ }
    // 兼容旧表：尝试添加 device_id 列
    try { await conn.query("ALTER TABLE mqtt_messages ADD COLUMN device_id INT DEFAULT NULL"); } catch (e) {}
    try { await conn.query("ALTER TABLE mqtt_messages ADD INDEX idx_device_id (device_id)"); } catch (e) {}
    await conn.query(`CREATE TABLE IF NOT EXISTS cloud_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        platform VARCHAR(50) NOT NULL COMMENT 'huawei/aliyun/tencent/onenet/gizwits',
        config_json TEXT NOT NULL,
        enabled TINYINT(1) DEFAULT 1,
        connected TINYINT(1) DEFAULT 0,
        poll_interval_sec INT DEFAULT 10,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_platform (platform)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS special_devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        content_hash VARCHAR(64) DEFAULT NULL,
        last_timestamp BIGINT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS special_data (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        json_data TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id),
        INDEX idx_timestamp (timestamp)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS sensor_display_names (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        sensor_key VARCHAR(100) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_device_sensor (device_id, sensor_key)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS flag_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        show_key VARCHAR(100) NOT NULL DEFAULT '' COMMENT '显示标志位键名',
        hide_key VARCHAR(100) NOT NULL DEFAULT '' COMMENT '隐藏标志位键名',
        online_key VARCHAR(100) NOT NULL DEFAULT '' COMMENT '在线标志位键名',
        offline_timeout INT NOT NULL DEFAULT 0 COMMENT '离线判定秒数，0=不启用',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS camera_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        yolo_url VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_device_id (device_id),
        INDEX idx_device_id (device_id)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS camera_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        json_data TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        INDEX idx_timestamp (timestamp),
        INDEX idx_project_timestamp (project_id, timestamp)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS camera_screenshots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        cam_id INT NOT NULL,
        image_base64 LONGTEXT NOT NULL,
        json_data TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_device_id (device_id),
        INDEX idx_timestamp (timestamp)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS special_json_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        json_data TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        INDEX idx_timestamp (timestamp),
        INDEX idx_project_timestamp (project_id, timestamp)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS projects (
        project_id INT NOT NULL PRIMARY KEY,
        display_name VARCHAR(255) NOT NULL,
        schema_keys TEXT,
        is_special TINYINT(1) DEFAULT 0,
        pinned TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_pinned (pinned),
        INDEX idx_is_special (is_special)
    )`);
    conn.release();

    // 数据迁移：回填 mqtt_messages 的 NULL device_id
    (async () => {
        try {
            const [nullRows] = await pool.query('SELECT id, json_data FROM mqtt_messages WHERE device_id IS NULL OR device_type IS NULL')
            if (nullRows.length === 0) return
            console.log(`[迁移] 发现 ${nullRows.length} 条 device_id/device_type 为空的 MQTT 消息，正在回填...`)
            let updated = 0
            const [specDevs] = await pool.query('SELECT id, content_hash FROM special_devices')
            const hashToId = {}
            for (const d of specDevs) { hashToId[d.content_hash] = d.id }

            for (const row of nullRows) {
                try {
                    const obj = JSON.parse(row.json_data)
                    let did = null
                    let dtype = null
                    const ids = new Set()
                    for (const key of Object.keys(obj)) {
                        const m = key.match(/(\d+)$/)
                        if (m) ids.add(parseInt(m[1], 10))
                    }
                    if (ids.size === 1) {
                        did = [...ids][0]
                        dtype = 'normal'
                    } else if (ids.size === 0) {
                        const hash = crypto.createHash('md5').update(JSON.stringify(Object.keys(obj).sort())).digest('hex')
                        did = hashToId[hash] || null
                        dtype = 'special'
                    }
                    if (did) {
                        await pool.query('UPDATE mqtt_messages SET device_id = ?, device_type = ? WHERE id = ?', [did, dtype, row.id])
                        updated++
                    }
                } catch (e) { /* skip */ }
            }
            console.log(`[迁移] 已回填 ${updated} 条 MQTT 消息的 device_id + device_type`)
        } catch (err) {
            console.error('[迁移] 回填失败:', err.message)
        }
    })();

    // 注入数据库连接池到云轮询服务并启动
    cloudPoller.injectPool(pool);
    cloudPoller.startPolling();
}).catch(err => {
    console.error('数据库连接失败:', err.message);
});

// ========== MQTT 配置 API ==========
app.get('/api/mqtt-configs', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, config_type, client_id, broker_url, port, qos, topic, created_at FROM mqtt_config WHERE config_type = "subscribe" ORDER BY created_at DESC'
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取配置列表失败' });
    }
});

app.post('/api/mqtt-configs', async (req, res) => {
    const { config_type, client_id, broker_url, port, qos, topic } = req.body;
    if (!client_id || !broker_url || !port || topic === undefined) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        const [existing] = await pool.query(
            `SELECT id FROM mqtt_config 
             WHERE config_type = ? AND client_id = ? AND broker_url = ? AND port = ? AND qos = ? AND topic = ?`,
            [config_type || 'subscribe', client_id, broker_url, port, qos || 0, topic]
        );
        if (existing.length > 0) {
            return res.json({ code: 200, message: '配置已存在，无需重复保存', data: { id: existing[0].id } });
        }
        const [result] = await pool.query(
            'INSERT INTO mqtt_config (config_type, client_id, broker_url, port, qos, topic) VALUES (?, ?, ?, ?, ?, ?)',
            [config_type || 'subscribe', client_id, broker_url, port, qos || 0, topic]
        );
        res.json({ code: 200, message: '配置保存成功', data: { id: result.insertId } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '保存配置失败' });
    }
});

app.delete('/api/clear-database', async (req, res) => {
    const tablesToClear = [
        'devices', 'sensor_history', 'publish_history', 'response_rules',
        'switch_configs', 'auto_switch_configs', 'theme_configs', 'schedule_configs',
        'threshold_configs', 'threshold_alarms', 'alarm_history', 'webview_configs',
        'webview_screenshots', 'mqtt_config', 'mqtt_messages', 'cloud_configs',
        'special_devices', 'special_data', 'sensor_display_names', 'flag_configs',
        'camera_configs', 'camera_records', 'camera_screenshots', 'special_json_records', 'projects'
    ];
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const table of tablesToClear) {
            await connection.query(`TRUNCATE TABLE ${table}`);
        }
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        await connection.commit();
        res.json({ code: 200, message: '数据库清空成功' });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ code: 500, message: '清空失败' });
    } finally {
        connection.release();
    }
});

// ========== MQTT 原始消息存储 API ==========
app.post('/api/mqtt-messages', async (req, res) => {
    const { jsonData, time, timestampMs, deviceId, deviceType } = req.body
    if (!jsonData) {
        return res.status(400).json({ code: 400, message: '缺少 jsonData' })
    }
    try {
        await pool.query(
            'INSERT INTO mqtt_messages (device_id, device_type, json_data, time, timestamp_ms) VALUES (?, ?, ?, ?, ?)',
            [deviceId || null, deviceType || null, JSON.stringify(jsonData), time || new Date().toISOString(), timestampMs || Date.now()]
        )
        res.json({ code: 200, message: 'ok' })
    } catch (err) {
        console.error('保存MQTT消息失败:', err.message)
        res.status(500).json({ code: 500, message: '保存失败' })
    }
})

// ========== 普通设备 API ==========
app.post('/api/sensor-history', async (req, res) => {
    const { deviceId, sensorName, value, timestamp } = req.body;
    if (deviceId === undefined || !sensorName || value === undefined || !timestamp) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    if (deviceId <= 0) {
        return res.status(400).json({ code: 400, message: '无效的设备ID' });
    }
    try {
        // 自动创建设备（不存在时），INSERT IGNORE 避免并发重复键报错
        await pool.query('INSERT IGNORE INTO devices (device_id, name) VALUES (?, ?)', [deviceId, `设备${deviceId}`]);
        // 存储传感器数据
        await pool.query(
            `INSERT INTO sensor_history (device_id, sensor_name, value, timestamp) VALUES (?, ?, ?, ?)`,
            [deviceId, sensorName, String(value), timestamp]
        );
        res.json({ code: 200, message: 'ok' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '存储失败' });
    }
});

// 查询普通设备的历史数据
app.get('/api/sensor-history', async (req, res) => {
    const deviceId = parseInt(req.query.deviceId);
    const limit = parseInt(req.query.limit) || 0;
    if (isNaN(deviceId) || deviceId <= 0) {
        return res.status(400).json({ code: 400, message: '无效的设备ID' });
    }
    try {
        let sql = `SELECT sensor_name, value, timestamp
             FROM sensor_history
             WHERE device_id = ?
             ORDER BY timestamp DESC`;
        if (limit > 0) sql += ` LIMIT ${limit}`;
        const [rows] = await pool.query(sql, [deviceId]);
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '查询失败' });
    }
});

// 按时间戳整组替换普通设备的传感器历史（原始JSON 编辑后回写）
app.put('/api/sensor-history-group', async (req, res) => {
    const { deviceId, timestamp, values } = req.body;
    if (deviceId === undefined || !timestamp || !values || typeof values !== 'object' || Array.isArray(values)) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        await pool.query('DELETE FROM sensor_history WHERE device_id = ? AND timestamp = ?', [deviceId, timestamp]);
        for (const [sensorName, value] of Object.entries(values)) {
            if (sensorName === undefined || sensorName === null || sensorName === '') continue;
            await pool.query(
                'INSERT INTO sensor_history (device_id, sensor_name, value, timestamp) VALUES (?, ?, ?, ?)',
                [deviceId, sensorName, String(value), timestamp]
            );
        }
        res.json({ code: 200, message: '更新成功' });
    } catch (err) {
        console.error('[整组更新传感器历史] 失败:', err.message);
        res.status(500).json({ code: 500, message: '更新失败: ' + err.message });
    }
});

app.put('/api/devices/:deviceId', async (req, res) => {
    const deviceId = parseInt(req.params.deviceId);
    const { name } = req.body;
    if (isNaN(deviceId) || deviceId <= 0 || !name) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query(
            `INSERT INTO devices (device_id, name) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name)`,
            [deviceId, name]
        );
        res.json({ code: 200, message: '修改成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '修改失败' });
    }
});

app.delete('/api/devices/:deviceId', async (req, res) => {
    const deviceId = parseInt(req.params.deviceId);
    if (isNaN(deviceId) || deviceId <= 0) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM sensor_history WHERE device_id = ?', [deviceId]);
        await connection.query('DELETE FROM devices WHERE device_id = ?', [deviceId]);
        await connection.commit();
        res.json({ code: 200, message: '删除成功' });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ code: 500, message: '删除失败' });
    } finally {
        connection.release();
    }
});

// ========== 特殊设备 API ==========
// 存储特殊设备数据（基于内容去重）
app.post('/api/special-data', async (req, res) => {
    const { jsonData, timestamp } = req.body;
    if (!jsonData || !timestamp) {
        return res.status(400).json({ code: 400, message: '缺少参数' });
    }
    try {
        const contentHash = crypto.createHash('md5').update(JSON.stringify(Object.keys(jsonData).sort())).digest('hex');
        let [rows] = await pool.query('SELECT id, name FROM special_devices WHERE content_hash = ?', [contentHash]);
        let deviceId;
        if (rows.length === 0) {
            const [result] = await pool.query(
                'INSERT INTO special_devices (name, content_hash, last_timestamp) VALUES (?, ?, ?)',
                ['', contentHash, timestamp]
            );
            deviceId = result.insertId;
            await pool.query('UPDATE special_devices SET name = ? WHERE id = ?', [`特殊设备${deviceId}`, deviceId]);
        } else {
            deviceId = rows[0].id;
            await pool.query('UPDATE special_devices SET last_timestamp = ? WHERE id = ?', [timestamp, deviceId]);
        }
        await pool.query(
            'INSERT INTO special_data (device_id, json_data, timestamp) VALUES (?, ?, ?)',
            [deviceId, JSON.stringify(jsonData), timestamp]
        );
        res.json({ code: 200, message: 'ok', data: { deviceId } });
    } catch (err) {
        console.error('特殊设备存储失败:', err);
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 查询特殊设备的历史数据
app.get('/api/special-data', async (req, res) => {
    const deviceId = parseInt(req.query.deviceId);
    const limit = parseInt(req.query.limit) || 0;
    if (isNaN(deviceId) || deviceId <= 0) {
        return res.status(400).json({ code: 400, message: '无效的设备ID' });
    }
    try {
        let sql = `SELECT id, timestamp, json_data
             FROM special_data
             WHERE device_id = ?
             ORDER BY timestamp DESC`;
        if (limit > 0) sql += ` LIMIT ${limit}`;
        const [rows] = await pool.query(sql, [deviceId]);
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '查询失败' });
    }
});

app.put('/api/special-devices/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { name } = req.body;
    if (isNaN(id) || !name) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query('UPDATE special_devices SET name = ? WHERE id = ?', [name, id]);
        res.json({ code: 200, message: '修改成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '修改失败' });
    }
});

app.delete('/api/special-devices/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM special_data WHERE device_id = ?', [id]);
        await connection.query('DELETE FROM special_devices WHERE id = ?', [id]);
        await connection.commit();
        res.json({ code: 200, message: '删除成功' });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ code: 500, message: '删除失败' });
    } finally {
        connection.release();
    }
});

// ========== 设备列表 API ==========
app.get('/api/devices', async (req, res) => {
    try {
        const [normalDevices] = await pool.query(
            `SELECT d.device_id, d.name, MAX(s.timestamp) as last_timestamp
             FROM devices d
             LEFT JOIN sensor_history s ON d.device_id = s.device_id
             WHERE d.device_id > 0
             GROUP BY d.device_id, d.name
             ORDER BY d.device_id ASC`
        );
        const normalWithType = normalDevices.map(d => ({ ...d, deviceType: 'normal' }));
        const [specialDevices] = await pool.query(
            `SELECT id as device_id, name, last_timestamp
             FROM special_devices
             ORDER BY id ASC`
        );
        const specialWithType = specialDevices.map(d => ({ ...d, deviceType: 'special' }));
        const devices = [...normalWithType, ...specialWithType];
        res.json({ code: 200, data: devices });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取设备列表失败' });
    }
});

// ========== 统计 API ==========
app.get('/api/stats', async (req, res) => {
    try {
        const [normalCount] = await pool.query(`SELECT COUNT(*) as total FROM devices WHERE device_id > 0`);
        const [specialCount] = await pool.query(`SELECT COUNT(*) as total FROM special_devices`);
        const totalDevices = normalCount[0].total + specialCount[0].total;

        const now = Date.now();
        const elevenSecondsAgo = now - 11000;

        const [onlineNormal] = await pool.query(
            `SELECT COUNT(DISTINCT device_id) as online FROM sensor_history WHERE timestamp > ? AND device_id > 0`,
            [elevenSecondsAgo]
        );
        const [onlineSpecial] = await pool.query(
            `SELECT COUNT(*) as online FROM special_devices WHERE last_timestamp > ?`,
            [elevenSecondsAgo]
        );
        const onlineDevices = onlineNormal[0].online + onlineSpecial[0].online;
        const offlineDevices = totalDevices - onlineDevices;

        const [normalRecordCount] = await pool.query(`SELECT COUNT(*) as total FROM sensor_history WHERE device_id > 0`);
        const [specialRecordCount] = await pool.query(`SELECT COUNT(*) as total FROM special_data`);
        const totalSensorRecords = normalRecordCount[0].total + specialRecordCount[0].total;

        res.json({ code: 200, data: { totalDevices, onlineDevices, offlineDevices, totalSensorRecords } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取统计失败' });
    }
});

// ========== 传感器显示名称管理 API ==========
app.get('/api/sensor-names/:deviceId', async (req, res) => {
    const deviceId = parseInt(req.params.deviceId);
    if (isNaN(deviceId)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT sensor_key, display_name FROM sensor_display_names WHERE device_id = ?',
            [deviceId]
        );
        const map = {};
        rows.forEach(row => { map[row.sensor_key] = row.display_name; });
        res.json({ code: 200, data: map });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取失败' });
    }
});

app.put('/api/sensor-names/:deviceId', async (req, res) => {
    const deviceId = parseInt(req.params.deviceId);
    const { sensorKey, displayName } = req.body;
    if (isNaN(deviceId) || !sensorKey || !displayName) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query(
            `INSERT INTO sensor_display_names (device_id, sensor_key, display_name)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
            [deviceId, sensorKey, displayName]
        );
        res.json({ code: 200, message: '更新成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '更新失败' });
    }
});

// ========== 标志位配置 API ==========
app.get('/api/flag-config/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT show_key, hide_key, online_key, offline_timeout FROM flag_configs WHERE device_id = ?',
            [deviceId]
        );
        const row = rows[0];
        res.json({ code: 200, data: row ? { show: row.show_key, hide: row.hide_key, online: row.online_key, offlineTimeout: row.offline_timeout } : { show: '', hide: '', online: '', offlineTimeout: 0 } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取标志位配置失败' });
    }
});

app.put('/api/flag-config/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const { show, hide, online, offlineTimeout } = req.body;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        await pool.query(
            `INSERT INTO flag_configs (device_id, show_key, hide_key, online_key, offline_timeout)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE show_key = VALUES(show_key), hide_key = VALUES(hide_key), online_key = VALUES(online_key), offline_timeout = VALUES(offline_timeout)`,
            [deviceId, show || '', hide || '', online || '', Number(offlineTimeout) || 0]
        );
        res.json({ code: 200, message: '保存成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '保存标志位配置失败' });
    }
});

// ========== 发布配置 API ==========
app.get('/api/publish-configs', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const clientId = 'publisher_' + deviceId;
        const [rows] = await pool.query(
            `SELECT id, topic, qos, broker_url, port, client_id FROM mqtt_config
             WHERE config_type = 'publish' AND client_id = ? ORDER BY created_at DESC LIMIT 1`,
            [clientId]
        );
        res.json({ code: 200, data: rows[0] || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取发布配置失败' });
    }
});

app.post('/api/publish-configs', async (req, res) => {
    const { topic, qos, broker_url, port, client_id } = req.body;
    if (!topic || broker_url === undefined) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        const [existing] = await pool.query(
            `SELECT id FROM mqtt_config WHERE config_type = 'publish' AND client_id = ? ORDER BY created_at DESC`,
            [client_id || '']
        );
        if (existing.length > 0) {
            await pool.query('UPDATE mqtt_config SET topic = ?, qos = ?, broker_url = ?, port = ? WHERE id = ?',
                [topic, qos || 0, broker_url, port || 8083, existing[0].id]);
            // 删除多余的旧记录，确保每个 client_id 只保留一条
            if (existing.length > 1) {
                const keepId = existing[0].id;
                await pool.query(
                    `DELETE FROM mqtt_config WHERE config_type = 'publish' AND client_id = ? AND id != ?`,
                    [client_id || '', keepId]
                );
            }
            return res.json({ code: 200, message: '配置已更新', data: { id: existing[0].id } });
        }
        const [result] = await pool.query(
            'INSERT INTO mqtt_config (config_type, client_id, broker_url, port, qos, topic) VALUES (?, ?, ?, ?, ?, ?)',
            ['publish', client_id || '', broker_url, port || 8083, qos || 0, topic]
        );
        res.json({ code: 200, message: '配置保存成功', data: { id: result.insertId } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '保存配置失败' });
    }
});

// ========== 发布历史 API ==========
app.get('/api/publish-history', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            `SELECT id, type, topic, payload, qos, ok, status, url, response_data, created_at FROM publish_history
             WHERE device_id = ? ORDER BY created_at DESC LIMIT 100`,
            [deviceId]
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取发布历史失败' });
    }
});

app.post('/api/publish-history', async (req, res) => {
    const { deviceId, topic, payload, qos, type, ok, status, url, responseData, method } = req.body;
    if (!deviceId || !topic || payload === undefined) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        await pool.query(
            'INSERT INTO publish_history (device_id, type, topic, payload, qos, ok, status, url, response_data, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [deviceId, type || 'mqtt', topic, payload, qos || '0', ok !== undefined ? (ok ? 1 : 0) : 1, status || '', url || '', responseData || null, method || '']
        );
        res.json({ code: 200, message: 'ok' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '保存发布历史失败' });
    }
});

// ========== 响应规则 API ==========
app.get('/api/response-rules', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) return res.status(400).json({ code: 400, message: '缺少 deviceId' });
    try {
        const [rows] = await pool.query('SELECT id, rule_name, array_path, target_key, command_key FROM response_rules WHERE device_id = ? ORDER BY id ASC', [deviceId]);
        res.json({ code: 200, data: rows });
    } catch (err) { res.status(500).json({ code: 500, message: err.message }); }
});
app.post('/api/response-rules', async (req, res) => {
    const { deviceId, ruleName, arrayPath, targetKey, commandKey } = req.body;
    if (!deviceId || !arrayPath || !targetKey || !commandKey) return res.status(400).json({ code: 400, message: '缺少参数' });
    try {
        await pool.query('INSERT INTO response_rules (device_id, rule_name, array_path, target_key, command_key) VALUES (?, ?, ?, ?, ?)',
            [deviceId, ruleName || '', arrayPath, targetKey, commandKey]);
        res.json({ code: 200, message: 'ok' });
    } catch (err) { res.status(500).json({ code: 500, message: err.message }); }
});
app.put('/api/response-rules/:id', async (req, res) => {
    const { id } = req.params;
    const { ruleName, arrayPath, targetKey, commandKey } = req.body;
    try {
        await pool.query('UPDATE response_rules SET rule_name = ?, array_path = ?, target_key = ?, command_key = ? WHERE id = ?',
            [ruleName || '', arrayPath, targetKey, commandKey, id]);
        res.json({ code: 200, message: 'ok' });
    } catch (err) { res.status(500).json({ code: 500, message: err.message }); }
});
app.delete('/api/response-rules/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM response_rules WHERE id = ?', [req.params.id]);
        res.json({ code: 200, message: 'ok' });
    } catch (err) { res.status(500).json({ code: 500, message: err.message }); }
});

// ========== 开关配置 API ==========
app.get('/api/switches', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT id, device_id, key_name, display_name, publish_topic, active_high, resp_array_path, resp_target_key, resp_command_key, resp_value_map, is_on FROM switch_configs WHERE device_id = ? ORDER BY id ASC',
            [deviceId]
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取开关列表失败' });
    }
});

app.post('/api/switches', async (req, res) => {
    const { deviceId, keyName, displayName, publishTopic, activeHigh, respArrayPath, respTargetKey, respCommandKey, respValueMap } = req.body;
    if (!deviceId || !keyName || !displayName || !publishTopic) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO switch_configs (device_id, key_name, display_name, publish_topic, active_high, resp_array_path, resp_target_key, resp_command_key, resp_value_map) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [deviceId, keyName, displayName, publishTopic, activeHigh !== undefined ? activeHigh : 1, respArrayPath || '', respTargetKey || '', respCommandKey || '', respValueMap || '']
        );
        res.json({ code: 200, message: '创建成功', data: { id: result.insertId } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '创建开关失败' });
    }
});

app.put('/api/switches/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { keyName, displayName, publishTopic, activeHigh, respArrayPath, respTargetKey, respCommandKey, respValueMap } = req.body;
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query(
            'UPDATE switch_configs SET key_name = ?, display_name = ?, publish_topic = ?, active_high = ?, resp_array_path = ?, resp_target_key = ?, resp_command_key = ?, resp_value_map = ? WHERE id = ?',
            [keyName, displayName, publishTopic, activeHigh !== undefined ? activeHigh : 1, respArrayPath || '', respTargetKey || '', respCommandKey || '', respValueMap || '', id]
        );
        res.json({ code: 200, message: '更新成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '更新开关失败' });
    }
});

app.delete('/api/switches/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query('DELETE FROM switch_configs WHERE id = ?', [id]);
        res.json({ code: 200, message: '删除成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '删除开关失败' });
    }
});

app.put('/api/switches/:id/state', async (req, res) => {
    const id = parseInt(req.params.id);
    const { isOn } = req.body;
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query('UPDATE switch_configs SET is_on = ? WHERE id = ?', [isOn ? 1 : 0, id]);
        res.json({ code: 200, message: '更新开关状态成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '更新开关状态失败' });
    }
});

// ========== 自动开关配置 API ==========
app.get('/api/auto-switch', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query('SELECT id, device_id, key_name, auto_value, manual_value, publish_topic, current_mode FROM auto_switch_configs WHERE device_id = ?', [deviceId]);
        res.json({ code: 200, data: rows[0] || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取自动开关配置失败' });
    }
});

app.post('/api/auto-switch', async (req, res) => {
    const { deviceId, keyName, autoValue, manualValue, publishTopic, currentMode } = req.body;
    if (!deviceId || keyName === undefined) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        await pool.query(
            'INSERT INTO auto_switch_configs (device_id, key_name, auto_value, manual_value, publish_topic, current_mode) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE key_name = VALUES(key_name), auto_value = VALUES(auto_value), manual_value = VALUES(manual_value), publish_topic = VALUES(publish_topic), current_mode = VALUES(current_mode)',
            [deviceId, keyName, autoValue || '', manualValue || '', publishTopic || '', currentMode || 'manual']
        );
        res.json({ code: 200, message: '保存成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '保存自动开关配置失败' });
    }
});

app.put('/api/auto-switch/mode', async (req, res) => {
    const { deviceId, currentMode } = req.body;
    if (!deviceId || !currentMode) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        await pool.query('UPDATE auto_switch_configs SET current_mode = ? WHERE device_id = ?', [currentMode, deviceId]);
        res.json({ code: 200, message: '更新模式成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '更新模式失败' });
    }
});

// ========== 定时任务配置 API ==========
app.get('/api/schedules', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT id, device_id, key_name, display_name, publish_topic, active_high, target_state, schedule_time, enabled, last_executed, resp_array_path, resp_target_key, resp_command_key FROM schedule_configs WHERE device_id = ? ORDER BY id ASC',
            [deviceId]
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取定时列表失败' });
    }
});

app.post('/api/schedules', async (req, res) => {
    const { deviceId, keyName, displayName, publishTopic, activeHigh, targetState, scheduleTime, enabled, respArrayPath, respTargetKey, respCommandKey } = req.body;
    if (!deviceId || !keyName || !displayName || !publishTopic || targetState === undefined || !scheduleTime) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO schedule_configs (device_id, key_name, display_name, publish_topic, active_high, target_state, schedule_time, enabled, resp_array_path, resp_target_key, resp_command_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [deviceId, keyName, displayName, publishTopic, activeHigh !== undefined ? activeHigh : 1, targetState, scheduleTime, enabled !== undefined ? enabled : 1, respArrayPath || '', respTargetKey || '', respCommandKey || '']
        );
        res.json({ code: 200, message: '创建成功', data: { id: result.insertId } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '创建定时失败' });
    }
});

app.put('/api/schedules/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { keyName, displayName, publishTopic, activeHigh, targetState, scheduleTime, enabled, respArrayPath, respTargetKey, respCommandKey } = req.body;
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query(
            'UPDATE schedule_configs SET key_name = ?, display_name = ?, publish_topic = ?, active_high = ?, target_state = ?, schedule_time = ?, enabled = ?, resp_array_path = ?, resp_target_key = ?, resp_command_key = ? WHERE id = ?',
            [keyName, displayName, publishTopic, activeHigh !== undefined ? activeHigh : 1, targetState, scheduleTime, enabled !== undefined ? enabled : 1, respArrayPath || '', respTargetKey || '', respCommandKey || '', id]
        );
        res.json({ code: 200, message: '更新成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '更新定时失败' });
    }
});

app.delete('/api/schedules/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query('DELETE FROM schedule_configs WHERE id = ?', [id]);
        res.json({ code: 200, message: '删除成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '删除定时失败' });
    }
});

app.put('/api/schedules/:id/execute', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
        await pool.query('UPDATE schedule_configs SET last_executed = ? WHERE id = ?', [timeStr, id]);
        res.json({ code: 200, message: 'ok' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '更新失败' });
    }
});

// ========== 主题配置 API ==========
app.get('/api/themes', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT id, device_id, theme_code, display_name, http_key_name, http_key_value, mqtt_key_name, mqtt_key_value, publish_topic, is_active FROM theme_configs WHERE device_id = ? ORDER BY id ASC',
            [deviceId]
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取主题列表失败' });
    }
});

app.post('/api/themes', async (req, res) => {
    const { deviceId, themeCode, displayName, httpKeyName, httpKeyValue, mqttKeyName, mqttKeyValue, publishTopic } = req.body;
    const validCodes = ['normal', 'warning', 'danger', 'info', 'offline'];
    if (!deviceId || !themeCode || !displayName || !publishTopic) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    if (!validCodes.includes(themeCode)) {
        return res.status(400).json({ code: 400, message: '无效的主题代码' });
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO theme_configs (device_id, theme_code, display_name, http_key_name, http_key_value, mqtt_key_name, mqtt_key_value, publish_topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [deviceId, themeCode, displayName, httpKeyName || '', httpKeyValue || '', mqttKeyName || '', mqttKeyValue || '', publishTopic]
        );
        res.json({ code: 200, message: '创建成功', data: { id: result.insertId } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '创建主题失败' });
    }
});

app.put('/api/themes/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { themeCode, displayName, httpKeyName, httpKeyValue, mqttKeyName, mqttKeyValue, publishTopic } = req.body;
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query(
            'UPDATE theme_configs SET theme_code = ?, display_name = ?, http_key_name = ?, http_key_value = ?, mqtt_key_name = ?, mqtt_key_value = ?, publish_topic = ? WHERE id = ?',
            [themeCode, displayName, httpKeyName || '', httpKeyValue || '', mqttKeyName || '', mqttKeyValue || '', publishTopic, id]
        );
        res.json({ code: 200, message: '更新成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '更新主题失败' });
    }
});

app.delete('/api/themes/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query('DELETE FROM theme_configs WHERE id = ?', [id]);
        res.json({ code: 200, message: '删除成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '删除主题失败' });
    }
});

app.put('/api/themes/:id/activate', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT device_id FROM theme_configs WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ code: 404, message: '主题不存在' });
        }
        const deviceId = rows[0].device_id;
        await connection.query('UPDATE theme_configs SET is_active = 0 WHERE device_id = ?', [deviceId]);
        await connection.query('UPDATE theme_configs SET is_active = 1 WHERE id = ?', [id]);
        await connection.commit();
        res.json({ code: 200, message: '主题已激活' });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ code: 500, message: '激活主题失败' });
    } finally {
        connection.release();
    }
});

// ========== 阈值配置 API ==========
app.get('/api/thresholds', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT id, device_id, sensor_key, display_name, min_value, max_value, alarm_message, send_to_device, upper_key, lower_key, publish_topic, enabled, resp_max_path, resp_min_path, alarm_send_json FROM threshold_configs WHERE device_id = ? ORDER BY id ASC',
            [deviceId]
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取阈值列表失败' });
    }
});

app.post('/api/thresholds', async (req, res) => {
    const { deviceId, sensorKey, displayName, minValue, maxValue, alarmMessage, sendToDevice, upperKey, lowerKey, publishTopic, enabled, respMaxPath, respMinPath, alarmSendJson } = req.body;
    if (!deviceId || !sensorKey || !displayName || minValue === undefined || maxValue === undefined) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO threshold_configs (device_id, sensor_key, display_name, min_value, max_value, alarm_message, send_to_device, upper_key, lower_key, publish_topic, enabled, resp_max_path, resp_min_path, alarm_send_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [deviceId, sensorKey, displayName, minValue, maxValue, alarmMessage || '', sendToDevice ? 1 : 0, upperKey || '', lowerKey || '', publishTopic || '', enabled !== undefined ? enabled : 1, respMaxPath || '', respMinPath || '', alarmSendJson || '']
        );
        res.json({ code: 200, message: '创建成功', data: { id: result.insertId } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '创建阈值失败' });
    }
});

app.put('/api/thresholds/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { sensorKey, displayName, minValue, maxValue, alarmMessage, sendToDevice, upperKey, lowerKey, publishTopic, enabled, respMaxPath, respMinPath, alarmSendJson } = req.body;
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query(
            'UPDATE threshold_configs SET sensor_key = ?, display_name = ?, min_value = ?, max_value = ?, alarm_message = ?, send_to_device = ?, upper_key = ?, lower_key = ?, publish_topic = ?, enabled = ?, resp_max_path = ?, resp_min_path = ?, alarm_send_json = ? WHERE id = ?',
            [sensorKey, displayName, minValue, maxValue, alarmMessage || '', sendToDevice ? 1 : 0, upperKey || '', lowerKey || '', publishTopic || '', enabled !== undefined ? enabled : 1, respMaxPath || '', respMinPath || '', alarmSendJson || '', id]
        );
        res.json({ code: 200, message: '更新成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '更新阈值失败' });
    }
});

app.delete('/api/thresholds/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ code: 400, message: '参数错误' });
    }
    try {
        await pool.query('DELETE FROM threshold_configs WHERE id = ?', [id]);
        res.json({ code: 200, message: '删除成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '删除阈值失败' });
    }
});

// ========== 阈值报警 API ==========
app.get('/api/threshold-alarms', async (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT id, device_id, threshold_id, sensor_key, current_value, alarm_message, min_value, max_value, alarm_time, created_at FROM threshold_alarms WHERE device_id = ? ORDER BY alarm_time DESC LIMIT 500',
            [deviceId]
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取报警记录失败' });
    }
});

app.post('/api/threshold-alarms', async (req, res) => {
    const { deviceId, thresholdId, sensorKey, currentValue, alarmMessage, minValue, maxValue, alarmTime } = req.body;
    if (!deviceId || thresholdId === undefined || !sensorKey || currentValue === undefined) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        await pool.query(
            'INSERT INTO threshold_alarms (device_id, threshold_id, sensor_key, current_value, alarm_message, min_value, max_value, alarm_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [deviceId, thresholdId, sensorKey, String(currentValue), alarmMessage || '', minValue || 0, maxValue || 0, alarmTime || Date.now()]
        );
        res.json({ code: 200, message: 'ok' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '记录报警失败' });
    }
});

// ========== 网页浏览（WebView）API ==========

app.get('/api/webview-config/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT page_url FROM webview_configs WHERE device_id = ? ORDER BY updated_at DESC LIMIT 1',
            [deviceId]
        );
        res.json({ code: 200, data: rows[0] || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取网页配置失败' });
    }
});

app.put('/api/webview-config/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const { pageUrl } = req.body;
    if (!deviceId || !pageUrl) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        await pool.query(
            'INSERT INTO webview_configs (device_id, page_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE page_url = VALUES(page_url)',
            [deviceId, pageUrl]
        );
        res.json({ code: 200, message: '保存成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '保存网页配置失败' });
    }
});

// ========== 网页代理（注入JS拦截截图，静态资源直连目标服务器） ==========
const http = require('http');
const https = require('https');

// 获取页面HTML（跟随重定向，最多5次）
function fetchPage(url, maxRedirects, callback) {
    if (maxRedirects === undefined) maxRedirects = 5;
    if (maxRedirects <= 0) {
        callback(new Error('重定向次数过多'));
        return;
    }
    if (!/^https?:\/\//i.test(url)) {
        url = 'http://' + url;
    }
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    let called = false;
    const done = (err, body, finalUrl) => {
        if (called) return;
        called = true;
        pageReq.destroy();
        callback(err, body, finalUrl);
    };

    const pageReq = transport.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search || '/',
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9'
        },
        timeout: 10000,
        rejectUnauthorized: false
    }, (pageRes) => {
        // 跟随重定向
        if ([301, 302, 303, 307, 308].includes(pageRes.statusCode) && pageRes.headers.location) {
            let redirectUrl = pageRes.headers.location;
            if (redirectUrl.startsWith('/')) {
                redirectUrl = parsedUrl.protocol + '//' + parsedUrl.host + redirectUrl;
            }
            console.log('[Webview] 跟随重定向:', url, '->', redirectUrl);
            pageReq.destroy();
            fetchPage(redirectUrl, maxRedirects - 1, callback);
            return;
        }

        let body = '';
        pageRes.on('data', chunk => body += chunk);
        pageRes.on('end', () => done(null, body, url));
    });

    pageReq.on('error', (err) => done(err));
    pageReq.on('timeout', () => done(new Error('请求超时: ' + url)));
    pageReq.end();
}

app.get('/api/webview-proxy/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;

    const [rows] = await pool.query(
        'SELECT page_url FROM webview_configs WHERE device_id = ? ORDER BY updated_at DESC LIMIT 1',
        [deviceId]
    );
    if (rows.length === 0) {
        return res.status(400).send('请先配置网页地址');
    }

    const basePageUrl = rows[0].page_url.replace(/\/$/, '');

    fetchPage(basePageUrl, 5, (err, body, finalUrl) => {
        if (err) {
            if (!res.headersSent) {
                console.error('[Webview] 获取页面失败:', err.message);
                res.status(502).send('获取页面失败: ' + err.message);
            }
            return;
        }

        finalUrl = finalUrl.replace(/\/$/, '');

        // 注入JS：拦截 SocketIO 获取 YOLOv8 检测数据（image + objects）
        // 同时拦截 fetch/XHR 让相对路径请求转回目标服务器（解决 /upload 404）
        const injectScript = [
            '<script>',
            '(function(){',
            "var DID='", deviceId, "';",
            "var TARGET='", finalUrl, "';",
            // 存储最新检测数据
            'window.__latestData=null;',
            // 保存截图到后端的函数
            'window.__saveScreenshot=function(d){',
            'var data=d||window.__latestData;',
            'if(!data||!data.image){console.log("[截图] 无数据，跳过");return;}',
            'console.log("[截图] 正在保存, image长度:",data.image.length,", objects:",(data.objects||[]).length);',
            "fetch('/api/webview-screenshot-save',{method:'POST',headers:{'Content-Type':'application/json'},",
            "body:JSON.stringify({deviceId:DID,image:data.image,objects:data.objects||[]})",
            '}).then(function(r){return r.json()}).then(function(r){console.log(\'[截图] 已保存\',r)}).catch(function(e){console.error(\'[截图] 保存失败\',e)});',
            '};',
            // 拦截 fetch：相对路径请求转发到目标服务器（解决 /upload 404）
            'var _fetch=window.fetch;',
            'window.fetch=function(url,opts){',
            'if(typeof url==="string"&&url.startsWith("/")&&!url.startsWith("/api/webview")){',
            'url=TARGET+url;',
            '}',
            'return _fetch.call(this,url,opts);',
            '};',
            // 拦截 XMLHttpRequest：同上
            'var _open=XMLHttpRequest.prototype.open;',
            'XMLHttpRequest.prototype.open=function(method,url){',
            'if(typeof url==="string"&&url.startsWith("/")&&!url.startsWith("/api/webview")){',
            'url=TARGET+url;',
            '}',
            'return _open.apply(this,arguments);',
            '};',
            // 拦截 SocketIO 定义
            'var _io=null;',
            'Object.defineProperty(window,"io",{',
            'get:function(){return _io;},',
            'set:function(orig){',
            '_io=function(url,opts){',
            'url=url||TARGET;',
            'var s=orig(url,opts);',
            'var _oe=s.onevent;',
            's.onevent=function(pkt){',
            'try{',
            'var d=pkt.data;',
            'if(Array.isArray(d)&&d.length>=2&&d[1]){',
            'var evt=d[0],payload=d[1];',
            // frame 事件：缓存图片，保留已有 objects
            'if(evt==="frame"&&payload.frame){',
            'var cur=window.__latestData||{};',
            'window.__latestData={image:payload.frame,objects:cur.objects||[],cam_id:payload.cam_id};',
            // 非 frame 事件：打印事件名+payload 键名，用于发现检测结果事件
            '}else if(evt!=="frame"){',
            'var keys=Object.keys(payload).join(",");',
            'console.log("[SocketIO] 事件:",evt,"键:",keys);',
            // 如果 payload 含 objects/detections/bboxes 等检测结果，合并进 __latestData
            'var objs=payload.objects||payload.detections||payload.results||payload.data;',
            'if(objs&&!payload.frame){',
            'var cur2=window.__latestData||{};',
            'window.__latestData={image:cur2.image||null,objects:objs,cam_id:payload.cam_id||cur2.cam_id};',
            'console.log("[SocketIO] 已缓存检测结果, 数量:",Array.isArray(objs)?objs.length:1);',
            '}',
            '}',
            // 兼容旧格式
            '}else if(d&&d.image){',
            'window.__latestData=d;',
            '}else if(d&&d.data&&d.data.image){',
            'window.__latestData=d.data;',
            '}',
            '}catch(e){console.error("[SocketIO] 处理错误",e)}',
            'return _oe.apply(this,arguments);',
            '};',
            'return s;',
            '};',
            '},',
            'configurable:true',
            '});',
            // 监听页面上截图按钮的点击
            'setInterval(function(){',
            'var btns=document.querySelectorAll("button,[role=button],.btn,a");',
            'for(var i=0;i<btns.length;i++){',
            'var b=btns[i];',
            'if(b.__hooked)continue;',
            'b.__hooked=true;',
            'var t=(b.textContent||"").toLowerCase();',
            'if(t.indexOf("截图")>=0||t.indexOf("screenshot")>=0||t.indexOf("capture")>=0||t.indexOf("保存")>=0){',
            'b.addEventListener("click",function(){',
            'console.log("[注入] 检测到截图按钮点击");',
            'setTimeout(function(){window.__saveScreenshot()},800);',
            '});',
            '}',
            '}',
            '},1500);',
            'console.log("[注入] 截图拦截已就绪，deviceId="+DID+", target="+TARGET);',
            '})();',
            '</script>'
        ].join('');

        body = body.replace('</head>', injectScript + '</head>');

        // 重写静态资源路径为目标服务器绝对URL
        body = body.replace(/src="\/([^"]+)"/g, 'src="' + finalUrl + '/$1"');
        body = body.replace(/href="\/([^"]+)"/g, 'href="' + finalUrl + '/$1"');
        body = body.replace(/io\(\)/g, 'io("' + finalUrl + '")');
        body = body.replace(/io\(["']\/["']\)/g, 'io("' + finalUrl + '")');

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(body);
    });
});

// 截图保存接口（供注入JS调用）
app.post('/api/webview-screenshot-save', async (req, res) => {
    const { deviceId, image, objects } = req.body;
    if (!deviceId || !image) {
        return res.status(400).json({ code: 400, message: '缺少必要参数' });
    }
    try {
        const timestamp = Date.now();
        const jsonData = objects && objects.length > 0
            ? JSON.stringify({ count: objects.length, objects })
            : null;
        const imageBase64 = image.replace(/^data:image\/\w+;base64,/, '');
        await pool.query(
            'INSERT INTO webview_screenshots (device_id, source, image_base64, json_data, timestamp) VALUES (?, ?, ?, ?, ?)',
            [deviceId, '', imageBase64, jsonData, timestamp]
        );
        console.log(`[Webview] 截图已保存: deviceId=${deviceId}`);
        res.json({ code: 200, message: 'ok' });
    } catch (err) {
        console.error('[Webview] 保存截图失败:', err.message);
        res.status(500).json({ code: 500, message: '保存截图失败' });
    }
});

// 获取截图历史
app.get('/api/webview-screenshots/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    if (!deviceId) {
        return res.status(400).json({ code: 400, message: '缺少deviceId' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT id, device_id, source, image_base64, json_data, timestamp, created_at FROM webview_screenshots WHERE device_id = ? ORDER BY timestamp DESC LIMIT 50',
            [deviceId]
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ code: 500, message: '获取截图历史失败' });
    }
});

// ========== 数据查询接口 ==========
app.get('/api/query', async (req, res) => {
    const { deviceId, table, keyword, keyword1, keyword2, keywordOp, keyword1Field, keyword2Field, time, timePrecise, page, pageSize, deviceType, startTime, endTime, exact, order, valueMin, valueMax, type, ok } = req.query
    console.log('[查询] 收到请求 deviceId=', deviceId, 'table=', table, 'deviceType=', deviceType, 'keyword=', keyword, 'time=', time)
    if (!deviceId || !table) {
        return res.status(400).json({ code: 400, message: '缺少 deviceId 或 table 参数' })
    }
    const validTables = ['sensor_history', 'alarm_history', 'mqtt_messages', 'special_data', 'webview_screenshots', 'publish_history']
    if (!validTables.includes(table)) {
        return res.status(400).json({ code: 400, message: '无效的表名: ' + table })
    }
    const pageNum = Math.max(1, parseInt(page) || 1)
    const size = Math.min(200, Math.max(1, parseInt(pageSize) || 50))
    const offset = (pageNum - 1) * size
    const did = Number(deviceId)

    try {
        let sql = ''
        let countSql = ''

        const kw1 = keyword1 ? String(keyword1).trim() : (keyword ? String(keyword).trim() : '')
        const kw2 = keyword2 ? String(keyword2).trim() : ''
        const f1 = keyword1Field ? String(keyword1Field).trim() : ''
        const f2 = keyword2Field ? String(keyword2Field).trim() : ''
        const kwMatch = (colExpr, kw) => exact === '1' ? `${colExpr} = '${kw}'` : `${colExpr} LIKE '%${kw}%'`
        const buildKwCond = (fieldCond) => {
            const conds = []
            if (kw1) conds.push(fieldCond(f1, kw1.replace(/'/g, "''")))
            if (kw2) conds.push(fieldCond(f2, kw2.replace(/'/g, "''")))
            if (conds.length === 0) return ''
            if (conds.length === 1) return ' AND ' + conds[0]
            return ' AND (' + conds[0] + ' ' + (keywordOp === 'or' ? 'OR' : 'AND') + ' ' + conds[1] + ')'
        }

        switch (table) {
        case 'sensor_history':
            if (deviceType === 'special') {
                sql = `SELECT id, device_id, json_data, timestamp FROM special_data WHERE device_id = ${did}`
                sql += buildKwCond((f, kw) => kwMatch('json_data', kw))
                if (startTime || endTime) {
                  const st = startTime ? Number(startTime) * 1000 : 0
                  const et = endTime ? Number(endTime) * 1000 : 9999999999999
                  sql += ` AND timestamp >= ${st} AND timestamp <= ${et}`
                } else if (time) {
                  if (timePrecise) { const t = Number(timePrecise) * 1000; sql += ` AND timestamp >= ${t} AND timestamp < ${t + 1000}` }
                  else { const dayStart = Number(time) * 1000; const dayEnd = dayStart + 86400000 - 1; sql += ` AND timestamp >= ${dayStart} AND timestamp <= ${dayEnd}` }
                }
                sql += order === 'asc' ? ' ORDER BY timestamp ASC' : ' ORDER BY timestamp DESC'
            } else {
                sql = `SELECT sh.id, sh.sensor_name, sh.value, sh.timestamp, sdn.display_name FROM sensor_history sh LEFT JOIN sensor_display_names sdn ON sh.device_id = sdn.device_id AND sh.sensor_name = sdn.sensor_key WHERE sh.device_id = ${did}`
                sql += buildKwCond((f, kw) => {
                    if (f === 'sensor_name') return kwMatch('sh.sensor_name', kw)
                    if (f === 'display_name') return kwMatch('sdn.display_name', kw)
                    if (f === 'value') return kwMatch('sh.value', kw)
                    return `(${kwMatch('sh.sensor_name', kw)} OR ${kwMatch('sdn.display_name', kw)})`
                })
                if (valueMin !== undefined && valueMin !== '') { sql += ` AND CAST(sh.value AS DECIMAL(20,6)) >= ${Number(valueMin)}` }
                if (valueMax !== undefined && valueMax !== '') { sql += ` AND CAST(sh.value AS DECIMAL(20,6)) <= ${Number(valueMax)}` }
                if (startTime || endTime) {
                  const st = startTime ? Number(startTime) * 1000 : 0
                  const et = endTime ? Number(endTime) * 1000 : 9999999999999
                  sql += ` AND sh.timestamp >= ${st} AND sh.timestamp <= ${et}`
                } else if (time) {
                  if (timePrecise) { const t = Number(timePrecise) * 1000; sql += ` AND sh.timestamp >= ${t} AND sh.timestamp < ${t + 1000}` }
                  else { const dayStart = Number(time) * 1000; const dayEnd = dayStart + 86400000 - 1; sql += ` AND sh.timestamp >= ${dayStart} AND sh.timestamp <= ${dayEnd}` }
                }
                sql += order === 'asc' ? ' ORDER BY sh.timestamp ASC' : ' ORDER BY sh.timestamp DESC'
            }
            break
        case 'alarm_history':
            sql = `SELECT id, source, sensor_name, alarm_message, timestamp FROM (SELECT id, 'alarm' AS source, sensor_name, alarm_message, timestamp FROM alarm_history WHERE project_id = ${did} UNION ALL SELECT id, 'threshold' AS source, sensor_key AS sensor_name, CONCAT('值:', current_value, ' (', min_value, '-', max_value, ') ', alarm_message) AS alarm_message, alarm_time AS timestamp FROM threshold_alarms WHERE device_id = ${did}) AS merged_alarms WHERE 1=1`
            sql += buildKwCond((f, kw) => {
                    if (f === 'sensor_name') return kwMatch('sensor_name', kw)
                    if (f === 'alarm_message') return kwMatch('alarm_message', kw)
                    return `(${kwMatch('sensor_name', kw)} OR ${kwMatch('alarm_message', kw)})`
                })
            if (startTime || endTime) {
              const st = startTime ? Number(startTime) * 1000 : 0
              const et = endTime ? Number(endTime) * 1000 : 9999999999999
              sql += ` AND timestamp >= ${st} AND timestamp <= ${et}`
            } else if (time) {
              if (timePrecise) { const t = Number(timePrecise) * 1000; sql += ` AND timestamp >= ${t} AND timestamp < ${t + 1000}` }
              else { const dayStart = Number(time) * 1000; const dayEnd = dayStart + 86400000 - 1; sql += ` AND timestamp >= ${dayStart} AND timestamp <= ${dayEnd}` }
            }
            sql += order === 'asc' ? ' ORDER BY timestamp ASC' : ' ORDER BY timestamp DESC'
            break
        case 'mqtt_messages':
            sql = `SELECT id, device_id, json_data, time, timestamp_ms FROM mqtt_messages WHERE device_id = ${did} AND (device_type = '${deviceType || 'normal'}' OR device_type IS NULL)`
            sql += buildKwCond((f, kw) => kwMatch('json_data', kw))
            if (startTime || endTime) {
              const st = startTime ? Number(startTime) * 1000 : 0
              const et = endTime ? Number(endTime) * 1000 : 9999999999999
              sql += ` AND timestamp_ms >= ${st} AND timestamp_ms <= ${et}`
            } else if (time) {
              if (timePrecise) { const t = Number(timePrecise) * 1000; sql += ` AND timestamp_ms >= ${t} AND timestamp_ms < ${t + 1000}` }
              else { const dayStart = Number(time) * 1000; const dayEnd = dayStart + 86400000 - 1; sql += ` AND timestamp_ms >= ${dayStart} AND timestamp_ms <= ${dayEnd}` }
            }
            sql += order === 'asc' ? ' ORDER BY timestamp_ms ASC' : ' ORDER BY timestamp_ms DESC'
            break
        case 'special_data':
            sql = `SELECT id, device_id, json_data, timestamp FROM special_data WHERE device_id = ${did}`
            sql += buildKwCond((f, kw) => kwMatch('json_data', kw))
            if (startTime || endTime) {
              const st = startTime ? Number(startTime) * 1000 : 0
              const et = endTime ? Number(endTime) * 1000 : 9999999999999
              sql += ` AND timestamp >= ${st} AND timestamp <= ${et}`
            } else if (time) {
              if (timePrecise) { const t = Number(timePrecise) * 1000; sql += ` AND timestamp >= ${t} AND timestamp < ${t + 1000}` }
              else { const dayStart = Number(time) * 1000; const dayEnd = dayStart + 86400000 - 1; sql += ` AND timestamp >= ${dayStart} AND timestamp <= ${dayEnd}` }
            }
            sql += order === 'asc' ? ' ORDER BY timestamp ASC' : ' ORDER BY timestamp DESC'
            break
        case 'webview_screenshots':
            sql = `SELECT id, image_base64, json_data, timestamp FROM webview_screenshots WHERE device_id = ${did}`
            sql += buildKwCond((f, kw) => kwMatch('json_data', kw))
            if (startTime || endTime) {
              const st = startTime ? Number(startTime) * 1000 : 0
              const et = endTime ? Number(endTime) * 1000 : 9999999999999
              sql += ` AND timestamp >= ${st} AND timestamp <= ${et}`
            } else if (time) {
              if (timePrecise) { const t = Number(timePrecise) * 1000; sql += ` AND timestamp >= ${t} AND timestamp < ${t + 1000}` }
              else { const dayStart = Number(time) * 1000; const dayEnd = dayStart + 86400000 - 1; sql += ` AND timestamp >= ${dayStart} AND timestamp <= ${dayEnd}` }
            }
            sql += order === 'asc' ? ' ORDER BY timestamp ASC' : ' ORDER BY timestamp DESC'
            break
        case 'publish_history':
            sql = `SELECT id, device_id, type, method, topic, payload, qos, ok, status, url, response_data, created_at FROM publish_history WHERE device_id = ${did}`
            sql += buildKwCond((f, kw) => {
                    if (f === 'topic') return kwMatch('topic', kw)
                    if (f === 'url') return kwMatch('url', kw)
                    if (f === 'payload') return kwMatch('payload', kw)
                    if (f === 'response_data') return kwMatch('response_data', kw)
                    return `(${kwMatch('payload', kw)} OR ${kwMatch('response_data', kw)} OR ${kwMatch('url', kw)})`
                })
            if (type) { sql += ` AND type = '${type}'` }
            if (ok !== undefined && ok !== '') { sql += ` AND ok = ${ok === '1' ? 1 : 0}` }
            if (startTime || endTime) {
              const st = startTime ? Number(startTime) * 1000 : 0
              const et = endTime ? Number(endTime) * 1000 : 9999999999999
              sql += ` AND UNIX_TIMESTAMP(created_at) * 1000 >= ${st} AND UNIX_TIMESTAMP(created_at) * 1000 <= ${et}`
            } else if (time) {
              if (timePrecise) { const t = Number(timePrecise) * 1000; sql += ` AND UNIX_TIMESTAMP(created_at) * 1000 >= ${t} AND UNIX_TIMESTAMP(created_at) * 1000 < ${t + 1000}` }
              else { const dayStart = Number(time) * 1000; const dayEnd = dayStart + 86400000 - 1; sql += ` AND UNIX_TIMESTAMP(created_at) * 1000 >= ${dayStart} AND UNIX_TIMESTAMP(created_at) * 1000 <= ${dayEnd}` }
            }
            sql += order === 'asc' ? ' ORDER BY created_at ASC' : ' ORDER BY created_at DESC'
            break
        }

        countSql = sql.replace(/SELECT .+? FROM/, 'SELECT COUNT(*) AS total FROM').replace(/ ORDER BY .+/, '')
        sql += ` LIMIT ${size} OFFSET ${offset}`

        console.log('[查询] SQL:', sql)
        console.log('[查询] CountSQL:', countSql)
        const [rows] = await pool.query(sql)
        const [countResult] = await pool.query(countSql)
        const total = countResult[0].total
        console.log('[查询] 结果: rows.length=', rows.length, 'total=', total)

        res.json({ code: 200, data: { list: rows, total, page: pageNum, pageSize: size } })
    } catch (err) {
        console.error('[查询] 失败:', err.message)
        res.status(500).json({ code: 500, message: '查询失败: ' + err.message })
    }
})

// ========== 查询结果编辑/删除 API ==========
app.put('/api/query-record', async (req, res) => {
    const { table, id, source } = req.body
    if (!table || id === undefined) {
        return res.status(400).json({ code: 400, message: '缺少 table 或 id 参数' })
    }
    // 兼容两种格式：新格式传 fields 对象；旧格式把字段平铺在 body 顶层
    const updates = (req.body.fields && typeof req.body.fields === 'object') ? { ...req.body.fields } : { ...req.body }
    delete updates.table
    delete updates.id
    delete updates.source
    delete updates.fields

    // 各表允许更新的列白名单（防注入，忽略未知字段）
    const allowedFields = {
        sensor_history: ['sensor_name', 'value', 'timestamp'],
        alarm_history: ['sensor_name', 'alarm_message', 'timestamp'],
        threshold_alarms: ['sensor_key', 'alarm_message', 'alarm_time'],
        mqtt_messages: ['json_data', 'time'],
        webview_screenshots: ['json_data', 'timestamp'],
        special_data: ['json_data', 'timestamp'],
        publish_history: ['type', 'topic', 'url', 'payload', 'response_data', 'ok', 'created_at']
    }

    // alarm_history 的 threshold 来源实际更新 threshold_alarms 表
    const targetTable = (table === 'alarm_history' && source === 'threshold') ? 'threshold_alarms' : table
    const fields = allowedFields[targetTable]
    if (!fields) {
        return res.status(400).json({ code: 400, message: '不支持的表: ' + table })
    }

    const setClauses = []
    const values = []
    for (const f of fields) {
        if (updates[f] !== undefined && updates[f] !== null) {
            setClauses.push('`' + f + '` = ?')
            values.push(updates[f])
        }
    }
    if (setClauses.length === 0) {
        return res.status(400).json({ code: 400, message: '没有可更新的字段' })
    }

    try {
        await pool.query('UPDATE `' + targetTable + '` SET ' + setClauses.join(', ') + ' WHERE id = ?', [...values, id])
        res.json({ code: 200, message: '更新成功' })
    } catch (err) {
        console.error('[编辑记录] 失败:', err.message)
        res.status(500).json({ code: 500, message: '更新失败: ' + err.message })
    }
})

app.delete('/api/query-record', async (req, res) => {
    const { table, id, source } = req.body
    if (!table || id === undefined) {
        return res.status(400).json({ code: 400, message: '缺少 table 或 id 参数' })
    }
    try {
        if (table === 'alarm_history' && source === 'threshold') {
            await pool.query('DELETE FROM threshold_alarms WHERE id = ?', [id])
        } else if (table === 'alarm_history') {
            await pool.query('DELETE FROM alarm_history WHERE id = ?', [id])
        } else if (['sensor_history', 'mqtt_messages', 'webview_screenshots', 'special_data', 'publish_history'].includes(table)) {
            await pool.query(`DELETE FROM ${table} WHERE id = ?`, [id])
        } else {
            return res.status(400).json({ code: 400, message: '不支持的表' })
        }
        res.json({ code: 200, message: '删除成功' })
    } catch (err) {
        console.error('[删除记录] 失败:', err.message)
        res.status(500).json({ code: 500, message: '删除失败: ' + err.message })
    }
})

// 批量删除当前查询条件下的全部记录（复用 /api/query 的过滤条件）
app.delete('/api/query-records', async (req, res) => {
    const { deviceId, table, keyword, keyword1, keyword2, keywordOp, keyword1Field, keyword2Field, deviceType, startTime, endTime, exact, valueMin, valueMax, type, ok } = req.query
    if (!deviceId || !table) {
        return res.status(400).json({ code: 400, message: '缺少 deviceId 或 table 参数' })
    }
    const validTables = ['sensor_history', 'alarm_history', 'mqtt_messages', 'special_data', 'webview_screenshots', 'publish_history']
    if (!validTables.includes(table)) {
        return res.status(400).json({ code: 400, message: '无效的表名: ' + table })
    }
    const did = Number(deviceId)

    const kw1 = keyword1 ? String(keyword1).trim() : (keyword ? String(keyword).trim() : '')
    const kw2 = keyword2 ? String(keyword2).trim() : ''
    const f1 = keyword1Field ? String(keyword1Field).trim() : ''
    const f2 = keyword2Field ? String(keyword2Field).trim() : ''
    const kwMatch = (colExpr, kw) => exact === '1' ? `${colExpr} = '${kw}'` : `${colExpr} LIKE '%${kw}%'`
    const buildKwCond = (fieldCond) => {
        const conds = []
        if (kw1) conds.push(fieldCond(f1, kw1.replace(/'/g, "''")))
        if (kw2) conds.push(fieldCond(f2, kw2.replace(/'/g, "''")))
        if (conds.length === 0) return ''
        if (conds.length === 1) return ' AND ' + conds[0]
        return ' AND (' + conds[0] + ' ' + (keywordOp === 'or' ? 'OR' : 'AND') + ' ' + conds[1] + ')'
    }
    const timeCond = (colExpr) => {
        if (!startTime && !endTime) return ''
        const st = startTime ? Number(startTime) * 1000 : 0
        const et = endTime ? Number(endTime) * 1000 : 9999999999999
        return ` AND ${colExpr} >= ${st} AND ${colExpr} <= ${et}`
    }

    const statements = []
    const push = (s) => { if (s) statements.push(s) }

    switch (table) {
    case 'sensor_history':
        if (deviceType === 'special') {
            push(`DELETE FROM special_data WHERE device_id = ${did}` + buildKwCond((f, kw) => kwMatch('json_data', kw)) + timeCond('timestamp'))
        } else {
            push(`DELETE sh FROM sensor_history sh LEFT JOIN sensor_display_names sdn ON sh.device_id = sdn.device_id AND sh.sensor_name = sdn.sensor_key WHERE sh.device_id = ${did}` +
                buildKwCond((f, kw) => {
                    if (f === 'sensor_name') return kwMatch('sh.sensor_name', kw)
                    if (f === 'display_name') return kwMatch('sdn.display_name', kw)
                    if (f === 'value') return kwMatch('sh.value', kw)
                    return `(${kwMatch('sh.sensor_name', kw)} OR ${kwMatch('sdn.display_name', kw)})`
                }) +
                (valueMin !== undefined && valueMin !== '' ? ` AND CAST(sh.value AS DECIMAL(20,6)) >= ${Number(valueMin)}` : '') +
                (valueMax !== undefined && valueMax !== '' ? ` AND CAST(sh.value AS DECIMAL(20,6)) <= ${Number(valueMax)}` : '') +
                timeCond('sh.timestamp'))
        }
        break
    case 'alarm_history':
        push(`DELETE FROM alarm_history WHERE project_id = ${did}` + buildKwCond((f, kw) => {
                    if (f === 'sensor_name') return kwMatch('sensor_name', kw)
                    if (f === 'alarm_message') return kwMatch('alarm_message', kw)
                    return `(${kwMatch('sensor_name', kw)} OR ${kwMatch('alarm_message', kw)})`
                }) + timeCond('timestamp'))
        push(`DELETE FROM threshold_alarms WHERE device_id = ${did}` + buildKwCond((f, kw) => {
                    if (f === 'sensor_name') return kwMatch('sensor_key', kw)
                    if (f === 'alarm_message') return kwMatch('alarm_message', kw)
                    return `(${kwMatch('sensor_key', kw)} OR ${kwMatch('alarm_message', kw)})`
                }) + timeCond('alarm_time'))
        break
    case 'mqtt_messages': {
        const dt = deviceType === 'special' ? 'special' : 'normal'
        push(`DELETE FROM mqtt_messages WHERE device_id = ${did} AND (device_type = '${dt}' OR device_type IS NULL)` + buildKwCond((f, kw) => kwMatch('json_data', kw)) + timeCond('timestamp_ms'))
        break
    }
    case 'special_data':
        push(`DELETE FROM special_data WHERE device_id = ${did}` + buildKwCond((f, kw) => kwMatch('json_data', kw)) + timeCond('timestamp'))
        break
    case 'webview_screenshots':
        push(`DELETE FROM webview_screenshots WHERE device_id = ${did}` + buildKwCond((f, kw) => kwMatch('json_data', kw)) + timeCond('timestamp'))
        break
    case 'publish_history': {
        let cond = buildKwCond((f, kw) => {
                    if (f === 'topic') return kwMatch('topic', kw)
                    if (f === 'url') return kwMatch('url', kw)
                    if (f === 'payload') return kwMatch('payload', kw)
                    if (f === 'response_data') return kwMatch('response_data', kw)
                    return `(${kwMatch('payload', kw)} OR ${kwMatch('response_data', kw)} OR ${kwMatch('url', kw)})`
                })
        if (type === 'http' || type === 'mqtt') cond += ` AND type = '${type}'`
        if (ok === '1' || ok === '0') cond += ` AND ok = ${ok === '1' ? 1 : 0}`
        push(`DELETE FROM publish_history WHERE device_id = ${did}` + cond + timeCond('UNIX_TIMESTAMP(created_at) * 1000'))
        break
    }
    }

    if (statements.length === 0) {
        return res.status(400).json({ code: 400, message: '无法构造删除语句' })
    }

    try {
        let affected = 0
        for (const stmt of statements) {
            console.log('[批量删除] SQL:', stmt)
            const [r] = await pool.query(stmt)
            affected += (r && r.affectedRows) || 0
        }
        res.json({ code: 200, message: '删除成功', data: { affected } })
    } catch (err) {
        console.error('[批量删除] 失败:', err.message)
        res.status(500).json({ code: 500, message: '删除失败: ' + err.message })
    }
})

// ========== 云平台配置 API ==========

// 获取云平台配置
app.get('/api/cloud-configs/:platform', async (req, res) => {
    const { platform } = req.params;
    const validPlatforms = ['aliyun', 'onenet', 'gizwits', 'huawei'];
    if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ code: 400, message: '不支持的平台' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT platform, config_json, enabled, poll_interval_sec FROM cloud_configs WHERE platform = ?',
            [platform]
        );
        res.json({ code: 200, data: rows[0] || null });
    } catch (err) {
        console.error('[CloudConfig] 获取失败:', err.message);
        res.status(500).json({ code: 500, message: '获取配置失败' });
    }
});

// 保存云平台配置
app.post('/api/cloud-configs', async (req, res) => {
    const { platform, configJson } = req.body;
    const validPlatforms = ['aliyun', 'onenet', 'gizwits', 'huawei'];
    if (!platform || !validPlatforms.includes(platform)) {
        return res.status(400).json({ code: 400, message: '不支持的平台' });
    }
    if (!configJson || typeof configJson !== 'object') {
        return res.status(400).json({ code: 400, message: '配置数据格式错误' });
    }
    try {
        // 自动 trim 所有字符串值，防止粘贴时带入前后空格
        const trimmed = {};
        for (const [k, v] of Object.entries(configJson)) {
            trimmed[k] = typeof v === 'string' ? v.trim() : v;
        }
        const configStr = JSON.stringify(trimmed);
        await pool.query(
            `INSERT INTO cloud_configs (platform, config_json, enabled) VALUES (?, ?, 1)
             ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), enabled = 1`,
            [platform, configStr]
        );
        res.json({ code: 200, message: '保存成功' });
    } catch (err) {
        console.error('[CloudConfig] 保存失败:', err.message);
        res.status(500).json({ code: 500, message: '保存失败: ' + err.message });
    }
});

// 测试云平台连接
app.post('/api/cloud-configs/:platform/test', async (req, res) => {
    const { platform } = req.params;
    try {
        const [rows] = await pool.query(
            'SELECT config_json FROM cloud_configs WHERE platform = ? AND enabled = 1',
            [platform]
        );
        if (rows.length === 0) {
            return res.json({ code: 400, message: '请先保存平台配置' });
        }

        let config;
        try {
            config = typeof rows[0].config_json === 'string'
                ? JSON.parse(rows[0].config_json)
                : rows[0].config_json;
        } catch (e) {
            return res.json({ code: 400, message: '配置解析失败' });
        }

        let ok = false;
        if (platform === 'aliyun') {
            const service = new AliyunIoTService(config);
            ok = await service.testConnection();
        } else if (platform === 'onenet') {
            const OneNetApiService = require('./services/onenet-api');
            const service = new OneNetApiService(config);
            try {
                ok = await service.testConnection();
            } catch (e) {
                console.error('[OneNet 测试] API连接异常:', e.message);
                return res.json({ code: 400, message: 'API连接失败: ' + e.message });
            }
        } else if (platform === 'gizwits') {
            const GizwitsIoTService = require('./services/gizwits-iot');
            const service = new GizwitsIoTService(config);
            try {
                ok = await service.testConnection();
            } catch (e) {
                console.error('[Gizwits 测试] API连接异常:', e.message);
                return res.json({ code: 400, message: 'API连接失败: ' + e.message });
            }
        }

        if (ok) {
            res.json({ code: 200, message: '连接成功' });
        } else {
            res.json({ code: 400, message: '连接失败，请检查配置' });
        }
    } catch (err) {
        console.error('[CloudConfig] 测试连接失败:', err.message);
        res.status(500).json({ code: 500, message: err.message });
    }
});

// ========== OneNet 手动连接控制 ==========
// 用户点击"连接"按钮后读取 cloud_configs 中的配置，启动 REST API 轮询

app.post('/api/onenet/connect', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT config_json FROM cloud_configs WHERE platform = 'onenet' AND enabled = 1"
        );
        if (rows.length === 0) {
            return res.json({ code: 400, message: '请先在 OneNet 表单中保存配置' });
        }
        let config = rows[0].config_json;
        if (typeof config === 'string') {
            try { config = JSON.parse(config); } catch (e) {
                return res.json({ code: 400, message: '配置解析失败' });
            }
        }
        cloudPoller.activateOnenet(config);
        await pool.query("UPDATE cloud_configs SET connected = 1 WHERE platform = 'onenet'");
        console.log('[OneNet] REST API 轮询已启动（已持久化）');
        res.json({ code: 200, message: '已连接' });
    } catch (e) {
        console.error('[OneNet] 启动失败:', e.message);
        res.json({ code: 500, message: '启动失败: ' + e.message });
    }
});

app.post('/api/onenet/disconnect', async (req, res) => {
    cloudPoller.deactivateOnenet();
    await pool.query("UPDATE cloud_configs SET connected = 0 WHERE platform = 'onenet'");
    console.log('[OneNet] REST API 轮询已停止');
    res.json({ code: 200, message: '已断开' });
});

app.get('/api/onenet/status', async (req, res) => {
    res.json({ code: 200, data: { connected: cloudPoller.isOnenetActive() } });
});

// ========== 阿里云 手动连接控制 ==========

app.post('/api/aliyun/connect', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT config_json FROM cloud_configs WHERE platform = 'aliyun' AND enabled = 1"
        );
        if (rows.length === 0) {
            return res.json({ code: 400, message: '请先在阿里云表单中保存配置' });
        }
        cloudPoller.activatePlatform('aliyun');
        await pool.query("UPDATE cloud_configs SET connected = 1 WHERE platform = 'aliyun'");
        console.log('[Aliyun] REST API 轮询已启动（已持久化）');
        res.json({ code: 200, message: '已连接' });
    } catch (e) {
        console.error('[Aliyun] 启动失败:', e.message);
        res.json({ code: 500, message: '启动失败: ' + e.message });
    }
});

app.post('/api/aliyun/disconnect', async (req, res) => {
    cloudPoller.deactivatePlatform('aliyun');
    await pool.query("UPDATE cloud_configs SET connected = 0 WHERE platform = 'aliyun'");
    console.log('[Aliyun] REST API 轮询已停止');
    res.json({ code: 200, message: '已断开' });
});

app.get('/api/aliyun/status', async (req, res) => {
    res.json({ code: 200, data: { connected: cloudPoller.isPlatformActive('aliyun') } });
});

// ========== 机智云 手动连接控制 ==========
app.post('/api/gizwits/connect', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT config_json FROM cloud_configs WHERE platform = 'gizwits' AND enabled = 1"
        );
        if (rows.length === 0) {
            return res.json({ code: 400, message: '请先在机智云表单中保存配置' });
        }
        cloudPoller.activatePlatform('gizwits');
        await pool.query("UPDATE cloud_configs SET connected = 1 WHERE platform = 'gizwits'");
        console.log('[Gizwits] REST API 轮询已启动（已持久化）');
        res.json({ code: 200, message: '已连接' });
    } catch (e) {
        console.error('[Gizwits] 启动失败:', e.message);
        res.json({ code: 500, message: '启动失败: ' + e.message });
    }
});

app.post('/api/gizwits/disconnect', async (req, res) => {
    cloudPoller.deactivatePlatform('gizwits');
    await pool.query("UPDATE cloud_configs SET connected = 0 WHERE platform = 'gizwits'");
    console.log('[Gizwits] REST API 轮询已停止');
    res.json({ code: 200, message: '已断开' });
});

app.get('/api/gizwits/status', async (req, res) => {
    res.json({ code: 200, data: { connected: cloudPoller.isPlatformActive('gizwits') } });
});

// ========== 华为云 手动连接控制 ==========
app.post('/api/huawei/connect', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT config_json FROM cloud_configs WHERE platform = 'huawei' AND enabled = 1"
        );
        if (rows.length === 0) {
            return res.json({ code: 400, message: '请先在华为云表单中保存配置' });
        }
        cloudPoller.activatePlatform('huawei');
        await pool.query("UPDATE cloud_configs SET connected = 1 WHERE platform = 'huawei'");
        console.log('[Huawei] REST API 轮询已启动（已持久化）');
        res.json({ code: 200, message: '已连接' });
    } catch (e) {
        console.error('[Huawei] 启动失败:', e.message);
        res.json({ code: 500, message: '启动失败: ' + e.message });
    }
});

app.post('/api/huawei/disconnect', async (req, res) => {
    cloudPoller.deactivatePlatform('huawei');
    await pool.query("UPDATE cloud_configs SET connected = 0 WHERE platform = 'huawei'");
    console.log('[Huawei] REST API 轮询已停止');
    res.json({ code: 200, message: '已断开' });
});

app.get('/api/huawei/status', async (req, res) => {
    res.json({ code: 200, data: { connected: cloudPoller.isPlatformActive('huawei') } });
});

// ============================================================
// OneNet HTTP 数据推送接收 (共享逻辑)
// 参考: C:\Users\27890\Desktop\onenet上云服务\server.js
// OneNet 文档: https://open.iot.10086.cn/doc/iot_platform/book/data-manage/push.html
// ============================================================

// 从数据库读取 OneNet 配置
async function getOnenetConfig() {
    const [rows] = await pool.query(
        "SELECT config_json FROM cloud_configs WHERE platform = 'onenet' AND enabled = 1"
    );
    if (rows.length === 0) return null;
    let config = rows[0].config_json;
    if (typeof config === 'string') {
        try { config = JSON.parse(config); } catch (e) { return null; }
    }
    return {
        token: config.token || '',
        productId: config.productId || '',
        accessKey: config.accessKey || ''
    };
}

// OneNet 签名校验: md5(token + nonce + msg) → base64
// 注意: msg 须使用 OneNet 推送的原始 msg 字符串 (未经 parse)
function checkOnenetSign(token, nonce, msg, signature) {
    if (!token || !nonce || !msg || !signature) return false;
    const hash = crypto.createHash('md5').update(token + nonce + msg).digest();
    const calSig = Buffer.from(hash).toString('base64');
    return calSig === signature;
}

// 提取设备数据的公共函数
// payload: OneNet 推送中 msg 解析后的 JSON 对象
// 支持三种格式: 物模型 params / datapoints / 直接键值
function extractOnenetPayload(payload) {
    const data = {};

    // 格式1: 物模型 {"id":"xxx","params":{"temp":{"value":25},...}}
    if (payload.params && typeof payload.params === 'object') {
        for (const [k, v] of Object.entries(payload.params)) {
            if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) {
                data[k] = v.value;
            } else if (typeof v !== 'object' || Array.isArray(v)) {
                data[k] = v;
            }
        }
    }

    // 格式2: OneJson {"datapoints":{"temp":25,...}}
    if (payload.datapoints && typeof payload.datapoints === 'object') {
        for (const [k, v] of Object.entries(payload.datapoints)) {
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) continue;
            data[k] = v;
        }
    }

    // 格式3: {"data":{"temp":25,...}}
    if (payload.data && typeof payload.data === 'object') {
        for (const [k, v] of Object.entries(payload.data)) {
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) continue;
            data[k] = v;
        }
    }

    // 格式4: 直接键值对 {"temp":25, "dianya_num":220}
    for (const [k, v] of Object.entries(payload)) {
        if (['id', 'type', 'params', 'datapoints', 'data', 'device_id', 'deviceId',
             'did', 'time', 'timestamp', 'nonce', 'signature'].includes(k)) continue;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) continue;
        data[k] = v;
    }

    // 自动转换数字字符串
    for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '') {
            data[k] = Number(v);
        }
    }

    return data;
}

// 将 OneNet 数据写入本地数据库 (sensor_history 或 special_data)
async function saveOnenetDataToDb(data, deviceId, deviceName, timestamp) {
    if (!data || Object.keys(data).length === 0) return 0;

    // 判断是否为 special_data: 只要有一个 value 是复杂对象, 就整包存 special
    const hasComplexValue = Object.values(data).some(
        v => typeof v === 'object' && v !== null && !Array.isArray(v)
    );

    const localHash = crypto.createHash('md5')
        .update(`onenet:${deviceId}`).digest();
    const numericId = (localHash.readUInt32BE(0) % 9000000) + 90000000;

    // 确保设备存在
    await pool.query(
        'INSERT INTO devices (device_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
        [numericId, deviceName]
    );

    if (hasComplexValue) {
        // 复杂结构 → special_data
        const contentHash = crypto.createHash('md5')
            .update(JSON.stringify(Object.keys(data).sort())).digest('hex');
        let [specRows] = await pool.query(
            'SELECT id FROM special_devices WHERE content_hash = ?', [contentHash]
        );
        let specId;
        if (specRows.length === 0) {
            const [ins] = await pool.query(
                'INSERT INTO special_devices (name, content_hash, last_timestamp) VALUES (?, ?, ?)',
                [deviceName, contentHash, timestamp]
            );
            specId = ins.insertId;
        } else {
            specId = specRows[0].id;
            await pool.query(
                'UPDATE special_devices SET last_timestamp = ? WHERE id = ?',
                [timestamp, specId]
            );
        }
        await pool.query(
            'INSERT INTO special_data (device_id, json_data, timestamp) VALUES (?, ?, ?)',
            [specId, JSON.stringify(data), timestamp]
        );
        console.log(`[OneNet] special_data 已入库: specId=${specId}, keys=${Object.keys(data).join(',')}`);
    } else {
        // 简单键值 → sensor_history
        for (const [key, val] of Object.entries(data)) {
            const sensorName = key.replace(/\d+$/, '') || key;
            await pool.query(
                'INSERT INTO sensor_history (device_id, sensor_name, value, timestamp) VALUES (?, ?, ?, ?)',
                [numericId, sensorName, String(val), timestamp]
            );
        }
        console.log(`[OneNet] sensor_history 已入库: device=${numericId}, fields=${Object.keys(data).join(',')}`);
    }

    return numericId;
}

// ============================================================
// GET /push — OneNet URL 验证 (和参考 server.js 完全一致)
// OneNet 配置推送时自动发起 GET 请求验证 URL 有效性
// 按照 OneNet 文档: 原样返回 msg 参数值即表示验证通过
// ============================================================
app.get('/push', (req, res) => {
    const { msg, nonce, signature } = req.query;
    console.log(`[OneNet GET /push] URL验证 msg=${(msg||'').substring(0,50)} nonce=${nonce}`);

    // 验签 (仅日志, 不拦截 — OneNet 文档允许跳过验签直接返回msg)
    getOnenetConfig().then(config => {
        if (config && config.token) {
            const ok = checkOnenetSign(config.token, nonce || '', msg || '', signature);
            console.log(`[OneNet GET /push] 验签: ${ok ? '✅ 通过' : '⚠️ 不匹配(仍返回msg)'}`);
        }
    });

    // 原样返回 msg, 和参考 server.js 完全一致: res.send(msg)
    res.send(msg || '');
});

// ============================================================
// POST /push — OneNet 数据推送接收 (和参考 server.js 完全一致)
// OneNet 将设备数据以 HTTP POST 方式推送到此端点
// 必须返回 HTTP 200, 否则 OneNet 会无限重推
// ============================================================
app.post('/push', async (req, res) => {
    const { msg, nonce, signature, time, id } = req.body;
    console.log(`[OneNet POST /push] 收到推送 id=${id}`);

    if (!msg) {
        console.log('[OneNet POST /push] ❌ 消息体为空');
        return res.status(400).send('missing msg');
    }

    // Step 1: 读取配置
    const config = await getOnenetConfig();
    if (!config || !config.token) {
        console.log('[OneNet POST /push] ⚠️ OneNet 未配置或未启用, 仍返回200 (避免OneNet重推)');
        return res.status(200).send('ok');
    }

    // Step 2: 验签 — msg 必须用原始字符串 (OneNet 推送body中的msg是JSON字符串)
    if (nonce && signature) {
        const ok = checkOnenetSign(config.token, nonce, msg, signature);
        if (!ok) {
            console.log('[OneNet POST /push] ❌ 签名验证失败, 拒绝入库 (仍返回200避免重推)');
            console.log(`  收到签名: ${signature.substring(0,30)}...`);
            return res.status(200).send('ok');
        }
        console.log('[OneNet POST /push] ✅ 签名验证通过');
    } else {
        console.log('[OneNet POST /push] ⚠️ 缺少签名参数, 跳过验签');
    }

    // Step 3: 解析 msg — OneNet 推送的 msg 是 JSON 字符串, 先 parse
    let payload;
    try {
        payload = typeof msg === 'string' ? JSON.parse(msg) : msg;
    } catch (e) {
        // msg 可能本身就是普通字符串 (设备生命周期事件等)
        console.log(`[OneNet POST /push] msg 非JSON字符串: ${(msg+'').substring(0,100)}`);
        return res.status(200).send('ok');
    }

    console.log(`[OneNet POST /push] 解析: ${JSON.stringify(payload).substring(0,200)}`);

    // Step 4: 提取设备标识
    let deviceId = config.productId || 'onenet_device';
    let deviceName = '[onenet] 设备';
    if (payload.device_id) {
        deviceId = payload.device_id;
        deviceName = `[onenet] ${payload.device_id}`;
    } else if (payload.deviceId) {
        deviceId = payload.deviceId;
        deviceName = `[onenet] ${payload.deviceId}`;
    } else if (payload.did) {
        deviceId = payload.did;
        deviceName = `[onenet] ${payload.did}`;
    }

    // Step 5: 提取数据字段
    const data = extractOnenetPayload(payload);

    // Step 6: 写入数据库
    if (Object.keys(data).length > 0) {
        await saveOnenetDataToDb(data, deviceId, deviceName, time || Date.now());
    } else {
        console.log('[OneNet POST /push] 无有效数据字段');
    }

    // Step 7: 必须返回 200
    res.status(200).send('ok');
});

// ============================================================
// GET /api/onenet/receive — 备选 URL 验证端点 (同 /push)
// ============================================================
app.get('/api/onenet/receive', async (req, res) => {
    const { msg, nonce, signature } = req.query;
    console.log(`[OneNet GET /api/onenet/receive] URL验证 msg=${(msg||'').substring(0,50)}`);

    const config = await getOnenetConfig();
    if (config && config.token) {
        const ok = checkOnenetSign(config.token, nonce || '', msg || '', signature);
        console.log(`[OneNet GET /api/onenet/receive] 验签: ${ok ? '✅ 通过' : '⚠️ 不匹配(仍返回msg)'}`);
    }

    res.send(msg || '');
});

// ============================================================
// POST /api/onenet/receive — 备选数据推送端点 (同 /push, 并对接cloud-poller MQTT数据)
// ============================================================
app.post('/api/onenet/receive', async (req, res) => {
    try {
        const { msg, nonce, signature, time, id } = req.body;
        console.log(`[OneNet POST /api/onenet/receive] 收到推送`);

        if (!msg) {
            return res.status(200).send('ok');
        }

        const config = await getOnenetConfig();

        // 验签 (仅日志)
        if (config && config.token && nonce && signature) {
            const ok = checkOnenetSign(config.token, nonce, msg, signature);
            console.log(`[OneNet POST /api/onenet/receive] 验签: ${ok ? '✅' : '⚠️ 不匹配'}`);
        }

        // 解析 msg
        let payload;
        if (typeof msg === 'string') {
            try { payload = JSON.parse(msg); } catch (e) { payload = msg; }
        } else {
            payload = msg;
        }

        if (typeof payload === 'string') {
            console.log(`[OneNet POST /api/onenet/receive] msg为字符串: ${payload}`);
            return res.status(200).send('ok');
        }

        // 提取数据
        const data = extractOnenetPayload(payload);
        if (Object.keys(data).length === 0) {
            return res.status(200).send('ok');
        }

        // 设备标识
        let deviceId = (config && config.productId) || 'onenet_device';
        let deviceName = '[onenet] 设备';
        if (payload.device_id) {
            deviceId = payload.device_id;
            deviceName = `[onenet] ${payload.device_id}`;
        } else if (payload.deviceId) {
            deviceId = payload.deviceId;
            deviceName = `[onenet] ${payload.deviceId}`;
        } else if (payload.did) {
            deviceId = payload.did;
            deviceName = `[onenet] ${payload.did}`;
        }

        await saveOnenetDataToDb(data, deviceId, deviceName, time || Date.now());
        res.send('ok');
    } catch (e) {
        console.error('[OneNet POST /api/onenet/receive] 异常:', e.message);
        res.status(200).send('ok'); // 仍返回200, 避免OneNet重推
    }
});

// ========== 智能判定上报代理（转发前端请求，绕过跨域） ==========
// 模拟回显接口：GET/POST 通用，返回涵盖三种匹配模式的模拟响应
app.all('/api/mock-echo', (req, res) => {
    const received = req.method === 'POST' ? req.body : req.query;
    res.json({
        code: 200,
        result: 'success',
        ...(received && typeof received === 'object' ? received : {}),
        task_id: 'TASK-20260816120000',
        api_version: 'v3.2.1',
        payload: {
            meta: {
                source: 'web',
                timestamp: '2026-08-16T12:00:00Z',
                environment: {
                    cluster: 'prod-east',
                    node: 'node-05',
                    replica_id: 'r-3'
                },
                session: {
                    user: {
                        id: 'u-10086',
                        role: 'operator',
                        credentials: {
                            token: {
                                value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
                                expires: '2026-08-16T14:00:00Z',
                                refresh: {
                                    enabled: true,
                                    count: 3,
                                    last: '2026-08-16T11:50:00Z',
                                    policy: {
                                        max_attempts: 5,
                                        backoff_ms: 1000
                                    }
                                }
                            }
                        }
                    },
                    client: {
                        ip: '192.168.1.100',
                        geo: {
                            city: 'Shanghai',
                            country: 'CN',
                            coords: { lat: 31.23, lng: 121.47, accuracy: 50 }
                        },
                        headers: {
                            user_agent: 'Mozilla/5.0 (compatible; CustomClient/2.0)',
                            accept: 'application/json',
                            lang: 'zh-CN'
                        }
                    }
                }
            },
            control_sequence: {
                plan_id: 'PLAN-20260816-001',
                priority: 'high',
                execution: {
                    steps: [
                        {
                            order: 1,
                            target_device: 'heater',
                            instruction: {
                                core: {
                                    command: {
                                        action: 'set_state',
                                        parameters: {
                                            desired_state: { switch: { power: 'off' } }
                                        }
                                    }
                                },
                                metadata: {
                                    mode: 'soft',
                                    delay_ms: 0,
                                    retry: { max: 3, interval: 500, exponential_backoff: true },
                                    theme: { zhuti: 'weixian' }
                                }
                            }
                        },
                        {
                            order: 2,
                            target_device: 'pump',
                            instruction: {
                                core: {
                                    command: {
                                        action: 'set_state',
                                        parameters: {
                                            desired_state: { switch: { power: 'ON' } }
                                        }
                                    }
                                },
                                metadata: {
                                    speed: 80,
                                    direction: 'clockwise',
                                    schedule: {
                                        start: 'now',
                                        duration_sec: 120,
                                        repeat: { enabled: false, interval_min: 0 }
                                    }
                                }
                            }
                        },
                        {
                            order: 3,
                            target_device: 'fan',
                            instruction: {
                                core: {
                                    command: {
                                        action: 'set_state',
                                        parameters: {
                                            desired_state: { switch: { power: 'enable' } }
                                        }
                                    }
                                },
                                metadata: {
                                    pwm: 1023,
                                    thresholds: { temp: { low: 25, high: 45 } },
                                    alarm: { enabled: true, sound: 'buzzer', volume: 80 }
                                }
                            }
                        }
                    ],
                    parallelism: 1,
                    timeout_seconds: 30
                },
                status: {
                    queue: ['heater', 'pump', 'fan'],
                    pending: 0,
                    history: [
                        {
                            step: 1,
                            action: 'heater_off',
                            result: 'success',
                            timestamp: '2026-08-16T12:00:01Z',
                            details: { ack: true, latency_ms: 12 }
                        }
                    ]
                }
            },
            devices: [
                {
                    id: 0,
                    name: 'light',
                    type: 'actuator',
                    hardware: {
                        model: 'LED-2000',
                        firmware: '2.0.4',
                        location: { zone: 'A1', rack: 3, slot: 2 }
                    },
                    operational: {
                        current: {
                            state: { switch: { is_on: true } },
                            brightness: 75,
                            color: { rgb: { r: 255, g: 200, b: 100 } },
                            energy: { voltage: 220, current: 0.5, power: 110 }
                        },
                        history: [
                            { timestamp: '2026-08-16T11:00:00Z', state: { switch: { is_on: true } } },
                            { timestamp: '2026-08-16T10:30:00Z', state: { switch: { is_on: false } } }
                        ]
                    }
                },
                {
                    id: 1,
                    name: 'valve',
                    type: 'valve',
                    hardware: {
                        model: 'V-300',
                        material: 'brass',
                        location: { zone: 'B2', rack: 1, slot: 4 },
                        maintenance: { last_check: '2026-08-01', next_due: '2026-09-01', status: 'ok' }
                    },
                    operational: {
                        current: {
                            state: { switch: { valve_position: 'close' } },
                            opening_percent: 0,
                            flow_rate: 0.0
                        },
                        history: [
                            { timestamp: '2026-08-16T09:00:00Z', state: { switch: { valve_position: 'open' } } },
                            { timestamp: '2026-08-16T10:00:00Z', state: { switch: { valve_position: 'close' } } }
                        ]
                    }
                },
                {
                    id: 2,
                    name: 'relay',
                    type: 'relay',
                    hardware: {
                        model: 'R-24',
                        coil_voltage: 24,
                        contact_rating: '10A/250V',
                        pins: { NO: 1, NC: 2, COM: 3 },
                        location: { zone: 'C3', rack: 2, slot: 1 }
                    },
                    operational: {
                        current: {
                            state: { switch: { is_active: 'ACTIVE' } },
                            diagnostics: { temperature: 38.2, cycles: 1250, last_error: null }
                        },
                        history: [
                            { timestamp: '2026-08-16T08:00:00Z', state: { switch: { is_active: 'ACTIVE' } } },
                            { timestamp: '2026-08-16T07:30:00Z', state: { switch: { is_active: 'INACTIVE' } } }
                        ]
                    }
                }
            ],
            commands: {
                available: ['heater', 'pump', 'fan', 'valve_adjust', 'light_dim'],
                issued: ['heater', 'pump', 'fan'],
                validated: { all: true, invalid: [] }
            },
            control_results: {
                execution_summary: { total: 3, succeeded: 2, failed: 0, pending: 0 },
                per_device: {
                    heater: { status: { success: false, state: 'off' }, error: null, timestamp: '2026-08-16T12:00:02Z' },
                    pump: { status: { success: true, state: 1 }, error: null, timestamp: '2026-08-16T12:00:03Z' },
                    valve: { status: { success: true, state: 'STOPPED' }, error: null, timestamp: '2026-08-16T12:00:04Z' }
                },
                extra: {
                    fan_speed: 1200,
                    alarm_triggered: false,
                    system_health: {
                        cpu: { usage_percent: 45.6, cores: [12.0, 34.5, 56.7, 78.9] },
                        memory: { used_mb: 12.5, total_mb: 256, swap: { used: 0, free: 1024 } },
                        network: { latency_ms: 12, packet_loss: 0.02, bandwidth_mbps: 100 }
                    },
                    acknowledged_commands: [
                        { cmd: 'heater', status: 'ok', timestamp: '2026-08-16T12:00:02Z', details: { response_code: 200 } },
                        { cmd: 'pump', status: 'ok', timestamp: '2026-08-16T12:00:03Z', details: { response_code: 200 } }
                    ]
                }
            },
            analysis: {
                sensors: {
                    temperature: { value: 34.5, unit: 'C', level: '偏高', threshold: { low: 20, high: 33, critical: 40 } },
                    humidity: { value: 53, unit: '%', level: '正常', threshold: { low: 30, high: 70 } },
                    pressure: { value: 1013.2, unit: 'hPa', trend: 'stable' }
                },
                trends: {
                    temperature_history: [32.5, 33.1, 34.0, 33.8, 34.5],
                    humidity_history: [55, 53, 52, 54, 53],
                    predictions: {
                        next_hour: { temp: 35.2, humidity: 50, confidence: 0.87 },
                        next_6h: { temp: 33.0, humidity: 55, confidence: 0.72 }
                    }
                },
                anomalies: [
                    { type: 'temp_spike', value: 34.5, threshold: 33.0, timestamp: '2026-08-16T11:55:00Z', severity: 'warning' }
                ],
                recommendations: [
                    { action: 'reduce_heater', priority: 1, detail: '温度偏高，建议调低加热功率', impact: { expected_temp_reduction: 1.5, time_minutes: 10 } },
                    { action: 'check_fan', priority: 2, detail: '风扇转速可能不足', impact: { expected_temp_reduction: 0.5, time_minutes: 5 } }
                ]
            },
            server_info: {
                time: { iso: '2026-08-16T12:00:00Z', unix: 1723816800, timezone: 'UTC' },
                uptime: { seconds: 3600, human: '1h 0m 0s' },
                version: { api: 'v3.2.1', firmware: '2.0.4', build: '20260816', commit: 'a1b2c3d' },
                health: {
                    overall: 'healthy',
                    checks: {
                        database: { connected: true, response_time_ms: 5, pool: { active: 3, idle: 5, max: 20 } },
                        mqtt: { connected: true, subscribers: 12, messages_sent: 456, messages_received: 789 },
                        storage: { free_gb: 120.5, used_gb: 30.2, warnings: [], disk_health: 'good' }
                    }
                },
                tags: ['production', 'east-zone', 'auto-mode'],
                deployment: { cluster: 'cluster-01', node: 'node-03', replicas: 3, canary: false }
            },
            debug: {
                trace_id: 'abc-123-def-456',
                span_id: 'span-789',
                parent_span: null,
                profiling: {
                    cpu: { user: 12.3, system: 5.4, idle: 82.3, interrupt: 0.2 },
                    memory: { heap: 8.2, stack: 0.9, gc: 0.4, objects: { count: 4567, size_mb: 3.1 } }
                },
                dependencies: {
                    external_services: [
                        { name: 'logger', status: 'ok', latency_ms: 2 },
                        { name: 'metrics', status: 'ok', latency_ms: 8 }
                    ]
                }
            }
        }
    });
});

app.post('/api/proxy-decision', async (req, res) => {
    const { url, body, method } = req.body;
    if (!url) {
        return res.status(400).json({ code: 400, message: '缺少 url 参数' });
    }
    const httpMethod = (method || 'POST').toUpperCase();
    try {
        const bodyStr = body ? JSON.stringify(body) : '';
        const targetUrl = /^https?:\/\//i.test(url) ? url : 'http://' + url;
        const urlObj = new URL(targetUrl);
        const mod = urlObj.protocol === 'https:' ? https : http;
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'HChapter02-Proxy/1.0'
        };
        if (bodyStr) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: httpMethod,
            headers,
            timeout: 15000,
            rejectUnauthorized: false
        };
        const proxyResult = await new Promise((resolve, reject) => {
            const proxyReq = mod.request(options, proxyRes => {
                let data = '';
                proxyRes.on('data', chunk => data += chunk);
                proxyRes.on('end', () => {
                    try { resolve({ status: proxyRes.statusCode, data: JSON.parse(data) }); }
                    catch (e) { resolve({ status: proxyRes.statusCode, data }); }
                });
            });
            proxyReq.on('error', e => reject(e));
            proxyReq.on('timeout', () => { proxyReq.destroy(); reject(new Error('请求超时')); });
            if (bodyStr) proxyReq.write(bodyStr);
            proxyReq.end();
        });
        res.json({ code: 200, data: proxyResult });
    } catch (e) {
        res.json({ code: 500, message: '代理请求失败: ' + e.message });
    }
});

// 启动服务
app.listen(PORT, '0.0.0.0', () => {
    console.log(`后端服务已启动: http://localhost:${PORT}`);
});