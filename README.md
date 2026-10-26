# Awesome Touch Bar

把熟悉的那一小条，放到 Windows 桌面上。

一个深灰、小圆角的桌面控制条。轻点箭头，把整条 Bar 变成你的控制台；再点一下，收回那一小条。亮度、音量和常用组件，都在鼠标旁边。

A compact, Apple-inspired Touch Bar for Windows, with inline volume and brightness controls, automatic edge docking, and a quiet always-on-top presence.

![Touch Bar 默认外观示意图](docs/preview.svg)

[下载 Windows 便携版](https://github.com/Chenxxxxxx06/awesome-touchbar/releases/latest) · [参与改进](CONTRIBUTING.md)

## 用起来

下载并双击 `Touch-Bar-Windows.exe`，首次启动位于屏幕顶部中央。

- 点击箭头展开全部组件，铺满 Bar；再次点击收起。展开区包括亮度与音量加减、静音、媒体上一首／播放暂停／下一首、显示桌面、任务视图和文件管理器。
- 放不下的组件用滚轮浏览：向上滚，组件向左（横排）或向上（竖排）移动，露出后面的内容；向下滚则返回。
- 鼠标停在亮度、音量按钮或滑块上，向上滚增加、向下滚减少，每个标准滚轮刻度调整 2 个百分点；数值限制在 0–100%。调整音量不会自动取消静音。
- 想在亮度／音量按钮上浏览组件，按住 Shift 再滚动；也可以将鼠标停在展开箭头上滚动。
- 点击音量或亮度，在中间展开滑块；拖动时实时调整，显示当前数值。展开模式下关闭滑块会返回组件列表。
- 点击静音切换状态。通过键盘或 Windows 面板改音量，组件也会同步。
- 切换音频输出设备时，取消旧设备未执行的操作，重新打开滑块后再调节新设备。
- Esc 先关闭滑块，再按一次收起全部组件；箭头始终可用。
- 拖动空白区域或展开后的点状把手自由移动：顶部、底部横排，左侧、右侧竖排，图标始终正立。
- 保持在普通应用窗口前面，失去焦点时不抢回你的输入焦点。
- 右键只保留长度与退出；位置交给拖动。

![展开组件示意图](docs/expanded.svg)

![条内滑块示意图](docs/slider.svg)

默认长度占当前屏幕可用宽度的 **72%**，竖排按可用高度计算。右键可选 **60% / 72% / 84%**。尺寸随 Windows 显示缩放调整，位置与长度会保存。

启动只读取当前系统状态，**不会恢复或修改音量、静音与亮度**；这些值只在你操作对应控制时写入。媒体按钮发送 Windows 媒体快捷键，响应取决于播放器；按住 Ctrl、Alt、Shift 或 Win 时，系统快捷操作暂不执行，避免组合出意外快捷键。

## 屏幕兼容性

音量和静音控制 Windows 的默认音频输出设备。亮度通过 Windows 的 WMI 接口控制支持它的笔记本内屏；是否可用取决于屏幕和驱动。没有该接口时，组件会提示亮度不可用。

本版尚未接入 DDC/CI 外接显示器控制，因此不保证能调整外接屏亮度。72% 是桌面版的布局比例，并非 Apple 硬件的实际尺寸比例。

## 开发与测试

开发环境需要 Windows、Node.js **22.12+**、pnpm，以及 **.NET Framework 4.8** 和其 C# 编译器。原生辅助程序使用系统框架编译，无需下载额外 NuGet 包。

```powershell
pnpm install
pnpm build:native
pnpm start
pnpm test
pnpm test:desktop
pnpm package:win
```

便携程序输出到 `release/Touch-Bar-Windows.exe`。`ui/` 负责界面，`desktop/` 负责窗口与控制桥接，`native/` 负责 Windows 音量和亮度接口。

**音频测试不碰真实设备。** `pnpm test:desktop` 强制使用 `mock` 模式，滑块、滚轮、静音和组件操作测试只改变模拟状态，不发送真实媒体或窗口快捷键。`readonly` 模式可以读取实机状态，但拒绝所有控制写入；适合正在听歌时检查兼容性。

```powershell
$env:TOUCH_BAR_CONTROLS_MODE = "readonly"
pnpm start
```

清除该环境变量后恢复默认 `live` 模式。`live` 模式也只会在明确操作控制后写入。贡献代码前请阅读[测试约定](CONTRIBUTING.md)。

## 灵感与许可

参考 [Apple Touch Bar Fundamentals](https://devstreaming-cdn.apple.com/videos/wwdc/2017/211r8euwwl9x4/211/211_touch_bar_fundamentals.pdf)、[TouchBarDemoApp](https://github.com/bikkelbroeders/TouchBarDemoApp)、[Pock](https://github.com/pock/pock) 和 [BetterTouchTool presets](https://github.com/vas3k/btt-touchbar-presets)。

界面和图标独立绘制，不包含 Apple 系统资源，也不调用 macOS Touch Bar 接口。本项目与 Apple 无关联。代码采用 [MIT License](LICENSE)。
