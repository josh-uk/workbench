import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

import {
  cancelAzureLogin,
  disconnectAzure,
  getAzureConnectionState,
  getKeyVaultAccessToken,
  startAzureLogin,
} from "./azure-cli";

function childProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("Azure CLI login lifecycle", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cancelAzureLogin();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reserves one login slot before account inspection and awaits cancellation", async () => {
    const accountCheck = childProcess();
    const login = childProcess();
    mocks.spawn.mockReturnValueOnce(accountCheck).mockReturnValueOnce(login);

    const firstLogin = startAzureLogin({});
    await expect(startAzureLogin({})).rejects.toMatchObject({
      code: "AZURE_LOGIN_IN_PROGRESS",
    });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    accountCheck.emit("close", 1);
    await expect(firstLogin).resolves.toMatchObject({ status: "starting" });
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn.mock.calls[0]?.[2]?.env).toMatchObject({
      AZURE_CORE_COLLECT_TELEMETRY: "no",
    });

    let cancelled = false;
    const cancellation = cancelAzureLogin().then(() => {
      cancelled = true;
    });
    await Promise.resolve();
    expect(login.kill).toHaveBeenCalledWith("SIGTERM");
    expect(cancelled).toBe(false);

    login.emit("close", 1);
    await cancellation;
    expect(cancelled).toBe(true);

    const accountAfterCancel = childProcess();
    mocks.spawn.mockReturnValueOnce(accountAfterCancel);
    const state = getAzureConnectionState();
    accountAfterCancel.emit("close", 1);
    await expect(state).resolves.toEqual({
      status: "disconnected",
      cliAvailable: true,
    });
  });

  it("parses Key Vault tokens without returning raw CLI output", async () => {
    const tokenCommand = childProcess();
    mocks.spawn.mockReturnValueOnce(tokenCommand);
    const token = getKeyVaultAccessToken();
    tokenCommand.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          accessToken: "access-token",
          expires_on: 2_000_000_000,
          tenant: "tenant-id",
          tokenType: "Bearer",
        }),
      ),
    );
    tokenCommand.emit("close", 0);

    await expect(token).resolves.toEqual({
      accessToken: "access-token",
      expiresOn: 2_000_000_000,
      tenantId: "tenant-id",
      tokenType: "Bearer",
    });
  });

  it("sanitizes CLI failures and clears the account during disconnect", async () => {
    const failedToken = childProcess();
    mocks.spawn.mockReturnValueOnce(failedToken);
    const token = getKeyVaultAccessToken();
    failedToken.stderr.emit(
      "data",
      Buffer.from("AADSTS50076 internal-secret-value"),
    );
    failedToken.emit("close", 1);
    await expect(token).rejects.toThrow("Microsoft Entra rejected");
    await expect(token).rejects.not.toThrow("internal-secret-value");

    mocks.spawn.mockImplementation(() => {
      const child = childProcess();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    await disconnectAzure();

    expect(mocks.spawn.mock.calls.slice(-2).map((call) => call[1])).toEqual([
      ["logout", "--only-show-errors"],
      ["account", "clear", "--only-show-errors"],
    ]);
  });

  it("does not report a successful disconnect when session removal fails", async () => {
    const logout = childProcess();
    const clear = childProcess();
    mocks.spawn.mockReturnValueOnce(logout).mockReturnValueOnce(clear);

    const disconnected = disconnectAzure();
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    logout.stderr.emit(
      "data",
      Buffer.from("permission denied internal-secret"),
    );
    logout.emit("close", 1);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
    clear.emit("close", 0);

    await expect(disconnected).rejects.toThrow(
      "Azure session data could not be cleared",
    );
    await expect(disconnected).rejects.not.toThrow("internal-secret");
  });
});
