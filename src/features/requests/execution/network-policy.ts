import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { RequestDomainError } from "@/features/requests/domain";

const metadataHostnames = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.google",
  "instance-data.ec2.internal",
  "fd00:ec2::254",
]);

function normaliseHostname(hostname: string) {
  return hostname
    .toLocaleLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function ipv4Parts(address: string) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isCloudMetadataTarget(hostnameOrAddress: string) {
  return metadataHostnames.has(normaliseHostname(hostnameOrAddress));
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const normalised = normaliseHostname(address);
  const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateOrReservedAddress(mapped);

  if (isIP(normalised) === 4) {
    const parts = ipv4Parts(normalised);
    if (!parts) return true;
    const [a = 0, b = 0] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && parts[2] === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && parts[2] === 100) ||
      (a === 203 && b === 0 && parts[2] === 113) ||
      a >= 224
    );
  }

  if (isIP(normalised) === 6) {
    if (normalised === "::" || normalised === "::1") return true;
    const first = Number.parseInt(normalised.split(":")[0] || "0", 16);
    return (
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00 ||
      normalised.startsWith("2001:db8:")
    );
  }

  return true;
}

export interface ResolvedTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
}

export async function resolveAndValidateTarget(
  url: URL,
  allowPrivateNetwork: boolean,
): Promise<ResolvedTarget> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RequestDomainError(
      "Only HTTP and HTTPS destinations are allowed.",
      "PROTOCOL_BLOCKED",
    );
  }

  if (url.username || url.password) {
    throw new RequestDomainError(
      "Credentials embedded in URLs are not allowed.",
      "URL_CREDENTIALS_BLOCKED",
    );
  }

  const hostname = normaliseHostname(url.hostname);
  if (!hostname || isCloudMetadataTarget(hostname)) {
    throw new RequestDomainError(
      "Cloud metadata destinations are blocked.",
      "METADATA_BLOCKED",
    );
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length) {
    throw new RequestDomainError("Destination did not resolve.", "DNS_EMPTY");
  }

  for (const candidate of addresses) {
    if (isCloudMetadataTarget(candidate.address)) {
      throw new RequestDomainError(
        "Cloud metadata destinations are blocked.",
        "METADATA_BLOCKED",
      );
    }
    if (!allowPrivateNetwork && isPrivateOrReservedAddress(candidate.address)) {
      throw new RequestDomainError(
        "Private and reserved network destinations are blocked. Enable the per-request private-network setting only for a trusted local API.",
        "PRIVATE_NETWORK_BLOCKED",
      );
    }
  }

  const target = addresses[0];
  if (!target || (target.family !== 4 && target.family !== 6)) {
    throw new RequestDomainError(
      "Destination address is invalid.",
      "DNS_INVALID",
    );
  }
  return { hostname, address: target.address, family: target.family };
}
