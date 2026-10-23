/**
 * OneNet MQTT 直连服务
 * 参照 server.py 的实现: 183.230.40.39:6002 + access_key签名
 */
const mqtt = require('mqtt');
const crypto = require('crypto');

class OneNetService {
  constructor(config) {
    this.productId = (config.productId || '').trim();
    this.accessKey = (config.accessKey || '').trim();
    this.deviceName = (config.deviceName || '').trim();
    this.client = null;
    this.connected = false;
    this.onData = null;
  }

  _buildToken() {
    const et = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    // server.py: sign = md5(access_key + et)
    const signStr = this.accessKey + et;
    const hash = crypto.createHash('md5').update(signStr).digest();
    const sign = Buffer.from(hash).toString('base64').trim();
    const signEncoded = encodeURIComponent(sign);
    const resEncoded = `products%2F${this.productId}%2Fdevices%2F${this.deviceName}`;
    return `version=2018-10-31&res=${resEncoded}&et=${et}&method=md5&sign=${signEncoded}`;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const clientId = `${this.deviceName}_crm_${Date.now()}`;
      const password = this._buildToken();

      console.log(`[OneNet] broker=183.230.40.39:6002`);
      console.log(`[OneNet] username=${this.productId}, device=${this.deviceName}`);

      this.client = mqtt.connect('mqtt://183.230.40.39:6002', {
        clientId,
        username: this.productId,
        password,
        protocolVersion: 4, // MQTT 3.1.1
        keepalive: 40,
        connectTimeout: 15000,
        clean: true,
        reconnectPeriod: 5000
      });

      let settled = false;

      this.client.on('connect', () => {
        if (settled) return;
        console.log('[OneNet] MQTT 连接成功');
        this.connected = true;

        const topics = [
          `$sys/${this.productId}/${this.deviceName}/dp/post/json/+`,
          `$sys/${this.productId}/${this.deviceName}/thing/property/post`,
          `$sys/${this.productId}/${this.deviceName}/thing/property/post/reply`
        ];
        topics.forEach(t => this.client.subscribe(t, { qos: 0 }));
        console.log(`[OneNet] 已订阅 ${topics.length} 个主题`);

        if (!settled) { settled = true; resolve(); }
      });

      this.client.on('message', (topic, payload) => {
        try {
          const raw = payload.toString();
          const parsed = this._parseMessage(topic, raw);
          if (parsed && this.onData) this.onData(parsed);
        } catch (e) {
          console.error('[OneNet] 解析失败:', e.message);
        }
      });

      this.client.on('error', (err) => {
        console.error('[OneNet] 错误:', err.message);
        this.connected = false;
        if (!settled) { settled = true; reject(err); }
      });

      this.client.on('close', () => {
        this.connected = false;
      });

      setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('连接超时')); }
      }, 15000);
    });
  }

  _parseMessage(topic, raw) {
    const data = JSON.parse(raw);
    const result = {};

    // server.py 格式: {"params": {"temp": {"value": 25}, ...}}
    if (data.params) {
      for (const [k, v] of Object.entries(data.params)) {
        if (typeof v === 'object' && v !== null && 'value' in v) {
          result[k] = typeof v.value === 'string' && !isNaN(Number(v.value)) ? Number(v.value) : v.value;
        } else {
          result[k] = typeof v === 'string' && !isNaN(Number(v)) ? Number(v) : v;
        }
      }
    } else {
      // 直接格式: {"temp": 25, ...}
      for (const [k, v] of Object.entries(data)) {
        if (['id', 'type'].includes(k)) continue;
        if (typeof v === 'object' && v !== null) continue;
        result[k] = typeof v === 'string' && !isNaN(Number(v)) ? Number(v) : v;
      }
    }

    if (Object.keys(result).length === 0) return null;

    const deviceId = crypto.createHash('md5')
      .update(`onenet:${this.productId}:${this.deviceName}`).digest('hex').substring(0, 16);

    return { deviceId, deviceName: `[onenet] ${this.deviceName}`, data: result, timestamp: Date.now() };
  }

  disconnect() {
    if (this.client) { this.client.end(true); this.client = null; }
    this.connected = false;
  }

  isConnected() { return this.connected; }

  async testConnection() {
    await this.connect();
    this.disconnect();
    return true;
  }

  async fetchAllDeviceData() {
    return { devices: [], errors: [] };
  }
}

module.exports = OneNetService;
