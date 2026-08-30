import type {
  AgentRecord,
  HeartbeatRequest,
  HubStatus,
  MessageRecord,
  RegisterAgentRequest,
  RegisterRunnerRequest,
  RunnerRecord,
  SendMessageRequest
} from "@agenthub/shared";

export class HubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 10_000
  ) {}

  getStatus(): Promise<HubStatus> {
    return this.request<HubStatus>("GET", "/healthz", undefined, false);
  }

  registerRunner(input: RegisterRunnerRequest): Promise<RunnerRecord> {
    return this.request("POST", "/api/v1/runners/register", input);
  }

  heartbeat(runnerId: string, input: HeartbeatRequest): Promise<RunnerRecord> {
    return this.request("POST", `/api/v1/runners/${encodeURIComponent(runnerId)}/heartbeat`, input);
  }

  registerAgent(input: RegisterAgentRequest): Promise<AgentRecord> {
    return this.request("POST", "/api/v1/agents/register", input);
  }

  async listAgents(projectKey?: string): Promise<AgentRecord[]> {
    const query = projectKey ? `?projectKey=${encodeURIComponent(projectKey)}` : "";
    const result = await this.request<{ agents: AgentRecord[] }>("GET", `/api/v1/agents${query}`);
    return result.agents;
  }

  sendMessage(input: SendMessageRequest): Promise<MessageRecord> {
    return this.request("POST", "/api/v1/messages", input);
  }

  async readInbox(agentId: string, after: number, limit = 20): Promise<MessageRecord[]> {
    const query = new URLSearchParams({ agentId, after: String(after), limit: String(limit) });
    const result = await this.request<{ messages: MessageRecord[] }>("GET", `/api/v1/inbox?${query}`);
    return result.messages;
  }

  async acknowledgeMessage(messageId: string, agentId: string, status: "delivered" | "read" | "handled"): Promise<void> {
    await this.request("POST", `/api/v1/messages/${encodeURIComponent(messageId)}/ack`, { agentId, status });
  }

  private async request<T>(
    method: "GET" | "POST",
    route: string,
    body?: unknown,
    authenticated = true
  ): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    if (authenticated) headers.set("authorization", `Bearer ${this.token}`);
    if (body !== undefined) headers.set("content-type", "application/json");
    let response: Response;
    try {
      const request: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs)
      };
      if (body !== undefined) request.body = JSON.stringify(body);
      response = await fetch(`${this.baseUrl}${route}`, request);
    } catch (error) {
      throw new Error(`Cannot reach AgentHub at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`AgentHub returned non-JSON data for ${method} ${route}`);
      }
    }
    if (!response.ok) {
      const message = typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `HTTP ${response.status}`;
      throw new Error(`AgentHub request failed: ${message}`);
    }
    return parsed as T;
  }
}
