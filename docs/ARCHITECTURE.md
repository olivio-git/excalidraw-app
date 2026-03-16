# Arquitectura y funcionalidades — Base Project

Documentación técnica resumida: qué está implementado, cómo se implementó, pendientes y extensibilidad.

---

## 1. Lo implementado (resumen técnico)

| Área            | Implementación                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Auth**        | Zustand store persistido (Tauri Store). Login/logout, `hasRole`/`hasPermission`. Guards en rutas.                                                            |
| **Tabs**        | Store con LRU, singleton/maxInstances por ruta, pin/unpin, reorder (dnd-kit). Sincronización URL ↔ store vía `TabRouter` + `useTabRouter`.                   |
| **Routing**     | `RouteRegistry` (Map por id). Rutas con `RouteConfig` (security, tabConfig, metadata). Búsqueda por keywords. Lazy components.                               |
| **Shell**       | Sidebar colapsable con panel switcher interno (Figma-style): header con icon-tabs, panels intercambiables (Explorer, Plugins). TitleBar + TabBar integrados. |
| **Plugins**     | `PluginManager`: register → activate/deactivate. API: `registerRoutes`, `registerSidebarSection`, `registerCommand`, `getAuthState`. Limpieza en deactivate. |
| **Storage**     | Adapter Zustand ↔ Tauri Store. Stores: auth, tabs, theme, appearance (archivos JSON separados).                                                              |
| **Apariencia**  | themeStore (light/dark/system) + appearanceStore (font, radius, highContrast, reduceAnimations). Persistidos.                                                |
| **Tab content** | `Activity` (visible/hidden) por tab; estado preservado. `TabContext` por tab.                                                                                |

---

## 2. Formas de implementación (patrones usados)

- **Estado global**: Zustand con `persist` + `createJSONStorage(tauriStorage)`. Sin EventBus.
- **Comunicación**:
  - **App ↔ Core**: stores (auth, tabs, theme, appearance).
  - **Plugins ↔ App**: API explícita (registro de rutas, sidebar, comandos); no hay pub/sub entre plugins y shell.
  - **Routing ↔ Tabs**: `RouteRegistry` + `useTabRouter` (efectos que sincronizan `location.pathname` ↔ `tab-store`).
- **Registros**: `RouteRegistry` (rutas), `PluginManager` (plugins + command handlers), array global `sidebarSections` en `plugin-api`.
- **UI**: React Router + componentes que leen stores; sidebar lee `getPluginSidebarSections()` (array actualizado al activar plugins).

---

## 3. Pendientes / lo que faltaría

| Pendiente                         | Descripción                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Command Palette UI**            | `showInCommandPalette` y `PluginManager.getCommands()`/`executeCommand` existen; no hay componente que muestre atajo (ej. Cmd+K) y ejecute comandos o abra rutas. |
| **Integración comandos en shell** | No hay menú/barra que liste comandos de plugins ni llame a `PluginManager.executeCommand(commandId)`.                                                             |
| **Navegación por comandos**       | Command palette podría usar `RouteRegistry.search()` y al elegir ruta abrir tab (usando `addTab` del store).                                                      |
| **Permisos en UI**                | `hasPermission`/`hasRole` existen; no hay HOC o guard por componente que oculte/deshabilite según permisos.                                                       |
| **Error boundaries**              | No hay error boundary global ni por tab para fallos en lazy components o plugins.                                                                                 |
| **Lifecycle de plugins**          | Sin hooks tipo `beforeNavigate` / `onTabClose` que los plugins puedan usar para limpiar o cancelar.                                                               |
| **Tests**                         | Sin tests unitarios/e2e referenciados en el repo.                                                                                                                 |

---

## 4. Extensibilidad

- **Nuevas pantallas**: Añadir ruta en `route-config` (o en un feature que registre en `RouteRegistry`) y, si aplica, entrada en sidebar.
- **Plugins**: Implementar `Plugin` (manifest + `activate(api)`). En `activate`: `registerRoutes`, `registerSidebarSection`, `registerCommand`. Desactivación limpia rutas, secciones y comandos.
- **Nuevos stores**: Crear store Zustand con `persist` y `createTauriStorage('nombre.json')` en `tauri-storage.ts`.
- **Sidebar**: Las secciones de plugins se leen de `getPluginSidebarSections()`; orden por `section.order`.
- **Comandos**: Cualquier módulo puede llamar `PluginManager.executeCommand(id)` cuando exista la UI (command palette); los plugins solo registran el handler.

Limitación actual: no hay forma estándar de que un plugin “reaccione” a eventos de la app (navegación, cierre de tab, etc.) salvo leyendo stores desde su propio código.

---

## 5. ¿Hace falta un EventBus?

**Estado actual**: No hay EventBus. Toda la comunicación es síncrona vía stores, registros y API de plugins.

**Cuándo el enfoque actual basta**

- Navegación y estado de tabs/URL.
- Preferencias de usuario (theme, appearance).
- Registro estático (rutas, comandos, sidebar) y ejecución de comandos bajo demanda.
- Apps con pocos actores que solo necesitan leer/escribir estado compartido.

**Cuándo un EventBus ayuda**

- Varios módulos o plugins deben reaccionar al mismo hecho sin conocerse (ej. “tab cerrada”, “navegación”, “usuario cambió”).
- Comandos o flujos que deben encadenar varios pasos en distintos lugares (analytics, logging, actualizar varias UIs).
- Desacoplar shell de plugins (ej. “onTabClose” para que plugins limpien recursos).
- Command palette u otras UIs que deban “avisar” a la app de que se eligió una acción (abrir ruta, ejecutar comando).

**Recomendación**

- Mantener el formato actual para estado y registro; no es obligatorio introducir EventBus ya.
- Introducir un **bus de eventos mínimo** (por ejemplo `emit('tab:closed', tabId)`, `emit('command:executed', commandId)`) si:
  - Se implementa command palette u otra UI que deba notificar “acción ejecutada”.
  - Se quieren hooks de lifecycle para plugins (ej. `onTabClose`).
  - Aparecen más consumidores que solo necesitan “reaccionar” a un hecho, sin leer todo el estado.

Implementación sugerida si se añade: módulo pequeño con `subscribe(event, handler)` y `emit(event, payload)`; opcionalmente tipado por evento. El shell y los plugins emitirían; command palette y plugins escucharían.

---

## 6. Referencia rápida de archivos clave

| Responsabilidad           | Archivo(s)                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Estado auth               | `core/auth/store/auth-store.ts`                                                                                                      |
| Estado tabs               | `core/tabs/store/tab-store.ts`                                                                                                       |
| Sincronización URL ↔ tabs | `core/routing/tab-router.tsx`                                                                                                        |
| Definición rutas          | `core/routing/route-config.ts`, `core/routing/types.ts`                                                                              |
| Registro rutas            | `core/routing/route-registry.ts`                                                                                                     |
| Plugins                   | `plugins/plugin-manager.ts`, `plugins/plugin-api.ts`, `plugins/types.ts`                                                             |
| Storage Tauri             | `core/storage/tauri-storage.ts`                                                                                                      |
| Shell + Sidebar           | `core/shell/Shell.tsx`, `core/shell/DiagramSidebar.tsx`, `core/shell/panels/ExplorerPanel.tsx`, `core/shell/panels/PluginsPanel.tsx` |
| Tab bar / contenido       | `core/tabs/components/TabBar.tsx`, `TabContent.tsx`                                                                                  |
| Tema / apariencia         | `stores/themeStore.ts`, `stores/appearanceStore.ts`                                                                                  |
