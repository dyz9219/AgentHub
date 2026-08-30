import { buildHubApp } from "./app.js";
import { loadHubConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadHubConfig();
  const { app } = buildHubApp(config);
  await app.listen({ host: config.host, port: config.port });
  console.error(`AgentHub listening on http://${config.host}:${config.port}`);
  if (config.token === "agenthub-local-dev-token") {
    console.error("AgentHub is using the loopback-only development token");
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
