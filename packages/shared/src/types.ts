import type {
  AgentStatus,
  MessageKind,
  PermissionMode,
  Provider,
  SessionBindingStatus
} from "./schemas.js";

export interface RunnerRecord {
  runnerId: string;
  name: string;
  machineName: string;
  os: string;
  version: string;
  capabilities: string[];
  status: "online" | "busy" | "degraded" | "offline";
  createdAt: string;
  lastSeenAt: string;
}

export interface AgentRecord {
  agentId: string;
  runnerId: string;
  projectKey: string;
  role: string;
  displayName: string;
  provider: Provider;
  repoFingerprint: string;
  sessionBindingRef: string;
  sessionBindingStatus: SessionBindingStatus;
  permissionMode: PermissionMode;
  capabilities: string[];
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  sequence: number;
  messageId: string;
  conversationId: string;
  traceId: string;
  senderAgentId: string;
  recipientAgentIds: string[];
  kind: MessageKind;
  text: string;
  attachmentIds: string[];
  replyToMessageId: string | null;
  createdAt: string;
}

export interface HubStatus {
  ok: true;
  serverTime: string;
  runners: {
    online: number;
    total: number;
  };
  agents: {
    online: number;
    total: number;
  };
}
