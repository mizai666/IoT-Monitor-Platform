/**
 * 机智云 (Gizwits) IoT 设备接入服务
 *
 * Open API 文档: http://docs.gizwits.com/zh-cn/Cloud/openapi_apps.html
 *
 * 认证方式: 匿名登录 POST /app/users 获取 UserToken, 再用 UserToken 拉设备数据
 * 主要接口:
 *   - 匿名登录: POST /app/users
 *   - 绑定设备: POST /app/bind_mac
 *   - 获取设备最新数据: GET /app/devdata/{did}/latest
 */
const crypto = require('crypto');
const https = require('https');

class GizwitsIoTService {
  constructor(config) {
    this.appId = (config.appId || '').trim();
    this.appSecret = (config.appSecret || '').trim();
    this.productKey = (config.productKey || '').trim();
    this.did = (config.did || '').trim();
    this.passcode = (config.passcode || '123456').trim();
    this.baseUrl = 'api.gizwits.com';
    this._token = null;
    this._tokenExpire = 0;
    this._phoneId = null;
  }

  _apiRequest(method, path, headers, body) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl, port: 443, path, method,
        headers: { 'Content-Type': 'application/json', ...headers },
        timeout: 10000
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ _raw: data }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * 匿名登录获取 UserToken
   * POST /app/users  { "phone_id": "unique_id" }
   */
  async _getToken() {
    if (this._token && Date.now() < this._tokenExpire) {
      return this._token;
    }

    if (!this._phoneId) {
      this._phoneId = 'hchapter01-' + this.appId.substring(0, 8);
    }

    // 1. 匿名登录创建用户
    let result = await this._apiRequest('POST', '/app/users',
      { 'X-Gizwits-Application-Id': this.appId },
      { phone_id: this._phoneId }
    );

    console.log('[Gizwits] 匿名登录响应:', JSON.stringify(result).substring(0, 200));

    // 如果 phone_id 已存在(400), 尝试用不同 phone_id
    if (result.error_code || (result.code && result.code !== 0)) {
      this._phoneId = 'hchapter01-' + Math.random().toString(36).substring(2, 10);
      result = await this._apiRequest('POST', '/app/users',
        { 'X-Gizwits-Application-Id': this.appId },
        { phone_id: this._phoneId }
      );
      console.log('[Gizwits] 匿名登录重试:', JSON.stringify(result).substring(0, 200));
    }

    if (result.token) {
      this._token = result.token;
      this._tokenExpire = Date.now() + 150 * 24 * 3600 * 1000; // 150天
      console.log('[Gizwits] UserToken获取成功');

      // 2. 尝试绑定虚拟设备
      try {
        const bindRes = await this._apiRequest('POST', '/app/bind_mac',
          {
            'X-Gizwits-Application-Id': this.appId,
            'X-Gizwits-User-Token': this._token
          },
          {
            product_key: this.productKey,
            mac: this.did,
            did: this.did,
            passcode: this.passcode
          }
        );
        console.log('[Gizwits] 设备绑定响应:', JSON.stringify(bindRes).substring(0, 200));
      } catch (e) {
        console.log('[Gizwits] 设备绑定异常(可能已绑定):', e.message);
      }

      return this._token;
    }

    throw new Error('匿名登录失败: ' + JSON.stringify(result));
  }

  async _request(path) {
    const token = await this._getToken();
    return this._apiRequest('GET', path, {
      'X-Gizwits-Application-Id': this.appId,
      'X-Gizwits-User-Token': token
    });
  }

  /**
   * 获取设备最新数据 (内部)
   */
  async fetchDeviceProperties() {
    const result = { props: {}, online: false };
    if (!this.did) return result;

    try {
      const res = await this._request(`/app/devdata/${this.did}/latest`);
      console.log('[Gizwits] 设备数据响应:', JSON.stringify(res).substring(0, 300));

      if (res && !res.error_code && res.attr) {
        let ts = Number(res.updated_at) || 0;
        if (ts < 10000000000) ts = ts * 1000;

        for (const [key, val] of Object.entries(res.attr)) {
          let v = val;
          if (typeof v === 'string' && !isNaN(Number(v))) v = Number(v);
          result.props[key] = { value: v, time: ts };
        }
      }
    } catch (e) {
      console.error('[Gizwits] 数据拉取异常:', e.message);
    }

    // 检查在线
    try {
      const devRes = await this._request(`/app/devices/${this.did}`);
      result.online = !!(devRes && !devRes.error_code && devRes.online);
    } catch (e) {
      result.online = Object.keys(result.props).length > 0;
    }

    return result;
  }

  /**
   * cloud-poller 统一接口
   */
  async fetchAllDeviceData() {
    const result = { devices: [], errors: [] };
    if (!this.did) {
      result.errors.push({ error: '未配置设备ID' });
      return result;
    }
    try {
      const { props, online } = await this.fetchDeviceProperties();
      if (Object.keys(props).length > 0) {
        let maxTs = 0;
        for (const info of Object.values(props)) {
          if (info.time && info.time > maxTs) maxTs = info.time;
        }
        result.devices.push({
          deviceId: this.did,
          deviceName: `[gizwits] ${this.did}`,
          data: props,
          timestamp: maxTs > 0 ? maxTs : Date.now()
        });
      }
    } catch (e) {
      result.errors.push({ deviceId: this.did, error: e.message });
    }
    return result;
  }

  async testConnection() {
    try {
      await this._getToken();
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = GizwitsIoTService;
