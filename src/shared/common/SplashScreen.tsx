import { Loader2 } from "lucide-react";

interface SplashScreenProps {
  message?: string;
}

const SplashScreen = ({ message = "Loading..." }: SplashScreenProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
};

export default SplashScreen;
