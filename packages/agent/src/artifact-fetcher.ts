import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { encodeAbiParameters, keccak256, type Hex } from "viem";

export interface FetchedArtifact {
  normalizedUrl: string;
  sourceKind: "github_pr" | "github_issue" | "web_post";
  title: string;
  authorHandle: string | null;
  excerpt: string;
  httpStatus: number;
  reachable: boolean;
}

/** Check whether an IPv4 or IPv6 literal is loopback, link-local, or RFC1918 private. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (clean === "::1" || clean === "::" || clean.startsWith("fe80:") || clean.startsWith("fc") || clean.startsWith("fd")) {
    return true;
  }
  const v4Mapped = clean.startsWith("::ffff:") ? clean.slice(7) : clean;
  const parts = v4Mapped.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return clean.includes(":"); // block unknown non-global IPv6 patterns conservatively
  }
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // cloud metadata & link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Strict SSRF-safe URL validator (protocol + hostname + DNS resolution guard). */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid deliverable URL format");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Blocked non-HTTP protocol: ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error(`Blocked internal hostname: ${host}`);
  }

  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(`Blocked private/reserved IP address: ${host}`);
    }
    return parsed;
  }

  const records = await lookup(host, { all: true }).catch(() => {
    throw new Error(`Unable to resolve deliverable host: ${host}`);
  });
  if (records.length === 0) {
    throw new Error(`No DNS records found for host: ${host}`);
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(`Blocked private DNS target ${rec.address} for host ${host}`);
    }
  }
  return parsed;
}

/** Normalize URL for deterministic anti-duplicate hashing (lowercase host, strip hash & tracking params). */
export function normalizeDeliverableUrl(rawUrl: string): string {
  const u = new URL(rawUrl.trim());
  u.hash = "";
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "s", "t"]) {
    u.searchParams.delete(key);
  }
  u.searchParams.sort();
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`;
}

/** Deterministic onchain bytes32 deliverable hash matching VireVault replay protection. */
export function computeDeliverableHash(params: {
  campaignIdBytes32: Hex;
  deliverableUrl: string;
  contributorHandle?: string;
}): Hex {
  const normalizedUrl = normalizeDeliverableUrl(params.deliverableUrl);
  return keccak256(
    encodeAbiParameters(
      [
        { name: "campaignId", type: "bytes32" },
        { name: "normalizedUrl", type: "string" },
        { name: "handle", type: "string" },
      ],
      [params.campaignIdBytes32, normalizedUrl, (params.contributorHandle ?? "").trim().toLowerCase()]
    )
  );
}

function stripHtmlToExcerpt(html: string, maxChars = 4_000): { title: string; excerpt: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]{1,240})<\/title>/i);
  const title = (titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, excerpt: stripped.slice(0, maxChars) };
}

/**
 * Fetch off-chain deliverable evidence (GitHub PR/Issue via API or public promo webpage) safely.
 */
export async function fetchDeliverableArtifact(params: {
  deliverableUrl: string;
  githubApiToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<FetchedArtifact> {
  const safeUrl = await assertSafePublicUrl(params.deliverableUrl);
  const normalizedUrl = normalizeDeliverableUrl(safeUrl.toString());
  const fetchFn = params.fetchImpl ?? fetch;

  // Dedicated GitHub PR / Issue API extraction for QA bugs & localization PRs
  const ghMatch = safeUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)\/?$/);
  if (safeUrl.hostname.toLowerCase() === "github.com" && ghMatch) {
    const [, owner, repo, kind, num] = ghMatch;
    const apiPath = kind === "pull" ? `pulls/${num}` : `issues/${num}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "Vire-Settlement-Agent/1.0",
    };
    if (params.githubApiToken) {
      headers.Authorization = `Bearer ${params.githubApiToken}`;
    }

    const res = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/${apiPath}`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return {
        normalizedUrl,
        sourceKind: kind === "pull" ? "github_pr" : "github_issue",
        title: `GitHub ${owner}/${repo}#${num}`,
        authorHandle: null,
        excerpt: `GitHub API returned HTTP ${res.status}`,
        httpStatus: res.status,
        reachable: false,
      };
    }

    const data = (await res.json()) as {
      title?: string;
      body?: string;
      state?: string;
      merged?: boolean;
      user?: { login?: string };
      changed_files?: number;
      additions?: number;
      deletions?: number;
    };

    const metaLine = [
      `state=${data.state ?? "unknown"}`,
      data.merged !== undefined ? `merged=${String(data.merged)}` : null,
      data.changed_files !== undefined ? `files=${data.changed_files}` : null,
      data.additions !== undefined ? `+${data.additions}/-${data.deletions ?? 0}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    return {
      normalizedUrl,
      sourceKind: kind === "pull" ? "github_pr" : "github_issue",
      title: data.title ?? `${owner}/${repo}#${num}`,
      authorHandle: data.user?.login ?? null,
      excerpt: `[${metaLine}] ${(data.body ?? "").slice(0, 3_500)}`,
      httpStatus: res.status,
      reachable: true,
    };
  }

  // Generic public promo post / social / referral URL fetch (blocks redirects to internal hosts)
  const res = await fetchFn(safeUrl.toString(), {
    method: "GET",
    headers: {
      "User-Agent": "Vire-Settlement-Agent/1.0",
      Accept: "text/html,application/json,text/plain;q=0.9",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      const redirected = new URL(loc, safeUrl).toString();
      await assertSafePublicUrl(redirected);
    }
  }

  const rawText = (await res.text()).slice(0, 32_768);
  const { title, excerpt } = stripHtmlToExcerpt(rawText);

  return {
    normalizedUrl,
    sourceKind: "web_post",
    title: title || safeUrl.hostname,
    authorHandle: null,
    excerpt: excerpt || `HTTP ${res.status} response from ${safeUrl.hostname}`,
    httpStatus: res.status,
    reachable: res.status >= 200 && res.status < 400,
  };
}
