/**
 * Where the server may call out to, on an owner's behalf.
 *
 * A `webhook` or `api` integration is an owner's declared destination, and
 * "declared" does not make an address safe: loopback, the link-local metadata
 * endpoint and the private ranges are the standard server-side request forgery
 * targets, and on a self-hosted box the admin, the metadata service and the
 * database all sit on the other side of that line.
 *
 * Checked twice, for two different reasons:
 *
 * - **`reachable(url)`**, before anything is sent: the scheme, names that are
 *   private by definition, and an address written into the URL. It is also the
 *   only check an IP literal gets — `net.connect` does not look one up.
 * - **At connect time**, by `outbound`'s lookup: every address a name
 *   resolves to must be public. Here rather than in a lookup done first,
 *   because the socket then connects to the address that was checked — a name
 *   that answers "public" to the check and "127.0.0.1" to the connect (DNS
 *   rebinding) gets nowhere.
 *
 * And `send` refuses redirects, which `fetch` otherwise follows to wherever the
 * far end says — the metadata endpoint included.
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local: the cloud metadata endpoint
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64: an IPv4 address, possibly a private one
  ["fc00::", 7], // unique-local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const)
  blocked.addSubnet(network, prefix, "ipv6");

/**
 * An address the server may connect to on an owner's behalf.
 *
 * IPv4-mapped IPv6 (`::ffff:127.0.0.1`, which the URL parser writes as
 * `::ffff:7f00:1`) is a way to write loopback that no IPv6 range covers;
 * `BlockList` checks it against the IPv4 rules, which is what makes it safe.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** The scheme, private names, and an address written into the URL. */
export function reachable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "" || host.endsWith(".internal")) return false;
  return isIP(host) === 0 || isPublicAddress(host);
}

type Lookup = (
  hostname: string,
  options: LookupOptions & { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * A `net.connect` lookup that refuses a name resolving to anything private.
 *
 * Every address, not the first: a name with one public and one private record
 * is a coin toss on which the socket uses.
 */
export function guarded(resolve: Lookup = dnsLookup as unknown as Lookup) {
  return (
    hostname: string,
    options: LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "");
      const refused = addresses.find((a) => !isPublicAddress(a.address));
      if (refused || addresses.length === 0) {
        const denied: NodeJS.ErrnoException = new Error(
          `${hostname} resolves to an address this server will not call`,
        );
        denied.code = "EFCMSPRIVATE";
        return callback(denied, "");
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

/** The dispatcher every owner-declared call goes through. */
export const outbound = new Agent({ connect: { lookup: guarded() } });

/**
 * `fetch`, for an owner-declared destination: through `outbound`, and never
 * following a redirect.
 *
 * @param agent For tests, which need a resolver they control.
 */
export function send(url: string, init: RequestInit, agent: Agent = outbound): Promise<Response> {
  return fetch(url, { ...init, redirect: "error", dispatcher: agent } as RequestInit);
}
