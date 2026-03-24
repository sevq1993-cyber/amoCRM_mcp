import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAppContext } from "./runtime/build-services.js";
import { createMcpApplicationServer } from "./mcp/server.js";

const main = async () => {
  const context = await buildAppContext();
  const server = createMcpApplicationServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  context.logger.info("stdio MCP server started");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
