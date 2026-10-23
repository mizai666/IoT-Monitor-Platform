import { ref } from 'vue'

// 全局共享报警列表（H5 下模块单例，首页与设备详情页共享同一份）
export const alarmNotifications = ref([])

const MAX_ALARMS = 3      // 最多同时显示条数
const ALARM_TTL = 5000    // 5 秒自动消失

const pad = (n) => String(n).padStart(2, '0')
const formatTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

export function addAlarmNotification({ deviceName, displayName, message }) {
  const id = `${Date.now()}_${Math.floor(Math.random() * 100000)}`
  alarmNotifications.value.push({
    id,
    deviceName,
    displayName,
    message,
    time: formatTime(new Date())
  })
  // 超出上限挤掉最旧
  while (alarmNotifications.value.length > MAX_ALARMS) {
    alarmNotifications.value.shift()
  }
  // 到时自动移除
  setTimeout(() => removeAlarmNotification(id), ALARM_TTL)
}

export function removeAlarmNotification(id) {
  const idx = alarmNotifications.value.findIndex(a => a.id === id)
  if (idx >= 0) alarmNotifications.value.splice(idx, 1)
}
