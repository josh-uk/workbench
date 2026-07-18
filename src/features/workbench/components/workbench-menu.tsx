"use client";

import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

export const menuItemClass =
  "flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-surface-strong data-[disabled]:opacity-40";

export function MenuContent({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        className="z-50 min-w-44 rounded-lg border bg-surface p-1 text-foreground shadow-xl"
        sideOffset={5}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}
