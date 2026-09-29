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
- **Atajos**: `Tab` inserta un paso conectado al seleccionado (buscador), `Ctrl+F`
  busca un paso por nombre, `Supr` borra, `Ctrl+C` / `Ctrl+V` / `Ctrl+D`
  copiar/pegar/duplicar, `Ctrl+A` todo, `Ctrl+G` agrupar (`Ctrl+Shift+G` desagrupar),
  `M` minimapa, `Ctrl+Z` / `Ctrl+Shift+Z` deshacer/rehacer, `Esc` deselecciona. Doble
  clic en un paso lo enfoca y abre su archivo vinculado.
- **Selección múltiple**: `Shift` + arrastrar sobre el fondo dibuja una caja;
  `Ctrl` + clic suma o quita pasos. Arrastrar cualquiera mueve todos.
- **Grupos (subflujos)**: agrupa la selección, ponle nombre y color, súbelo de
  nivel (altura) para apilar subflujos en 3D, y pliégalo: se ve como un solo bloque
  que se ilumina mientras corre cualquiera de sus pasos. Doble clic lo despliega.
- **Minimapa**: vista en planta de todo el flujo; clic para llevar la cámara ahí.
- **Exportar**: imagen PNG de la vista, vídeo WebM de la reproducción (se graba del
  lienzo) o diagrama de Excalidraw.

## Ejecución real

El conmutador **Simular / Ejecutar** de la barra elige entre la animación de siempre
y correr el flujo de verdad. En la pestaña **Ejecución** del inspector cada paso
elige qué hace:

| Tipo                | Qué hace                                                | Salida                           |
| ------------------- | ------------------------------------------------------- | -------------------------------- |
| Datos iniciales     | JSON con el que arranca el disparador                   | el JSON                          |
| Petición HTTP       | GET/POST/PUT/PATCH/DELETE a una URL, cabeceras y cuerpo | `{ status, headers, body }`      |
| Comando de terminal | Ejecuta en el shell (carpeta y límite de tiempo)        | `{ stdout, stderr, code, json }` |
| Comando de la app   | Lanza cualquier comando registrado                      | la entrada                       |
| Llamada a IA        | Usa el proveedor de IA activo (Ajustes → IA)            | el texto (o JSON)                |
| Escribir nota       | Escribe o añade a un archivo (relativo al flujo)        | `{ path, bytes }`                |
| Plantilla JSON      | Construye datos nuevos                                  | el JSON                          |
| Condición           | Compara un campo (`==`, `>`, `contiene`, `existe`…)     | sale por «sí» o «no»             |

- **Datos entre pasos**: cada paso recibe la salida del anterior. En cualquier texto
  se puede escribir `{{input.campo}}` o `{{steps.<id>.output.campo}}` (el id aparece
  en la pestaña Paso). En JSON, `"{{input}}"` inserta el valor tal cual.
- **Datos**: la pestaña Datos del inspector muestra entrada, salida, error y tiempo
  de cada paso de la última ejecución.
- **Estados reales**: los paquetes y los estados de la escena siguen la ejecución de
  verdad; un paso que falla se marca en rojo, su rama se detiene y el resto sigue.
  Después se puede repetir la ejecución grabada con la línea de tiempo.
- **Confirmación**: antes de ejecutar se listan los pasos con efectos fuera del flujo
  (red, terminal, archivos, IA; un GET no cuenta). Se puede cancelar en cualquier
  momento.
- Los pasos sin tipo solo se simulan (pasan los datos tal cual).

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
- **Excalidraw en los dos sentidos**: «Exportar → Diagrama de Excalidraw» escribe el
  flujo como dibujo (formas enlazadas con las flechas, mismos ids) y lo deja como
  origen: edita el dibujo y sincroniza para traer los cambios sin perder lo del 3D
  (configuración de ejecución, grupos, descripciones, alturas).
- **Enlaces a un paso**: `pedidos.flow3d#validar` (id o nombre del paso) abre el flujo
  con ese paso enfocado. En una nota, el flujo incrustado tiene «Empezar en» para
  mostrarlo desde un paso concreto.
- **Referencias**: el panel Referencias indexa los `.flow3d`: qué notas o flujos
  apuntan a un flujo (o a uno de sus pasos) y a qué archivos enlazan sus pasos.

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

Cada paso puede llevar `config` (ejecución, p. ej. `{ "type": "command", "command":
"git status" }`) y `group`; los grupos van en `groups: [{ "id", "label", "color",
"collapsed" }]`.

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
