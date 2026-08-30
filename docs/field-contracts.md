# Field contracts and privacy boundaries

字段只在对应事实或决策存在时保存。Hub 数据属于团队路由面；Runner 数据属于单机私有执行面。任何从 Runner 发往 Hub 的请求都必须在 Schema 严格模式下拒绝额外字段，因此 `providerSessionId` 和 `workspacePath` 即使误传也会失败。

## Identity overview

| 标识 | 示例 | 用途 | 不是什么 |
|---|---|---|---|
| `runnerId` | `d3e7…` UUID | 一台机器上的 Runner 安装身份 | 用户、Agent 或 Session |
| `agentId` | `8a2b…` UUID | 项目中一个已注册角色端点 | 模型账号 |
| `providerSessionId` | Codex thread UUID / Claude session UUID | 恢复真实模型上下文，只保存在 Runner | Trace ID |
| `sessionBindingRef` | 64 位 SHA-256 | Hub 的不可逆 Session 路由引用 | 可用于恢复 Session 的凭据 |
| `conversationId` | UUID | 一轮跨 Agent 讨论房间 | provider Session |
| `messageId` | UUID | 单条消息、ACK 与去重 | 执行授权 |
| `traceId` | UUID | 一次消息创建和投递链路追踪 | 固定对话上下文 |
| `idempotencyKey` | `message:<uuid>` | 同一逻辑写请求重试去重 | 身份或鉴权 Token |

## Runner config（本机）

| 字段 | 类型 / 空值 | 来源、写入时机与写入者 | 约束、默认与使用 | 可见性及错误影响 |
|---|---|---|---|---|
| `runnerId` | UUID，必填不可空 | `init` 首次生成；后续 init 保留 | 单机安装唯一且不可变；Hub 注册/心跳路由 | 本机与 Hub 可见；被篡改会被当作另一台 Runner |
| `runnerName` | string，必填 | 用户 `--name`，否则 OS hostname | 1–100 字符；页面显示 | 团队可见，不含秘密；错误只影响识别 |
| `hubUrl` | URL，必填 | 用户 `--hub` | 绝对 HTTP(S) URL；所有 Hub 请求使用 | 本机可见；错误导致不可连接，不能回退到未知 Hub |
| `tokenEnv` | 环境变量名，必填 | `--token-env`，默认 `AGENTHUB_TOKEN` | 只保存变量名，不保存 Token | 本机可见；缺失变量时拒绝联网 |
| `heartbeatIntervalMs` | integer，必填 | Runner 默认写入 | 5,000–300,000；默认 15,000 | 本机可见；异常值被 Schema 拒绝 |

## Pending registration（本机、五分钟临时）

| 字段 | 类型 / 空值 | 来源与产生时机 | 约束及使用 | 可见性及错误影响 |
|---|---|---|---|---|
| `challenge` | `ahb_bind_<uuid>`，必填 | `begin_registration` 随机生成 | 单次、五分钟；精确 transcript 搜索 | 仅本机与当前 task；重复命中即拒绝 |
| `createdAt` | ISO timestamp，必填 | challenge 生成时 | 限制 transcript 搜索时间窗 | 本机；错误会漏匹配或扩大扫描 |
| `expiresAt` | ISO timestamp，必填 | `createdAt + 5m` | 过期删除，不允许继续 | 本机；篡改会破坏防重放边界 |
| `workspaceRoot` | absolute path，必填 | Runner 通过 realpath/Git 核验 | 必须存在；用于核对 Session cwd | 严禁出 Runner；错误可能指向错误仓库，因此失败关闭 |
| `repoFingerprint` | 64 位 SHA-256，必填 | Git remote 或本地目录身份摘要 | Hub 校验仓库身份，不提供路径 | Hub 可见摘要；错误会导致角色仓库不一致 |
| `draft` | object，必填 | Agent 根据用户意图传入 | 使用下表注册输入字段 | 含 `workspacePath`，整体只在本机临时保存 |

`draft` 字段：

