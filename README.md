# AgentHub

AgentHub 是一个面向局域网开发团队的轻量 Agent 通讯中枢。每台机器保留自己的 Codex/Claude 登录、Session 和代码目录；Agent 通过本机 Runner 注册、收发消息并在协商后继续原 Session。

当前版本是 `0.1.0` 技术闭环底座，已经可运行，不是项目管理系统。

## 第一版结构

```text
Codex / Claude
    ↕ 本机 stdio MCP
Runner（同一个安装包）
    ├─ mcp：供当前 Agent 调工具
    ├─ daemon：常驻心跳、接收并缓存消息
    └─ CLI：init / status
    ↕ 鉴权 HTTP（Hub 同时提供 Streamable HTTP MCP）
AgentHub
    ├─ SQLite WAL：Runner、Agent、消息、ACK
    └─ Web 状态页
```

Runner 需要像 CLI 一样在每台开发机安装一次，但它不替代 Codex/Claude，也不需要单独的 AI 账号。它是一个很小的本地 Sidecar：常驻 daemon 与短生命周期 stdio MCP bridge 都由同一个可执行包提供。正式发布时适合做成 npm 全局包或单文件原生可执行程序，再注册为系统自启动服务；第一版源码方式直接运行 Node.js。

界面采用“Hub 页面 + 本地 CLI”，暂不做重桌面客户端：

- 团队连接、角色和在线状态在 Hub 页面看。
- 本机 Session 绑定、守护进程和错误用 `agenthub-runner status` 看。
- 写代码审批最终应出现在本机 Agent/Runner，而不是由远程 Hub 替用户授权。

## 已实现

- Hub 的 Runner 注册、心跳、Agent 注册、在线状态和 SQLite 持久化。
- 带 sequence、conversation ID、trace ID、幂等键和 ACK 的文字消息队列。
- Hub 的鉴权 REST API、Streamable HTTP MCP 入口和轻量状态页。
- Runner 的 `init`、`daemon`、`status` 与本机 stdio MCP。
- Codex 与 Claude 的当前 Session challenge 绑定，不靠“最近 Session”猜测。
- `confirm_write` / `full_auto` 权限模式字段；Agent 方案批准和本地执行授权分离。
- 注册 Skill 与 MCP Prompt。
- 构建、8 个测试和真实进程 smoke test。

尚未实现：通过 Codex App Server/Claude CLI 自动唤醒已绑定 Session、代码写入审批 UI、截图上传、系统服务安装器和两台真实机器联调。消息中的 `attachmentIds` 已预留，但附件 API 不能视为完成。

## 本机快速启动

要求 Node.js 22.5 或更高版本。

```powershell
cd E:\workspace\AI\AgentHub
npm install
npm run build
$env:AGENTHUB_TOKEN = "替换为足够长的随机字符串"
npm run start:hub
```

状态页：`http://127.0.0.1:4310/`。

打开另一个 PowerShell，初始化并启动本机 Runner：

```powershell
$env:AGENTHUB_TOKEN = "与 Hub 相同的字符串"
node E:\workspace\AI\AgentHub\apps\runner\dist\index.js init --hub http://127.0.0.1:4310
node E:\workspace\AI\AgentHub\apps\runner\dist\index.js daemon
```

`init` 默认把 `agenthub-register` Skill 安装到当前用户的 Codex 与 Claude Skill 目录；若不需要可传 `--skip-skills`。它不会覆盖内容不同的已有 Skill，除非用户审查后显式传 `--force-skills`。

将本地 MCP bridge 配给 Codex 和 Claude：

```powershell
codex mcp add agenthub -- node E:\workspace\AI\AgentHub\apps\runner\dist\index.js mcp
claude mcp add -s user agenthub -- node E:\workspace\AI\AgentHub\apps\runner\dist\index.js mcp
```

配置完成后重开对应 Agent task，让它重新加载 MCP 工具。

## 用户只说一句话注册

推荐用法：

```text
把当前项目以 backend 角色注册到 AgentHub，项目名为 user-profile，修改代码前需要我确认。
```

Agent 在内部自动执行：

```text
确认 Runner 已连接
→ 只读核验当前 Git 根目录
→ agenthub_begin_registration
→ 得到一次性 challenge
→ 同一 task 立即 agenthub_complete_registration
→ Runner 在本机会话日志中定位 challenge
→ 校验 Session 的 cwd 属于目标仓库
→ 本机保存真实 thread_id/session_id 与绝对路径
→ Hub 只收到 opaque binding ref 和 repo fingerprint
```

用户不需要复制 challenge，也不需要知道 Session ID。若 challenge 出现在多个 Session、目录不一致或 Session 日志不可定位，Runner 会拒绝注册，不会选择“最近一个”。

完整提示词见 [注册提示词](docs/prompts/register-current-agent.md)，可安装 Skill 见 [agenthub-register](skills/agenthub-register/SKILL.md)。

## 如何确认已连接

三种方式互相校验：

1. 对 Agent 说“检查 AgentHub 连接状态”，它调用 `agenthub_get_connection_status`。
2. 本机执行：

   ```powershell
   node E:\workspace\AI\AgentHub\apps\runner\dist\index.js status
   ```

3. 打开 Hub 页面，看 Runner 心跳、Agent 角色、Session binding 和权限模式。

只有同时满足 `Hub connected + daemon running + session bound`，才算可自动收消息；后续加入 provider 唤醒适配器后，页面还会显示 `provider ready`。

## 局域网启动

Hub 所在机器显式配置监听地址、Token 和允许的 Host：

```powershell
$env:AGENTHUB_HOST = "0.0.0.0"
$env:AGENTHUB_ALLOWED_HOSTS = "172.16.31.100,agenthub.local"
$env:AGENTHUB_TOKEN = "替换为足够长的随机字符串"
npm run start:hub
```

其他机器把 Runner 的 `--hub` 改成 Hub 的局域网地址。不要把 Codex App Server 或 Claude 端口暴露到局域网；Runner 只主动连接 Hub。

## 验证

```powershell
npm run build
npm test
npm run smoke
```

更完整的两机与前后端 Demo 场景见 [测试方案](docs/test-plan.md)。调用全链路与技术选型见 [全链路](docs/full-chain.md)。

## 依据

- [Codex App Server（官方 OpenAI 文档）](https://developers.openai.com/codex/app-server)：`thread/start`、`thread/resume`、审批与流式事件。
- [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)：本机 stdio 与远程 Streamable HTTP。
- [MCP specification](https://modelcontextprotocol.io/specification/latest)。
