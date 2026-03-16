# desktop-app-base

A production-ready Tauri + React template for building VSCode-style desktop applications. Ships with a tab system, plugin architecture, keybinding engine, sidebar, auth, and persistent storage — all wired together and ready to extend.

## What's included

| System                  | Description                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Tab system**          | Multi-tab UI with LRU eviction, pin/unpin, drag-to-reorder (dnd-kit), singleton/maxInstances constraints, URL ↔ tab sync |
| **Plugin architecture** | Register routes, sidebar sections, commands, keybindings, and context keys from isolated plugin modules                  |
| **Keybinding engine**   | Chord sequences (e.g. `Ctrl+K Ctrl+S`), `when` context expressions, per-source priority (core → user → plugin)           |
| **Routing**             | `RouteRegistry` with lazy components, security guards (roles/permissions), tab config per route                          |
| **Shell**               | Collapsible sidebar with plugin-registered sections, custom TitleBar (frameless window), command palette foundation      |
| **Auth**                | Zustand store with login/logout, `hasRole`/`hasPermission`, route guards                                                 |
| **Persistent storage**  | Zustand `persist` adapter over Tauri Store — tabs, auth, theme, and appearance survive restarts                          |
| **Theming**             | Light/dark/system theme + appearance config (font size, border radius, high contrast, reduce animations)                 |

## Tech stack

- [Tauri v2](https://tauri.app) — desktop runtime
- [React 19](https://react.dev) — UI with `Activity` for hidden tab preservation
- [TypeScript](https://www.typescriptlang.org)
- [Zustand](https://zustand-demo.pmnd.rs) — state management
- [Tailwind CSS v4](https://tailwindcss.com)
- [Radix UI](https://www.radix-ui.com) — accessible primitives
- [React Router v7](https://reactrouter.com)
- [dnd-kit](https://dndkit.com) — drag and drop
- [Vite](https://vite.dev) + [pnpm](https://pnpm.io)

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [pnpm](https://pnpm.io) — `npm install -g pnpm`
- [Rust](https://rustup.rs) — required by Tauri
- Tauri prerequisites for your OS: [Linux](https://tauri.app/start/prerequisites/#linux) / [macOS](https://tauri.app/start/prerequisites/#macos) / [Windows](https://tauri.app/start/prerequisites/#windows)

### Install and run

```bash
git clone https://github.com/olivio-git/desktop-app-base
cd desktop-app-base
pnpm install

# Web dev mode (no Tauri, faster iteration)
pnpm dev

# Full desktop app
pnpm tauri:dev
```

### Build for production

```bash
pnpm tauri:build
```

## Project structure

```
src/
├── core/               # Framework systems (not app-specific)
│   ├── auth/           # Auth store, types, hooks
│   ├── keybindings/    # Keybinding registry, chord buffer, context keys
│   ├── routing/        # RouteRegistry, TabRouter, route types
│   ├── shell/          # Shell, Sidebar, TitleBar
│   ├── storage/        # Tauri Store adapter for Zustand
│   └── tabs/           # Tab store, TabBar, TabContent, hooks
├── features/           # App pages (home, settings, auth, plugins)
├── plugins/            # Plugin system
│   ├── plugin-api.ts   # PluginAPI factory
│   ├── plugin-manager.ts
│   ├── types.ts
│   ├── sdk/            # SDK for building plugins
│   └── internal/       # Built-in plugins (example, alerts)
├── shared/             # UI components, error boundaries, utilities
└── stores/             # Global stores (theme, appearance)

src-tauri/              # Rust backend (Tauri configuration, capabilities)
docs/
└── ARCHITECTURE.md     # In-depth technical reference
```

## Adding a new page

1. Create your component under `src/features/your-feature/YourPage.tsx`
2. Register the route in `src/core/routing/route-config.ts`:

```ts
{
  id: "your-feature",
  name: "Your Feature",
  path: "/your-feature",
  component: lazy(() => import("@/features/your-feature/YourPage")),
  icon: SomeIcon,
  tabConfig: { closable: true },
}
```

3. Add it to the sidebar by including it in a `SidebarSection`.

## Writing a plugin

Plugins are self-contained modules that extend the app via a stable API.

```ts
// src/plugins/internal/my-plugin/index.ts
import type { Plugin } from "@/plugins/types";
import { lazy } from "react";
import { MyIcon } from "lucide-react";

export const myPlugin: Plugin = {
  manifest: {
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
  },

  activate(api) {
    api.registerRoutes([
      {
        id: "my-plugin.main",
        name: "My Plugin",
        path: "/my-plugin",
        component: lazy(() => import("./MyPage")),
        icon: MyIcon,
        tabConfig: { closable: true },
      },
    ]);

    api.registerSidebarSection({
      id: "my-plugin.section",
      label: "My Plugin",
      order: 10,
      icon: MyIcon,
      items: [RouteRegistry.getRoute("my-plugin.main")!],
    });

    api.registerCommand("my-plugin.doSomething", () => {
      console.log("command executed");
    });

    api.registerKeybinding({
      commandId: "my-plugin.doSomething",
      key: "Ctrl+Shift+M",
    });
  },

  deactivate() {
    // cleanup is handled automatically for routes, sidebar, keybindings
  },
};
```

Then load it in `src/App.tsx`:

```ts
PluginManager.register(myPlugin);
```

## Keybinding system

Supports single keys and chord sequences. Bindings can have `when` conditions using context keys.

```ts
api.registerKeybinding({
  commandId: "my-plugin.action",
  key: "Ctrl+K Ctrl+M", // chord: press Ctrl+K, then Ctrl+M
  when: "isAuthenticated", // optional context expression
});

// Set a context key to control when bindings are active
api.registerContext("myPlugin.panelOpen", true);
```

Priority order: `user > plugin > core`. User bindings always win.

## Using this as a template

Click **"Use this template"** on GitHub to create a new repo with this codebase as the starting point.

To pull future updates from this template into your fork:

```bash
git remote add upstream https://github.com/olivio-git/desktop-app-base
git fetch upstream
git merge upstream/main
```

Resolve any conflicts in areas where you've customized the shell, then commit.

## Architecture reference

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a detailed breakdown of every system, design decisions, known limitations, and extensibility guidance.

## License

MIT — see [LICENSE](LICENSE).
