import ipaddr from "ipaddr.js";

import { authError } from "./auth-errors.js";

export function resolveAuthClientIp(input: {
  socketPeer: string | undefined;
  forwardedFor: string | readonly string[] | undefined;
  trustedProxyCidrs: readonly string[];
}): string {
  const peer = parseAddress(input.socketPeer);
  if (!isTrusted(peer, input.trustedProxyCidrs)) return peer.toString().toLowerCase();
  if (input.forwardedFor === undefined) return peer.toString().toLowerCase();
  if (typeof input.forwardedFor !== "string" || input.forwardedFor.includes(",")) {
    throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
  }
  return parseAddress(input.forwardedFor.trim()).toString().toLowerCase();
}

function parseAddress(value: string | undefined): ipaddr.IPv4 | ipaddr.IPv6 {
  try {
    if (!value || value.includes("%")) throw new Error("invalid");
    return ipaddr.process(value);
  } catch {
    throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
  }
}

function isTrusted(address: ipaddr.IPv4 | ipaddr.IPv6, cidrs: readonly string[]): boolean {
  return cidrs.some((entry) => {
    try {
      const [network, prefix] = entry.includes("/")
        ? ipaddr.parseCIDR(entry)
        : [ipaddr.process(entry), ipaddr.process(entry).kind() === "ipv4" ? 32 : 128];
      return address.kind() === network.kind() && address.match(network, prefix);
    } catch {
      throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
    }
  });
}
