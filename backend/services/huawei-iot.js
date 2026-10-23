/**
 * 华为云 IoTDA 设备接入服务
 * 使用官方 SDK，标准版采用 V11-HMAC-SHA256 衍生签名
 *
 * API 文档: https://support.huaweicloud.com/api-iothub/iot_06_v5_0001.html
 * 主要接口: 查询设备影子 GET /v5/iot/{project_id}/devices/{device_id}/shadow
 */

const core = require('@huaweicloud/huaweicloud-sdk-core');
const iotda = require('@huaweicloud/huaweicloud-sdk-iotda');

class HuaweiIoTService {
  constructor(config) {
    this.accessKey = (config.accessKey || '').trim();
    this.secretKey = (config.secretKey || '').trim();
    this.projectId = (config.projectId || '').trim();
    this.deviceId = (config.deviceId || '').trim();
    this.endpoint = (config.endpoint || 'iotda.cn-north-4.myhuaweicloud.com').trim();
  }

  _getClient() {
    const ep = this.endpoint.startsWith('https://') ? this.endpoint : 'https://' + this.endpoint;
    const region = new core.Region('cn-north-4', [ep]);

    const auth = new core.BasicCredentials()
      .withAk(this.accessKey)
      .withSk(this.secretKey)
      .withProjectId(this.projectId)
      .withDerivedPredicate(function (req) {
        return core.BasicCredentials.getDefaultDerivedPredicate(req);
      });

    return iotda.IoTDAClient.newBuilder()
      .withCredential(auth)
      .withDerivedAuthServiceName('iotda')
      .withRegion(region)
      .build();
  }

  async testConnection() {
    try {
      const client = this._getClient();
      const req = new iotda.ShowDeviceShadowRequest();
      req.withDeviceId(this.deviceId);
      await client.showDeviceShadow(req);
      return true;
    } catch (e) {
      const msg = (e.data && e.data.error_msg) || e.message || '';
      console.error('[HuaweiIoT] 连接测试失败:', msg);
      return false;
    }
  }

  async fetchAllDeviceData() {
    const result = { devices: [], errors: [] };
    if (!this.projectId || !this.deviceId) {
      if (!this.projectId) result.errors.push({ error: '未配置项目ID' });
      if (!this.deviceId) result.errors.push({ error: '未配置设备ID' });
      return result;
    }
    try {
      const client = this._getClient();
      const req = new iotda.ShowDeviceShadowRequest();
      req.withDeviceId(this.deviceId);

      const shadow = await client.showDeviceShadow(req);
      const data = {};
      let latestEventTime = 0;
      const shadows = shadow.shadow || [];
      for (const svc of shadows) {
        const props = (svc.reported && svc.reported.properties) || {};
        for (const [key, val] of Object.entries(props)) {
          let v = val;
          if (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '') v = Number(v);
          data[key] = v;
        }
        // 取影子的真实事件时间
        const et = (svc.reported && svc.reported.event_time);
        if (et) {
          const ts = new Date(et.replace('Z', '+00:00')).getTime();
          if (ts > latestEventTime) latestEventTime = ts;
        }
      }
      if (Object.keys(data).length > 0) {
        result.devices.push({
          deviceId: this.deviceId,
          deviceName: '[huawei] ' + this.deviceId,
          data,
          // 优先用影子事件时间，否则用当前时间
          timestamp: latestEventTime > 0 ? latestEventTime : Date.now()
        });
      }
    } catch (e) {
      const msg = (e.data && e.data.error_msg) || e.message || String(e);
      result.errors.push({ deviceId: this.deviceId, error: msg });
    }
    return result;
  }
}

module.exports = HuaweiIoTService;
