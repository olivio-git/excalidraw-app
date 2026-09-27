export class StreamParser {
  private buffers = new Map<string, string>();

  onToolDelta(toolCallId: string, delta: string): void {
    const current = this.buffers.get(toolCallId) ?? "";
    this.buffers.set(toolCallId, current + delta);
  }

  tryFlushPartial(toolCallId: string): unknown[] | null {
    const buf = this.buffers.get(toolCallId);
    if (!buf) return null;
    try {
      const parsed = JSON.parse(buf);
      if (parsed && Array.isArray(parsed.elements)) return parsed.elements;
      return null;
    } catch {
      return null;
    }
  }

  onToolStop(toolCallId: string): unknown[] | null {
    const result = this.tryFlushPartial(toolCallId);
    this.buffers.delete(toolCallId);
    return result;
  }

  reset(): void {
    this.buffers.clear();
  }
}
