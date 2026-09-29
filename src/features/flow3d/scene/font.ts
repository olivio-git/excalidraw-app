import interFont from "@fontsource/inter/files/inter-latin-500-normal.woff?url";

/**
 * Local font for SDF labels (troika would otherwise fetch one from a CDN).
 * WOFF, not WOFF2: troika's font parser only converts WOFF.
 */
export const FONT_URL = interFont;
