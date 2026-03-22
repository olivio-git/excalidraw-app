import "i18next";

// Namespace type — keeps namespace name checking without strict key typing.
// Strict key typing (typeof en_*) breaks interpolation overloads in i18next v23
// because TypeScript cannot resolve t(key, { count }) against the typed overloads.
// Trade-off: namespace autocomplete ✅, key-level autocomplete ❌.
type NS = Record<string, unknown>;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: NS;
      settings: NS;
      explorer: NS;
      tabs: NS;
      commands: NS;
    };
  }
}
