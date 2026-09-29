# 安卓手机提词器实现计划

## Step 1：建立移动端应用骨架

- Output：`teleprompter/` 内可直接打开的 HTML、CSS 与图标。
- Test：页面资源无缺失，360px 宽度无横向溢出。

## Step 2：实现提词功能

- Output：编辑、持久化、倒计时、滚动、暂停、镜像、全屏和参数控制。
- Test：核心计算单元测试，浏览器手动流程验证。

## Step 3：加入安卓安装能力

- Output：Web App Manifest、Service Worker、离线缓存和安装入口。
- Test：Manifest 可解析，Service Worker 静态资源列表存在。

## Step 4：完整验收

- Output：通过测试、手机尺寸截图与使用说明。
- Test：运行全部测试并检查截图中的布局和主要状态。

