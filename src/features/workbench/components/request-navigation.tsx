"use client";

import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import { Button } from "@/components/ui/button";
import {
  duplicateSavedRequestAction,
  moveSavedRequestAction,
} from "@/features/requests/actions";
import type { SavedRequestSummary } from "@/features/requests/domain";
import { cn } from "@/lib/utils";

import { MenuContent, menuItemClass } from "./workbench-menu";
import type { DeleteState, Mutation } from "./workspace-ui-types";

const methodTone: Record<SavedRequestSummary["method"], string> = {
  GET: "text-emerald-500",
  POST: "text-sky-500",
  PUT: "text-amber-500",
  PATCH: "text-orange-500",
  DELETE: "text-red-500",
  HEAD: "text-violet-500",
  OPTIONS: "text-cyan-500",
};

export function RequestNavigationItem({
  pending,
  request,
  runMutation,
  selected,
  setDeleteState,
  setSelectedRequestId,
}: {
  pending: boolean;
  request: SavedRequestSummary;
  runMutation: (mutation: Mutation, success: string) => void;
  selected: boolean;
  setDeleteState: (state: DeleteState) => void;
  setSelectedRequestId: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "group/request flex items-center rounded-md text-xs text-muted hover:bg-surface-strong hover:text-foreground",
        selected && "bg-surface-strong text-foreground",
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
        onClick={() => setSelectedRequestId(request.id)}
        type="button"
      >
        <span
          className={cn(
            "w-10 shrink-0 font-mono text-[0.5625rem] font-bold",
            methodTone[request.method],
          )}
        >
          {request.method}
        </span>
        <span className="truncate">{request.name}</span>
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            aria-label={`Request actions for ${request.name}`}
            className="size-6 opacity-0 group-hover/request:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            disabled={pending}
            size="icon"
            variant="ghost"
          >
            <MoreHorizontal aria-hidden="true" className="size-3.5" />
          </Button>
        </DropdownMenu.Trigger>
        <MenuContent>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() =>
              runMutation(
                () => duplicateSavedRequestAction({ requestId: request.id }),
                `Duplicated ${request.name}.`,
              )
            }
          >
            <Copy aria-hidden="true" className="size-3.5" /> Duplicate
          </DropdownMenu.Item>
          {(["up", "down"] as const).map((direction) => {
            const Icon = direction === "up" ? ArrowUp : ArrowDown;
            return (
              <DropdownMenu.Item
                className={menuItemClass}
                key={direction}
                onSelect={() =>
                  runMutation(
                    () =>
                      moveSavedRequestAction({
                        requestId: request.id,
                        direction,
                      }),
                    `Moved ${request.name} ${direction}.`,
                  )
                }
              >
                <Icon aria-hidden="true" className="size-3.5" /> Move{" "}
                {direction}
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator className="my-1 border-t" />
          <DropdownMenu.Item
            className={cn(menuItemClass, "text-red-500")}
            onSelect={() =>
              setDeleteState({
                kind: "request",
                id: request.id,
                name: request.name,
              })
            }
          >
            <Trash2 aria-hidden="true" className="size-3.5" /> Delete
          </DropdownMenu.Item>
        </MenuContent>
      </DropdownMenu.Root>
    </div>
  );
}
