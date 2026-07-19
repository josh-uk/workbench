import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAzureDeviceCodeOutput } from "./azure-cli";

describe("Azure CLI device-code parsing", () => {
  it("extracts only the bounded device code from CLI output", () => {
    expect(
      parseAzureDeviceCodeOutput(
        "To sign in, open https://microsoft.com/devicelogin and enter the code AB12-CD34 to authenticate.",
      ),
    ).toBe("AB12-CD34");
    expect(
      parseAzureDeviceCodeOutput("Use the browser. Device code: ZXCV1234"),
    ).toBe("ZXCV1234");
  });

  it("does not accept arbitrary text as a device code", () => {
    expect(
      parseAzureDeviceCodeOutput("code: <script>alert(1)</script>"),
    ).toBeNull();
    expect(parseAzureDeviceCodeOutput("enter code short")).toBeNull();
  });
});
