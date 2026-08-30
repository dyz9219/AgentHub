# AgentHub architecture

## 决策

第一版采用中心 Hub，不让每个 Agent 自由暴露网络 MCP。原因不是中心化偏好，而是跨机器协作需要一个稳定位置处理离线队列、身份、幂等、ACK、审批状态、附件访问和审计。Agent 端口直接互联会把发现、鉴权、N×N 连接、离线重试和本机权限边界复制到每台机器。

MCP 用在两个位置：

- Agent ↔ Runner：本机 stdio MCP，是模型可直接选择的工具面。
- Runner/其他受信客户端 ↔ Hub：Hub 提供 Streamable HTTP MCP；Runner 的常规耐久消息路径暂用同域鉴权 HTTP API，后续可以替换成 MCP Client 而不改变业务 Schema。

耐久队列不是 MCP 本身提供的能力，因此 Hub 的消息、ACK 和 SQLite 状态机仍然是业务层。

## 组件边界

| 组件 | 负责 | 绝不负责 |
|---|---|---|
| Hub | Runner/Agent 注册、心跳、路由、离线消息、ACK、Trace、状态页 | 登录模型、读取远端代码、直接执行命令、保存真实 Session ID/绝对路径 |
| Runner daemon | 常驻连接、心跳、收件缓存、以后唤醒 provider Session | 替远程 Agent 放宽本机权限 |
| Runner stdio MCP | 把注册、状态和消息工具暴露给当前 Codex/Claude | 作为长期在线进程 |
| Provider adapter | `thread/resume` / `claude --resume`、输入注入、流式结果、审批桥接 | 把账号 Cookie/Token 上传 Hub |
| Hub Web | 团队状态、审计、合同批准状态 | 直接操作开发机文件 |

## 当前 Session 自动注册

标准 MCP `tools/call` 不应被假设会把宿主的 thread ID 自动交给任意 MCP Server。提示词也不能创造一个模型不知道的 ID。因此采用 challenge proof：

1. Agent 调 `agenthub_begin_registration`，Runner 生成高熵、五分钟有效的 challenge。
2. 工具结果进入当前 provider task 的本地 transcript。
3. Agent 立即调 `agenthub_complete_registration(challenge)`；第二次工具调用参数同样进入当前 transcript。
4. Runner 只在 challenge 创建时间附近的本地 provider transcript 中搜索这个精确字符串。
5. 恰好命中一份时读取该 transcript 的 Session metadata，并核验 cwd 属于目标 workspace。
6. 零命中、多个命中、目录不符均失败；不回退到“最近 Session”。

Codex 本地保存 `thread_id`，Claude 本地保存 `session_id`。Hub 只保存：

```text
session_binding_ref = SHA-256(runner_id + provider + provider_session_id)
```

这个摘要用于稳定路由和幂等，不能恢复真实 Session ID。

## 自动化与权限

```text
approve_contract   = Agent 之间确认方案
approve_execution  = 本机用户或本机预设策略允许修改
```

- `confirm_write`：讨论、只读诊断和消息自动；发生代码写入前暂停并请求本机确认。
- `full_auto`：用户预先在本机限定 workspace、命令与网络权限后，Runner 可自动恢复 Session 并执行。
- 远程消息、Hub 管理员和其他 Agent 都不能把 `confirm_write` 改成 `full_auto`。

Worktree 不属于 Hub 的一致性要求。每个 Runner 后续可选 `current_checkout`、`branch` 或 `worktree`；默认当前 checkout。

## 下一层 Provider adapter

Codex adapter 将在 Runner 本机启动 `codex app-server`，执行：

```text
initialize
→ thread/resume(local thread_id)
→ turn/start(threadId, incoming message, cwd, local permission policy)
→ stream item/turn events
→ result/blocker 回传 Hub
```

Claude adapter使用本机已登录的 Claude Code `--resume <session_id>` 或其 SDK。两者都由 Runner 子进程调用，不把 provider 服务端口暴露到 LAN。

当前 `0.1.0` 已完成绑定和消息接收缓存，但还没有执行上述自动唤醒，因此不能把“daemon 在线”误认为“Agent 已全自动工作”。
