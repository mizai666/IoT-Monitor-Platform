/**
 * 云平台统一调度器
 *
 * 支持两种模式：
 *   REST API 轮询（阿里云 / OneNet / 华为云 / 腾讯云）：每 N 秒主动拉取
 *   MQTT 直连（OneNet 备用）：持久连接，实时接收数据
 *
 * 数据写入逻辑：MQTT 消息到达 → 解析 → 写入 sensor_history / special_data → 前端刷新
 */

const crypto = require('crypto');
const mysql = require('mysql2/promise');
const AliyunIoTService = require('./aliyun-iot');
const OneNetService = require('./onenet-iot');     // MQTT 直连 (保留兼容)
const OneNetApiService = require('./onenet-api');  // REST API (新方案)
const GizwitsIoTService = require('./gizwits-iot');
const HuaweiIoTService = require('./huawei-iot');

let pool = null;
let running = false;
let pollInterval = null;
let onenetInstance = null; // OneNet MQTT 持久连接实例
let onenetPollActive = false;      // OneNet 轮询开关
let aliyunPollActive = false;      // 阿里云 轮询开关
let gizwitsPollActive = false;     // 机智云 轮询开关
let huaweiPollActive = false;      // 华为云 轮询开关

const SERVICE_FACTORIES = {
  aliyun: (config) => new AliyunIoTService(config),
  onenet: (config) => new OneNetApiService(config),  // 使用 REST API 轮询
  gizwits: (config) => new GizwitsIoTService(config),
  huawei: (config) => new HuaweiIoTService(config)
};

// MQTT 平台列表（不自动连接，用户手动触发）
const MQTT_PLATFORMS = [];

function injectPool(dbPool) {
  pool = dbPool;
}

// 后端重启时从数据库恢复连接状态（仅恢复用户手动点过"连接"的平台）
async function restoreConnectionState() {
  if (!pool) return;
  try {
    // 启动时重置所有平台的连接状态，用户需手动点击"连接"才开始轮询
    await pool.query("UPDATE cloud_configs SET connected = 0");
    console.log('[CloudPoller] 已重置所有云平台连接状态，等待用户手动连接');
  } catch (e) {
    console.error('[CloudPoller] 恢复连接状态失败:', e.message);
  }
}

async function startPolling() {
  if (running) return;
  running = true;
  console.log('[CloudPoller] 调度器已启动');

  // 从数据库恢复用户的连接状态
  await restoreConnectionState();

  await pollAllPlatforms();

  pollInterval = setInterval(async () => {
    await pollAllPlatforms();
  }, 3000); // 3秒轮询, 设备快速更新也能跟上
}

function stopPolling() {
  running = false;
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (onenetInstance) { onenetInstance.disconnect(); onenetInstance = null; }
  console.log('[CloudPoller] 调度器已停止');
}

async function pollAllPlatforms() {
  if (!pool) return;

  try {
    const [configs] = await pool.query(
      'SELECT platform, config_json FROM cloud_configs WHERE enabled = 1'
    );

    for (const row of configs) {
      try {
        // 云平台需用户手动点击"连接"后才开始轮询
        if (row.platform === 'onenet' && !onenetPollActive) continue;
        if (row.platform === 'aliyun' && !aliyunPollActive) continue;
        if (row.platform === 'gizwits' && !gizwitsPollActive) continue;
        if (row.platform === 'huawei' && !huaweiPollActive) continue;

        if (MQTT_PLATFORMS.includes(row.platform)) {
          await ensureMqttConnection(row.platform, row.config_json);
        } else {
          await pollRestPlatform(row.platform, row.config_json);
        }
      } catch (e) {
        console.error(`[CloudPoller] ${row.platform} 失败:`, e.message);
      }
    }
  } catch (e) {
    console.error('[CloudPoller] 读取配置失败:', e.message);
  }
}

// ==================== MQTT 持久连接 ====================

