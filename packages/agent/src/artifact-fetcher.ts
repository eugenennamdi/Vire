import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { encodeAbiParameters, keccak256, type Hex } from "viem";

export interface FetchedArtifact {
  normalizedUrl: string;
  sourceKind: "github_pr" | "github_issue" | "x_post" | "web_post";
  title: string;
  authorHandle: string | null;
  /** Immutable platform user ID (X numeric author.id or GitHub user.id) — blocks handle-rename Sybil farming. */
  authorId?: string | null;
  /** Author follower count when available from platform metadata. */
  authorFollowers?: number | null;
  /** Account creation timestamp in epoch ms when available from platform metadata. */
  authorJoinedAtMs?: number | null;
  /** Post/PR creation timestamp in epoch ms when available. */
  createdAtMs?: number | null;
  /** True when an X post is a reply rather than a standalone original post. */
  isReply?: boolean;
  /** True when an X post is a retweet/repost rather than original content. */
  isRepost?: boolean;
  /** Raw platform text body without synthetic metadata prefixes. */
  rawText?: string;
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

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

/** Parse canonical X/Twitter status handle + tweet ID when URL points to a public post. */
export function parseXStatusUrl(url: URL): { handle: string; tweetId: string } | null {
  if (!X_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,32})\/status\/(\d+)/i);
  if (!match) return null;
  return { handle: match[1]!, tweetId: match[2]! };
}

/**
 * Normalize URL for deterministic anti-duplicate hashing:
 * - X/Twitter posts canonicalize strictly by numeric tweetId (`https://x.com/i/status/<id>`) so
 *   `x.com/i/status/123`, `x.com/anyhandle/status/123`, `mobile.x.com/...`, and `twitter.com/...`
 *   ALL hash identically and cannot bypass replay protection.
 */
