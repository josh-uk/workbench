import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AssertionEditor } from "./assertion-editor";

describe("AssertionEditor", () => {
  it("adds, configures, and removes no-code assertions", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <AssertionEditor assertions={[]} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "Add assertion" }));
    const added = onChange.mock.calls[0]?.[0];
    expect(added).toEqual([
      expect.objectContaining({ type: "status_equals", enabled: true }),
    ]);

    onChange.mockClear();
    rerender(<AssertionEditor assertions={added} onChange={onChange} />);
    await user.selectOptions(
      screen.getByLabelText("Assertion 1 type"),
      "body_schema",
    );
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "body_schema",
        configuration: { schema: expect.stringContaining('"type"') },
      }),
    ]);

    onChange.mockClear();
    await user.click(
      screen.getByRole("button", { name: "Remove assertion 1" }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
