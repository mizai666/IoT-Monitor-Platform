// utils/api.js
import { getBackendHost, BACKEND_PORT } from './config'

let baseUrl = null;

async function detectBaseUrl() {
    const loopbackUrl = `http://127.0.0.1:${BACKEND_PORT}/api`;
    const ipUrl = `http://${getBackendHost()}:${BACKEND_PORT}/api`;

    const systemInfo = uni.getSystemInfoSync();
    const platform = systemInfo.platform;

    if (platform === 'android' || platform === 'ios') {
        console.log('[API] 手机环境，直接使用 IP:', ipUrl);
        return ipUrl;
    }

    console.log('[API] 电脑环境，尝试回环地址:', loopbackUrl);
    try {
        await new Promise((resolve, reject) => {
            uni.request({
                url: `${loopbackUrl}/mqtt-configs`,
                method: 'GET',
                timeout: 2000,
                success: (res) => {
                    if (res.statusCode === 200) resolve();
                    else reject();
                },
                fail: reject
            });
        });
        console.log('[API] 回环地址可用');
        return loopbackUrl;
    } catch (err) {
        console.log('[API] 回环地址不可用，切换到 IP:', ipUrl);
        return ipUrl;
    }
}

async function ensureBaseUrl() {
    if (!baseUrl) {
        baseUrl = await detectBaseUrl();
    }
    return baseUrl;
}

function request(options) {
    return new Promise(async (resolve, reject) => {
        const url = await ensureBaseUrl();
        uni.request({
            url: url + options.url,
            method: options.method || 'GET',
            header: options.header,
            data: options.data,
            success: (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(res);
                } else {
                    reject(res);
                }
            },
            fail: reject
        });
    });
}

export const getMqttConfigs = () => {
    return new Promise((resolve, reject) => {
        request({ url: '/mqtt-configs', method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message || '获取配置失败');
            })
            .catch(() => reject('网络请求失败，请检查后端服务'));
    });
};

export const saveMqttConfig = (config) => {
    return new Promise((resolve, reject) => {
        request({
            url: '/mqtt-configs',
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: config
        })
            .then(res => {
                if (res.data.code === 200) resolve(res.data);
                else reject(res.data.message || '保存失败');
            })
            .catch(() => reject('网络请求失败'));
    });
};

export const clearDatabase = () => {
    return new Promise((resolve, reject) => {
        request({ url: '/clear-database', method: 'DELETE' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data);
                else reject(res.data.message || '清空失败');
            })
            .catch(() => reject('网络请求失败'));
    });
};

