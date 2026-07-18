"use client";

import { Search, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CommandPaletteAction {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({
  actions,
  onOpenChange,
  open,
  theme,
}: {
  actions: CommandPaletteAction[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  theme: "dark" | "light";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const visibleActions = useMemo(() => {
    const normalised = query.trim().toLocaleLowerCase();
    if (!normalised) return actions;
    return actions.filter((action) =>
      [action.label, action.description, ...(action.keywords ?? [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalised),
    );
  }, [actions, query]);

  const safeActiveIndex = Math.min(
    activeIndex,
    Math.max(visibleActions.length - 1, 0),
  );

  const changeOpen = (next: boolean) => {
    if (!next) {
      setQuery("");
      setActiveIndex(0);
    }
    onOpenChange(next);
  };

  const execute = (action: CommandPaletteAction | undefined) => {
    if (!action || action.disabled) return;
    changeOpen(false);
    action.run();
  };

  return (
    <Dialog.Root onOpenChange={changeOpen} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[2px]"
          data-theme={theme}
        />
        <Dialog.Content
          className="fixed top-[18vh] left-1/2 z-[80] w-[min(92vw,42rem)] -translate-x-1/2 overflow-hidden rounded-xl border bg-surface text-foreground shadow-2xl"
          data-theme={theme}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold">
                Command palette
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">
                Search actions, then use ↑ ↓ and Enter.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                aria-label="Close command palette"
                size="icon"
                variant="ghost"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="relative border-b">
            <Search
              aria-hidden="true"
              className="absolute top-3.5 left-4 size-4 text-muted"
            />
            <label className="sr-only" htmlFor="command-palette-search">
              Search commands
            </label>
            <input
              aria-activedescendant={
                visibleActions[safeActiveIndex]
                  ? `command-${visibleActions[safeActiveIndex].id}`
                  : undefined
              }
              aria-controls="command-palette-results"
              aria-expanded="true"
              aria-haspopup="listbox"
              autoComplete="off"
              className="h-12 w-full bg-surface pr-4 pl-11 text-sm outline-none"
              id="command-palette-search"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) =>
                    visibleActions.length
                      ? (index + 1) % visibleActions.length
                      : 0,
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) =>
                    visibleActions.length
                      ? (index - 1 + visibleActions.length) %
                        visibleActions.length
                      : 0,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  execute(visibleActions[safeActiveIndex]);
                }
              }}
              placeholder="Type a command…"
              ref={inputRef}
              role="combobox"
              value={query}
            />
          </div>
          <div
            aria-label="Available commands"
            className="max-h-[min(50vh,28rem)] overflow-auto p-2"
            id="command-palette-results"
            role="listbox"
          >
            {visibleActions.length ? (
              visibleActions.map((action, index) => (
                <button
                  aria-disabled={action.disabled || undefined}
                  aria-selected={index === safeActiveIndex}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
                    index === safeActiveIndex && "bg-accent/12",
                    action.disabled && "cursor-not-allowed opacity-45",
                  )}
                  id={`command-${action.id}`}
                  key={action.id}
                  onClick={() => execute(action)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {action.label}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block truncate text-xs text-muted",
                        index === safeActiveIndex && "text-foreground",
                      )}
                    >
                      {action.description}
                    </span>
                  </span>
                  {action.shortcut ? (
                    <kbd
                      aria-hidden="true"
                      className="shrink-0 rounded border bg-surface-subtle px-2 py-1 font-sans text-[10px] text-muted"
                    >
                      {action.shortcut}
                    </kbd>
                  ) : null}
                </button>
              ))
            ) : (
              <p className="px-3 py-8 text-center text-sm text-muted">
                No commands match “{query}”.
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
