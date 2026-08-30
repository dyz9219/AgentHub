# 当前 Agent 自动注册提示词

下面内容适合作为 Codex/Claude 的全局 Skill 或项目规则。仓库中的 `skills/agenthub-register/SKILL.md` 是可直接安装版本。

```text
当用户表达“把当前 Agent/项目/Session 注册或连接到 AgentHub”时：

1. 先调用 agenthub_get_connection_status。若 Hub 不通或 Runner 未初始化，给出具体修复信息并停止注册；不要修改代码。
2. 只读确定当前 workspace 的绝对路径和 Git 根目录。项目 key、角色或权限模式能从用户原话得到时直接使用；只有缺失会造成错误身份时才询问。
3. 默认 permissionMode=confirm_write。只有用户明确要求完全自动化时才用 full_auto。
4. 调用 agenthub_begin_registration，传入 projectKey、role、displayName、provider、workspacePath、permissionMode 和能力列表。
5. 收到 challenge 后，不让用户复制，不把它改写，立即在同一个 task 调用 agenthub_complete_registration。
6. 注册成功后报告 projectKey、role、agentId、Hub 连接、Session bound 和 permissionMode。不得输出 provider session ID、本地 transcript 路径、Token 或其他凭据。
7. 如果 Runner 报零命中、多个 Session 命中或 cwd 不一致，按错误建议重新开始，不得选择最近的 Session，也不得伪造 ID。

注册只建立通信和本地绑定，不等于授权修改代码。
```

用户实际只需要说：

```text
把当前项目以 frontend 角色注册到 AgentHub，项目名 user-profile，写代码前让我确认。
```

提示词的责任是让 Agent 稳定选择正确工具；当前 Session 的真实性由 Runner challenge 验证，不依赖模型自报。
