import type { FlowEditorStore } from "./editor-store";

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PNG of what the camera shows now. */
export function snapshotPng(store: FlowEditorStore): Uint8Array {
  const capture = store.getState().capture;
  if (!capture) throw new Error("La vista 3D no está lista");
  return dataUrlToBytes(capture.snapshot());
}

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
}

/**
 * Record the playback from start to end as a WebM video, straight from the
 * canvas (the camera can still be moved while it records).
 */
export async function recordPlayback(store: FlowEditorStore, fps = 30): Promise<Uint8Array> {
  const state = store.getState();
  const capture = state.capture;
  if (!capture) throw new Error("La vista 3D no está lista");
  if (typeof MediaRecorder === "undefined") throw new Error("Este sistema no puede grabar vídeo");
  if (!(state.timeline.duration > 0) || !Number.isFinite(state.timeline.duration))
    throw new Error("El flujo no tiene nada que reproducir");
  const stream = capture.canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: pickMimeType(),
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  state.stop();
  recorder.start(250);
  // A short lead-in so the video doesn't start on the first packet.
  await new Promise((resolve) => setTimeout(resolve, 300));
  store.getState().play();
  await new Promise<void>((resolve) => {
    if (!store.getState().playing) return resolve();
    const unsubscribe = store.subscribe((next) => {
      if (!next.playing) {
        unsubscribe();
        resolve();
      }
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());
  await stopped;
  return new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
}