async function ensureMqttConnection(platform, configJsonRaw) {
  let config;
  try {
    config = typeof configJsonRaw === 'string' ? JSON.parse(configJsonRaw) : configJsonRaw;
  } catch (e) { return; }

  if (platform === 'onenet') {
    // 已连接则检查健康状态
    if (onenetInstance && onenetInstance.isConnected()) {
      return;
    }

    // 断开旧连接
    if (onenetInstance) {
      onenetInstance.disconnect();
      onenetInstance = null;
    }

    // 创建新连接
    const service = new OneNetService(config);
    service.onData = (parsed) => handleMqttData(platform, parsed);

    try {
      await service.connect();
      onenetInstance = service;
      console.log('[CloudPoller] OneNet MQTT 连接成功，实时数据通道就绪');
    } catch (e) {
      console.error('[CloudPoller] OneNet MQTT 连接失败:', e.message);
    }
  }
}

// ==================== REST 轮询 ====================

async function pollRestPlatform(platform, configJsonRaw) {
  const Factory = SERVICE_FACTORIES[platform];
  if (!Factory) return;

  let config;
  try {
    config = typeof configJsonRaw === 'string' ? JSON.parse(configJsonRaw) : configJsonRaw;
  } catch (e) { return; }

  const service = Factory(config);
  let result;
  try {
    result = await service.fetchAllDeviceData();
  } catch (e) {
    console.error(`[CloudPoller] ${platform} 数据拉取失败:`, e.message);
    return;
  }

  await processDeviceData(platform, result);
}

// ==================== 统一数据处理 ====================

async function processDeviceData(platform, result) {
  let saved = 0, skipped = 0;
  for (const deviceData of result.devices) {
    try {
      if (!deviceData.data || Object.keys(deviceData.data).length === 0) {
        skipped++;
        continue;
      }

      const localDeviceId = generateCloudDeviceId(platform, deviceData.deviceId);
      await upsertCloudDevice(platform, deviceData.deviceId, deviceData.deviceName, localDeviceId);

      // OneNet 格式: {temp: {value: 25, time: 1725...}} → 展平并逐条用属性时间戳
      const sampleVal = Object.values(deviceData.data)[0];
      const isOnenetFormat = sampleVal && typeof sampleVal === 'object' && 'value' in sampleVal;

      if (isOnenetFormat) {
        for (const [key, info] of Object.entries(deviceData.data)) {
          const sensorName = key.replace(/\d+$/, '') || key;
          const val = info.value;
          const propTs = info.time ? Number(info.time) : deviceData.timestamp;
          await saveCloudSensorData(localDeviceId, sensorName, val, propTs);
        }
      } else {
        // 判断 special_data: 有复杂对象值才入 special, 否则走 sensor_history
        const isSpecial = Object.values(deviceData.data).some(
          v => typeof v === 'object' && v !== null && !Array.isArray(v)
        );
        if (isSpecial) {
          await saveCloudSpecialData(platform, deviceData.deviceId, deviceData.data, deviceData.timestamp);
        } else {
          for (const [key, val] of Object.entries(deviceData.data)) {
            const sensorName = key.replace(/\d+$/, '') || key;
            await saveCloudSensorData(localDeviceId, sensorName, val, deviceData.timestamp);
          }
        }
      }
      saved++;
    } catch (e) {
      console.error(`[CloudPoller] ${platform} 存储失败:`, e.message);
    }
  }
  if (saved > 0) {
    console.log(`[CloudPoller] ${platform}: ${saved} 设备已同步, ${skipped} 跳过`);
  }
}

/**
 * MQTT 实时数据回调 — 单条设备数据直接入库
 */
async function handleMqttData(platform, parsed) {
  if (!parsed || !parsed.data) return;
  try {
    // 包装成统一格式
    const result = {
      devices: [{
        deviceId: parsed.deviceId,
        deviceName: parsed.deviceName,
        data: parsed.data,
        timestamp: parsed.timestamp
      }],
      errors: []
    };
    await processDeviceData(platform, result);
  } catch (e) {
    console.error(`[CloudPoller] MQTT 数据处理失败:`, e.message);
  }
}

// ==================== 数据库操作 ====================

function generateCloudDeviceId(platform, cloudDeviceId) {
  const hash = crypto.createHash('md5')
    .update(`${platform}:${cloudDeviceId}`)
    .digest();
  return (hash.readUInt32BE(0) % 9000000) + 90000000;
}

