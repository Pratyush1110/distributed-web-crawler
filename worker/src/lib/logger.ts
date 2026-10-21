type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function writeLog(
  level: LogLevel,
  event: string,
  context: LogContext = {},
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  };

  const output = JSON.stringify(logEntry);

  if (level === "error") {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info(event: string, context?: LogContext): void {
    writeLog("info", event, context);
  },

  warn(event: string, context?: LogContext): void {
    writeLog("warn", event, context);
  },

  error(event: string, context?: LogContext): void {
    writeLog("error", event, context);
  },
};
