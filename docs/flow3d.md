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
- **Repetir y reintentar**: cualquier paso puede repetirse por cada elemento de una
  lista (`body.items`, o `input`), con `{{item}}` e `{{index}}`; su salida es la lista
  de resultados. También puede reintentarse N veces con una espera entre intentos.
- **Secretos**: el botón de la llave guarda valores para `{{secrets.NOMBRE}}` en la
  carpeta de datos de la app (no en el `.flow3d`). Se ocultan como `••••` en los datos
  de cada ejecución y en el historial. No están cifrados. Si un paso escribe un
  secreto en una nota, la nota sí lo contiene.
- **Historial**: las últimas 20 ejecuciones de cada flujo (manuales y automáticas) se
  guardan en los datos de la app. Desde el botón del reloj se puede ver y repetir una
  ejecución pasada; en la pestaña Datos, «Comparar con otra ejecución» muestra la
  salida de ese paso entonces y si cambió.
- **IA**: «Crear o rehacer con IA» (varita) propone el flujo completo a partir de una
  descripción; en un paso que falló, «Diagnosticar con IA» explica la causa probable y
  qué cambiar. El chat tiene `flow3d_create`, `flow3d_read` (incluye la última
  ejecución) y `flow3d_update`.

## Automatización

Un disparador puede ser **Horario** (cada N minutos, o todos los días a una hora) o
**Cambio de archivo** (un archivo o carpeta relativo al flujo). Para que el flujo se
ejecute solo hay que activar «Automatización» en la pestaña Ejecución del
disparador: la app pide confirmación una vez, listando los pasos con efectos, porque
desde ese momento se ejecutan sin preguntar.

- Funciona mientras la app está abierta con esa carpeta de trabajo. Si el flujo está
  abierto, se ve ejecutarse en su pestaña; si no, corre en segundo plano.
- Un disparador de archivos ignora los cambios que hace el propio flujo durante su
  ejecución y los 2 segundos siguientes (un flujo que escribe en la carpeta que vigila
  no entra en bucle). No se lanza dos veces a la vez.
- Comandos: «Flow 3D: Ver automatizaciones activas» y «Pausar / reanudar
  automatizaciones». Si un flujo automático falla, aparece un aviso.

## Aspecto

El botón de destellos activa los **efectos**: luz de estudio (reflejos suaves, sin
descargar mapas HDR), una sombra difusa bajo cada tarjeta que se atenúa con la altura
y brillo (bloom) en los paquetes y en los pasos que se ejecutan. La elección se
recuerda. Los flujos incrustados en notas van sin efectos para ser ligeros.

## Diagramas visuales 3D

Un flujo también es un diagrama 3D libre: redes neuronales, arquitecturas, matrices, torres…

- **Tipo `element`**: una pieza visual que no ejecuta nada (neurona, servidor, bloque).
- **Formas** (`style.shape`): `card` (por defecto), `box`, `sphere`, `cylinder`, `cone`, `capsule`,
  `torus`, `diamond`, `gem`, `disc`, `plane`. Con `size` (`[ancho, alto, fondo]` o una escala),
  `icon` (emoji o texto corto), `image` (ruta del proyecto o URL pintada sobre la forma),
  `opacity`, `label` (`auto`/`above`/`below`/`inside`/`hidden`) y `glow`.
- **Espacio**: x = izquierda→derecha, y = altura, z = fondo. Cada nodo puede tener `position`.
- **Distribuciones** (al crear con el agente o la API): `auto` (flujo izquierda→derecha),
  `layers` (columnas verticales por `layer`, ideal para redes neuronales), `grid` (matriz de
  `columns`; `layer` empuja capas hacia el fondo), `radial` (anillo con un centro opcional) y
  `manual` (respeta las posiciones). Si todos los nodos traen posición, se respetan.
- **Conexiones** (`edge.style`): `color`, `dashed`, `width`, `curve` (`auto`/`straight`/`smooth`),
  `arrow`. Entre formas que no son tarjetas van rectas de superficie a superficie.
- **Inspector**: la ventana de propiedades se arrastra por el título, se redimensiona desde las
  esquinas, se maximiza y recuerda su sitio (doble clic en el título la devuelve a la derecha).
  La sección **Apariencia** edita forma, color, tamaño, posición, icono, imagen, opacidad y brillo.
- **Plantillas**: «Red neuronal (3D)», «Arquitectura en capas (3D)» y «Torre de bloques (3D)».

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
