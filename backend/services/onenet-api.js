/**
 * OneNet REST API 服务 (新协议)
 * 参考: post_server/utils/onenet.js
 *
 * 使用 OneNet 新版 REST API (iot-api.heclouds.com)
 * 认证方式: HMAC-SHA1 签名 (version=2022-05-01)
 *
 * 不需要公网IP, 不需要MQTT直连, 不需要HTTP推送
 * 主动轮询即可获取设备数据
 */

const crypto = require('crypto');
const https = require('https');

class OneNetApiService {
  constructor(config) {
    this.productId = (config.productId || '').trim();
    this.accessKey = (config.accessKey || '').trim();
    this.deviceName = (config.deviceName || '').trim();
    this.baseUrl = 'iot-api.heclouds.com';
    this._token = null;
    this._tokenTime = 0;
  }

  /**
   * 生成 HMAC-SHA1 认证 Token
   * 格式: version=2022-05-01&res=products%2F{pid}&et={expire}&method=sha1&sign={sign}
   */
  _generateToken() {
    const version = '2022-05-01';
    const res = `products/${this.productId}`;
    const et = String(Math.floor(Date.now() / 1000) + 86400);
    const method = 'sha1';

    // sign = HMAC-SHA1(access_key, et + '\n' + method + '\n' + res + '\n' + version)
    const org = et + '\n' + method + '\n' + res + '\n' + version;
    const key = Buffer.from(this.accessKey, 'base64');
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(org);
    const sign = hmac.digest('base64');

    return `version=${version}&res=${encodeURIComponent(res)}&et=${et}&method=${method}&sign=${encodeURIComponent(sign)}`;
  }

  _getToken() {
    const now = Date.now();
    if (!this._token || (now - this._tokenTime) > 3600000) {
      this._token = this._generateToken();
      this._tokenTime = now;
    }
    return this._token;
  }

  /**
   * 发送 API 请求
   */
  _request(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        port: 443,
        path: path,
        method: method,
        headers: {
          'Authorization': this._getToken(),
          'Content-Type': 'application/json'
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            // 某些接口可能返回多行, 取第一行 JSON
            const firstLine = body.split('\n')[0];
            const result = JSON.parse(firstLine);
            if (result.code === 0) {
              resolve(result);
            } else {
              reject(new Error(`OneNet API错误: ${result.code} - ${result.msg || ''}`));
            }
          } catch (e) {
            reject(new Error('JSON解析失败: ' + body.substring(0, 200)));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });

      if (data && method !== 'GET') {
        req.write(JSON.stringify(data));
      }
      req.end();
    });
  }

  /**
   * 查询设备最新属性值
   * GET /thingmodel/query-device-property?product_id={pid}&device_name={dname}
   * 返回: { temperature: {value: 25, time: 1725962719211}, ... }
   */
  async getDeviceProperty() {
    const params = `product_id=${this.productId}&device_name=${this.deviceName}`;
    const res = await this._request(`/thingmodel/query-device-property?${params}`);
    const props = {};
    (res.data || []).forEach(item => {
      let val = item.value;
      if (val === undefined || val === null || val === 'undefined') {
        val = '';
      }
      if (typeof val === 'string' && !isNaN(Number(val)) && val.trim() !== '') {
        val = Number(val);
      }
      props[item.identifier] = {
        value: val,
        time: item.time || null   // OneNet 返回的属性时间戳
      };
    });
    return props;
  }

  /**
   * 查询设备在线状态
   * GET /thingmodel/query-device-status?product_id={pid}&device_name={dname}
   */
  async getDeviceStatus() {
    const params = `product_id=${this.productId}&device_name=${this.deviceName}`;
    try {
      const res = await this._request(`/thingmodel/query-device-status?${params}`);
      return res.data && res.data.status === 1;
    } catch (e) {
      return false;
    }
  }

  /**
   * 测试连接: 能查到属性或状态即表示连接正常
   */
  async testConnection() {
    try {
      await this.getDeviceProperty();
      return true;
    } catch (e) {
      // 设备可能离线但API连通, 再试状态接口
      try {
        await this.getDeviceStatus();
        return true;
      } catch (e2) {
        console.error('[OneNetApi] 连接测试失败:', e.message);
        return false;
      }
    }
  }

  /**
   * 拉取所有设备数据 (兼容 cloud-poller 接口)
   * 返回: { devices: [{ deviceId, deviceName, data: {...}, timestamp }], errors: [] }
   * 注意: data 中的每个属性为 {value, time} 格式, timestamp 取所有属性中最新的 time
   */
  async fetchAllDeviceData() {
    const result = { devices: [], errors: [] };
    try {
      const props = await this.getDeviceProperty();
      if (Object.keys(props).length === 0) {
        return result;
      }

      // 取所有属性中最新的 OneNet 时间戳
      let latestDeviceTs = 0;
      for (const item of Object.values(props)) {
        if (item.time) {
          const t = Number(item.time);
          if (t > latestDeviceTs) latestDeviceTs = t;
        }
      }

      const deviceId = this.deviceName || `onenet_${this.productId}`;
      result.devices.push({
        deviceId,
        deviceName: `[onenet] ${this.deviceName}`,
        data: props,
        timestamp: latestDeviceTs > 0 ? latestDeviceTs : Date.now()
      });
    } catch (e) {
      result.errors.push({ deviceId: this.deviceName, error: e.message });
    }
    return result;
  }
}

module.exports = OneNetApiService;
