import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

interface TooltipWrapperProps {
  children: ReactNode;
  tooltip: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}

export const TooltipWrapper = ({
  children,
  tooltip,
  side = "top",
  delayDuration = 300,
}: TooltipWrapperProps) => {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
