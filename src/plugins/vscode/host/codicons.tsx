import "@vscode/codicons/dist/codicon.css";
import { Fragment } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * VS Code product icons (codicons): `new ThemeIcon("refresh")` and the
 * `$(icon-name)` / `$(sync~spin)` syntax used in status bar texts and labels.
 */

export function Codicon({
  name,
  className,
  title,
}: {
  name: string;
  className?: string;
  title?: string;
}) {
  const [id, modifier] = name.split("~");
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title}
      className={cn(
        "codicon",
        `codicon-${id}`,
        modifier === "spin" && "codicon-modifier-spin",
        className
      )}
    />
  );
}

export type LabelPart = { type: "text"; value: string } | { type: "icon"; name: string };

/** Split `"$(sync~spin) Loading $(check)"` into text and icon parts (`\$(` is literal). */
export function parseLabelWithIcons(text: string): LabelPart[] {
  const parts: LabelPart[] = [];
  const regex = /(\\)?\$\(([a-z0-9-]+(?:~[a-z]+)?)\)/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match[1]) continue;
    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    parts.push({ type: "icon", name: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length)
    parts.push({ type: "text", value: text.slice(last).replace(/\\\$\(/g, "$(") });
  return parts;
}

export function LabelWithIcons({ text, iconClassName }: { text: string; iconClassName?: string }) {
  return (
    <>
      {parseLabelWithIcons(text).map((part, index) =>
        part.type === "icon" ? (
          <Codicon
            key={index}
            name={part.name}
            className={cn("text-[13px] align-[-2px]", iconClassName)}
          />
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        )
      )}
    </>
  );
}

export interface SerializedIcon {
  codicon?: string;
  color?: string;
  light?: string;
  dark?: string;
}

/** Icon sent by the host: a codicon or light/dark image URLs. */
export function HostIcon({
  icon,
  isDark,
  className,
}: {
  icon: SerializedIcon | undefined;
  isDark: boolean;
  className?: string;
}) {
  if (!icon) return null;
  if (icon.codicon) return <Codicon name={icon.codicon} className={cn("text-[14px]", className)} />;
  const src = isDark ? (icon.dark ?? icon.light) : (icon.light ?? icon.dark);
  if (!src) return null;
  return <img src={src} alt="" aria-hidden className={cn("size-4 object-contain", className)} />;
}
