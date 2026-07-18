const MASK = "••••••••";

const sensitiveHeaderNames = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

export function maskSecret(value: string, visibleSuffixLength = 0) {
  if (!value) {
    return "";
  }

  const suffixLength = Math.max(0, Math.min(visibleSuffixLength, value.length));

  return `${MASK}${value.slice(value.length - suffixLength)}`;
}

export function redactHeaders(
  headers: Record<string, string | readonly string[] | undefined>,
) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      sensitiveHeaderNames.has(name.toLowerCase()) ? MASK : value,
    ]),
  );
}
