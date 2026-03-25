import { buildAppContext } from "./runtime/build-services.js";
import { createHttpApp } from "./http/app.js";

const main = async () => {
  const context = await buildAppContext();
  const app = await createHttpApp(context);
  const host = process.env.HTTP_BIND_HOST ?? "127.0.0.1";
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await app.close();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await app.listen({
    port: context.config.env.PORT,
    host,
  });

  context.logger.info(
    {
      port: context.config.env.PORT,
      host,
      baseUrl: context.config.baseUrl.toString(),
      dashboard: new URL("/dashboard", context.config.baseUrl).toString(),
      mcp: context.config.mcpUrl.toString(),
    },
    "HTTP server started",
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
