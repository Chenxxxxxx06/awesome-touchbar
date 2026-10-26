# 参与 Awesome Touch Bar

欢迎修复问题、打磨交互，或提出让这条小组件更顺手的想法。请优先保持窄条、简洁、低干扰的体验。

## 提交改动

1. Fork 仓库并创建分支，一次解决一个明确的问题。
2. 用 `pnpm install` 安装依赖，`pnpm start` 启动开发版。
3. 运行 `pnpm test` 和 `pnpm test:desktop`；修改原生接口时运行 `pnpm build:native`。
4. 提交 PR，说明改了什么、如何验证。涉及外观时附上横排与竖排截图。

报告问题时，请注明 Windows 版本、显示缩放、屏幕类型以及复现步骤。亮度问题请区分笔记本内屏和外接显示器。

## 音频与亮度测试

- 自动化测试必须使用 `mock` 模式；`test:desktop` 会强制设置该模式。
- 不要让测试修改真实设备的音量、静音或亮度，也不要通过系统快捷键绕过模拟后端。
- 需要检查硬件能力时使用 `TOUCH_BAR_CONTROLS_MODE=readonly`。此模式只读取状态，原生辅助程序也拒绝写入。
- 启动、刷新、接收状态更新和退出都不得自动写回音量、静音或亮度。写入必须来自用户明确的控制操作。
- 设备不可用或写入失败时应显示真实状态，不能用界面数值变化伪装成功。

## 保持仓库干净

不要提交 `node_modules/`、`native/bin/`、`release/`、运行配置目录、个人日志、账户信息、访问令牌或其他秘密。截图请只保留组件，避开私人桌面内容。

源码采用 MIT 许可。提交代码时保留已有版权与许可说明。


## DIY 组件贡献

仅贡献一个组件时，无需修改 Electron 源码。按 [组件 Skill](skills/touchbar-component/SKILL.md) 生成定义，放到 `community/<id>/widget.json`，运行 `pnpm validate:community`。提供说明和模拟数据截图即可。禁止把真实 AI 会话、认证文件、使用记录或付费 API 凭据提交到仓库。

修改 DIY 引擎时，运行 `pnpm test:diy` 和 `pnpm test:widgets`。生成只发送新需求、组件协议与所选组件定义；监控功能仍保持本地只读。AI CLI 登录由用户自己的 CLI 管理，主程序不读取认证文件。组件能力必须由 schema、运行服务和 UI 一起实现，不能在 JSON 中放入未经支持的代码字段。
