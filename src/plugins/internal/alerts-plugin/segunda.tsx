import { Button } from "@/shared/components/ui/button";
import { PluginManager } from "@/plugins/plugin-manager";

export default function Segunda() {
  const runCommand = (id: string) => () => {
    void PluginManager.executeCommand(id);
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Alertas</h1>
      <p className="text-muted-foreground">Esta página muestra segundo componente para alertas.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={runCommand("alert.command.saludo")}>
          Mostrar saludo (comando)
        </Button>
      </div>
    </div>
  );
}
