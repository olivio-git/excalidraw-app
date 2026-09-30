import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Send, Square, X, ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { useAISettingsStore } from "@/features/settings/ai/ai-settings-store";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { resolveAIChatContext } from "./utils/context-resolver";
import type { AIImageAttachment } from "./providers/types";

interface AIChatInputProps {
  onSend: (text: string, images?: AIImageAttachment[]) => void;
  onAnswer?: (text: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  isWaitingForUser?: boolean;
  disabled?: boolean;
  /** Text put in the input from outside (a new `id` replaces it again). */
  draft?: { text: string; id: number } | null;
}

export function AIChatInput({
  onSend,
  onAnswer,
  onCancel,
  isStreaming,
  isWaitingForUser,
  disabled,
  draft,
}: AIChatInputProps) {
  const { t } = useTranslation("common");
  const [value, setValue] = useState("");
  const [images, setImages] = useState<AIImageAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A new draft replaces the text once; the user edits it freely afterwards.
  const [draftId, setDraftId] = useState<number | null>(null);
  if (draft && draft.id !== draftId) {
    setDraftId(draft.id);
    setValue(draft.text);
  }
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!draft || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(draft.text.length, draft.text.length);
  }, [draft]);

  const activeProvider = useAISettingsStore((s) => s.activeProvider);
  const providerModel = useAISettingsStore((s) => s.providers[s.activeProvider].model);

  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const context = resolveAIChatContext();
  const contextLabel = context.kind !== "none" ? (activeTab?.title ?? null) : null;

  const addImageFiles = async (files: FileList | File[]) => {
    const next: AIImageAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 10 * 1024 * 1024) continue;
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (data) next.push({ mediaType: file.type, data, name: file.name });
    }
    setImages((current) => [...current, ...next].slice(0, 4));
  };

  const send = () => {
    const trimmed = value.trim();
    if ((!trimmed && images.length === 0) || isStreaming || disabled) return;
    if (isWaitingForUser && onAnswer) onAnswer(trimmed);
    else onSend(trimmed, images);
    setValue("");
    setImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleSend = () => {
    send();
    textareaRef.current?.focus();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData;
    const files = Array.from(clipboard.files);
    const itemFiles = Array.from(clipboard.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const imagesFromClipboard = [...files, ...itemFiles].filter(
      (file, index, all) => all.findIndex((candidate) => candidate === file) === index
    );

    // Linux screenshot tools often expose the bitmap only through the native
    // clipboard, not through Chromium's ClipboardEvent.files/items.
    event.preventDefault();
    if (imagesFromClipboard.length > 0) {
      void addImageFiles(imagesFromClipboard);
      return;
    }

    void invoke<string | null>("read_clipboard_image")
      .then((dataUrl) => {
        if (dataUrl) {
          const [header, data] = dataUrl.split(",", 2);
          const mediaType = header.match(/^data:([^;]+);/)?.[1] ?? "image/png";
          setImages((current) =>
            [...current, { mediaType, data, name: "clipboard.png" }].slice(0, 4)
          );
          return;
        }
        // Preserve normal Ctrl+V text paste when the native clipboard has no image.
        setValue((current) => current + clipboard.getData("text/plain"));
      })
      .catch(() => setValue((current) => current + clipboard.getData("text/plain")));
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addImageFiles(event.target.files);
    event.target.value = "";
  };

  const placeholder = isWaitingForUser
    ? t("aiChat.waitingForAnswer")
    : t("aiChat.inputPlaceholder");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex items-end gap-1.5">
        {images.length > 0 && (
          <div className="absolute bottom-full left-0 right-8 mb-1 flex gap-1.5 rounded-md border border-border bg-background p-1.5 shadow-sm">
            {images.map((image, index) => (
              <div key={`${image.name ?? image.mediaType}-${index}`} className="group relative">
                <img
                  src={`data:${image.mediaType};base64,${image.data}`}
                  alt={image.name ?? "Attached image"}
                  className="size-14 rounded object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                  className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block"
                  aria-label="Remove image"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          data-ai-chat-input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={3}
          disabled={isStreaming || disabled}
          className={cn(
            "flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            isWaitingForUser && "border-primary/50"
          )}
        />

        <div className="flex flex-col gap-1 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFiles}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || disabled}
            title="Attach image"
            className="size-7"
          >
            <ImagePlus className="size-3.5" />
          </Button>
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onCancel}
              title={t("aiChat.stopGeneration")}
              className="size-7"
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={handleSend}
              disabled={(!value.trim() && images.length === 0) || disabled}
              title={t("aiChat.sendMessage")}
              className="size-7"
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] text-muted-foreground truncate">
          {activeProvider} · {providerModel}
        </span>
        {contextLabel ? (
          <span
            className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]"
            title={contextLabel}
          >
            {t("aiChat.context")}: {contextLabel}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/40">
            {t("aiChat.noDiagramActive")}
          </span>
        )}
      </div>
    </div>
  );
}
