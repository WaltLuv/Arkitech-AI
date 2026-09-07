/**
 * Browser site authorisation: which destinations a browser run may reach.
 *
 * Pure functions, so every rule is testable without a browser. The decision
 * takes exactly two inputs: the URL the browser wants, and the policy loaded
 * from the owner's row in the database. Nothing a web page says is an input.
 * A page cannot widen the policy, because there is no path from page content
 * to this function other than the URL it is asking for, and that URL is what
 * is being judged.
 *
 * Two layers, in order:
 *
 * 1. Destinations that are never allowed, whatever the owner configured:
 *    loopback, private and link-local networks, cloud metadata endpoints,
 *    and intranet-style names. These cannot be added to an allow list; the
 *    rule parser refuses them.
 * 2. The owner's policy: an allow list of hosts, and whether public websites
 *    outside the list are permitted at all.
 */

export type SitePolicy = {
    /** Public websites not on the list are allowed. Never covers layer 1. */
    allowPublic: boolean;
    /** Host rules. `example.com` covers the host and every subdomain. */
    allowedHosts: string[];
};

export const DEFAULT_SITE_POLICY: SitePolicy = { allowPublic: true, allowedHosts: [] };

export const MAX_ALLOWED_HOSTS = 200;

export type DenyReason =
    | "invalid_url"
    | "unsupported_scheme"
    | "loopback"
    | "private_network"
    | "link_local"
    | "metadata_endpoint"
    | "reserved_host"
    | "not_in_policy";

export type SiteDecision =
    | { allowed: true; host: string }
    | { allowed: false; reason: DenyReason; host: string };

/** Schemes that carry no network destination and so have nothing to judge. */
const INLINE_SCHEMES = new Set(["about:", "data:", "blob:", "chrome-error:"]);

/** Schemes that reach a network host. Everything else is refused. */
const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

/** Cloud metadata services, by name. IP forms are caught by classification. */
const METADATA_HOSTS = new Set([
    "metadata.google.internal",
    "metadata.goog",
    "metadata",
    "instance-data",
    "instance-data.ec2.internal",
]);

/** Metadata service addresses that are not inside link-local space. */
const METADATA_ADDRESSES = new Set([
    "169.254.169.254",
    "169.254.170.2",
    "100.100.100.200",
    "192.0.0.192",
    "fd00:ec2::254",
]);

/** Suffixes that name a local network, not the internet. */
const RESERVED_SUFFIXES = [
    ".localhost", ".local", ".internal", ".localdomain", ".home.arpa",
    ".intranet", ".lan", ".corp", ".home", ".private",
];

export type AddressClass =
    | "public" | "loopback" | "private" | "link_local" | "metadata" | "reserved" | "invalid";

function parseIPv4(text: string): number[] | null {
    const parts = text.split(".");
    if (parts.length !== 4) return null;
    const octets: number[] = [];
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const value = Number(part);
        if (value > 255) return null;
        octets.push(value);
    }
    return octets;
}