export const saveMqttMessage = (jsonData, time, timestampMs, deviceId, deviceType) => {
    return new Promise((resolve, reject) => {
        request({
            url: '/mqtt-messages',
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: { jsonData, time, timestampMs, deviceId, deviceType }
        })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// 响应规则 CRUD
export const getResponseRules = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/response-rules?deviceId=${deviceId}`, method: 'GET' })
            .then(res => { if (res.data.code === 200) resolve(res.data.data); else reject(res.data.message); })
            .catch(reject);
    });
};
export const createResponseRule = (data) => {
    return new Promise((resolve, reject) => {
        request({ url: '/response-rules', method: 'POST', data })
            .then(res => { if (res.data.code === 200) resolve(res.data); else reject(res.data.message); })
            .catch(reject);
    });
};
export const updateResponseRule = (id, data) => {
    return new Promise((resolve, reject) => {
        request({ url: `/response-rules/${id}`, method: 'PUT', data })
            .then(res => { if (res.data.code === 200) resolve(res.data); else reject(res.data.message); })
            .catch(reject);
    });
};
export const deleteResponseRule = (id) => {
    return new Promise((resolve, reject) => {
        request({ url: `/response-rules/${id}`, method: 'DELETE' })
            .then(res => { if (res.data.code === 200) resolve(res.data); else reject(res.data.message); })
            .catch(reject);
    });
};

export const saveSensorData = (deviceId, sensorName, value, timestamp) => {
    return new Promise((resolve, reject) => {
        request({
            url: '/sensor-history',
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: { deviceId, sensorName, value, timestamp }
        })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const getDevices = () => {
    return new Promise((resolve, reject) => {
        request({ url: '/devices', method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const updateDeviceName = (deviceId, name) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/devices/${deviceId}`,
            method: 'PUT',
            header: { 'Content-Type': 'application/json' },
            data: { name }
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const deleteDevice = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/devices/${deviceId}`, method: 'DELETE' })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const getStats = () => {
    return new Promise((resolve, reject) => {
        request({ url: '/stats', method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};
// 修改特殊设备名称
export const updateSpecialDeviceName = (deviceId, name) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/special-devices/${deviceId}`,
            method: 'PUT',
            header: { 'Content-Type': 'application/json' },
            data: { name }
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

// 删除特殊设备
export const deleteSpecialDevice = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/special-devices/${deviceId}`, method: 'DELETE' })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};
// 导出 request 函数供详情页使用
export { request };

// ========== 开关配置 API ==========
export const getSwitchConfigs = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/switches?deviceId=${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const createSwitchConfig = (data) => {
    return new Promise((resolve, reject) => {
        request({
            url: '/switches',
            method: 'POST',
            data
        }).then(res => {
            if (res.data.code === 200) resolve(res.data.data);
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const updateSwitchConfig = (id, data) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/switches/${id}`,
            method: 'PUT',
            data
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const deleteSwitchConfig = (id) => {
    return new Promise((resolve, reject) => {
        request({ url: `/switches/${id}`, method: 'DELETE' })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const updateSwitchState = (id, isOn) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/switches/${id}/state`,
            method: 'PUT',
            data: { isOn }
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const getAutoSwitchConfig = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/auto-switch?deviceId=${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const saveAutoSwitchConfig = (data) => {
    return new Promise((resolve, reject) => {
        request({ url: '/auto-switch', method: 'POST', data })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const updateAutoSwitchMode = (deviceId, currentMode) => {
    return new Promise((resolve, reject) => {
        request({ url: '/auto-switch/mode', method: 'PUT', data: { deviceId, currentMode } })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// ========== 定时任务 API ==========
export const getScheduleConfigs = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/schedules?deviceId=${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const createScheduleConfig = (data) => {
    return new Promise((resolve, reject) => {
        request({
            url: '/schedules',
            method: 'POST',
            data
        }).then(res => {
            if (res.data.code === 200) resolve(res.data.data);
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const updateScheduleConfig = (id, data) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/schedules/${id}`,
            method: 'PUT',
            data
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const deleteScheduleConfig = (id) => {
    return new Promise((resolve, reject) => {
        request({ url: `/schedules/${id}`, method: 'DELETE' })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const executeSchedule = (id) => {
    return new Promise((resolve, reject) => {
        request({ url: `/schedules/${id}/execute`, method: 'PUT' })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// ========== 主题配置 API ==========
export const getThemeConfigs = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/themes?deviceId=${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const createThemeConfig = (data) => {
    return new Promise((resolve, reject) => {
        request({ url: '/themes', method: 'POST', data })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const updateThemeConfig = (id, data) => {
    return new Promise((resolve, reject) => {
        request({ url: `/themes/${id}`, method: 'PUT', data })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const deleteThemeConfig = (id) => {
    return new Promise((resolve, reject) => {
        request({ url: `/themes/${id}`, method: 'DELETE' })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const activateTheme = (id) => {
    return new Promise((resolve, reject) => {
        request({ url: `/themes/${id}/activate`, method: 'PUT' })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// ========== 阈值配置 API ==========
export const getThresholdConfigs = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/thresholds?deviceId=${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const createThresholdConfig = (data) => {
    return new Promise((resolve, reject) => {
        request({
            url: '/thresholds',
            method: 'POST',
            data
        }).then(res => {
            if (res.data.code === 200) resolve(res.data.data);
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const updateThresholdConfig = (id, data) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/thresholds/${id}`,
            method: 'PUT',
            data
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const deleteThresholdConfig = (id) => {
    return new Promise((resolve, reject) => {
        request({ url: `/thresholds/${id}`, method: 'DELETE' })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const recordAlarm = (data) => {
    return new Promise((resolve, reject) => {
        request({
            url: '/threshold-alarms',
            method: 'POST',
            data
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

// 详情页专用 API
export const getSensorHistory = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/sensor-history?deviceId=${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const getSpecialData = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/special-data?deviceId=${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const getSensorDisplayNames = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/sensor-names/${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// ========== 标志位配置 API ==========
export const getFlagConfig = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/flag-config/${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const saveFlagConfig = (deviceId, show, hide, online, offlineTimeout) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/flag-config/${deviceId}`,
            method: 'PUT',
            header: { 'Content-Type': 'application/json' },
            data: { show, hide, online, offlineTimeout }
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const updateSensorDisplayName = (deviceId, sensorKey, displayName) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/sensor-names/${deviceId}`,
            method: 'PUT',
            data: { sensorKey, displayName }
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

// ========== 网页浏览（WebView）API ==========
export const getWebviewConfig = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/webview-config/${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

export const saveWebviewConfig = (deviceId, pageUrl) => {
    return new Promise((resolve, reject) => {
        request({
            url: `/webview-config/${deviceId}`,
            method: 'PUT',
            data: { pageUrl }
        }).then(res => {
            if (res.data.code === 200) resolve();
            else reject(res.data.message);
        }).catch(reject);
    });
};

export const getWebviewScreenshots = (deviceId) => {
    return new Promise((resolve, reject) => {
        request({ url: `/webview-screenshots/${deviceId}`, method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// 数据查询
export const queryData = (params) => {
    return new Promise((resolve, reject) => {
        const queryParts = []
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null && v !== '') {
                queryParts.push(k + '=' + encodeURIComponent(v))
            }
        }
        request({ url: '/query?' + queryParts.join('&'), method: 'GET' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// 编辑查询记录
export const updateQueryRecord = (data) => {
    return new Promise((resolve, reject) => {
        request({ url: '/query-record', method: 'PUT', data })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// 删除查询记录
export const deleteQueryRecord = (table, id, source) => {
    return new Promise((resolve, reject) => {
        request({ url: '/query-record', method: 'DELETE', data: { table, id, source } })
            .then(res => {
                if (res.data.code === 200) resolve();
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

// 批量删除当前查询条件下的全部记录
export const deleteQueryRecords = (params) => {
    return new Promise((resolve, reject) => {
        const queryParts = []
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null && v !== '') {
                queryParts.push(k + '=' + encodeURIComponent(v))
            }
        }
        request({ url: '/query-records?' + queryParts.join('&'), method: 'DELETE' })
            .then(res => {
                if (res.data.code === 200) resolve(res.data.data);
                else reject(res.data.message);
            })
            .catch(reject);
    });
};

