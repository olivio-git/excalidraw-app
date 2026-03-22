import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

const WelcomeScreen = () => {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground select-none">
      <FolderOpen className="size-12 opacity-20" />
      <div className="text-center">
        <p className="text-base font-medium">{t("welcomeScreen.noFilesOpen")}</p>
        <p className="text-sm mt-1 opacity-70">{t("welcomeScreen.openWorkspaceHint")}</p>
      </div>
    </div>
  );
};

export default WelcomeScreen;
