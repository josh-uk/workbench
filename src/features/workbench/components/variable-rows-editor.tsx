"use client";

import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { VariableValue } from "@/features/variables/domain";

export function VariableRowsEditor({
  defaultSecret = false,
  emptyLabel = "No variables at this scope.",
  onChange,
  variables,
}: {
  defaultSecret?: boolean;
  emptyLabel?: string;
  onChange: (variables: VariableValue[]) => void;
  variables: VariableValue[];
}) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const update = (index: number, values: Partial<VariableValue>) =>
    onChange(
      variables.map((variable, variableIndex) =>
        variableIndex === index ? { ...variable, ...values } : variable,
      ),
    );

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[32px_minmax(120px,0.8fr)_minmax(180px,1.4fr)_62px_36px] items-center gap-2 border-b bg-surface-subtle px-2 py-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
        <span>On</span>
        <span>Name</span>
        <span>Value</span>
        <span>Secret</span>
        <span />
      </div>
      {variables.length ? (
        variables.map((variable, index) => (
          <div
            className="grid grid-cols-[32px_minmax(120px,0.8fr)_minmax(180px,1.4fr)_62px_36px] items-center gap-2 border-b px-2 py-2 last:border-b-0"
            key={index}
          >
            <input
              aria-label={`Enable variable ${index + 1}`}
              checked={variable.enabled}
              className="size-4 accent-accent"
              onChange={(event) =>
                update(index, { enabled: event.target.checked })
              }
              type="checkbox"
            />
            <input
              aria-label={`Variable name ${index + 1}`}
              className="h-8 min-w-0 rounded border bg-surface-subtle px-2 font-mono text-xs"
              onChange={(event) => update(index, { name: event.target.value })}
              placeholder="baseUrl"
              value={variable.name}
            />
            <div className="relative min-w-0">
              <input
                aria-label={`Variable value ${index + 1}`}
                className="h-8 w-full rounded border bg-code-background px-2 pr-8 font-mono text-xs"
                onChange={(event) =>
                  update(index, { value: event.target.value })
                }
                placeholder="https://api.example.test"
                type={
                  variable.secret && !revealed.has(index) ? "password" : "text"
                }
                value={variable.value}
              />
              {variable.secret ? (
                <button
                  aria-label={
                    revealed.has(index)
                      ? "Hide secret value"
                      : "Reveal secret value"
                  }
                  className="absolute top-1 right-1 grid size-6 place-items-center text-muted hover:text-foreground"
                  onClick={() =>
                    setRevealed((current) => {
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                  type="button"
                >
                  {revealed.has(index) ? (
                    <EyeOff aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Eye aria-hidden="true" className="size-3.5" />
                  )}
                </button>
              ) : null}
            </div>
            <input
              aria-label={`Mark variable ${index + 1} as secret`}
              checked={variable.secret}
              className="size-4 accent-accent"
              onChange={(event) =>
                update(index, { secret: event.target.checked })
              }
              type="checkbox"
            />
            <Button
              aria-label={`Delete variable ${index + 1}`}
              onClick={() =>
                onChange(
                  variables.filter(
                    (_variable, variableIndex) => variableIndex !== index,
                  ),
                )
              }
              size="icon"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" className="size-3.5 text-red-500" />
            </Button>
          </div>
        ))
      ) : (
        <p className="px-4 py-8 text-center text-xs text-muted">{emptyLabel}</p>
      )}
      <button
        className="flex w-full items-center justify-center gap-1.5 border-t bg-surface-subtle px-3 py-2 text-xs text-muted hover:text-foreground"
        onClick={() =>
          onChange([
            ...variables,
            { name: "", value: "", secret: defaultSecret, enabled: true },
          ])
        }
        type="button"
      >
        <Plus aria-hidden="true" className="size-3.5" /> Add variable
      </button>
    </div>
  );
}
