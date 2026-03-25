import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAppContext } from "./runtime/build-services.js";
import { createMcpApplicationServer } from "./mcp/server.js";

const main = async () => {
  const context = await buildAppContext();
  const server = createMcpApplicationServer(context);
  const transport = new StdioServerTransport();
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await Promise.allSettled([transport.close(), server.close()]);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await server.connect(transport);
  context.logger.info("stdio MCP server started");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
