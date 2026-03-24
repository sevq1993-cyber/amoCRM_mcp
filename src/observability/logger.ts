import pino from "pino";

export const createLogger = () =>
  pino({
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino/file",
            options: {
              destination: 1,
            },
          },
  });

export type AppLogger = ReturnType<typeof createLogger>;
