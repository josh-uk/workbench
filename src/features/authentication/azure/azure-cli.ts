import "server-only";

import { spawn, type ChildProcess } from "node:child_process";

import { z } from "zod";

import {
  type AzureAccountSummary,
  AzureAuthenticationError,
  type AzureConnectionState,
  azureLoginRequestSchema,
} from "./domain";

const AZURE_CLI = "/usr/bin/az";
const LOGIN_TIMEOUT_MS = 15 * 60 * 1_000;
const COMMAND_TIMEOUT_MS = 20_000;
const MAX_CAPTURE_BYTES = 64 * 1_024;
const DEVICE_LOGIN_URL = "https://microsoft.com/devicelogin";

const accountSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  user: z.object({ name: z.string().min(1).max(320) }),
});

const accessTokenSchema = z.object({
  accessToken: z.string().min(1).max(32_768),
  expires_on: z.union([z.number(), z.string()]).optional(),
  tenant: z.string().min(1).max(200),
  tokenType: z.literal("Bearer").default("Bearer"),
});

interface LoginAttempt {
  process: Pick<ChildProcess, "kill"> | null;
  state: AzureConnectionState;
  output: string;
  timeout: NodeJS.Timeout | null;
  cancelled: boolean;
  completed: Promise<void>;
  complete: () => void;
}

interface AzureCliGlobal {
  login: LoginAttempt | null;
  lastFailure: { message: string; at: number } | null;
}

const globalKey = Symbol.for("workbench.azure-cli-state");
const globalStore = globalThis as typeof globalThis & {
  [globalKey]?: AzureCliGlobal;
};
const store = (globalStore[globalKey] ??= {
  login: null,
  lastFailure: null,
});

function cliEnvironment() {
  return {
    ...process.env,
    AZURE_CORE_COLLECT_TELEMETRY: "no",
    AZURE_CORE_LOGIN_EXPERIENCE_V2: "off",
    AZURE_CORE_NO_COLOR: "true",
    AZURE_CORE_ONLY_SHOW_ERRORS: "true",
    PYTHONUNBUFFERED: "1",
  };
}

function friendlyFailure(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("not found") || lower.includes("enoent")) {
    return "Azure CLI is not available in this Workbench installation.";
  }
  if (
    lower.includes("az login") ||
    lower.includes("not logged in") ||
    lower.includes("no subscriptions found")
  ) {
    return "Azure is disconnected. Reconnect Azure and try again.";
  }
  if (lower.includes("expired") || lower.includes("code_expired")) {
    return "Microsoft sign-in expired. Start a new Azure connection.";
  }
  if (lower.includes("cancel") || lower.includes("authorization_pending")) {
    return "Microsoft sign-in was cancelled or did not complete.";
  }
  if (lower.includes("conditional access") || lower.includes("aadsts")) {
    return "Microsoft Entra rejected the sign-in. Check MFA, tenant, and Conditional Access requirements.";
  }
  return "Azure sign-in failed. Check the tenant and try again.";
}

function boundedAppend(current: string, chunk: Buffer | string) {
  const combined = current + chunk.toString();
  return combined.length > MAX_CAPTURE_BYTES
    ? combined.slice(-MAX_CAPTURE_BYTES)
    : combined;
}

export function parseAzureDeviceCodeOutput(output: string) {
  const code =
    output.match(/enter\s+(?:the\s+)?code\s+([A-Z0-9-]{6,20})/i)?.[1] ??
    output.match(/code\s*:\s*([A-Z0-9-]{6,20})/i)?.[1] ??
    null;
  return code?.toUpperCase() ?? null;
}

function clearAttempt(attempt: LoginAttempt) {
  if (attempt.timeout) clearTimeout(attempt.timeout);
  if (store.login === attempt) store.login = null;
  attempt.complete();
}

function terminateProcess(process: Pick<ChildProcess, "kill">) {
  process.kill("SIGTERM");
  const force = setTimeout(() => process.kill("SIGKILL"), 2_000);
  force.unref();
}

