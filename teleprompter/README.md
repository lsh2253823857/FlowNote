# 顺词 · 安卓手机提词器

一个不需要后端的移动端 PWA 提词器。支持本地保存、TXT 导入、自动滚动、倒计时、镜像、全屏、屏幕常亮和离线使用。

## 本地运行

在 `teleprompter` 目录启动静态服务器：

```powershell
npx serve .
```

也可以使用任意静态服务器。浏览器直接打开 `index.html` 可使用主要功能，但安装到桌面、离线缓存和屏幕常亮需要通过 `http://localhost` 或 HTTPS 访问。

## 安卓安装

1. 用 Chrome 打开部署后的 HTTPS 地址。
2. 点击页面右上角安装按钮，或浏览器菜单中的“添加到主屏幕”。
3. 安装后可从桌面全屏启动，首次成功打开后可离线使用。

## 测试

```powershell
node .\tests\core.test.mjs
node --check .\app.js
node --check .\sw.js
```

启动本地服务器后，可以用本机 Chrome 做安卓视口、提词播放和离线重载冒烟测试：

```powershell
node .\tests\mobile-smoke.mjs
```

## 当前边界

这是网页安装版，不具备安卓“悬浮在其他相机 App 上方”的系统权限。若需要悬浮窗，可在下一阶段用 Capacitor/原生 Android 壳接入悬浮窗服务并打包 APK。
