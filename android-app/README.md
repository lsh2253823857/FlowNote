# 顺词 Android APK

这是“顺词 · 手机提词器”的原生 Android WebView 包装工程。网页资源在构建时从 `../teleprompter` 自动复制进 APK，不依赖线上网址。

## 环境

- JDK 17
- Android SDK Platform 34
- Android SDK Build Tools 34.0.0
- Gradle 8.7（Wrapper 会自动使用）

## 构建可直接安装的调试 APK

```powershell
.\gradlew.bat assembleDebug
```

输出文件位于 `app/build/outputs/apk/debug/app-debug.apk`。调试 APK 已使用 Android 调试证书签名，适合直接安装测试，不适合提交应用商店。

## 原生能力

- 应用资源完全内置，离线启动。
- “横屏提词”通过原生桥接锁定横屏并进入沉浸式全屏。
- 播放期间通过原生窗口标志保持屏幕常亮。
- TXT 导入使用安卓系统文件选择器。
- 返回键在提词页优先返回编辑页，再次返回才退出应用。