async function runCommand(
  args: string[],
  options: { timeoutMs?: number; allowFailure?: boolean } = {},
) {
  return new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ AZURE_CLI, args, {
        env: cliEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        terminateProcess(child);
        reject(
          new AzureAuthenticationError(
            "Azure CLI did not respond in time.",
            "AZURE_CLI_TIMEOUT",
          ),
        );
      }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = boundedAppend(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = boundedAppend(stderr, chunk);
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(
          new AzureAuthenticationError(
            friendlyFailure(error.message),
            error.message.includes("ENOENT")
              ? "AZURE_CLI_UNAVAILABLE"
              : "AZURE_CLI_FAILED",
          ),
        );
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        const exitCode = code ?? 1;
        if (exitCode !== 0 && !options.allowFailure) {
          reject(
            new AzureAuthenticationError(
              friendlyFailure(stderr),
              "AZURE_CLI_FAILED",
            ),
          );
          return;
        }
        resolve({ stdout, stderr, code: exitCode });
      });
    },
  );
}

async function currentAccount(): Promise<AzureAccountSummary | null> {
  const result = await runCommand(
    ["account", "show", "--output", "json", "--only-show-errors"],
    { allowFailure: true },
  );
  if (result.code !== 0 || !result.stdout.trim()) return null;
  try {
    const account = accountSchema.parse(JSON.parse(result.stdout));
    return {
      name: account.name,
      username: account.user.name,
      tenantId: account.tenantId,
      subscriptionId: account.id,
    };
  } catch {
    throw new AzureAuthenticationError(
      "Azure CLI returned invalid account information.",
      "AZURE_CLI_INVALID_RESPONSE",
    );
  }
}

async function verifyKeyVaultSession() {
  await runCommand([
    "account",
    "get-access-token",
    "--resource",
    "https://vault.azure.net",
    "--query",
    "expires_on",
    "--output",
    "tsv",
    "--only-show-errors",
  ]);
}

export async function getAzureConnectionState(): Promise<AzureConnectionState> {
  if (store.login) return store.login.state;
  try {
    const account = await currentAccount();
    if (account) {
      await verifyKeyVaultSession();
      return { status: "connected", cliAvailable: true, account };
    }
    const recentFailure =
      store.lastFailure && Date.now() - store.lastFailure.at < 60_000
        ? store.lastFailure
        : null;
    if (recentFailure) {
      return {
        status: "failed",
        cliAvailable: true,
        error: recentFailure.message,
      };
    }
    return { status: "disconnected", cliAvailable: true };
  } catch (error) {
    if (
      error instanceof AzureAuthenticationError &&
      error.code === "AZURE_CLI_UNAVAILABLE"
    ) {
      return { status: "disconnected", cliAvailable: false };
    }
    return {
      status: "failed",
      cliAvailable:
        !(error instanceof AzureAuthenticationError) ||
        error.code !== "AZURE_CLI_UNAVAILABLE",
      error:
        error instanceof AzureAuthenticationError
          ? error.message
          : "Azure connection status could not be checked.",
    };
  }
}

