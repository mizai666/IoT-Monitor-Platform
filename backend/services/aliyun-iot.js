/**
 * 阿里云 IoT 设备接入服务
 *
 * API 文档: https://help.aliyun.com/document_detail/69893.html
 *
 * 认证方式: HMAC-SHA1 签名 (阿里云 POP SDK 方式)
 * 主要接口:
 *   - 查询设备列表: QueryDevice
 *   - 查询设备属性: QueryDevicePropertyData
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

class AliyunIoTService {
  constructor(config) {
    this.accessKeyId = config.accessKeyId;
    this.accessKeySecret = config.accessKeySecret;
    this.productKey = config.productKey;
    this.deviceName = config.deviceName || '';
    this.regionId = config.regionId || 'cn-shanghai';
    this.iotInstanceId = config.iotInstanceId || '';
    this.endpoint = config.endpoint || `iot.${this.regionId}.aliyuncs.com`;
  }

  /**
   * 阿里云 POP API 签名 (HMAC-SHA1)
   */
  _buildSignedParams(action, params) {
    const publicParams = {
      Format: 'JSON',
      Version: '2018-01-20',
      AccessKeyId: this.accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      SignatureVersion: '1.0',
      SignatureNonce: Math.random().toString(36).substring(2, 15),
      RegionId: this.regionId,
      ProductKey: this.productKey,
      Action: action
    };
    // 企业实例/分发产品需要指定实例ID
    if (this.iotInstanceId) {
      publicParams.IotInstanceId = this.iotInstanceId;
    }

    const allParams = { ...publicParams, ...params };

    // 1. Sort params
    const sortedKeys = Object.keys(allParams).sort();
    const canonicalized = sortedKeys
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(allParams[k]))
      .join('&');

    // 2. StringToSign = GET&%2F& + encode(canonicalized)
    const stringToSign = 'GET&' + encodeURIComponent('/') + '&' + encodeURIComponent(canonicalized);

    // 3. HMAC-SHA1 sign with secret + '&'
    const sign = crypto.createHmac('sha1', this.accessKeySecret + '&')
      .update(stringToSign)
      .digest('base64');

    allParams.Signature = sign;
    return allParams;
  }

  /**
   * 发送 API 请求
   */
  async _request(params) {
    return new Promise((resolve, reject) => {
      const query = Object.keys(params)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');

      const options = {
        hostname: this.endpoint,
        port: 443,
        path: '/?' + query,
        method: 'GET',
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.Code) {
              reject(new Error(`阿里云IoT错误: ${parsed.Code} - ${parsed.Message || ''}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.end();
    });
  }

  /**
   * 查询产品下的设备列表
   */
  async listDevices(pageSize = 50) {
    return this._request(
      this._buildSignedParams('QueryDevice', {
        PageSize: String(pageSize),
        CurrentPage: '1'
      })
    );
  }

  /**
   * 查询设备属性数据 (最新)
   */
  async getDevicePropertyData(deviceName, identifier, pageSize = 10) {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;
    return this._request(
      this._buildSignedParams('QueryDevicePropertyData', {
        DeviceName: deviceName,
        Identifier: identifier,
        StartTime: String(thirtyDaysAgo),
        EndTime: String(now),
        PageSize: String(pageSize),
        Asc: '0'  // 0=最新在前, 1=最旧在前
      })
    );
  }

  /**
   * 查询设备的物模型属性列表 (获取可查询的属性key)
   */
  async queryThingModel(deviceName) {
    return this._request(
      this._buildSignedParams('QueryThingModel', {
        DeviceName: deviceName
      })
    );
  }

  /**
   * 拉取指定设备的最新遥测数据
   * 返回格式: { devices: [{ deviceId, deviceName, data: {...}, timestamp }], errors: [] }
   */
  async fetchAllDeviceData() {
    const result = { devices: [], errors: [] };
    if (!this.deviceName) {
      result.errors.push({ error: '未配置设备名称' });
      return result;
    }

    try {
      const deviceName = this.deviceName;
      const deviceId = `aliyun_${this.productKey}_${deviceName}`;

      // 查询物模型，获取设备属性列表
      let propertyIdentifiers = [];
      try {
        const modelRes = await this.queryThingModel(deviceName);
        if (modelRes && modelRes.Data) {
          const thingModel = typeof modelRes.Data.ThingModelJson === 'string'
            ? JSON.parse(modelRes.Data.ThingModelJson)
            : modelRes.Data.ThingModelJson;
          const properties = thingModel.properties || [];
          propertyIdentifiers = properties.map(p => p.identifier).filter(Boolean);
        }
      } catch (e) {
        console.warn(`阿里云设备 ${deviceName} 物模型查询失败:`, e.message);
      }

      // 查询每个属性的最新值
      const data = {};
      let maxTs = 0;
      for (const identifier of propertyIdentifiers) {
        try {
          const propRes = await this.getDevicePropertyData(deviceName, identifier, 1);
          const items = (propRes.Data && propRes.Data.List && propRes.Data.List.PropertyInfo) || [];
          if (items.length > 0) {
            const latest = items[0];
            let val = latest.Value;
            if (typeof val === 'string' && !isNaN(Number(val))) {
              val = Number(val);
            }
            data[identifier] = val;
            const ts = parseInt(latest.Time, 10);
            if (ts > maxTs) maxTs = ts;
          }
        } catch (e) {}
      }

      if (Object.keys(data).length > 0) {
        result.devices.push({
          deviceId,
          deviceName: `[aliyun] ${deviceName}`,
          data,
          timestamp: maxTs > 0 ? maxTs : Date.now()
        });
      }
    } catch (err) {
      result.errors.push({ deviceId: this.deviceName, error: err.message });
    }
    return result;
  }

  /**
   * 测试连接：查询设备列表成功即为连接正常
   */
  async testConnection() {
    try {
      await this.listDevices(1);
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = AliyunIoTService;
