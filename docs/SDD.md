# SDD: excalidraw-app — Desktop Excalidraw Editor

> **Stack**: Tauri v2 · React 19 · Zustand · Tailwind v4 · pnpm
> **Base template**: [desktop-app-base](https://github.com/olivio-git/desktop-app-base)
> **Dependencia clave**: `@excalidraw/excalidraw 0.18.0`

---

## Visión general

App desktop para editar diagramas Excalidraw (`.excalidraw`) con una UI tipo editor creativo (Figma-style, no VSCode):

- Tabs = documentos abiertos
- Sidebar con panel switcher interno (tabs en el header del sidebar, estilo Figma)
- Guardado automático en disco con debounce
- Soporte multi-diagrama simultáneo

---

## Decisiones de Arquitectura

### 1. Tabs como documentos

- Cada tab abierto = un archivo `.excalidraw`
- `tab.routeId = "diagram"` para todos los diagramas
- `tab.instanceId = filePath` (ruta absoluta del archivo, o uuid para nuevos sin guardar)
- `tab.path = "/diagram"` — todos comparten el mismo path de URL
- El sistema de tabs del template ya evita duplicados por `(path + instanceId)` via `findTabByPath(path, instanceId)` ✓
- El componente `DiagramCanvas` obtiene su instanceId con:
  ```ts
  const { tabId } = useTabContext();
  const instanceId = useTabStore((s) => s.getTab(tabId))?.instanceId;
  ```

### 2. Diagram Store (Zustand, sin persistencia)

Store separado del tab-store. Los elementos Excalidraw son demasiado grandes para `tauri-plugin-store`.

```
Map: Record<instanceId, DiagramState>

DiagramState = {
  elements: ExcalidrawElement[]
  appState: Partial<AppState>
  isDirty: boolean
  filePath: string | null   // null = nuevo sin guardar
}
```

- `onChange` de Excalidraw → debounce 1000ms → `updateDiagram()` → auto-save al disco
- Al cerrar tab: confirmar si `isDirty` antes de remover del store

### 3. Sidebar con panel switcher interno (Figma-style)

Reemplaza el `AppSidebar` de navegación. El nuevo sidebar tiene:

#### Layout visual

```
┌──────────────────┐
│ [📁] [⬡]    [+] │  ← SidebarHeader: icon tabs + acción contextual
├──────────────────┤
│  panel activo    │  ← SidebarBody: renderiza el panel seleccionado
│  (file tree o    │
│   plugin panel)  │
├──────────────────┤
│ [≡] [◑]         │  ← SidebarFooter: settings, theme
└──────────────────┘
```

#### Iconos (Lucide)

- `Files` → panel explorador de archivos
- `Blocks` → panel de secciones de plugins
- Footer: `SlidersHorizontal` (settings), `Sun`/`Moon` (theme)

#### Panel 0 — Explorador de archivos (`ExplorerPanel`)

- **Workspace folder** configurable (guardado en `workspaceStore` con `tauri-plugin-store`)
- Lee el directorio con `readDir()` de `@tauri-apps/plugin-fs`
- Watcher con `watch()` para auto-refrescar al crear/eliminar archivos externos
- Click en archivo → `addTab({ routeId: "diagram", instanceId: filePath, ... })`
- Botón "+" en header → crea archivo vacío `.excalidraw`, abre tab
- Context menu (right-click): Renombrar, Eliminar, Duplicar
- Soporte de subcarpetas (árbol colapsable)

#### Panel 1 — Plugins (`PluginsPanel`)

- Renderiza las `SidebarSection[]` registradas por plugins (sistema existente)
- Solo visible si hay plugins con secciones registradas

#### Estado del switcher

```ts
type SidebarPanel = "explorer" | "plugins";
// en workspaceStore o estado local del sidebar
const [activePanel, setActivePanel] = useState<SidebarPanel>("explorer");
```

#### Sin modo compacto de íconos

El sidebar es colapsable (via `SidebarTrigger` existente en TitleBar). No hay modo "solo íconos" — se colapsa o se muestra completo.

### 4. Auth simplificado

Esta app no necesita sistema de autenticación.

- Eliminar `AuthGuard`, `PublicGuard`, ruta `/login` de `App.tsx`
- Renderizar `Shell` directamente sin guards
- El `auth-store` puede mantenerse intacto (no causa daño)

### 5. Route del diagrama

Agregar en `route-config.ts`:

```ts
{
  id: "diagram",
  path: "/diagram",
  name: "Diagram",
  type: "protected",
  icon: PencilLine,
  component: lazy(() => import("@/features/diagram/DiagramCanvas")),
  tabConfig: { singleton: false, closable: true },
  showSidebar: false,
  showInCommandPalette: false,
}
```

`TabContent` ya renderiza `route.component` automáticamente por cada tab ✓

### 6. Tauri plugins adicionales (no están en el template)

| Plugin                | Uso                                        |
| --------------------- | ------------------------------------------ |
| `tauri-plugin-fs`     | Leer/escribir/watch archivos `.excalidraw` |
| `tauri-plugin-dialog` | Diálogos "Abrir carpeta" y "Guardar como"  |

npm: `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`

---

## Mapa de archivos

### Crear (archivos nuevos)

```
src/
├── core/diagram/
│   ├── types.ts                           ← DiagramState, DiagramStore types
│   ├── store/
│   │   └── diagram-store.ts               ← Zustand store (elementos por instanceId)
│   ├── hooks/
│   │   └── use-diagram.ts                 ← hook: useDiagram(instanceId)
│   └── services/
│       └── diagram-file.service.ts        ← leer/escribir .excalidraw via Tauri fs
├── features/diagram/
│   ├── DiagramCanvas.tsx                  ← componente principal (Excalidraw wrapper)
│   └── WelcomeScreen.tsx                  ← pantalla cuando no hay tabs abiertos
├── core/shell/
│   ├── DiagramSidebar.tsx                 ← sidebar con panel switcher interno (reemplaza Sidebar.tsx)
│   ├── panels/
│   │   ├── ExplorerPanel.tsx              ← árbol de archivos .excalidraw
│   │   └── PluginsPanel.tsx               ← secciones de plugins (sistema existente)
│   └── useFileWatcher.ts                  ← hook wrapper de watch() de plugin-fs
└── stores/
    └── workspaceStore.ts                  ← carpeta workspace (Zustand + persist)
```

### Modificar

| Archivo                                  | Cambio                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src-tauri/Cargo.toml`                   | Agregar `tauri-plugin-fs = "2"`, `tauri-plugin-dialog = "2"`                                 |
| `src-tauri/src/lib.rs`                   | Registrar `.plugin(tauri_plugin_fs::init()).plugin(tauri_plugin_dialog::init())`             |
| `src-tauri/capabilities/default.json`    | Agregar permisos: `fs:read-all`, `fs:write-all`, `fs:watch`, `dialog:open`, `dialog:save`    |
| `src/core/routing/route-config.ts`       | Agregar ruta `"diagram"`, simplificar `protectedRoutes`                                      |
| `src/features/_registry.ts`              | Registrar ruta `diagram`                                                                     |
| `src/App.tsx`                            | Quitar auth guards, ruta `/login`, renderizar `Shell` directo                                |
| `src/core/shell/Shell.tsx`               | Reemplazar `<AppSidebar>` por `<DiagramSidebar>` (no pasa `routes` — el sidebar es autónomo) |
| `src/features/settings/SettingsPage.tsx` | Agregar sección "Workspace" con selector de carpeta                                          |

### Eliminar

```
src/features/auth/LoginPage.tsx           ← no se usa
src/features/home/HomePage.tsx            ← reemplazar por WelcomeScreen
src/plugins/internal/example-plugin/     ← limpiar
src/plugins/internal/alerts-plugin/      ← limpiar
```

---

## Plan de implementación

### Fase 1 — Tauri + dependencias

1. `Cargo.toml`: agregar `tauri-plugin-fs = "2"` y `tauri-plugin-dialog = "2"`
2. `src-tauri/src/lib.rs`: registrar plugins
3. `src-tauri/capabilities/default.json`: agregar permisos fs y dialog
4. `pnpm add @tauri-apps/plugin-fs @tauri-apps/plugin-dialog`

### Fase 2 — Diagram Store + Types

5. **`src/core/diagram/types.ts`**:

   ```ts
   import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
   import type { AppState } from "@excalidraw/excalidraw/types/types";

   export interface DiagramState {
     elements: readonly ExcalidrawElement[];
     appState: Partial<AppState>;
     isDirty: boolean;
     filePath: string | null;
   }
   ```

6. **`src/core/diagram/store/diagram-store.ts`**: Zustand store con `Map<instanceId, DiagramState>`
   - Acciones: `loadDiagram(instanceId, filePath)`, `updateDiagram(instanceId, elements, appState)`, `saveDiagram(instanceId)`, `closeDiagram(instanceId)`
   - **Sin** `persist` middleware (archivos viven en disco)

7. **`src/core/diagram/services/diagram-file.service.ts`**:
   - `readDiagram(filePath)` → `readTextFile()` de plugin-fs → parse JSON
   - `writeDiagram(filePath, data)` → `writeTextFile()` con JSON.stringify
   - `createNewDiagram(dir, name)` → crea archivo vacío `.excalidraw`, retorna filePath

### Fase 3 — DiagramCanvas

8. **`src/features/diagram/DiagramCanvas.tsx`**:
   - Obtener `instanceId` via `useTabContext()` → `useTabStore`
   - Al montar: `loadDiagram(instanceId, filePath)`
   - `onChange` → debounce 1000ms → `updateDiagram()` + auto-save
   - Pasar `theme` del `themeStore` a `<Excalidraw theme={...}>`
   - Usar `React.memo` para evitar re-mounts (el `<Activity>` del template ya preserva el canvas ✓)

9. Registrar ruta `"diagram"` en `route-config.ts` y `_registry.ts`

### Fase 4 — DiagramSidebar (panel switcher + explorador)

10. **`src/stores/workspaceStore.ts`**: Zustand persist → `workspaceDir: string | null`

11. **`src/core/shell/DiagramSidebar.tsx`**:
    - Header: tabs de íconos (`Files`, `Blocks`) + acción contextual del panel activo
    - `activePanel` state local (`"explorer"` por default)
    - Renderiza `<ExplorerPanel>` o `<PluginsPanel>` según panel activo
    - Footer: botón settings (abre tab `/settings`), botón theme toggle
    - **Sin modo compacto de íconos** — solo colapsable vía trigger existente
    - **No recibe `routes` como prop** — es autónomo

12. **`src/core/shell/panels/ExplorerPanel.tsx`**:
    - Sin `workspaceDir` → pantalla "Abrir carpeta" con botón (dialog)
    - `readDir(workspaceDir)` al montar + watcher
    - Filtrar solo `.excalidraw` y subdirectorios
    - Botón "+" en header del DiagramSidebar → nuevo diagrama
    - Click en archivo → `addTab(...)`
    - Context menu: Renombrar, Eliminar, Duplicar

13. **`src/core/shell/panels/PluginsPanel.tsx`**:
    - Consume `usePluginSidebarResources()` (hook existente)
    - Si no hay secciones: mensaje vacío
    - El tab `Blocks` en el header solo aparece si hay plugins con secciones

14. **`src/core/shell/useFileWatcher.ts`**: wrapper de `watch()` de `@tauri-apps/plugin-fs`

### Fase 5 — Limpieza + Simplificación

13. Simplificar `App.tsx`: quitar auth, ruta `/login`
14. Actualizar `Shell.tsx`: usar `DiagramSidebar`
15. `SettingsPage`: agregar selector de workspace folder
16. Eliminar plugins de ejemplo

### Fase 6 — Polish

17. **Dirty indicator**: `isDirty=true` en `updateDiagram`, `false` en `saveDiagram`
    - `updateTab(tabId, { title: isDirty ? filename + " •" : filename })`
18. **Keybinding `Ctrl+S`** → save active diagram (usar keybinding-service existente)
19. **Keybinding `Ctrl+N`** → nuevo diagrama en workspace dir actual
20. **WelcomeScreen** cuando no hay tabs: instrucciones de apertura

---

## Componentes compartidos — regla de uso

Siempre usar los componentes de `@/shared/` antes de escribir HTML nativo.

| Necesidad                  | Componente                                                                   |
| -------------------------- | ---------------------------------------------------------------------------- |
| Botón (cualquier variante) | `Button` (`variant="ghost"`, `size="icon"`, etc.) — **nunca `<button>` raw** |
| Área scrolleable           | `ScrollArea` — **nunca `overflow-y-auto` nativo**                            |
| Ícono con tooltip          | `TooltipWrapper` — **nunca `title` attr en botones de ícono**                |
| Toggle de tema             | `ThemeToggle` — ya implementado, no reinventar                               |
| Dropdown menu              | `DropdownMenu` + primitivos de `@/shared/components/ui/dropdown-menu`        |
| Context menu               | `ContextMenu` + primitivos de `@/shared/components/ui/context-menu`          |

---

## Gotchas y notas técnicas

- **React 19 + Excalidraw**: hay peer warnings de radix antiguo pero React 19 es backwards compatible — funciona sin cambios.
- **esbuild**: requiere `onlyBuiltDependencies: ["esbuild"]` en `package.json` (ya configurado).
- **Tab-router con `/diagram`**: múltiples tabs con el mismo `path` puede confundir el URL→Tab sync. Mitigación: en `tab-router.tsx`, al encontrar la ruta "diagram", hacer skip del URL sync o usar `findTabByPath(path, instanceId)` con el instanceId activo.
- **Tauri v2 capabilities**: permisos explícitos requeridos en `src-tauri/capabilities/default.json`. Sin ellos, las llamadas a fs/dialog fallan silenciosamente.
- **Tipos de Excalidraw**: importar de `@excalidraw/excalidraw/types/...` — no están en el export principal.
- **Cross-platform paths**: usar `@tauri-apps/api/path` (`join`, `resolve`) para construir rutas correctamente en Linux/macOS/Windows.
- **DiagramCanvas como `React.memo`**: el `<Activity mode="hidden">` del template preserva el canvas en memoria al cambiar de tab, pero `memo` evita re-renders innecesarios del wrapper.
