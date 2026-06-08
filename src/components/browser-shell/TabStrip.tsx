import { X, FolderArchive } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function TabStrip({ title }: { title: string }) {
  return (
    <div className="flex items-end justify-between gap-1 border-b border-border bg-muted/40 px-3 pt-2">
      <div className="flex h-9 max-w-xs items-center gap-2 rounded-t-md border border-b-0 border-border bg-background px-3 text-sm text-foreground shadow-sm">
        <span className="h-2 w-2 rounded-full bg-destructive/70" />
        <span className="truncate">{title}</span>
        <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
      </div>
      <Link
        to="/corpus"
        className="mb-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <FolderArchive className="h-3.5 w-3.5" />
        Corpus
      </Link>
    </div>
  );
}
