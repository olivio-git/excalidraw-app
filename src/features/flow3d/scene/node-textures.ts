import { useEffect, useState } from "react";
import { CanvasTexture, SRGBColorSpace, TextureLoader, type Texture } from "three";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * Textures for node styles: an icon (emoji or short text) drawn on a canvas,
 * and pictures loaded from the workspace or the web.
 */

const iconCache = new Map<string, CanvasTexture>();

/** A square texture with the icon centered, transparent around it. Cached per icon and color. */
export function iconTexture(icon: string, color = "#ffffff"): CanvasTexture {
  const key = `${icon}\u0000${color}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const short = [...icon].length;
  context.font = `${short > 1 && /\w/.test(icon) ? 120 : 180}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(icon, 128, 138);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  iconCache.set(key, texture);
  return texture;
}

let roundShadow: CanvasTexture | null = null;

/** A soft round shadow (radial fade), shared by every shape. */
export function roundShadowTexture(): CanvasTexture {
  if (roundShadow) return roundShadow;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(0,0,0,0.9)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.45)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  roundShadow = new CanvasTexture(canvas);
  return roundShadow;
}

const isUrl = (value: string) => /^(https?:|data:|blob:|asset:)/i.test(value);
const isAbsolute = (value: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(value);

async function imageUrl(image: string): Promise<string> {
  if (isUrl(image)) return image;
  const root = useWorkspaceStore.getState().workspaceDir;
  const path = isAbsolute(image) || !root ? image : `${root.replace(/[\\/]$/, "")}/${image}`;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

const imageCache = new Map<string, Promise<Texture>>();

function loadImage(image: string): Promise<Texture> {
  const cached = imageCache.get(image);
  if (cached) return cached;
  const promise = imageUrl(image).then(
    (url) =>
      new Promise<Texture>((resolve, reject) =>
        new TextureLoader().load(
          url,
          (texture) => {
            texture.colorSpace = SRGBColorSpace;
            resolve(texture);
          },
          undefined,
          reject
        )
      )
  );
  promise.catch(() => imageCache.delete(image));
  imageCache.set(image, promise);
  return promise;
}

/** The node's picture as a texture, or null (none, loading or not found). */
export function useImageTexture(image: string | undefined): Texture | null {
  const [texture, setTexture] = useState<{ image: string; texture: Texture } | null>(null);
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    loadImage(image).then(
      (loaded) => !cancelled && setTexture({ image, texture: loaded }),
      () => !cancelled && setTexture(null)
    );
    return () => {
      cancelled = true;
    };
  }, [image]);
  return image && texture?.image === image ? texture.texture : null;
}
