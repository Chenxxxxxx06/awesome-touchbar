# 社区：分享一个你每天会点的按钮

这里存放可以直接导入 Awesome Touch Bar 的组件定义。无需执行陌生脚本；每个定义都经过同一套协议校验。

| 示例 | 功能 | 文件 |
| --- | --- | --- |
| 喝水提醒 | 每 60 分钟提醒一次，可暂停 | [water-break](water-break/widget.json) |
| 今日阅读 | 记录今天完成了几段阅读 | [reading-count](reading-count/widget.json) |
| 下班清单 | 离开前确认保存、备份和明日重点 | [closing-checklist](closing-checklist/widget.json) |

在 GitHub 打开文件，选择 Raw 并保存为 `.json`，然后从 Bar 的 **DIY → 导入** 选择它。计时组件需要你点击开始才运行。已有相同 ID 时不会直接覆盖，可先导出留存再移除，或从现有组件的“修改”入口更新。

## 分享你的组件

1. 在组件 **⋯ → 导出**，得到只含定义的 JSON。
2. Fork 本仓库，新增 `community/<id>/widget.json`，文件夹名与定义中的 `id` 保持一致。
3. 执行 `node scripts/validate-community.cjs community/<id>/widget.json`。
4. 开一个 PR，描述用途、如何使用、横竖排体验和测试结果；可以附上只包含 Bar 的截图。
5. 维护者审核后合并。喜欢一个组件，可以给对应 PR 点 👍；当前没有独立的应用内点赞后台。

可选：在组件目录添加简短说明。不要提交账号信息、提示词历史、运行记录、私人桌面截图、可执行文件或第三方脚本。

开发前读 [组件 Skill](../skills/touchbar-component/SKILL.md) 和 [协议](../skills/touchbar-component/references/widget-contract.md)。定义采用本仓库 MIT 许可；确保你有权分享文字与链接。需要新的底层能力时，先提 Issue 讨论主程序接口，不能在 JSON 中塞入未实现的代码字段。
