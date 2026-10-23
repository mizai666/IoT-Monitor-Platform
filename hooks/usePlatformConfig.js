// hooks/usePlatformConfig.js
// 平台配置管理 hook — 管理平台选择、表单数据、保存/加载
import { ref, computed, watch } from 'vue'
import { saveConfig, getConfig, testConnection } from '@/utils/cloud-api.js'
import { getMqttConfigs, saveMqttConfig } from '@/utils/api.js'

// 平台类型列表
export const PLATFORM_TYPES = [
  { value: 'local', label: '本地MQTT' },
  { value: 'aliyun', label: '阿里云IoT' },
  { value: 'onenet', label: 'OneNet' },
  { value: 'gizwits', label: '机智云' },
  { value: 'huawei', label: '华为云IoT' }
]

// 阿里云表单字段定义
const ALIYUN_FIELDS = [
  { key: 'productKey', label: '产品PK', placeholder: '阿里云IoT产品 ProductKey', required: true },
  { key: 'deviceName', label: '设备名称', placeholder: '要监控的设备名', required: true },
  { key: 'accessKeyId', label: 'AccessKey ID', placeholder: '阿里云RAM用户 AccessKey ID', required: true },
  { key: 'accessKeySecret', label: 'AccessKey Secret', placeholder: '阿里云RAM用户 AccessKey Secret', required: true, password: true },
  { key: 'iotInstanceId', label: '实例ID', placeholder: '企业实例/分发产品必填，URL里 iot- 开头那段', required: true },
  { key: 'regionId', label: '地域', placeholder: '默认 cn-shanghai (可不填)', required: false }
]

// OneNet表单字段定义（REST API 主动轮询模式）
const ONENET_FIELDS = [
  { key: 'productId', label: '产品ID', placeholder: 'OneNet 产品ID', required: true },
  { key: 'deviceName', label: '设备名称', placeholder: 'OneNet 设备名', required: true },
  { key: 'accessKey', label: 'Access-Key', placeholder: '产品页 access_key (Base64格式)', required: true }
]

// 机智云表单字段定义（AppID + AppSecret 自动认证）
const GIZWITS_FIELDS = [
  { key: 'appId', label: 'AppID', placeholder: '机智云应用 AppID', required: true },
  { key: 'appSecret', label: 'AppSecret', placeholder: '机智云应用 AppSecret', required: true, password: true },
  { key: 'productKey', label: '产品Key', placeholder: '机智云产品 ProductKey', required: true },
  { key: 'did', label: '设备ID', placeholder: '机智云设备 did', required: true }
]

// 华为云IoT（V11-HMAC-SHA256 衍生签名，标准版）
const HUAWEI_FIELDS = [
  { key: 'endpoint', label: '接入地址', placeholder: '应用接入HTTPS地址', required: true },
  { key: 'projectId', label: '项目ID', placeholder: 'bc01245b86474c88ae119195f0db2274', required: true },
  { key: 'deviceId', label: '设备ID', placeholder: 'IoT设备ID', required: true },
  { key: 'accessKey', label: 'AK', placeholder: '访问密钥 AK', required: true },
  { key: 'secretKey', label: 'SK', placeholder: '秘密访问密钥 SK', required: true, password: true }
]

const PLATFORM_FIELDS_MAP = {
  aliyun: ALIYUN_FIELDS,
  onenet: ONENET_FIELDS,
  gizwits: GIZWITS_FIELDS,
  huawei: HUAWEI_FIELDS
}

export function usePlatformConfig() {
  // 当前选中的平台
  const platformType = ref('local')

  // 本地 MQTT 配置
  const mqttConfig = ref({
    clientId: '',
    brokerUrl: '',
    port: '',
    qos: '0',
    subTopic: ''
  })

  // 云平台配置 (动态表单)
  const cloudConfig = ref({})

  // 连接状态
  const isConnected = ref(false)
  const isSaving = ref(false)
  const isTesting = ref(false)

  // 当前平台的表单字段定义
  const currentCloudFields = computed(() => {
    return PLATFORM_FIELDS_MAP[platformType.value] || []
  })

  // 是否为云平台
  const isCloudPlatform = computed(() => platformType.value !== 'local')

  // 切换平台时重置云配置
  watch(platformType, (newVal) => {
    if (newVal !== 'local') {
      loadCloudConfig(newVal)
    }
  })

  // 加载云平台配置
  async function loadCloudConfig(platform) {
    try {
      const data = await getConfig(platform)
      if (data && data.config_json) {
        try {
          cloudConfig.value = JSON.parse(data.config_json)
        } catch (e) {
          cloudConfig.value = {}
        }
      } else {
        cloudConfig.value = {}
      }
    } catch (e) {
      cloudConfig.value = {}
    }
  }

  // 加载MQTT历史配置
  async function loadMqttHistory() {
    try {
      const configs = await getMqttConfigs()
      return configs
    } catch (e) {
      return []
    }
  }

  // 保存云平台配置
  async function saveCloudConfig() {
    isSaving.value = true
    try {
      await saveConfig(platformType.value, cloudConfig.value)
      uni.showToast({ title: '保存成功', icon: 'success' })
    } catch (e) {
      uni.showToast({ title: '保存失败', icon: 'error' })
    } finally {
      isSaving.value = false
    }
  }

  // 测试云平台连接
  async function testCloudConnection() {
    isTesting.value = true
    try {
      const ok = await testConnection(platformType.value)
      if (ok) {
        uni.showToast({ title: '连接成功', icon: 'success' })
      } else {
        uni.showToast({ title: '连接失败，请检查配置', icon: 'error' })
      }
    } catch (e) {
      uni.showToast({ title: '测试失败: ' + (e.message || '网络错误'), icon: 'error' })
    } finally {
      isTesting.value = false
    }
  }

  // 保存本地MQTT配置
  async function saveLocalMqttConfig() {
    const config = {
      config_type: 'subscribe',
      client_id: mqttConfig.value.clientId || ('uni-' + Math.random().toString(16).substr(2, 8)),
      broker_url: mqttConfig.value.brokerUrl,
      port: Number(mqttConfig.value.port),
      qos: Number(mqttConfig.value.qos) || 0,
      topic: mqttConfig.value.subTopic
    }
    return await saveMqttConfig(config)
  }

  return {
    platformType,
    mqttConfig,
    cloudConfig,
    isConnected,
    isSaving,
    isTesting,
    currentCloudFields,
    isCloudPlatform,
    loadCloudConfig,
    loadMqttHistory,
    saveCloudConfig,
    testCloudConnection,
    saveLocalMqttConfig
  }
}