| 字段 | 类型 / 空值 | 含义、来源和约束 | 使用与隐私 |
|---|---|---|---|
| `projectKey` | string，必填，1–120 | 团队共享项目名；来自用户或明确仓库名 | Hub 分组，可见；错误会把 Agent 分到错误项目 |
| `role` | string，必填，1–120 | frontend/backend/algorithm/product/ui 等责任 | Hub 路由，可见；允许未来自定义角色 |
| `displayName` | string，必填，1–120 | 人类可读名称 | 页面显示，不用于安全判断 |
| `provider` | `codex` / `claude`，必填 | 当前真实宿主 | 选择 Session locator 与后续 adapter；错误导致绑定失败 |
| `workspacePath` | absolute path，必填 | 当前 task 的项目目录，由 Agent 只读核验 | 仅 Runner；不得发 Hub |
| `permissionMode` | enum，必填 | 用户选择；默认 `confirm_write` | 本机执行策略；Hub 只展示，远程不能提升 |
| `capabilities` | string[]，必填可空数组，最多 50 | Agent 声明的技术/责任能力 | 发现与路由；不作为授权 |

## Local binding（本机长期）

| 字段 | 类型 / 空值 | 业务事实与写入者 | 约束 / 使用 | 隐私与篡改影响 |
|---|---|---|---|---|
| `agentId` | UUID，必填 | Hub 注册返回 | Hub 消息端点主键 | 可对团队显示；错误会串 inbox |
| `runnerId` | UUID，必填 | 本机 config | 必须等于当前 Runner | 可对 Hub 显示；不一致时应拒绝执行 |
| `projectKey` | string，必填 | 注册 draft | 项目路由 | 团队可见 |
| `role` | string，必填 | 注册 draft | 责任路由 | 团队可见 |
| `displayName` | string，必填 | 注册 draft | UI 显示 | 团队可见 |
| `provider` | enum，必填 | locator 类型 | 选择恢复 adapter | 团队可见 |
| `providerSessionId` | string，必填 | challenge 命中的 transcript metadata | 固定上下文恢复；不可静默替换 | 绝不出 Runner；错误会恢复错误上下文，是高风险字段 |
| `workspacePath` | absolute path，必填 | 已核验 repository root | 所有本机文件/命令作用域 | 绝不出 Runner；错误会修改错误仓库，是高风险字段 |
| `repoFingerprint` | SHA-256，必填 | repository inspector | 恢复前复核仓库身份 | Hub 仅见摘要；不匹配时暂停 |
| `sessionBindingRef` | SHA-256，必填唯一 | Runner 对 runner/provider/session 哈希 | Hub 稳定引用和去重 | 不可逆；被篡改会创建错误路由 |
| `permissionMode` | enum，必填 | 用户本机选择 | 执行前权限门 | Hub 可展示，不可远程提升 |
| `capabilities` | string[]，必填 | 注册输入 | Agent 发现 | 团队可见，不是授权 |
| `createdAt` | ISO timestamp，必填 | 首次完成注册 | 审计 | 团队不需要原值；错误影响审计 |
| `updatedAt` | ISO timestamp，必填 | 重新绑定/配置改变 | 新鲜度与审计 | 错误会误判 stale |

## Hub Runner record

| 字段 | 类型 / 空值 | 来源与时机 | 约束 / 使用 / 隐私 |
|---|---|---|---|
| `runnerId` | UUID，必填唯一 | Runner init 后注册 | 路由主键；团队可见 ID |
| `name` | string，必填 | Runner config | 页面名称，不作鉴权 |
| `machineName` | string，必填 | OS hostname | 运维识别，属于内部信息；不公开互联网 |
| `os` | string，必填 | Runner runtime | 兼容性判断，内部可见 |
| `version` | string，必填 | Runner build | 协议兼容与升级判断 |
| `capabilities` | string[]，可空数组 | Runner build | 调度能力，不是权限 |
| `status` | online/busy/degraded/offline | 心跳写入；offline 动态派生 | 页面、路由健康判断；不能代表 provider Session 正在工作 |
| `createdAt` | ISO timestamp | 首次注册 | 审计，不可变 |
| `lastSeenAt` | ISO timestamp | 每次心跳 | 超过 45 秒派生 offline；伪造会误报在线 |