/** Expands an IPv6 literal into eight 16-bit groups, or null if malformed. */
function parseIPv6(text: string): number[] | null {
    let body = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
    const zone = body.indexOf("%");
    if (zone !== -1) body = body.slice(0, zone);
    if (!/^[0-9a-f:.]+$/i.test(body)) return null;

    // An embedded IPv4 tail, as in ::ffff:127.0.0.1.
    const lastColon = body.lastIndexOf(":");
    if (body.includes(".")) {
        const v4 = parseIPv4(body.slice(lastColon + 1));
        if (!v4) return null;
        const hi = ((v4[0] << 8) | v4[1]).toString(16);
        const lo = ((v4[2] << 8) | v4[3]).toString(16);
        body = `${body.slice(0, lastColon)}:${hi}:${lo}`;
    }

    const halves = body.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    if (halves.length === 1 && head.length !== 8) return null;
    if (head.length + tail.length > 8) return null;

    const groups = [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
    const values: number[] = [];
    for (const group of groups) {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
        values.push(parseInt(group, 16));
    }
    return values;
}

function classifyIPv4(o: number[]): AddressClass {
    const [a, b] = o;
    const dotted = o.join(".");
    if (METADATA_ADDRESSES.has(dotted)) return "metadata";
    if (a === 127) return "loopback";
    if (a === 0) return "loopback";            // 0.0.0.0/8 reaches this host
    if (a === 10) return "private";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "private"; // carrier-grade NAT
    if (a === 169 && b === 254) return "link_local";
    if (a === 192 && b === 0 && o[2] === 0) return "reserved";
    if (a === 198 && (b === 18 || b === 19)) return "reserved"; // benchmarking
    if (a >= 224) return "reserved";           // multicast and future use
    return "public";
}

function classifyIPv6(g: number[], literal: string): AddressClass {
    if (METADATA_ADDRESSES.has(literal.toLowerCase().replace(/^\[|\]$/g, ""))) return "metadata";
    const allZeroButLast = g.slice(0, 7).every(v => v === 0);
    if (allZeroButLast && g[7] === 1) return "loopback";   // ::1
    if (allZeroButLast && g[7] === 0) return "loopback";   // ::
    // ::ffff:a.b.c.d is an IPv4 address in disguise. Judge the IPv4.
    if (g.slice(0, 5).every(v => v === 0) && g[5] === 0xffff) {
        return classifyIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return "private";      // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return "link_local";   // fe80::/10
    if (g[0] === 0x2001 && g[1] === 0x0db8) return "reserved"; // documentation
    if ((g[0] & 0xff00) === 0xff00) return "reserved";     // multicast
    return "public";
}

/** Where an address points. Anything not clearly public is not public. */
export function classifyAddress(address: string): AddressClass {
    if (typeof address !== "string" || address.length === 0) return "invalid";
    const v4 = parseIPv4(address);
    if (v4) return classifyIPv4(v4);
    const v6 = parseIPv6(address);
    if (v6) return classifyIPv6(v6, address);
    return "invalid";
}

export function isIpLiteral(host: string): boolean {
    return parseIPv4(host) !== null || parseIPv6(host) !== null;
}

/** Hosts that are refused whatever the policy says. */
export function reservedHostReason(host: string): DenyReason | null {
    const h = host.toLowerCase().replace(/\.$/, "");
    if (h === "localhost") return "loopback";
    if (METADATA_HOSTS.has(h)) return "metadata_endpoint";
    for (const suffix of RESERVED_SUFFIXES) {
        if (h.endsWith(suffix)) return "reserved_host";
    }
    // A single label is an intranet name, never an internet host.
    if (!h.includes(".")) return "reserved_host";
    return null;
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Turns what a person typed into a host rule, or refuses it.
 *
 * Accepts `example.com`, `https://example.com/path`, `*.example.com` and
 * `EXAMPLE.COM:443`, all as `example.com`. Refuses IP literals (an address
 * is not a site), bare labels, and every always-blocked name, so a rule can
 * never be a way round layer 1.
 */
export function normaliseHostRule(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    let text = raw.trim().toLowerCase();
    if (text.length === 0 || text.length > 253) return null;

    if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
        try {
            text = new URL(text).hostname;
        } catch {
            return null;
        }
    } else {
        text = text.split("/")[0].split("?")[0].split("#")[0];
        text = text.replace(/:\d+$/, "");
    }

    text = text.replace(/^\*\./, "").replace(/^\./, "").replace(/\.$/, "");
    if (text.length === 0) return null;
    if (isIpLiteral(text) || text.startsWith("[")) return null;
    if (reservedHostReason(text) !== null) return null;

    const labels = text.split(".");
    if (labels.length < 2) return null;
    if (!labels.every(label => HOST_LABEL.test(label))) return null;
    // A public suffix on its own would allow everything beneath it.
    if (labels[labels.length - 1].length < 2) return null;

    return text;
}

export type ParsedPolicy =
    | { ok: true; policy: SitePolicy }
    | { ok: false; error: string };

/** Validates an untrusted policy body. Every rule passes the normaliser. */
export function parseSitePolicy(raw: unknown): ParsedPolicy {
    if (!raw || typeof raw !== "object") return { ok: false, error: "policy must be an object" };
    const body = raw as { allowPublic?: unknown; allowedHosts?: unknown };

    if (typeof body.allowPublic !== "boolean") return { ok: false, error: "allowPublic must be true or false" };
    if (!Array.isArray(body.allowedHosts)) return { ok: false, error: "allowedHosts must be a list" };
    if (body.allowedHosts.length > MAX_ALLOWED_HOSTS) {
        return { ok: false, error: `allowedHosts may hold at most ${MAX_ALLOWED_HOSTS} rules` };
    }

    const hosts = new Set<string>();
    for (const entry of body.allowedHosts) {
        const rule = normaliseHostRule(entry);
        if (!rule) {
            const shown = typeof entry === "string" ? entry.slice(0, 80) : String(entry);
            return { ok: false, error: `"${shown}" is not a host that can be allowed` };
        }
        hosts.add(rule);
    }

    return { ok: true, policy: { allowPublic: body.allowPublic, allowedHosts: [...hosts].sort() } };
}

/** `example.com` matches `example.com` and `www.example.com`, never `notexample.com`. */
export function hostMatchesRule(host: string, rule: string): boolean {
    return host === rule || host.endsWith(`.${rule}`);
}

/**
 * The decision. `resolvedAddresses` are what the host resolved to, when the
 * caller looked; a public name that resolves into a private network is
 * refused, which is the rebinding case.
 */
export function evaluateUrl(
    url: string,
    policy: SitePolicy,
    resolvedAddresses: readonly string[] = [],
): SiteDecision {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { allowed: false, reason: "invalid_url", host: "" };
    }

    if (INLINE_SCHEMES.has(parsed.protocol)) return { allowed: true, host: "" };
    if (!NETWORK_SCHEMES.has(parsed.protocol)) {
        return { allowed: false, reason: "unsupported_scheme", host: parsed.hostname };
    }

    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return { allowed: false, reason: "invalid_url", host };

    if (parsed.username || parsed.password) {
        // Credentials in a URL are both a leak and a classic confusion trick.
        return { allowed: false, reason: "invalid_url", host };
    }

    if (isIpLiteral(host)) {
        const cls = classifyAddress(host);
        const denied = denyForClass(cls);
        if (denied) return { allowed: false, reason: denied, host };
        // A public address is not a site anyone listed; only open policies allow it.
        return policy.allowPublic
            ? { allowed: true, host }
            : { allowed: false, reason: "not_in_policy", host };
    }

    const reserved = reservedHostReason(host);
    if (reserved) return { allowed: false, reason: reserved, host };

    for (const address of resolvedAddresses) {
        const denied = denyForClass(classifyAddress(address));
        if (denied) return { allowed: false, reason: denied, host };
    }

    if (policy.allowedHosts.some(rule => hostMatchesRule(host, rule))) return { allowed: true, host };
    if (policy.allowPublic) return { allowed: true, host };

    return { allowed: false, reason: "not_in_policy", host };
}

function denyForClass(cls: AddressClass): DenyReason | null {
    switch (cls) {
        case "public": return null;
        case "loopback": return "loopback";
        case "private": return "private_network";
        case "link_local": return "link_local";
        case "metadata": return "metadata_endpoint";
        case "reserved": return "reserved_host";
        case "invalid": return "invalid_url";
    }
}

/** True for anything a page could reach a private service through. */
export function isBlockedRegardlessOfPolicy(decision: SiteDecision): boolean {
    return !decision.allowed && decision.reason !== "not_in_policy";
}
