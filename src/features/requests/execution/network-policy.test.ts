import { describe, expect, it } from "vitest";

import {
  isCloudMetadataTarget,
  isPrivateOrReservedAddress,
  resolveAndValidateTarget,
} from "./network-policy";

describe("outbound network policy", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.1.2",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("classifies %s as private or reserved", (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPrivateOrReservedAddress(address)).toBe(false);
    },
  );

  it("always identifies cloud metadata targets", () => {
    expect(isCloudMetadataTarget("169.254.169.254")).toBe(true);
    expect(isCloudMetadataTarget("METADATA.GOOGLE.INTERNAL.")).toBe(true);
  });

  it("rejects non-HTTP protocols before DNS resolution", async () => {
    await expect(
      resolveAndValidateTarget(new URL("file:///etc/passwd"), false),
    ).rejects.toMatchObject({ code: "PROTOCOL_BLOCKED" });
  });

  it("requires an explicit opt-in for loopback", async () => {
    await expect(
      resolveAndValidateTarget(new URL("http://127.0.0.1:9000"), false),
    ).rejects.toMatchObject({ code: "PRIVATE_NETWORK_BLOCKED" });

    await expect(
      resolveAndValidateTarget(new URL("http://127.0.0.1:9000"), true),
    ).resolves.toMatchObject({ address: "127.0.0.1", family: 4 });
  });

  it("blocks metadata even when private networking is enabled", async () => {
    await expect(
      resolveAndValidateTarget(new URL("http://169.254.169.254/latest"), true),
    ).rejects.toMatchObject({ code: "METADATA_BLOCKED" });
  });
});
