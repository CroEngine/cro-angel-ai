import { ArrowLeft, ArrowRight, RotateCw, MousePointer2, Hand } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface UrlBarProps {
  value: string;
  onSubmit: (url: string) => void;
  onReload: () => void;
}

export function UrlBar({ value, onSubmit, onReload }: UrlBarProps) {
  const [draft, setDraft] = useState(value);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(draft);
  };

  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2">
      <div className="flex items-center gap-1 text-muted-foreground">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button">
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" onClick={onReload}>
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>
      <form onSubmit={handleSubmit} className="flex-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 rounded-md bg-muted/50 font-mono text-sm"
          spellCheck={false}
        />
      </form>
      <div className="flex items-center gap-1 text-muted-foreground">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button">
          <MousePointer2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button">
          <Hand className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
