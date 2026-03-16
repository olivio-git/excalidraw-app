import { Button } from "@/shared/components/ui/button";
import { Plus } from "lucide-react";

interface NewTabButtonProps {
  onClick: () => void;
  className?: string;
}

const NewTabButton = ({ onClick, className }: NewTabButtonProps) => {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className={className} aria-label="New tab">
      <Plus className="size-4" />
    </Button>
  );
};

export default NewTabButton;
