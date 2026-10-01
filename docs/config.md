# Configuración en archivos (estilo vim / LazyVim)

QoriApp lee su configuración de archivos de texto. Guardas y el cambio se ve al
instante; un error se reporta (con la línea o la opción) y nunca rompe la app.

| Archivo                        | Para qué                                                   |
| ------------------------------ | ---------------------------------------------------------- |
| `~/.config/qori/config.toml`   | Opciones: apariencia, translucidez, editor, notas, Flow 3D |
| `~/.config/qori/keymap.toml`   | Atajos de teclado (`[[bind]]`)                             |
| `~/.config/qori/styles.css`    | CSS propio, cargado después del tema                       |
| `<proyecto>/.qori/config.toml` | Opciones del proyecto, encima de las del usuario           |

Comandos (Ctrl+Shift+P): **Preferencias: Abrir config.toml**, **… keymap.toml**,
**… styles.css**, **… configuración del proyecto**, **Recargar** y **Ver problemas**.
La primera vez se crea el archivo con todas las opciones comentadas.

Reglas:

- Orden: valores por defecto → usuario → proyecto.
- Opción desconocida o de tipo incorrecto: se avisa con su ruta (`appearance.opacity`) y se ignora; el resto se aplica.
- Número fuera de rango: se ajusta al límite y se avisa.
- Error de sintaxis (archivo a medio escribir): se mantiene la última versión válida de ese archivo.

## Translucidez y desenfoque

| `translucency` | macOS                                        | Windows                                                       | Linux                                             |
| -------------- | -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `none`         | opaca                                        | opaca                                                         | opaca                                             |
| `native`       | vibrancia (`sidebar`, `under-window`, `hud`) | Mica / Acrílico / Blur (Win 11; Acrílico/Blur también Win 10) | no disponible                                     |
| `transparent`  | transparente                                 | transparente                                                  | transparente; el desenfoque lo pone el compositor |
| `wallpaper`    | imagen desenfocada por la app                | igual                                                         | igual                                             |

En Linux Tauri no puede pedir efectos al compositor. Con `transparent` el blur
se activa en el compositor, por ejemplo:

- KDE Plasma: efecto «Blur» de KWin (o una regla de ventana para `qori`).
- Hyprland: `windowrulev2 = opacity 0.99 0.99, class:^(qori)$` y `decoration { blur { enabled = true } }`.
- GNOME: la extensión «Blur my Shell» (aplicaciones).

`wallpaper` funciona en todas partes y da el aspecto de Inkdrop sin depender del
sistema.

## Ejemplo: aspecto Inkdrop

```toml
[appearance]
theme = "dark"
translucency = "wallpaper"      # o "native" en macOS/Windows
wallpaper = "~/Imágenes/montaña.jpg"
wallpaper_dim = 0.45
blur = 32
opacity = 0.72
sidebar_opacity = 0.45
font_family = "Inter"
density = "comfortable"
accent = "#7c3aed"

[editor]
markdown = "source"             # Markdown como texto, como Inkdrop
font_family = "JetBrains Mono"
font_size = 15
line_height = 1.7

[notes]
sort = "updated"
pinned = ["README.md"]
```

## Vista «Notas»

Lista todas las notas `.md` del proyecto por fecha de modificación, con título,
extracto, cuaderno (carpeta), etiquetas y estado. Todo sale del front matter:

```markdown
---
title: Post del blog
tags: [CSS, diseño]
status: active # active | onhold | completed | dropped (o activo, en espera, completado, descartado)
---
```

Un clic muestra la vista previa y doble clic abre la nota.

## Editor de Markdown

```toml
[editor]
markdown = "code"   # rich (bloques) | source (formato al escribir) | code (texto plano)
```

Con `code`, los `.md` se abren en el mismo editor que `config.toml`: texto plano con números de
línea, colores y Vim; las líneas largas se ajustan al ancho. **Ctrl+K V** (o el botón «Vista
previa») abre al lado el documento formateado, que se actualiza mientras escribes: tablas, listas
de tareas, citas, código, enlaces a otros archivos e imágenes, incluidos diagramas `.excalidraw`.

## Modo Vim

```toml
[editor]
keymap = "vim"          # default | vim
markdown = "source"     # para escribir notas con Vim (el editor por bloques no lo admite)
content_width = "full"  # full | readable (columna centrada de lectura)
```

Es el mismo motor que usa Inkdrop (`@replit/codemirror-vim`): JavaScript puro, funciona igual en
Windows, macOS y Linux sin instalar Vim. Funciona en el editor de código y en el Markdown como texto:
modos normal/insertar/visual, movimientos y operadores, registros, macros, marcas, `/` y `:s`.

- `:w` guarda, `:q` cierra la pestaña, `:wq` / `:x` ambas cosas.
- `:qori <comando>` ejecuta cualquier comando de la app (los IDs salen en Ctrl+Shift+P).

Mapeos en `~/.config/qori/vimrc` (**Preferencias: Abrir vimrc**), se aplican al guardar:

```vim
let mapleader = " "
inoremap jk <Esc>
nnoremap <leader>w :w<CR>
nnoremap <leader>ff :qori workbench.action.openQuickOpen<CR>
nnoremap <leader>a :qori workbench.action.toggleAgent<CR>
```

Se admiten `let mapleader` y `map`/`nmap`/`imap`/`vmap`/`xmap` con sus versiones `noremap`.
Otras líneas (`set …`, funciones, plugins) se reportan como problema y se ignoran.

## keymap.toml

```toml
[[bind]]
key = "ctrl+alt+n"
command = "templates.new"

[[bind]]
key = "ctrl+shift+g"
command = "knowledgeGraph.open"
when = ""   # opcional
```

Estos atajos ganan sobre los de la app. Si quitas uno del archivo, vuelve el original.
