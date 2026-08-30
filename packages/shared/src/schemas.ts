import * as z from "zod/v4";

export const ProviderSchema = z.enum(["codex", "claude"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const PermissionModeSchema = z.enum(["confirm_write", "full_auto"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const SessionBindingStatusSchema = z.enum(["pending", "bound", "stale"]);
export type SessionBindingStatus = z.infer<typeof SessionBindingStatusSchema>;

export const AgentStatusSchema = z.enum([
  "online",
  "offline",
  "busy",
  "blocked",
  "waiting_approval"
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const MessageKindSchema = z.enum([
  "text",
  "proposal",
  "question",
  "objection",
  "approval",
  "blocker",
  "result"
]);
export type MessageKind = z.infer<typeof MessageKindSchema>;

const IdentifierSchema = z.string().trim().min(1).max(120);
const CapabilitySchema = z.string().trim().min(1).max(80);

export const RegisterRunnerRequestSchema = z.object({
  runnerId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  machineName: z.string().trim().min(1).max(255),
  os: z.string().trim().min(1).max(100),
  version: z.string().trim().min(1).max(40),
  capabilities: z.array(CapabilitySchema).max(50).default([])
}).strict();
export type RegisterRunnerRequest = z.infer<typeof RegisterRunnerRequestSchema>;

export const HeartbeatRequestSchema = z.object({
  status: z.enum(["online", "busy", "degraded"]).default("online"),
  agentIds: z.array(z.uuid()).max(100).default([])
}).strict();
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export const RegisterAgentRequestSchema = z.object({
  agentId: z.uuid().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
  runnerId: z.uuid(),
  projectKey: IdentifierSchema,
  role: IdentifierSchema,
  displayName: z.string().trim().min(1).max(120),
  provider: ProviderSchema,
  repoFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sessionBindingRef: z.string().regex(/^[a-f0-9]{64}$/),
  sessionBindingStatus: SessionBindingStatusSchema,
  permissionMode: PermissionModeSchema,
  capabilities: z.array(CapabilitySchema).max(50).default([])
}).strict();
export type RegisterAgentRequest = z.infer<typeof RegisterAgentRequestSchema>;

export const SendMessageRequestSchema = z.object({
  messageId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  senderAgentId: z.uuid(),
  recipientAgentIds: z.array(z.uuid()).min(1).max(20),
  kind: MessageKindSchema.default("text"),
  text: z.string().trim().min(1).max(50_000),
  attachmentIds: z.array(z.uuid()).max(10).default([]),
  replyToMessageId: z.uuid().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(200)
}).strict();
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const InboxQuerySchema = z.object({
  agentId: z.uuid(),
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();
export type InboxQuery = z.infer<typeof InboxQuerySchema>;

export const AcknowledgeMessageRequestSchema = z.object({
  agentId: z.uuid(),
  status: z.enum(["delivered", "read", "handled"])
}).strict();
export type AcknowledgeMessageRequest = z.infer<typeof AcknowledgeMessageRequestSchema>;

export const BeginRegistrationInputSchema = z.object({
  projectKey: IdentifierSchema.describe("Shared project key used by all roles, for example demo-user-profile"),
  role: IdentifierSchema.describe("Agent responsibility, for example frontend or backend"),
  displayName: z.string().trim().min(1).max(120).describe("Human-readable agent name"),
  provider: ProviderSchema.describe("Current agent host"),
  workspacePath: z.string().trim().min(1).max(2_000).describe("Absolute path of the current project workspace"),
  permissionMode: PermissionModeSchema.default("confirm_write"),
  capabilities: z.array(CapabilitySchema).max(50).default([])
}).strict();
export type BeginRegistrationInput = z.infer<typeof BeginRegistrationInputSchema>;

export const CompleteRegistrationInputSchema = z.object({
  challenge: z.string().regex(/^ahb_bind_[a-f0-9-]{36}$/)
    .describe("Exact challenge returned by agenthub_begin_registration; never invent or alter it")
}).strict();
export type CompleteRegistrationInput = z.infer<typeof CompleteRegistrationInputSchema>;
