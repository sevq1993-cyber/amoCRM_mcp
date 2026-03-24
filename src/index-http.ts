import { buildAppContext } from "./runtime/build-services.js";
import { createHttpApp } from "./http/app.js";

const main = async () => {
  const context = await buildAppContext();
  const app = await createHttpApp(context);

  await app.listen({
    port: context.config.env.PORT,
    host: "0.0.0.0",
  });

  context.logger.info(
    {
      port: context.config.env.PORT,
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
