import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("renders accessible content and handles activation", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={onClick}>Send request</Button>);
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not activate when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button disabled onClick={onClick}>
        Send request
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
