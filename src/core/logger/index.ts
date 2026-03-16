import { debug, info, warn, error as tauriError } from "@tauri-apps/plugin-log";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

interface LogEntry {
  level: LogLevel;
  category: string;
  message: string;
  data?: any;
  timestamp: string;
}

class Logger {
  private levelHierarchy: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  };

  private currentLevel: LogLevel = import.meta.env.DEV ? "debug" : "info";

  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case "debug":
        return "color: #8b5cf6"; // Violet
      case "info":
        return "color: #3b82f6"; // Blue
      case "warn":
        return "color: #f59e0b"; // Amber
      case "error":
        return "color: #ef4444"; // Red
      case "fatal":
        return "color: #ffffff; background: #dc2626; padding: 2px 4px; border-radius: 4px;"; // White on Red
      default:
        return "";
    }
  }

  private formatMessage(entry: LogEntry): string[] {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const prefix = `[%c${entry.level.toUpperCase()}%c] [${timestamp}] [${entry.category}]`;

    const styles = [
      this.getLevelColor(entry.level) + "; font-weight: bold",
      "color: inherit; font-weight: normal", // Reset style
    ];

    return [prefix, ...styles, entry.message];
  }

  private log(level: LogLevel, category: string, message: string, data?: any) {
    if (this.levelHierarchy[level] < this.levelHierarchy[this.currentLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      category,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    const formatted = this.formatMessage(entry);

    // In a real app we could also send to a backend/file here
    // We now send to Tauri plugin-log to save to disk
    const rawMessage = `[${entry.category}] ${entry.message} ${data ? JSON.stringify(data) : ""}`;

    switch (level) {
      case "debug":
        console.debug(...formatted, data ? data : "");
        debug(rawMessage);
        break;
      case "info":
        console.info(...formatted, data ? data : "");
        info(rawMessage);
        break;
      case "warn":
        console.warn(...formatted, data ? data : "");
        warn(rawMessage);
        break;
      case "error":
      case "fatal":
        console.error(...formatted, data ? data : "");
        tauriError(rawMessage);
        break;
    }
  }

  setLevel(level: LogLevel) {
    this.currentLevel = level;
  }

  debug(category: string, message: string, data?: any) {
    this.log("debug", category, message, data);
  }
  info(category: string, message: string, data?: any) {
    this.log("info", category, message, data);
  }
  warn(category: string, message: string, data?: any) {
    this.log("warn", category, message, data);
  }
  error(category: string, message: string, data?: any) {
    this.log("error", category, message, data);
  }
  fatal(category: string, message: string, data?: any) {
    this.log("fatal", category, message, data);
  }
}

export const logger = new Logger();
