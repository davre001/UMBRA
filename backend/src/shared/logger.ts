import pino from "pino";

/**
 * Single shared logger for the whole backend. Rendered as plain,
 * human-readable lines (not raw JSON) because the only place these logs are
 * actually read is Render's dashboard log viewer, not a JSON log pipeline —
 * readability there matters more than machine-parseability. No ANSI color,
 * since Render's viewer doesn't render escape codes.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: false,
      translateTime: "yyyy-mm-dd HH:MM:ss.l",
      ignore: "pid,hostname",
    },
  },
});
