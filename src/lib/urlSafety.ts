import dns from "node:dns/promises";
import net from "node:net";

export function isPrivateIpAddress(ip: string): boolean {
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(clean) === 4) {
    const [a, b] = clean.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIP(clean) === 6) {
    if (clean === "::" || clean === "::1" || clean === "0:0:0:0:0:0:0:1") {
      return true;
    }
    if (
      clean.startsWith("fc") ||
      clean.startsWith("fd") ||
      clean.startsWith("fe80")
    ) {
      return true;
    }
    if (clean.startsWith("::ffff:")) {
      const mapped = clean.slice("::ffff:".length);
      if (net.isIP(mapped) === 4) {
        return isPrivateIpAddress(mapped);
      }
      // Node URL parser normalizes IPv4-mapped IPv6 into hex pairs (e.g. ::ffff:7f00:1)
      const parts = mapped.split(":");
      if (parts.length === 2) {
        const hi = parseInt(parts[0], 16);
        const lo = parseInt(parts[1], 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
          return isPrivateIpAddress(ipv4);
        }
      }
      return true;
    }
    return false;
  }
  return false;
}

export function isBlockedImportHostname(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !clean ||
    clean === "localhost" ||
    clean === "0.0.0.0" ||
    clean.endsWith(".localhost") ||
    clean.endsWith(".local") ||
    clean.endsWith(".internal")
  ) {
    return true;
  }
  if (net.isIP(clean) !== 0) {
    return isPrivateIpAddress(clean);
  }
  return false;
}

export async function validatePublicScrapeUrl(
  rawUrl: string,
  lookupFn: (hostname: string) => Promise<Array<{ address: string }>> = (h) =>
    dns.lookup(h, { all: true })
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: "Please enter a valid https:// URL." };
  }

  if (parsedUrl.protocol !== "https:") {
    return { ok: false, error: "Only public https:// channel URLs are supported." };
  }

  const rawHost = parsedUrl.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedImportHostname(rawHost)) {
    return { ok: false, error: "Private or local URLs are not permitted." };
  }

  if (net.isIP(rawHost) === 0) {
    try {
      const resolved = await lookupFn(rawHost);
      if (
        !Array.isArray(resolved) ||
        resolved.length === 0 ||
        resolved.some((r) => isPrivateIpAddress(r.address))
      ) {
        return { ok: false, error: "Target hostname resolves to a restricted network." };
      }
    } catch {
      return { ok: false, error: "Unable to resolve channel URL hostname." };
    }
  }

  return { ok: true, url: parsedUrl };
}
