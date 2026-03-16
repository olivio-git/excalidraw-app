import { toast } from "sonner";

export type NotifyType = "success" | "error" | "warning" | "info";

export interface NotifyOptions {
  type?: NotifyType;
  description?: string;
  duration?: number;
}

export function notify(message: string, options: NotifyOptions = {}): void {
  const { type = "info", description, duration } = options;
  const config = { description, duration };

  switch (type) {
    case "success":
      toast.success(message, config);
      break;
    case "error":
      toast.error(message, config);
      break;
    case "warning":
      toast.warning(message, config);
      break;
    default:
      toast.info(message, config);
      break;
  }
}
