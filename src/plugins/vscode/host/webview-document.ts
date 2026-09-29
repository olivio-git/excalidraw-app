import { hslTripletToHex } from "@/features/terminal/xterm-theme";

/**
 * Builds the document a webview iframe renders: the extension's HTML plus
 * what VS Code injects — `acquireVsCodeApi()`, the `--vscode-*` theme
 * variables, default styles and `vscode-light`/`vscode-dark` body classes.
 */

export interface WebviewTheme {
  kind: "light" | "dark";
  vars: Record<string, string>;
}

/** App CSS variable (H S% L%) used as fallback for VS Code colors. */
const FALLBACKS: Record<string, string> = {
  foreground: "--foreground",
  "editor.background": "--background",
  "editor.foreground": "--foreground",
  "sideBar.background": "--background",
  "panel.background": "--background",
  "editorWidget.background": "--popover",
  "button.background": "--primary",
  "button.foreground": "--primary-foreground",
  "button.hoverBackground": "--primary",
  "button.secondaryBackground": "--secondary",
  "button.secondaryForeground": "--secondary-foreground",
  "input.background": "--background",
  "input.foreground": "--foreground",
  "input.border": "--border",
  "input.placeholderForeground": "--muted-foreground",
  "dropdown.background": "--popover",
  "dropdown.foreground": "--popover-foreground",
  "dropdown.border": "--border",
  focusBorder: "--ring",
  "textLink.foreground": "--primary",
  "textLink.activeForeground": "--primary",
  descriptionForeground: "--muted-foreground",
  errorForeground: "--destructive",
  "widget.border": "--border",
  "list.hoverBackground": "--accent",
  "list.activeSelectionBackground": "--accent",
  "list.activeSelectionForeground": "--accent-foreground",
  "badge.background": "--primary",
  "badge.foreground": "--primary-foreground",
  "textPreformat.background": "--muted",
  "textPreformat.foreground": "--foreground",
  "textBlockQuote.background": "--muted",
  "textBlockQuote.border": "--border",
  "textCodeBlock.background": "--muted",
  "checkbox.background": "--background",
  "checkbox.border": "--border",
  "progressBar.background": "--primary",
  "icon.foreground": "--foreground",
  "scrollbarSlider.background": "--muted",
  "scrollbarSlider.hoverBackground": "--accent",
  "panel.border": "--border",
  "editorGroup.border": "--border",
};

export function cssVarName(colorKey: string): string {
  return `--vscode-${colorKey.replace(/\./g, "-")}`;
}

export function buildWebviewTheme(
  cssVar: (name: string) => string,
  isDark: boolean,
  themeColors: Record<string, string>
): WebviewTheme {
  const vars: Record<string, string> = {};
  for (const [key, appVar] of Object.entries(FALLBACKS)) {
    const hex = hslTripletToHex(cssVar(appVar));
    if (hex) vars[cssVarName(key)] = hex;
  }
  for (const [key, value] of Object.entries(themeColors)) vars[cssVarName(key)] = value;
  const mono = cssVar("--font-mono").trim() || "monospace";
  const sans = cssVar("--font-sans").trim() || "system-ui, sans-serif";
  Object.assign(vars, {
    "--vscode-font-family": sans,
    "--vscode-font-weight": "normal",
    "--vscode-font-size": "13px",
    "--vscode-editor-font-family": mono,
    "--vscode-editor-font-weight": "normal",
    "--vscode-editor-font-size": "13px",
    "--monaco-monospace-font": mono,
  });
  return { kind: isDark ? "dark" : "light", vars };
}

export function currentWebviewTheme(themeColors: Record<string, string>): WebviewTheme {
  const styles = getComputedStyle(document.documentElement);
  return buildWebviewTheme(
    (name) => styles.getPropertyValue(name),
    document.documentElement.classList.contains("dark"),
    themeColors
  );
}

const DEFAULT_STYLES = `
html{scrollbar-color:var(--vscode-scrollbarSlider-background) transparent}
body{background-color:transparent;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-weight:var(--vscode-font-weight);font-size:var(--vscode-font-size);margin:0;padding:0 20px}
img,video{max-width:100%;max-height:100%}
a,a code{color:var(--vscode-textLink-foreground)}
a:hover{color:var(--vscode-textLink-activeForeground)}
a:focus,input:focus,select:focus,textarea:focus{outline:1px solid -webkit-focus-ring-color;outline-offset:-1px}
code{font-family:var(--monaco-monospace-font);color:var(--vscode-textPreformat-foreground);background-color:var(--vscode-textPreformat-background);padding:1px 3px;border-radius:4px}
pre code{padding:0}
blockquote{background:var(--vscode-textBlockQuote-background);border-color:var(--vscode-textBlockQuote-border)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-corner{background-color:transparent}
::-webkit-scrollbar-thumb{background-color:var(--vscode-scrollbarSlider-background)}
::-webkit-scrollbar-thumb:hover{background-color:var(--vscode-scrollbarSlider-hoverBackground)}
`;

