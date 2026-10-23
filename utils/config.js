// 后端服务配置
// MQTT 连接成功后会自动更新 backendIp，无需手动修改
export const BACKEND_PORT = 3000

// 智能判定上报默认地址
export const DEFAULT_DECISION_URL = 'http://127.0.0.1:5000/decision'

let _backendIp = '127.0.0.1'

// 从本地存储恢复上次成功连接的 IP
try {
  const saved = uni.getStorageSync('backend_ip')
  if (saved) _backendIp = saved
} catch (e) {}

export const getBackendHost = () => {
  const systemInfo = uni.getSystemInfoSync()
  const isMobile = systemInfo.platform === 'android' || systemInfo.platform === 'ios'
  // 手机端用存储的 IP；电脑端可用 127.0.0.1
  if (isMobile) return _backendIp
  return '127.0.0.1'
}

// MQTT 连接成功后调用，传入用户输入的 broker IP
export const setBackendIp = (ip) => {
  if (!ip || ip === _backendIp) return
  _backendIp = ip
  try { uni.setStorageSync('backend_ip', ip) } catch (e) {}
}
