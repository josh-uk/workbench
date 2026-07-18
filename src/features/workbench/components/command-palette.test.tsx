import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette, type CommandPaletteAction } from "./command-palette";

describe("CommandPalette", () => {
  it("filters and runs the active command from the keyboard", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const onOpenChange = vi.fn();
    const actions: CommandPaletteAction[] = [
      {
        id: "settings",
        label: "Open settings",
        description: "Manage backup and retention",
        run,
      },
      {
        id: "variables",
        label: "Workspace variables",
        description: "Manage environments and values",
        run: vi.fn(),
      },
    ];

    render(
      <CommandPalette
        actions={actions}
        onOpenChange={onOpenChange}
        open
        theme="dark"
      />,
    );

    const search = await screen.findByRole("combobox", {
      name: "Search commands",
    });
    expect(search).toHaveFocus();
    await user.type(search, "backup{Enter}");

    expect(run).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps disabled commands visible but does not execute them", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <CommandPalette
        actions={[
          {
            id: "new-request",
            label: "Create request",
            description: "Requires a project",
            disabled: true,
            run,
          },
        ]}
        onOpenChange={vi.fn()}
        open
        theme="dark"
      />,
    );

    await user.keyboard("{Enter}");
    expect(run).not.toHaveBeenCalled();
    expect(
      screen.getByRole("option", { name: /Create request/ }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