export function normalizeDeliverableUrl(rawUrl: string): string {
  const u = new URL(rawUrl.trim());
  u.hash = "";
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "s", "t"]) {
    u.searchParams.delete(key);
  }
  const xStatus = parseXStatusUrl(u);
  if (xStatus) {
    return `https://x.com/i/status/${xStatus.tweetId}`;
  }
  u.searchParams.sort();
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`;
}

/** Personal 4-hex-char anti-hijack claim tag derived deterministically from the contributor's wallet. */
export function buildWalletClaimCode(walletAddress: string): string {
  const clean = walletAddress.trim().replace(/^0x/i, "");
  return `VIRE-${clean.slice(-4).toUpperCase()}`;
}

/** Strip URLs, @mentions, #hashtags, and personal VIRE-XXXX codes to isolate original commentary text. */
export function extractOriginalCommentary(rawText: string): string {
  return rawText
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@[A-Za-z0-9_]+/g, " ")
    .replace(/#[A-Za-z0-9_]+/g, " ")
    .replace(/\bVIRE-[A-F0-9]{4}\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Deterministic per-campaign hash of normalized original post body (blocks word-for-word copy-paste spam). */
export function computeContentHash(campaignIdBytes32: Hex, rawText: string): Hex {
  const normalizedBody = extractOriginalCommentary(rawText);
  return keccak256(
    encodeAbiParameters(
      [
        { name: "campaignId", type: "bytes32" },
        { name: "normalizedBody", type: "string" },
      ],
      [campaignIdBytes32, normalizedBody]
    )
  );
}

/**
 * Deterministic onchain bytes32 deliverable hash matching VireVault replay protection.
 * Intentionally binds ONLY (campaignId, normalizedUrl) so a second wallet/handle cannot
 * replay an already-claimed X post or GitHub PR URL under a different handle.
 */
export function computeDeliverableHash(params: {
  campaignIdBytes32: Hex;
  deliverableUrl: string;
  /** @deprecated Ignored so the same URL cannot be replayed across handles. */
  contributorHandle?: string;
}): Hex {
  const normalizedUrl = normalizeDeliverableUrl(params.deliverableUrl);
  return keccak256(
    encodeAbiParameters(
      [
        { name: "campaignId", type: "bytes32" },
        { name: "normalizedUrl", type: "string" },
      ],
      [params.campaignIdBytes32, normalizedUrl]
    )
  );
}

function stripHtmlToExcerpt(html: string, maxChars = 4_000): { title: string; excerpt: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]{1,240})<\/title>/i);
  const title = (titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Preserve external href URLs (e.g. oEmbed tweet links) before stripping anchor tags
    .replace(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/gi, " $1 ")
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
      created_at?: string;
      user?: { login?: string; id?: number };
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

    const ghCreatedAtMs = data.created_at ? Date.parse(data.created_at) : Number.NaN;
    return {
      normalizedUrl,
      sourceKind: kind === "pull" ? "github_pr" : "github_issue",
      title: data.title ?? `${owner}/${repo}#${num}`,
      authorHandle: data.user?.login ?? null,
      authorId: data.user?.id !== undefined ? `gh:${data.user.id}` : null,
      createdAtMs: Number.isFinite(ghCreatedAtMs) ? ghCreatedAtMs : null,
      rawText: `${data.title ?? ""}\n${data.body ?? ""}`.trim(),
      excerpt: `[${metaLine}] ${(data.body ?? "").slice(0, 3_500)}`,
      httpStatus: res.status,
      reachable: true,
    };
  }

  // Dedicated X (Twitter) public post extraction — X blocks raw fetch with a JS shell,
  // so we resolve full tweet text, immutable author ID, followers, account age, and expanded URLs via FxTwitter.
  const xStatus = parseXStatusUrl(safeUrl);
  if (xStatus) {
    try {
      const fxRes = await fetchFn(
        `https://api.fxtwitter.com/${encodeURIComponent(xStatus.handle)}/status/${xStatus.tweetId}`,
        {
          headers: { Accept: "application/json", "User-Agent": "Vire-Settlement-Agent/1.0" },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (fxRes.ok) {
        const fx = (await fxRes.json()) as {
          code?: number;
          tweet?: {
            text?: string;
            created_at?: string;
            created_timestamp?: number;
            likes?: number;
            retweets?: number;
            views?: number;
            replying_to?: string | null;
            reposted_by?: unknown;
            author?: {
              id?: string;
              screen_name?: string;
              name?: string;
              followers?: number;
              joined?: string;
            };
            raw_text?: { facets?: Array<{ type?: string; replacement?: string; original?: string }> };
          };
        };
        if (fx.tweet?.text) {
          const authorScreen = fx.tweet.author?.screen_name ?? (xStatus.handle.toLowerCase() === "i" ? null : xStatus.handle);
          const expandedUrls = (fx.tweet.raw_text?.facets ?? [])
            .filter((f) => f.type === "url" && f.replacement)
            .map((f) => f.replacement!);
          const metaParts = [
            authorScreen ? `author=@${authorScreen}` : null,
            fx.tweet.created_at ? `created_at=${fx.tweet.created_at}` : null,
            fx.tweet.likes !== undefined ? `likes=${fx.tweet.likes}` : null,
            fx.tweet.views !== undefined ? `views=${fx.tweet.views}` : null,
            expandedUrls.length > 0 ? `links=[${expandedUrls.join(", ")}]` : null,
          ]
            .filter(Boolean)
            .join(", ");

          const joinedMs = fx.tweet.author?.joined ? Date.parse(fx.tweet.author.joined) : Number.NaN;
          const tweetCreatedMs =
            typeof fx.tweet.created_timestamp === "number" && Number.isFinite(fx.tweet.created_timestamp)
              ? fx.tweet.created_timestamp * 1000
              : fx.tweet.created_at
                ? Date.parse(fx.tweet.created_at)
                : Number.NaN;

          return {
            normalizedUrl,
            sourceKind: "x_post",
            title: authorScreen ? `X post by @${authorScreen}` : "X post",
            authorHandle: authorScreen,
            authorId: fx.tweet.author?.id ? `x:${fx.tweet.author.id}` : null,
            authorFollowers:
              typeof fx.tweet.author?.followers === "number" ? fx.tweet.author.followers : null,
            authorJoinedAtMs: Number.isFinite(joinedMs) ? joinedMs : null,
            createdAtMs: Number.isFinite(tweetCreatedMs) ? tweetCreatedMs : null,
            isReply: Boolean(fx.tweet.replying_to),
            isRepost: Boolean(fx.tweet.reposted_by) || /^RT\s+@/i.test(fx.tweet.text.trim()),
            rawText: fx.tweet.text,
            excerpt: `[${metaParts}] ${fx.tweet.text}`.slice(0, 3_800),
            httpStatus: 200,
            reachable: true,
          };
        }
      }
    } catch {
      // Fall through to official oEmbed below
    }

    try {
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(`https://twitter.com/${xStatus.handle}/status/${xStatus.tweetId}`)}&omit_script=true`;
      const oeRes = await fetchFn(oembedUrl, {
        headers: { Accept: "application/json", "User-Agent": "Vire-Settlement-Agent/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (oeRes.ok) {
        const oe = (await oeRes.json()) as { author_name?: string; author_url?: string; html?: string };
        const { excerpt } = stripHtmlToExcerpt(oe.html ?? "");
        const authorFromUrl = oe.author_url?.match(/twitter\.com\/([A-Za-z0-9_]{1,32})/i)?.[1] ?? null;
        const resolvedHandle = authorFromUrl ?? (xStatus.handle.toLowerCase() === "i" ? null : xStatus.handle);
        if (excerpt) {
          return {
            normalizedUrl,
            sourceKind: "x_post",
            title: resolvedHandle ? `X post by @${resolvedHandle}` : "X post",
            authorHandle: resolvedHandle,
            rawText: excerpt,
            excerpt: `[author=@${resolvedHandle ?? "unknown"}, source=oembed] ${excerpt}`.slice(0, 3_800),
            httpStatus: 200,
            reachable: true,
          };
        }
      }
    } catch {
      // Fall through to fail-closed unreachable result below
    }

    return {
      normalizedUrl,
      sourceKind: "x_post",
      title: `X post by @${xStatus.handle}`,
      authorHandle: xStatus.handle,
      excerpt: "Unable to verify public X post content (post may be deleted, private, or unreachable).",
      httpStatus: 404,
      reachable: false,
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
