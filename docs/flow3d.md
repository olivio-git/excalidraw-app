# Flow 3D

Plugin interno para diseñar flujos (al estilo n8n) en 3D, recorrerlos con la cámara
y reproducirlos paso a paso. Vive en `src/features/flow3d/` y se registra como plugin
interno (`src/plugins/internal/flow3d`).

## Uso

- **Crear**: comando `Flow 3D: Nuevo flujo`, o un archivo `.flow3d` nuevo desde el
  Explorador (arranca con un flujo de ejemplo).
- **Editar**: la paleta de la izquierda añade pasos (si hay uno seleccionado, el nuevo
  se añade después y queda conectado). Arrastra una tarjeta para moverla en el plano,
  `Shift` + arrastrar cambia su altura, arrastra el punto derecho de un paso hasta otro
  para conectarlos. El inspector de la derecha edita nombre, tipo, descripción,
  duración, color, rama de una condición y el archivo vinculado.
- **Reproducir**: `Espacio` o el botón play. La línea de tiempo permite saltar a
  cualquier instante; la velocidad va de 0.5× a 2×. «Seguir» mueve la cámara al paso
  en ejecución. «Planta» muestra el flujo desde arriba; `F` encuadra.
- **Atajos**: `Supr` borra, `Ctrl+Z` / `Ctrl+Shift+Z` deshacer/rehacer, `Esc`
  deselecciona. Doble clic en un paso lo enfoca y abre su archivo vinculado.

## Integración

- **Excalidraw**: `Flow 3D: Ver diagrama de Excalidraw en 3D` convierte el diagrama
  activo (rectángulos, rombos → condiciones, elipses; flechas enlazadas o cercanas;
  textos como etiquetas) en `<diagrama>.flow3d` y lo abre al lado. El botón de
  sincronizar vuelve a convertir desde el dibujo conservando lo editado en 3D
  (descripciones, enlaces, duraciones, altura).
- **Notas**: el bloque «Insertar diagrama» de las notas acepta `.flow3d` y muestra el
  flujo reproducible dentro de la nota (se actualiza al cambiar el archivo).
- **Enlaces**: cada paso puede vincular una nota, un markdown, un diagrama u otro flujo;
  se abre al lado desde el inspector.

## Formato `.flow3d`

JSON legible, pensado para editarse también a mano:

```json
{
  "type": "qori-flow3d",
  "version": 1,
  "name": "Pedidos",
  "nodes": [
    { "id": "webhook", "kind": "trigger", "label": "Webhook", "position": [0, 0, 0] },
    {
      "id": "check",
      "kind": "condition",
      "label": "¿Válido?",
      "position": [4.5, 0, 0],
      "branch": "e2"
    },
    {
      "id": "ok",
      "kind": "action",
      "label": "Guardar",
      "position": [9, 0, -1.6],
      "link": "/@workspace/notas.md"
    }
  ],
  "edges": [
    { "id": "e1", "from": "webhook", "to": "check" },
    { "id": "e2", "from": "check", "to": "ok", "label": "sí" }
  ]
}
```

Tipos: `trigger`, `action`, `condition`, `transform`, `ai`, `output`, `note` (las notas
no se ejecutan). Un archivo con tipos desconocidos, ids repetidos o conexiones rotas
se abre igualmente: se corrige al cargarlo.

## Motor y rendimiento

- **Three.js + React Three Fiber + drei**. Se carga bajo demanda: la app base no
  incluye Three.js hasta abrir un flujo.
- **Render bajo demanda**: en reposo no se dibuja nada; solo se anima mientras se
  reproduce, se arrastra o se mueve la cámara. Las pestañas ocultas no renderizan.
- **Sin renders de React por frame**: la reproducción avanza un reloj mutable y cada
  nodo/conexión se anima desde `useFrame` mutando refs.
- **Línea de tiempo precalculada** (`timeline.ts`): cuándo corre cada paso y cuándo
  viaja cada paquete; buscar en el tiempo es gratis.
- **Instancing**: todos los paquetes de datos son dos `InstancedMesh` (núcleo y
  halo), una llamada de dibujo cada uno. Las geometrías de las tarjetas se comparten.
- **Texto SDF** (troika) con Inter local (WOFF), sin descargas externas.
