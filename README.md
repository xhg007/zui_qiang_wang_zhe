# AI 智怼助手

> 一款**辩论辅助**浏览器扩展，而不是网络暴力加速器。

在 X / 微博上，每条评论旁边都有一个小小的「AI 回复」按钮。点它 → 自动读这条评论（连同上面几轮对话）→ 生成一段有理有据的草稿 → 你改完、一键填进回复框，**最后仍由你亲手点发送**。

技术栈：**WXT + Vue 3 + TypeScript**，AI 接入走 OpenAI 兼容协议（官方 `openai` SDK，含流式），内置 5 家国内供应商预设 + 自定义供应商。

## 功能

| 需求 | 实现 |
| :--- | :--- |
| F1 页面文本捕获 | ① 每条评论操作栏自动注入「AI 回复」按钮；② 选中文本浮出按钮；③ popup 粘贴文本 |
| F2 AI 回复生成 | background 单一网络出口，30s 超时，**流式输出（打字机）**，错误码中文翻译 + 重试 |
| F3 回复风格 | 🧊 理性反驳 / 🎭 幽默反讽 / 🔥 灵魂拷问 |
| F4 审核发送 | 页面内可编辑草稿气泡：重新生成、换风格重生成、复制、**一键填入平台回复框**；没有任何自动发送 |
| F5 供应商管理 | 5 家预设 + 自定义（OpenAI 兼容）；切换时模型 / Key / hint 三联动；Key 独立存本机；测试连接；申请直达链接 |
| F6 上下文多轮 | 自动带上同一讨论串前 4 轮，Prompt 里按时间正序呈现 |
| F7 自定义 Prompt | 设置页可查看 / 编辑 / 恢复默认三风格的系统提示与风格指令，支持 `{{author}}` `{{text}}` `{{styleName}}` `{{context}}` |
| F9 情绪预分析 | 生成前判断对方语气（愤怒 / 讽刺 / 挑衅 …），在面板显示并据此调整策略，可在设置页关闭 |

生成结果开头固定带 `🤖` 标识（默认开启、不可关闭）；Prompt 内置禁止脏话 / 歧视 / 人身攻击的硬约束，并要求 100-200 字——**这些硬约束始终由程序追加，即使用户自定义了 Prompt 也删不掉**。

## 合规边界（重要）

- **没有任何自动发送能力**：不调用平台发布接口，不模拟点击「发送」按钮，不做批量回复。
- 「填入回复框」只做一件事：把文本写进平台已经打开的回复编辑器（必要时替你点一下「回复」把编辑器打开），然后提示你检查、自己点发送。
- 首次生成前会明确告知：评论文本会发送到你选择的 AI 供应商；插件不设中转服务器、不采集浏览记录。

## 快速开始

```bash
pnpm install
pnpm dev        # 开发模式
pnpm build      # 构建到 .output/chrome-mv3
pnpm typecheck  # vue-tsc 类型检查
pnpm test       # vitest 单测（29 个用例）
pnpm zip        # 打包上架用的 zip
```

加载：Chrome / Edge → `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `.output/chrome-mv3`。

## 配置供应商（三步）

设置页里：**选供应商**（首次不预选）→ **粘贴 API Key**（页面有直达申请链接）→ **测试连接**（401 / 404 / 429 等都会翻译成可读原因）。

切换供应商时模型自动回到默认值、Key 输入框自动加载该家已存的 Key、提示文案同步更新；各家 Key 互相独立。

自定义供应商填任意 OpenAI 兼容地址（如 `https://your-host/v1`）与模型名，保存时按需申请该域名权限，不预先占用宽泛权限。

## 架构

```
entrypoints/
├── background.ts        # 唯一网络出口：普通消息 + 流式 port（生成 / 测试连接 / 状态）
├── content.ts           # 评论按钮注入 + 选区捕获 + Shadow DOM 草稿面板
├── popup/               # 粘贴文本快速生成
└── options/             # 设置：供应商 / Key / 测试连接 / 生成选项 / Prompt 模板
lib/
├── providers.ts         # 预设供应商数据表（纯数据）
├── storage.ts           # 存储封装 + resolveActiveProvider()
├── prompts/             # 三风格模板、变量替换、硬约束、🤖 标识
├── adapters/            # 站点适配：评论 / 操作栏 / 回复框 / 讨论串选择器
├── injector.ts          # 评论内「AI 回复」按钮注入（MutationObserver + 去重）
├── ai.ts                # openai SDK 封装（普通 + 流式）
├── stream.ts            # 流式 port 客户端
├── emotion.ts           # 语气分类与应对策略（F9）
├── errors.ts            # HTTP / 网络错误 → 中文文案
├── client.ts            # UI → background 消息、域名权限申请
└── messaging.ts         # 消息、流式协议与结果类型
components/              # DraftPanel / StylePicker / ContentOverlay
assets/theme.css         # 社交 App 卡片风设计令牌（三处 UI 共用）
```

关键约束：

- **供应商差异只在 `lib/providers.ts`**，新增供应商 = 加一条数据；`wxt.config.ts` 的 host 权限也由它派生。
- **站点差异只在 `lib/adapters/sites.ts`**，平台改版只改选择器；解析有启发式回退。
- **网络请求只在 background**；content / popup 只收发消息。
- **UI 与逻辑解耦**：评论按钮通过 `window` 事件通知面板，不依赖模块单例（打包拆 chunk 后仍成立）。

## 质量与自查

- `pnpm test`：29 个单测覆盖 Prompt 构建（🤖 标识、硬约束不可删、上下文/情绪/自定义覆盖）、错误码翻译、情绪策略表、站点解析与「填入不发送」路径。
- 设置页「使用统计（仅本机）」：成功生成次数、成功率、平均耗时、复制率、填入次数。用来对照 PRD 指标（生成 ≤15 秒、编辑后复制率 ≥60%），数据只存本机、可重置。
- 已知的行为边界：讨论串上下文只在推文详情页 / 微博正文页生效，时间线首页不带（避免把无关推文当上下文）；流式长时间无新内容会在 45 秒后被判定为卡住并提示重试。

## 存储与隐私

| 数据 | 位置 |
| :--- | :--- |
| 当前激活配置（供应商 id + 模型） | `chrome.storage.sync` |
| 各供应商 API Key | `chrome.storage.local`（不参与云同步） |
| 自定义供应商、风格偏好、Prompt 模板、语气分析开关、隐私告知标记 | `chrome.storage.local` |

源码零硬编码密钥；不采集浏览记录；不设中转服务器。

## 权限说明

- `storage`：保存配置与 Key。
- `host_permissions`：仅 5 家预设供应商域名。
- `optional_host_permissions`：仅在你保存 / 测试自定义供应商时，按需申请该域名。
- content script：仅 `x.com` 与 `weibo.com`。

## 已知限制

- 站点 DOM 选择器按公开结构编写；平台改版后需要更新 `lib/adapters/sites.ts`。
- 填入回复框依赖平台编辑器的实现（textarea 或 contenteditable），失败时会自动回退为复制。
- Firefox 尚未验证；`pnpm build:firefox` 保留。
