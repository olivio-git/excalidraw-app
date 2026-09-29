import { showNotification } from "@/shared/components/notification";

export type NotifyType = "success" | "error" | "warning" | "info";

export interface NotifyOptions {
  type?: NotifyType;
  description?: string;
  duration?: number;
}

/** App notification (VS Code style, see shared/components/notification). */
export function notify(message: string, options: NotifyOptions = {}): void {
  const { type = "info", description, duration } = options;
  showNotification({ level: type, message, detail: description, duration });
}
