# Búsqueda, grafo y plantillas

## Buscar en todos los archivos (`Ctrl+Shift+F`)

Vista «Buscar» de la barra lateral. Busca en lo que una persona lee en cada archivo:

| Archivo        | Se busca en                                                    | Al abrir un resultado |
| -------------- | -------------------------------------------------------------- | --------------------- |
| `.note`        | cada bloque                                                    | salta al bloque       |
| `.md`          | cada línea (fuera de bloques de código se sigue el encabezado) | salta al encabezado   |
| `.excalidraw`  | los textos del dibujo                                          | selecciona la forma   |
| `.flow3d`      | nombre, descripción y configuración de cada paso               | enfoca el paso        |
| código y texto | cada línea                                                     | abre el archivo       |

Opciones: distinguir mayúsculas, palabra completa y expresión regular. Ignora
`node_modules`, `.git`, `dist`, `build` y archivos de más de 1 MB. Las notas abiertas
se buscan tal como están en el editor, aunque no se hayan guardado.

## Grafo de conocimiento

Comando «Workspace: Knowledge graph (3D)» o el botón del panel Referencias. Muestra
los archivos enlazados entre sí (notas, Markdown, diagramas, flujos) como un grafo
3D: el tamaño indica cuántos enlaces tiene cada archivo. Clic enfoca un archivo y sus
vecinos; doble clic lo abre; el filtro resalta por nombre. La disposición es
determinista: el mismo espacio de trabajo siempre tiene la misma forma.

## Nuevo desde plantilla

Botón del Explorador o comando «File: New from Template…». Plantillas:

- **Notas** (Markdown): acta de reunión, diario, especificación técnica, retrospectiva.
- **Diagramas** (Excalidraw): arquitectura web, proceso con decisión, pipeline CI/CD.
- **Flujos** (ejecutables): informe diario de commits, monitor de una web, resumir
  notas nuevas con IA, procesar una lista con reintentos.

El contenido sale en el idioma de la app (español o inglés). Nunca sobrescribe: si el
nombre existe, añade `-2`, `-3`…

## Pruebas de la app completa (`pnpm test:e2e`)

`e2e/` contiene pruebas con Playwright que abren la app real en Chromium sobre un
backend de Tauri simulado (`e2e/fixtures/tauri-mock.js`: archivos en memoria,
diálogos y comandos). El servidor de desarrollo arranca solo. WebGL funciona por
software, sin GPU.

```bash
pnpm exec playwright install chromium   # una vez
pnpm test:e2e
```

Si Chromium está en otra ruta: `CHROMIUM_PATH=/ruta/chromium pnpm test:e2e`. Los
fallos dejan captura y traza en `test-results/`.
