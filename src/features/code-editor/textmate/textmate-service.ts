import type { IGrammar, IOnigLib, IRawGrammar, IRawTheme, Registry } from "vscode-textmate";
import type { GrammarContribution } from "@/plugins/vscode/contributions";

/**
 * TextMate grammars contributed by extensions (`contributes.grammars`),
 * tokenized with vscode-textmate + Oniguruma (WebAssembly), the same engine
 * VS Code uses. Everything is loaded on first use.
 */

export interface GrammarSource {
  extensionId: string;
  contribution: GrammarContribution;
  /** Read a file of the contributing extension as text. */
  read: (path: string) => Promise<string>;
}

type Listener = () => void;

let onigLibPromise: Promise<IOnigLib> | null = null;

async function loadOnigLib(): Promise<IOnigLib> {
  const [oniguruma, wasm] = await Promise.all([
    import("vscode-oniguruma"),
    import("vscode-oniguruma/release/onig.wasm?url"),
  ]);
  const response = await fetch(wasm.default);
  await oniguruma.loadWASM(await response.arrayBuffer());
  return {
    createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
    createOnigString: (text: string) => new oniguruma.OnigString(text),
  };
}

export class TextMateService {
  private sources: GrammarSource[] = [];
  private registry: Registry | null = null;
  private registryPromise: Promise<Registry> | null = null;
  private grammars = new Map<string, Promise<IGrammar | null>>();
  private theme: IRawTheme | null = null;
  private themeVersion = 0;
  private listeners = new Set<Listener>();
  private languageIds = new Map<string, number>();
  private readonly onigLib: () => Promise<IOnigLib>;

  constructor(onigLib: () => Promise<IOnigLib> = () => (onigLibPromise ??= loadOnigLib())) {
    this.onigLib = onigLib;
  }

  /** Replace the available grammars (after installs/uninstalls). */
  setSources(sources: GrammarSource[]): void {
    this.sources = sources;
    this.registry?.dispose();
    this.registry = null;
    this.registryPromise = null;
    this.grammars.clear();
    this.emit();
  }

  hasGrammarFor(languageId: string): boolean {
    return this.sources.some((source) => source.contribution.language === languageId);
  }

  scopeNameFor(languageId: string): string | null {
    return (
      this.sources.find((s) => s.contribution.language === languageId)?.contribution.scopeName ??
      null
    );
  }

  setTheme(theme: IRawTheme): void {
    this.theme = theme;
    this.themeVersion++;
    this.registry?.setTheme(theme);
    this.emit();
  }

  getThemeVersion(): number {
    return this.themeVersion;
  }

  /** Color ids used in token metadata → CSS colors. */
  getColorMap(): string[] {
    return this.registry?.getColorMap() ?? [];
  }

  private languageNumber(languageId: string): number {
    let id = this.languageIds.get(languageId);
    if (id === undefined) {
      id = this.languageIds.size + 1;
      this.languageIds.set(languageId, id);
    }
    return id;
  }

  private async getRegistry(): Promise<Registry> {
    if (this.registry) return this.registry;
    this.registryPromise ??= (async () => {
      const { Registry, parseRawGrammar } = await import("vscode-textmate");
      const sources = this.sources;
      const registry = new Registry({
        onigLib: this.onigLib(),
        theme: this.theme ?? undefined,
        loadGrammar: async (scopeName): Promise<IRawGrammar | null> => {
          const source = sources.find((s) => s.contribution.scopeName === scopeName);
          if (!source) return null;
          try {
            const content = await source.read(source.contribution.path);
            return parseRawGrammar(content, source.contribution.path);
          } catch (error) {
            console.warn(`[textmate] Could not load grammar ${scopeName}`, error);
            return null;
          }
        },
        getInjections: (scopeName) =>
          sources
            .filter((s) => s.contribution.injectTo?.includes(scopeName))
            .map((s) => s.contribution.scopeName),
      });
      this.registry = registry;
      // The color map exists now; let the theme CSS catch up.
      this.emit();
      return registry;
    })();
    return this.registryPromise;
  }

  /** Grammar for a language, or null when no extension contributes one. */
  loadGrammar(languageId: string): Promise<IGrammar | null> {
    const cached = this.grammars.get(languageId);
    if (cached) return cached;
    const source = this.sources.find((s) => s.contribution.language === languageId);
    if (!source) return Promise.resolve(null);
    const promise = (async () => {
      const registry = await this.getRegistry();
      const embedded = Object.fromEntries(
        Object.entries(source.contribution.embeddedLanguages ?? {}).map(([scope, language]) => [
          scope,
          this.languageNumber(language),
        ])
      );
      return registry.loadGrammarWithEmbeddedLanguages(
        source.contribution.scopeName,
        this.languageNumber(languageId),
        embedded
      );
    })().catch((error) => {
      console.warn(`[textmate] Grammar for ${languageId} failed`, error);
      return null;
    });
    this.grammars.set(languageId, promise);
    return promise;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const textMateService = new TextMateService();
