# PT Keeper Chrome 扩展

一键读取 10 个 PT 站点的 Cookie / Token，过期时提示重新登录，导出后供 PT-Keeper Docker 服务使用。

## 安装

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `pt-keeper-extension` 文件夹

## 使用方法

### 1. 登录所有 PT 站

在浏览器中正常登录这 10 个 PT 站点。

### 2. 读取 Cookie

点击扩展图标 → **「读取所有站点 Cookie」**

- 普通站点：直接从浏览器 Cookie 读取
- **M-Team**：需要先访问 M-Team 任意页面，触发 `/api/member/profile` 请求，扩展自动拦截 Authorization 头

### 3. 导出到 Docker 服务

点击 **「导出 Cookie 文件」**，下载 `pt-cookies.txt`，包含所有站点的认证信息。

复制内容到 `pt-keeper/config/cookies/` 目录下的各个 JSON 文件。

### 4. 一键保活访问

点击 **「访问所有站点（保活）」**，自动打开并关闭所有站点标签页。

## M-Team 特别说明

M-Team 使用 API 认证，Cookie 方式不可用。请确保：

1. 登录 M-Team（kp.m-team.cc）
2. 访问任意页面，触发 `api.m-team.io/api/member/profile` 请求
3. 扩展会在后台拦截 Authorization Bearer Token
4. 再点击「读取所有站点 Cookie」即可获取

如果 Token 过期（HTTP 401），扩展会提示，重新登录 M-Team 后再次读取即可。

## 文件对应关系

| PT 站 | 文件名 |
|-------|--------|
| PTHome | pthome.json |
| HDArea | hdarea.json |
| PTer | pter.json |
| HDHome | hdhome.json |
| BTSCHOOL | btschool.json |
| HDTime | hdtime.json |
| HDDolby | hddolby.json |
| Skyey2 | skyey2.json |
| U2 | u2.json |
| M-Team | mteam.json |