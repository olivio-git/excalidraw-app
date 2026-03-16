// Una vez publicado en npm: import { definePlugin } from "@tuapp/plugin-sdk";
// Para desarrollo local usa la ruta al SDK o npm link:
import { definePlugin } from "@tuapp/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "mi-plugin",
    name: "Mi Plugin",
    version: "1.0.0",
  },

  activate(api) {
    // Registrar un comando
    api.registerCommand("mi-plugin.saludo", () => {
      alert("Hola desde mi plugin!");
    });

    // Registrar un botón en el footer del sidebar
    // api.registerSidebarFooterAction({
    //   id: "mi-plugin.footer",
    //   tooltip: "Mi acción",
    //   onClick: () => alert("Acción del footer"),
    // });
  },

  deactivate() {
    console.log("[mi-plugin] Desactivado");
  },
});
