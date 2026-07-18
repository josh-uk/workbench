"use client";

import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { RequestField } from "@/features/requests/domain";

export function RequestFieldEditor({
  allowSecrets = false,
  emptyLabel,
  items,
  onChange,
}: {
  allowSecrets?: boolean;
  emptyLabel: string;
  items: RequestField[];
  onChange: (items: RequestField[]) => void;
}) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const update = (index: number, values: Partial<RequestField>) => {
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...values } : item,
      ),
    );
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div className="flex items-center gap-2" key={index}>
          <input
            aria-label={`Enable field ${index + 1}`}
            checked={item.enabled}
            className="size-4 accent-accent"
            onChange={(event) =>
              update(index, { enabled: event.target.checked })
            }
            type="checkbox"
          />
          <input
            aria-label={`Field ${index + 1} name`}
            className="h-9 min-w-0 flex-1 rounded-md border bg-surface-subtle px-2.5 text-xs"
            onChange={(event) => update(index, { name: event.target.value })}
            placeholder="Name"
            value={item.name}
          />
          <input
            aria-label={`Field ${index + 1} value`}
            className="h-9 min-w-0 flex-[1.5] rounded-md border bg-surface-subtle px-2.5 font-mono text-xs"
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder="Value"
            type={item.secret && !revealed.has(index) ? "password" : "text"}
            value={item.value}
          />
          {allowSecrets ? (
            <>
              <label className="flex items-center gap-1 text-[10px] text-muted">
                <input
                  aria-label={`Field ${index + 1} is secret`}
                  checked={item.secret}
                  onChange={(event) =>
                    update(index, { secret: event.target.checked })
                  }
                  type="checkbox"
                />
                Secret
              </label>
              {item.secret ? (
                <Button
                  aria-label={`${revealed.has(index) ? "Hide" : "Reveal"} field ${index + 1}`}
                  onClick={() =>
                    setRevealed((current) => {
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  {revealed.has(index) ? (
                    <EyeOff aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Eye aria-hidden="true" className="size-3.5" />
                  )}
                </Button>
              ) : null}
            </>
          ) : null}
          <Button
            aria-label={`Remove field ${index + 1}`}
            onClick={() =>
              onChange(items.filter((_, itemIndex) => itemIndex !== index))
            }
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      ))}
      {!items.length ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted">
          {emptyLabel}
        </p>
      ) : null}
      <Button
        onClick={() =>
          onChange([
            ...items,
            { name: "", value: "", enabled: true, secret: false },
          ])
        }
        size="sm"
        type="button"
        variant="secondary"
      >
        <Plus aria-hidden="true" className="size-3.5" /> Add row
      </Button>
    </div>
  );
}