## Hub Agent record

| 字段 | 类型 / 空值 | 来源与时机 | 约束 / 使用 / 隐私 |
|---|---|---|---|
| `agentId` | UUID，必填唯一 | Runner 生成并由 Hub确认 | inbox 与责任端点主键 |
| `runnerId` | UUID，必填 | 本机 binding | 路由到机器，必须已注册 |
| `projectKey` | string，必填 | 用户/Agent 注册输入 | 项目分组与查询 |
| `role` | string，必填 | 用户注册输入 | 责任发现与消息目标 |
| `displayName` | string，必填 | 注册输入 | UI 展示 |
| `provider` | enum，必填 | Runner locator | 能力展示；真实账号信息不上传 |
| `repoFingerprint` | SHA-256，必填 | Runner | 同项目仓库一致性检查，不泄露 remote/path |
| `sessionBindingRef` | SHA-256，必填唯一 | Runner | 固定 Session 的不透明引用 |
| `sessionBindingStatus` | pending/bound/stale | Runner | 是否可继续原上下文；`bound` 仍不等于 provider ready |
| `permissionMode` | enum，必填 | 本机策略 | 页面展示和审计；Hub 无权提高 |
| `capabilities` | string[]，可空 | Agent 注册输入 | 发现与路由 |
| `status` | online/offline/busy/blocked/waiting_approval | Runner 心跳/工作状态 | 工作流路由；离线由 Runner 心跳覆盖 |
| `createdAt` | ISO timestamp | 首次注册 | 审计 |
| `updatedAt` | ISO timestamp | 状态或绑定变化 | 新鲜度；篡改影响调度判断 |

## Hub message

| 字段 | 类型 / 空值 | 来源与产生时机 | 约束 / 使用 / 隐私 |
|---|---|---|---|
| `sequence` | positive integer，必填 | SQLite 自增 | inbox 分页和断线续传；不可由调用方指定 |
| `messageId` | UUID，必填唯一 | 发送方或 Hub | ACK、引用和去重 |
| `conversationId` | UUID，必填 | 首条消息创建，后续复用 | 跨 Agent 讨论房间；不是 provider Session |
| `traceId` | UUID，必填 | Hub 每次逻辑消息创建 | 可观测链路；不是固定上下文 |
| `senderAgentId` | UUID，必填 | 发送 Agent | 责任和鉴权校验；必须已注册 |
| `recipientAgentIds` | UUID[]，1–20 | 发送 Agent | fan-out 与 inbox；全部必须已注册 |
| `kind` | 7 值 enum，必填 | 发送 Agent | proposal/question/objection/approval/blocker/result/text 状态语义 |
| `text` | string，必填，1–50,000 | Agent 生成 | 模型上下文和审计；不得放 Token/隐私凭据 |
| `attachmentIds` | UUID[]，0–10 | 附件上传结果 | 截图引用；当前上传 API 尚未实现 |
| `replyToMessageId` | UUID 或 null | 回复时设置 | 因果链；错误会破坏讨论关联 |
| `createdAt` | ISO timestamp | Hub 写入 | 排序与审计，不接受调用方覆盖 |

## Planned attachment

附件实现时最少保存 `attachmentId`、`projectKey`、`uploaderAgentId`、`originalName`、`detectedMime`、`byteSize`、`sha256`、`storageKey`、`createdAt`、`expiresAt`。PNG/JPEG/WebP 必须通过 magic-byte 检测，默认最大 10 MiB，清理 EXIF；SVG 首版拒绝。二进制落 Hub 文件存储，SQLite 只存元数据，消息只传 `attachmentId`。缺失或哈希不符时 Runner 不得把图片送入模型。