function escapeForScript(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c");
}

function bootstrapScript(handle: string, state: unknown, kind: string): string {
  return `(function(){
var HANDLE=${escapeForScript(handle)};var state=${escapeForScript(state)};var acquired=false;
function post(type,extra){var m={__qoriWebview:HANDLE,type:type};if(extra)for(var k in extra)m[k]=extra[k];window.parent.postMessage(m,"*");}
var api=Object.freeze({postMessage:function(message){post("message",{message:message});},getState:function(){return state;},setState:function(s){state=s;post("state",{state:s});return s;}});
window.acquireVsCodeApi=function(){if(acquired)throw new Error("An instance of the VS Code API has already been acquired");acquired=true;return api;};
function applyKind(kind){if(!document.body)return;document.body.classList.remove("vscode-light","vscode-dark","vscode-high-contrast");document.body.classList.add("vscode-"+kind);document.body.setAttribute("data-vscode-theme-kind","vscode-"+kind);}
window.addEventListener("message",function(e){var d=e.data;if(e.source===window.parent&&d&&d.__qoriTheme){e.stopImmediatePropagation();var root=document.documentElement;for(var k in d.__qoriTheme.vars)root.style.setProperty(k,d.__qoriTheme.vars[k]);applyKind(d.__qoriTheme.kind);}},true);
window.addEventListener("keydown",function(e){if(e.ctrlKey||e.metaKey||e.key==="F1"){post("keydown",{key:e.key,code:e.code,ctrlKey:e.ctrlKey,metaKey:e.metaKey,altKey:e.altKey,shiftKey:e.shiftKey});}},true);
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var href=a.getAttribute("href")||"";if(/^(https?:|mailto:)/i.test(href)){e.preventDefault();post("link",{href:href});}else if(/^command:/i.test(href)){e.preventDefault();post("command",{href:href});}},true);
document.addEventListener("DOMContentLoaded",function(){applyKind(${escapeForScript(kind)});});
post("ready");
})();`;
}

function rootStyle(theme: WebviewTheme): string {
  const declarations = Object.entries(theme.vars)
    .map(([name, value]) => `${name}:${value.replace(/[;{}<>]/g, "")}`)
    .join(";");
  return `:root{${declarations}}`;
}

/**
 * Lets the page's own CSP load `data:` fonts. Extensions ship icon fonts
 * inlined in their CSS (codicons) and VS Code renders them; fonts can't run
 * code, so this doesn't widen what the page can execute.
 */
export function allowDataFonts(html: string): string {
  return html.replace(
    /(<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*content\s*=\s*)(["'])([\s\S]*?)\2/gi,
    (match, prefix: string, quote: string, policy: string) => {
      const directives = policy.split(";").map((d) => d.trim());
      const font = directives.findIndex((d) => /^font-src\b/i.test(d));
      if (font >= 0) {
        if (/(^|\s)data:/i.test(directives[font])) return match;
        directives[font] += " data:";
      } else {
        const fallback = directives.find((d) => /^default-src\b/i.test(d));
        if (!fallback || /(^|\s)data:/i.test(fallback)) return match;
        directives.push(`font-src${fallback.slice("default-src".length)} data:`);
      }
      return `${prefix}${quote}${directives.filter(Boolean).join("; ")}${quote}`;
    }
  );
}

/**
 * Inject our bootstrap right after `<head>` so it runs before the page's own
 * Content-Security-Policy meta takes effect (VS Code injects it outside the
 * page; a meta CSP only applies to what follows it).
 */
export function buildWebviewDocument(
  html: string,
  options: { handle: string; state: unknown; theme: WebviewTheme; enableScripts: boolean }
): string {
  html = allowDataFonts(html);
  const injected =
    `<style id="_defaultStyles">${rootStyle(options.theme)}${DEFAULT_STYLES}</style>` +
    (options.enableScripts
      ? `<script>${bootstrapScript(options.handle, options.state, options.theme.kind)}</script>`
      : "");
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head)
    return (
      html.slice(0, head.index + head[0].length) +
      injected +
      html.slice(head.index + head[0].length)
    );
  const htmlTag = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${html.slice(0, at)}<head>${injected}</head>${html.slice(at)}`;
  }
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return `${html.slice(0, at)}<head>${injected}</head>${html.slice(at)}`;
  }
  return `<!DOCTYPE html><html><head>${injected}</head><body>${html}</body></html>`;
}

/** Sandbox flags: scripts only when the extension enabled them. */
export function sandboxFor(options: { enableScripts: boolean; enableForms: boolean }): string {
  const flags = ["allow-popups", "allow-downloads", "allow-modals"];
  if (options.enableScripts) flags.push("allow-scripts", "allow-pointer-lock");
  if (options.enableForms) flags.push("allow-forms");
  return flags.join(" ");
}
