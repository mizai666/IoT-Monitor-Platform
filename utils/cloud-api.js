// utils/cloud-api.js
// 云平台配置 API 调用层
import { request } from './api.js'

// 获取某平台的配置
export const getConfig = (platform) => {
  return new Promise((resolve, reject) => {
    request({ url: `/cloud-configs/${platform}`, method: 'GET' })
      .then(res => {
        if (res.data.code === 200) resolve(res.data.data)
        else resolve(null)
      })
      .catch(() => resolve(null))
  })
}

// 保存云平台配置
export const saveConfig = (platform, configJson) => {
  return new Promise((resolve, reject) => {
    request({
      url: '/cloud-configs',
      method: 'POST',
      data: { platform, configJson }
    }).then(res => {
      if (res.data.code === 200) resolve()
      else reject(res.data.message || '保存失败')
    }).catch(reject)
  })
}

// 测试云平台连接
export const testConnection = (platform) => {
  return new Promise((resolve, reject) => {
    request({
      url: `/cloud-configs/${platform}/test`,
      method: 'POST'
    }).then(res => {
      if (res.data.code === 200) resolve(true)
      else resolve(false)
    }).catch(() => resolve(false))
  })
}

// OneNet 手动连接
export const connectOnenet = () => {
  return request({ url: '/onenet/connect', method: 'POST' })
}
export const disconnectOnenet = () => {
  return request({ url: '/onenet/disconnect', method: 'POST' })
}
export const getOnenetStatus = () => {
  return new Promise((resolve) => {
    request({ url: '/onenet/status', method: 'GET' })
      .then(res => {
        if (res.data.code === 200) resolve(res.data.data.connected)
        else resolve(false)
      })
      .catch(() => resolve(false))
  })
}

// 机智云 手动连接
export const connectGizwits = () => {
  return request({ url: '/gizwits/connect', method: 'POST' })
}
export const disconnectGizwits = () => {
  return request({ url: '/gizwits/disconnect', method: 'POST' })
}
export const getGizwitsStatus = () => {
  return new Promise((resolve) => {
    request({ url: '/gizwits/status', method: 'GET' })
      .then(res => {
        if (res.data.code === 200) resolve(res.data.data.connected)
        else resolve(false)
      })
      .catch(() => resolve(false))
  })
}

// 阿里云 手动连接
export const connectAliyun = () => {
  return request({ url: '/aliyun/connect', method: 'POST' })
}
export const disconnectAliyun = () => {
  return request({ url: '/aliyun/disconnect', method: 'POST' })
}
export const getAliyunStatus = () => {
  return new Promise((resolve) => {
    request({ url: '/aliyun/status', method: 'GET' })
      .then(res => {
        if (res.data.code === 200) resolve(res.data.data.connected)
        else resolve(false)
      })
      .catch(() => resolve(false))
  })
}

// 华为云 手动连接
export const connectHuawei = () => {
  return request({ url: '/huawei/connect', method: 'POST' })
}
export const disconnectHuawei = () => {
  return request({ url: '/huawei/disconnect', method: 'POST' })
}
export const getHuaweiStatus = () => {
  return new Promise((resolve) => {
    request({ url: '/huawei/status', method: 'GET' })
      .then(res => {
        if (res.data.code === 200) resolve(res.data.data.connected)
        else resolve(false)
      })
      .catch(() => resolve(false))
  })
}
