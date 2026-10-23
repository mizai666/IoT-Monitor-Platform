# Hchapter01 — 物联网智能检测平台

> 物联网创新设计竞赛（IoT Innovation Design Competition）参赛作品 · Web 端

基于 **UniApp (Vue 3) + Node.js + MySQL** 的物联网智能检测平台。前端运行于 H5 浏览器，后端为 Express 服务（端口 `3000`），数据库 MySQL `hbuilderchapter01`（24 张表，启动时自动建）。核心能力：本地 MQTT 消息管理、五大云平台对接、设备监控、传感器历史、阈值告警、YOLOv8 摄像头检测、开关控制、定时任务、主题控制、响应规则引擎、组合数据查询。

> 本项目也是 `chapter05`（纯 Java MQTT 控制台）的功能原型与参考来源。

---

## 目录

- [技术栈](#技术栈)
- [核心功能](#核心功能)
- [功能演示](#功能演示)
- [可用云平台](#可用云平台)
- [目录结构](#目录结构)
- [数据库设计](#数据库设计)
- [设备识别机制](#设备识别机制)
- [响应规则引擎](#响应规则引擎)
- [启动方式](#启动方式)
- [部署到新机器](#部署到新机器)
- [注意事项](#注意事项)

---

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 前端 | UniApp (Vue 3)，HBuilderX 开发，H5 浏览器运行 |
| 后端 | Node.js + Express，端口 `3000` |
| 数据库 | MySQL `hbuilderchapter01`（24 张表） |
| 图表 | @qiun/ucharts `^2.5.0`、echarts `^6.1.0` |
| MQTT | paho-mqtt `^1.1.0` |
| 云平台 | 阿里云 IoT / OneNet / 机智云 / 华为云 IoTDA / 本地 MQTT |

---

## 核心功能

- **MQTT 消息管理**：订阅 / 发布，原始消息按设备隔离存储（`mqtt_messages` 含 `device_id` + `device_type`）。
- **云平台对接**：五平台统一配置与轮询调度（`cloud-poller.js`，3 秒间隔），连接状态持久化。
- **设备监控**：设备列表、实时数据、传感器历史曲线、设备离线判定（5 秒无数据置离线）。
- **特殊 / 普通设备识别**：按 JSON 键名结构自动区分并拆分设备（见下方机制）。
- **阈值告警**：上下限 + 阈值下发 + 报警 JSON 指令（`alarm_send_json`）+ 全局报警通知卡片。
- **YOLOv8 摄像头检测**：摄像头配置 / 数据记录 / 截图管理。
- **网页截图**：webview 配置与截图记录。
- **开关控制**：开关 CRUD + 状态持久化（`is_on`）+ 自动 / 手动模式（`auto_switch_configs`）。
- **定时任务**：倒计时 N 秒把 `key_name` 置为目标状态发到 `publish_topic`，1 秒粒度检查。
- **主题控制**：normal / warning / danger / info / offline 五色主题，HTTP / MQTT 键值触发切换，激活主题改变页面配色。
- **响应规则引擎**：`getByPath` 通用路径取值 + 开关 / 主题 / 定时 / 阈值四类规则，HTTP 响应与 MQTT 上行均可触发。
- **组合数据查询**：表类型 + 关键词模糊/精确 + 排序 + 时间区段 + 数值范围 + 类型/状态，若依式分页（`page` / `pageSize`）。
- **发布上报**：MQTT / HTTP 双通道，HTTP 响应持久化到 `publish_history.response_data`。

---

## 功能演示

18 张实际运行截图，按模块展开。

### 一、主界面与平台接入

三栏布局：左侧平台配置，中间设备列表，右侧系统状态与实时数据。

<p align="center"><img src="./docs/screenshots/01-main-dashboard.png" width="860" alt="主界面"></p>

选择平台后表单随平台切换（本地 MQTT 只需地址与端口；阿里云需要 ProductKey、AccessKey ID/Secret；华为云用 AK/SK；OneNET 用 Base64 格式 access_key；机智云用 AppID + AppSecret）。「填充」可快速载入上次配置，「清空数据库」一键重置全部历史数据。

### 二、数据可视化

三种图表共用同一数据源，右上角下拉可切换视图、筛选传感器与 X 轴模式。

| 曲线图 | 柱状图 |
| --- | --- |
| <img src="./docs/screenshots/02-chart-line.png" width="405" alt="曲线图"> | <img src="./docs/screenshots/03-chart-bar.png" width="405" alt="柱状图"> |
| 多传感器叠加，tooltip 显示时间戳与各曲线读数 | 同一时刻横向对比，柱顶标注具体数值 |

| 饼图 | 传感器筛选 |
| --- | --- |
| <img src="./docs/screenshots/04-chart-pie.png" width="405" alt="饼图"> | <img src="./docs/screenshots/05-chart-sensor-filter.png" width="405" alt="传感器筛选"> |
| 环形图中心显示采样时刻与传感器数量 | 下拉逐项选择单路传感器，可滚动检索 |

图表下方带数据缩放滑块，可拖拽选择区间；左下角常驻报警卡片，阈值越限时弹出。

### 三、数据一览与传感器命名

左栏为各传感器的实时值与更新时间，右栏为原始 JSON 按时间倒序分页，便于对照排查上报格式。

<p align="center"><img src="./docs/screenshots/06-data-overview.png" width="860" alt="数据一览"></p>

传感器名支持自定义显示名称，保存在后端，刷新后依然生效：

<p align="center"><img src="./docs/screenshots/07-sensor-rename.png" width="620" alt="修改传感器显示名称"></p>

### 四、消息发布

支持 MQTT 与 HTTP 双通道，消息体可手写 JSON，也可从历史记录或日志文件中提取。

| 发布页 | 从历史记录填充 |
| --- | --- |
| <img src="./docs/screenshots/08-publish.png" width="405" alt="发布消息"> | <img src="./docs/screenshots/09-publish-record-picker.png" width="405" alt="选择数据记录"> |
| 主题、QoS、格式、时间戳主题均可配置，底部保留发送记录 | 列出历史 JSON，选中后一键填入消息体 |

<p align="center"><img src="./docs/screenshots/10-publish-from-file.png" width="500" alt="从文件发布"></p>

选择本地日志文件后可批量解析并逐条发送，用于回放真实测试数据。

### 五、设备控制

四类控制集中在同一页，卡片式开关支持增删改，并可为每个开关配置响应规则。

<p align="center"><img src="./docs/screenshots/11-device-control-switch.png" width="860" alt="开关控制"></p>

| 添加开关 | 添加定时任务 |
| --- | --- |
| <img src="./docs/screenshots/12-switch-add.png" width="405" alt="添加开关"> | <img src="./docs/screenshots/13-schedule-add.png" width="405" alt="添加定时任务"> |
| 键名、显示名、发布主题、高电平点亮，以及响应规则的数组路径 / 目标字段 / 命令字段 / 映射表 | 目标状态、间隔秒数、启用开关，命中响应规则后重置倒计时 |

| 添加阈值设定 | 添加主题 |
| --- | --- |
| <img src="./docs/screenshots/14-threshold-add.png" width="405" alt="添加阈值设定"> | <img src="./docs/screenshots/15-theme-add.png" width="405" alt="添加主题"> |
| 监测键名、上下限、报警消息与下发的 JSON 指令，可把阈值同步写回设备 | 主题类型（正常 / 告警等）、HTTP 响应匹配规则、MQTT 键名键值下发 |

### 六、监控与数据查询

监控页通过内嵌浏览器加载任意网页，可填摄像头出流地址或第三方监控面板：

| 未连接 | 已连接 |
| --- | --- |
| <img src="./docs/screenshots/16-monitor-empty.png" width="405" alt="监控未连接"> | <img src="./docs/screenshots/17-monitor-connected.png" width="405" alt="监控已连接"> |
| 输入网址后点击连接 | 加载完成，右上角显示连接状态 |

数据查询支持两个关键词组合与数值、时间区间过滤，结果按列排序，可直接修改或删除：

<p align="center"><img src="./docs/screenshots/18-data-query.png" width="860" alt="数据查询"></p>

---

## 可用云平台

| 平台 | 实现文件 | 认证 / 接口 |
| --- | --- | --- |
| 本地 MQTT | `backend/services/` | 标准 MQTT broker（默认 1883） |
| 阿里云 IoT | `aliyun-iot.js` | POP API HMAC-SHA1 签名，30 天查询窗口 |
| OneNet | `onenet-iot.js` / `onenet-api.js` | MQTT 直连 + REST API |
| 机智云 | `gizwits-iot.js` | 机智云 IoT SDK |
| 华为云 IoTDA | `huawei-iot.js` | V11-HMAC-SHA256 + 官方 SDK |

- 统一轮询调度：`cloud-poller.js`（3 秒间隔）。
- 连接控制：后端启动时自动重置所有 `connected = 0`，用户在 H5 界面手动点「连接」后才开始拉取。

---

## 目录结构

```
Hchapter01/
├── App.uvue                        # 应用入口
├── main.uts                        # uni-app x 入口
├── index.html                      # H5 入口
├── manifest.json                   # 应用配置（vueVersion 3）
├── pages.json                      # 页面路由配置
├── uni.scss / vite.config.ts
├── pages/
│   ├── index/
│   │   ├── index.uvue              # 主页面
│   │   └── components/
│   │       └── ConfigPanel.uvue    # 平台配置面板组件
│   └── device-detail/
│       └── device-detail.uvue      # 设备详情页（实时/发布/主题/查询）
├── hooks/
│   ├── usePlatformConfig.js        # 平台配置 hook（含华为云 5 字段定义）
│   └── useAlarmCenter.js           # 全局报警共享
├── utils/
│   ├── api.js                      # 后端 API 调用（含 detectBaseUrl 自动探测）
│   ├── cloud-api.js                # 云平台配置 API
│   └── config.js                   # 后端地址配置（桌面环境用 127.0.0.1）
├── backend/
│   ├── app.js                      # Express 后端（端口 3000，24 张表自动建）
│   └── services/
│       ├── aliyun-iot.js           # 阿里云 IoT SDK
│       ├── onenet-iot.js           # OneNet MQTT 直连
│       ├── onenet-api.js           # OneNet REST API
│       ├── gizwits-iot.js          # 机智云 IoT SDK
│       ├── huawei-iot.js           # 华为云 IoTDA
│       └── cloud-poller.js         # 云平台统一轮询调度器
├── db/
│   └── hbuilderchapter01.sql       # 建表脚本（24 张表完整版）
├── docs/screenshots/               # 18 张功能截图
└── static/
```

---

## 数据库设计

数据库 `hbuilderchapter01`，共 **24 张表**，`app.js` 启动时 `CREATE TABLE IF NOT EXISTS` 自动建。

### 核心表
| 表名 | 用途 |
| --- | --- |
| `devices` | 设备列表（`device_id` 为 INT 哈希，`name` 含平台前缀如 `[aliyun]`） |
| `sensor_history` | 传感器历史（device_id、sensor_name、value、timestamp） |
| `special_devices` | 特殊设备列表 |
| `special_data` | 特殊 JSON 数据 |
| `mqtt_messages` | MQTT 原始消息（含 device_id、device_type，按设备隔离） |
| `cloud_configs` | 云平台配置（含 connected 列持久化连接状态） |

### 配置表
| 表名 | 用途 |
| --- | --- |
| `mqtt_config` | MQTT 订阅 / 发布配置 |
| `switch_configs` | 开关控制配置（含 is_on 状态持久化） |
| `response_rules` | 响应规则（HTTP 响应解析自动触发开关） |
| `theme_configs` | 主题配置（normal/warning/danger/info/offline） |
| `schedule_configs` | 定时任务配置 |
| `threshold_configs` | 传感器阈值配置 |
| `threshold_alarms` | 阈值报警记录 |
| `sensor_display_names` | 传感器显示名称 |
| `auto_switch_configs` | 自动 / 手动模式配置 |

### 其他表
| 表名 | 用途 |
| --- | --- |
| `projects` | 项目管理 |
| `alarm_history` | 报警历史 |
| `publish_history` | 发布/上报历史（type/ok/status/url/response_data） |
| `camera_configs` | 摄像头 YOLOv8 配置 |
| `camera_records` | 摄像头数据记录 |
| `camera_screenshots` | 摄像头截图 |
| `webview_configs` | 网页浏览配置 |
| `webview_screenshots` | 网页截图 |
| `special_json_records` | 特殊 JSON 记录 |

---

## 设备识别机制

与 `chapter05` 一致，按 JSON 键名结构自动区分两类设备：

### 普通设备（多设备 JSON）
所有键名以数字结尾（如 `Temp1`、`Humi1`、`Temp2`），按末尾数字拆分成多个设备，传感器名去掉尾数。

### 特殊设备（非多设备 JSON）
存在非数字结尾的键（如 `Soil_Water`、`CO2`、`Mode`），作为独立特殊设备存储于 `special_devices` / `special_data`，查询传感器历史时后端自动路由到 `special_data` 表，前端把 `json_data` 拆成 `sensor_name + value` 行。

---

## 响应规则引擎

- **通用路径取值 `getByPath`**：支持点分隔深层路径（如 `device_control.exec_info.dongzuo`），不限顶层。
- **四类规则统一响应 MQTT / HTTP**：
  - **开关**：响应规则 `array_path / target_key / command_key` 匹配开关键名 → `on`→1、`off`→0 → 用开关自己的 `publish_topic` 发 MQTT，并本地同步开关状态。
  - **主题**：HTTP 匹配 `http_key_name/value`，MQTT 匹配 `mqtt_key_name/value`。
  - **定时**：`resp_array_path / resp_target_key / resp_command_key` 匹配到 `key_name` → 重置倒计时。
  - **阈值**：`resp_max_path / resp_min_path` 取新上下限 → 改阈值 + 用 `upper_key/lower_key` 发下位机 + 检查报警。
- **规则独立表** `response_rules`：`id, device_id, rule_name, array_path, target_key, command_key`，独立 CRUD。

---

## 启动方式

### 1. 启动后端
```bash
cd backend
node app.js
```

### 2. 启动前端
HBuilderX 打开项目 → 运行 → 运行到浏览器 → Chrome

> 顺序：**先启动后端，再开前端**，否则浏览器 `ERR_CONNECTION_REFUSED`。

---

## 部署到新机器

1. 数据库账号需与 `backend/app.js` 中 `mysql.createPool` 的配置一致（仓库内为本地开发默认值 `root/root`，部署时请自行修改或改用环境变量）。
2. 24 张表在 `app.js` 启动时自动建，无需手动导入 SQL；`db/hbuilderchapter01.sql` 已同步为 24 张表完整版，手动导入也可用。
3. 后端必须先启动（`node app.js`），再开前端。

---

## 注意事项

- **云平台配置自动 trim**：`/api/cloud-configs` 保存时自动去除字符串两端空格，粘贴 AK/AS 带空格不会出错。
- **URL 路径**：`api.js` 的 `request()` 中 `baseUrl` 已包含 `/api`，调用时写 `/proxy-decision` 而非 `/api/proxy-decision`，否则路径重复 404。
- **开关状态以 `is_on` 为准**：状态变化时才更新，避免历史轮询覆盖用户刚操作的新值。
- **增量轮询**：`updateRealtimeAndRaw` 只处理新增记录，防止旧值回写。
- **原始 JSON 上限**：`pushRawJson` 限制原始 JSON 记录 200 条，防 DOM 膨胀。
- **报警卡片**：全局报警上限 3 条，带时间戳，5 秒自动消失。
- **查询分页**：`page` 默认 50、上限 200，返回 `{list, total, page, pageSize}`。
