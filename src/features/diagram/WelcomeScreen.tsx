import { FolderOpen } from "lucide-react";

const WelcomeScreen = () => (
  <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground select-none">
    <FolderOpen className="size-12 opacity-20" />
    <div className="text-center">
      <p className="text-base font-medium">No hay archivos abiertos</p>
      <p className="text-sm mt-1 opacity-70">
        Abrí un workspace desde el panel lateral para comenzar
      </p>
    </div>
  </div>
);

export default WelcomeScreen;