export async function startAzureLogin(input: unknown) {
  const parsed = azureLoginRequestSchema.parse(input);
  if (store.login) {
    throw new AzureAuthenticationError(
      "An Azure sign-in is already in progress.",
      "AZURE_LOGIN_IN_PROGRESS",
    );
  }
  const expiresAt = new Date(Date.now() + LOGIN_TIMEOUT_MS).toISOString();
  let complete = () => {};
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const attempt: LoginAttempt = {
    process: null,
    output: "",
    state: {
      status: "starting",
      cliAvailable: true,
      verificationUrl: null,
      userCode: null,
      expiresAt,
    } satisfies AzureConnectionState,
    timeout: null,
    cancelled: false,
    completed,
    complete,
  };

  // Reserve the process slot before the first await so simultaneous requests
  // cannot both pass the login-in-progress check.
  store.login = attempt;
  store.lastFailure = null;

  try {
    if (await currentAccount()) {
      throw new AzureAuthenticationError(
        "Disconnect the current Azure account before signing in again.",
        "AZURE_ALREADY_CONNECTED",
      );
    }
    if (attempt.cancelled || store.login !== attempt) {
      throw new AzureAuthenticationError(
        "Microsoft sign-in was cancelled.",
        "AZURE_LOGIN_CANCELLED",
      );
    }
  } catch (error) {
    clearAttempt(attempt);
    throw error;
  }

  const args = [
    "login",
    "--use-device-code",
    "--allow-no-subscriptions",
    "--output",
    "json",
    "--only-show-errors",
  ];
  if (parsed.tenant) args.push("--tenant", parsed.tenant);

  const child = spawn(/* turbopackIgnore: true */ AZURE_CLI, args, {
    env: cliEnvironment(),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  attempt.process = child;
  attempt.timeout = setTimeout(() => {
    terminateProcess(child);
    store.lastFailure = {
      message: "Microsoft sign-in expired. Start a new Azure connection.",
      at: Date.now(),
    };
  }, LOGIN_TIMEOUT_MS);

  const receive = (chunk: Buffer) => {
    attempt.output = boundedAppend(attempt.output, chunk);
    const userCode = parseAzureDeviceCodeOutput(attempt.output);
    if (userCode) {
      attempt.state = {
        status: "waiting",
        cliAvailable: true,
        verificationUrl: DEVICE_LOGIN_URL,
        userCode,
        expiresAt,
      };
    }
  };
  child.stdout.on("data", receive);
  child.stderr.on("data", receive);
  child.once("error", (error) => {
    if (store.login !== attempt) return;
    if (!attempt.cancelled) {
      store.lastFailure = {
        message: friendlyFailure(error.message),
        at: Date.now(),
      };
    }
    clearAttempt(attempt);
  });
  child.once("close", (code) => {
    if (store.login !== attempt) return;
    if (code !== 0 && !attempt.cancelled && !store.lastFailure) {
      store.lastFailure = {
        message: friendlyFailure(attempt.output),
        at: Date.now(),
      };
    }
    clearAttempt(attempt);
  });
  return attempt.state;
}

export async function cancelAzureLogin() {
  const attempt = store.login;
  if (!attempt) return;
  store.lastFailure = null;
  attempt.cancelled = true;
  if (attempt.timeout) {
    clearTimeout(attempt.timeout);
    attempt.timeout = null;
  }
  if (attempt.process) terminateProcess(attempt.process);
  await attempt.completed;
}

export async function disconnectAzure() {
  await cancelAzureLogin();
  const logout = await runCommand(["logout", "--only-show-errors"], {
    allowFailure: true,
  });
  const clear = await runCommand(["account", "clear", "--only-show-errors"], {
    allowFailure: true,
  });
  const logoutMessage =
    `${logout.stdout}\n${logout.stderr}`.toLocaleLowerCase();
  const wasAlreadyDisconnected =
    logoutMessage.includes("please run 'az login'") ||
    logoutMessage.includes('please run "az login"') ||
    logoutMessage.includes("not logged in");
  if ((logout.code !== 0 && !wasAlreadyDisconnected) || clear.code !== 0) {
    throw new AzureAuthenticationError(
      "Azure session data could not be cleared. Retry disconnect before removing the Azure CLI volume.",
      "AZURE_DISCONNECT_FAILED",
    );
  }
  store.lastFailure = null;
}

export async function getKeyVaultAccessToken() {
  const result = await runCommand([
    "account",
    "get-access-token",
    "--resource",
    "https://vault.azure.net",
    "--output",
    "json",
    "--only-show-errors",
  ]);
  try {
    const token = accessTokenSchema.parse(JSON.parse(result.stdout));
    return {
      accessToken: token.accessToken,
      expiresOn: token.expires_on ? Number(token.expires_on) : null,
      tenantId: token.tenant,
      tokenType: token.tokenType,
    };
  } catch {
    throw new AzureAuthenticationError(
      "Azure CLI returned an invalid access token response.",
      "AZURE_CLI_INVALID_RESPONSE",
    );
  }
}