async function upsertCloudDevice(platform, deviceId, deviceName, localDeviceId) {
  const [existing] = await pool.query(
    'SELECT id FROM devices WHERE device_id = ?', [localDeviceId]
  );
  if (existing.length === 0) {
    await pool.query(
      'INSERT INTO devices (device_id, name) VALUES (?, ?)',
      [localDeviceId, deviceName || `[${platform}] ${deviceId}`]
    );
  } else {
    await pool.query(
      'UPDATE devices SET name = ? WHERE device_id = ?',
      [deviceName || `[${platform}] ${deviceId}`, localDeviceId]
    );
  }
}

async function saveCloudSensorData(localDeviceId, sensorName, value, timestamp) {
  // 检查最新记录的时间戳，数据时间没更新则跳过（避免轮询重复入库）
  // BINARY 强制大小写敏感，避免 als/ALS 被当成同一个传感器
  const [latest] = await pool.query(
    'SELECT timestamp FROM sensor_history WHERE device_id = ? AND BINARY sensor_name = ? ORDER BY timestamp DESC LIMIT 1',
    [localDeviceId, sensorName]
  );
  if (latest.length > 0 && latest[0].timestamp >= timestamp) {
    return; // 已有更新或相同时间的数据，跳过
  }
  await pool.query(
    'INSERT INTO sensor_history (device_id, sensor_name, value, timestamp) VALUES (?, ?, ?, ?)',
    [localDeviceId, sensorName, String(value), timestamp]
  );
}

async function saveCloudSpecialData(platform, deviceId, jsonData, timestamp) {
  const contentHash = crypto.createHash('md5')
    .update(JSON.stringify(Object.keys(jsonData).sort()))
    .digest('hex');
  let [rows] = await pool.query('SELECT id FROM special_devices WHERE content_hash = ?', [contentHash]);
  let specialDeviceId;
  if (rows.length === 0) {
    const [result] = await pool.query(
      'INSERT INTO special_devices (name, content_hash, last_timestamp) VALUES (?, ?, ?)',
      [`[${platform}] ${deviceId}`, contentHash, timestamp]
    );
    specialDeviceId = result.insertId;
  } else {
    specialDeviceId = rows[0].id;
    await pool.query('UPDATE special_devices SET last_timestamp = ? WHERE id = ?', [timestamp, specialDeviceId]);
  }
  await pool.query(
    'INSERT INTO special_data (device_id, json_data, timestamp) VALUES (?, ?, ?)',
    [specialDeviceId, JSON.stringify(jsonData), timestamp]
  );
}

// ==================== 平台手动激活/停用 ====================

function activatePlatform(platform) {
  switch (platform) {
    case 'onenet': onenetPollActive = true; break;
    case 'aliyun': aliyunPollActive = true; break;
    case 'gizwits': gizwitsPollActive = true; break;
    case 'huawei': huaweiPollActive = true; break;
  }
  console.log(`[CloudPoller] ${platform} 轮询已激活`);
}

function deactivatePlatform(platform) {
  switch (platform) {
    case 'onenet': onenetPollActive = false; break;
    case 'aliyun': aliyunPollActive = false; break;
    case 'gizwits': gizwitsPollActive = false; break;
    case 'huawei': huaweiPollActive = false; break;
  }
  console.log(`[CloudPoller] ${platform} 轮询已停用`);
}

function isPlatformActive(platform) {
  switch (platform) {
    case 'onenet': return onenetPollActive;
    case 'aliyun': return aliyunPollActive;
    case 'gizwits': return gizwitsPollActive;
    case 'huawei': return huaweiPollActive;
    default: return false;
  }
}

// 兼容旧接口
function activateOnenet(c) { activatePlatform('onenet'); }
function deactivateOnenet() { deactivatePlatform('onenet'); }
function isOnenetActive() { return isPlatformActive('onenet'); }

module.exports = {
  injectPool, startPolling, stopPolling,
  activatePlatform, deactivatePlatform, isPlatformActive,
  activateOnenet, deactivateOnenet, isOnenetActive
};
