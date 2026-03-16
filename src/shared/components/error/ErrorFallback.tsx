import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export function ErrorFallback({ error, resetErrorBoundary }: ErrorFallbackProps) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-background text-foreground animate-in fade-in duration-300">
      <div className="max-w-md w-full flex flex-col items-center text-center space-y-6">
        <div className="rounded-full bg-destructive/10 p-4">
          <AlertCircle className="size-12 text-destructive" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Ocurrió un problema inesperado</h2>
          <p className="text-muted-foreground">
            Lamentamos los inconvenientes. Un error impidió cargar esta vista correctamente.
          </p>
        </div>

        {import.meta.env.DEV && (
          <div className="w-full text-left bg-muted p-4 rounded-md overflow-auto max-h-48 border border-border">
            <p className="font-mono text-sm font-semibold text-destructive mb-2">
              {error.name}: {error.message}
            </p>
            <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap">
              {error.stack}
            </pre>
          </div>
        )}

        <Button onClick={resetErrorBoundary} className="gap-2">
          <RefreshCw className="size-4" />
          Intentar de nuevo
        </Button>
      </div>
    </div>
  );
}
