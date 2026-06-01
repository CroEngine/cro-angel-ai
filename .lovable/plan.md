## Ändringar i `src/components/browser-shell/FindingsView.tsx`

Översätt tom-läget till engelska och centrera vertikalt så den hamnar i höjd med viewportens "Enter a URL and click Run"-placeholder.

```tsx
if (reports.length === 0) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
      <p className="text-center">
        No pages analyzed yet. Data appears once the first{" "}
        <span className="font-medium text-foreground">goto</span> runs.
      </p>
    </div>
  );
}
```

För att `h-full` ska fungera behöver `ScrollArea`-wrappern i `ConsolePanel.tsx` (rad 286–288) inte ändras — `ScrollArea` har redan `h-full`, och dess viewport-child sträcker sig fullt. Om det visar sig att höjden inte propagerar lägger jag till `min-h-full` på en inre wrapper.

Inga andra filer ändras.