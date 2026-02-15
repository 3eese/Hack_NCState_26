export type EvidenceLink = {
    title: string;
    url: string;
    domain: string;
    snippet: string;
    rank: number;
    trustScore: number;
    trustLevel: 'high' | 'medium' | 'low';
    trustedDomain: boolean;
    query: string;
};

type SearchOptions = {
    perQueryLimit?: number;
    maxQueries?: number;
};

type GoogleCustomSearchResponse = {
    searchInformation?: {
        totalResults?: string;
    };
    items?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        displayLink?: string;
    }>;
};

type SearchEvidenceResult = {
    queryCount: number;
    totalResultsReported: number;
    evidenceLinks: EvidenceLink[];
};

const DEFAULT_SEARCH_TIMEOUT_MS = 12000;
const DEFAULT_PER_QUERY_LIMIT = 5;
const DEFAULT_MAX_QUERIES = 2;
const DEFAULT_SEARCH_BASE_URL = 'https://www.googleapis.com/customsearch/v1';

const DEFAULT_TRUSTED_DOMAINS = [
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'npr.org',
    'nytimes.com',
    'wsj.com',
    'who.int',
    'cdc.gov',
    'fda.gov',
    'nasa.gov',
    'whitehouse.gov',
    'state.gov'
];

const DEFAULT_TRUSTED_SUFFIXES = ['.gov', '.edu'];

export class SearchRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

const resolveNumberEnv = (name: string, fallback: number): number => {
    const raw = Number(process.env[name]);
    if (Number.isFinite(raw) && raw > 0) {
        return raw;
    }
    return fallback;
};

const resolveApiKey = (): string => {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    if (!apiKey) {
        throw new SearchRequestError(500, 'Missing GOOGLE_SEARCH_API_KEY for verify search.');
    }
    return apiKey;
};

const resolveSearchEngineId = (): string => {
    const searchEngineId = process.env.GOOGLE_SEARCH_CX;
    if (!searchEngineId) {
        throw new SearchRequestError(500, 'Missing GOOGLE_SEARCH_CX for verify search.');
    }
    return searchEngineId;
};

const resolveBaseUrl = (): string => {
    const baseUrl = process.env.GOOGLE_SEARCH_BASE_URL ?? DEFAULT_SEARCH_BASE_URL;
    return baseUrl.replace(/\/+$/, '');
};

const resolveTrustedDomains = (): string[] => {
    const fromEnv = process.env.VERIFY_DOMAIN_ALLOWLIST;
    if (!fromEnv) {
        return DEFAULT_TRUSTED_DOMAINS;
    }

    const parsed = fromEnv
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);

    if (parsed.length === 0) {
        return DEFAULT_TRUSTED_DOMAINS;
    }

    return parsed;
};

const normalizeWhitespace = (value: string): string =>
    value
        .replace(/\r/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const normalizeDomain = (input: string): string => input.toLowerCase().replace(/^www\./, '').trim();

const extractDomain = (value: string): string | null => {
    try {
        const parsed = new URL(value);
        return normalizeDomain(parsed.hostname);
    } catch {
        return null;
    }
};

const normalizeUrl = (value: string): string => {
    try {
        const parsed = new URL(value);
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return value.trim();
    }
};

const isTrustedDomain = (domain: string, trustedDomains: string[]): boolean => {
    for (const trusted of trustedDomains) {
        const normalizedTrusted = normalizeDomain(trusted);
        if (domain === normalizedTrusted || domain.endsWith(`.${normalizedTrusted}`)) {
            return true;
        }
    }

    for (const suffix of DEFAULT_TRUSTED_SUFFIXES) {
        if (domain.endsWith(suffix)) {
            return true;
        }
    }

    return false;
};

const domainTrustScore = (domain: string, trustedDomains: string[]): number => {
    if (isTrustedDomain(domain, trustedDomains)) {
        return 0.9;
    }
    if (domain.endsWith('.org')) {
        return 0.65;
    }
    return 0.45;
};

const trustLevelFromScore = (score: number): 'high' | 'medium' | 'low' => {
    if (score >= 0.8) {
        return 'high';
    }
    if (score >= 0.6) {
        return 'medium';
    }
    return 'low';
};

const searchGoogle = async (query: string, limit: number): Promise<GoogleCustomSearchResponse> => {
    const apiKey = resolveApiKey();
    const cx = resolveSearchEngineId();
    const baseUrl = resolveBaseUrl();
    const timeoutMs = resolveNumberEnv('SEARCH_TIMEOUT_MS', DEFAULT_SEARCH_TIMEOUT_MS);

    const params = new URLSearchParams({
        key: apiKey,
        cx,
        q: query,
        num: String(Math.min(10, Math.max(1, limit)))
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${baseUrl}?${params.toString()}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Search] Google API error:', response.status, errorText.slice(0, 500));
            const mappedStatus = response.status >= 500 ? 502 : response.status;
            throw new SearchRequestError(mappedStatus, 'Search provider request failed.');
        }

        return (await response.json()) as GoogleCustomSearchResponse;
    } catch (error) {
        if (error instanceof SearchRequestError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new SearchRequestError(504, 'Search request timed out.');
        }
        throw new SearchRequestError(502, 'Unable to reach search provider.');
    } finally {
        clearTimeout(timeout);
    }
};

export const searchEvidenceForQueries = async (
    rawQueries: string[],
    options: SearchOptions = {}
): Promise<SearchEvidenceResult> => {
    if (!Array.isArray(rawQueries) || rawQueries.length === 0) {
        throw new SearchRequestError(400, 'At least one search query is required.');
    }

    const trustedDomains = resolveTrustedDomains();
    const perQueryLimit = Math.min(10, Math.max(1, options.perQueryLimit ?? DEFAULT_PER_QUERY_LIMIT));
    const maxQueries = Math.min(4, Math.max(1, options.maxQueries ?? DEFAULT_MAX_QUERIES));

    const queries = rawQueries
        .map((query) => normalizeWhitespace(query))
        .filter(Boolean)
        .slice(0, maxQueries);

    if (queries.length === 0) {
        throw new SearchRequestError(400, 'Search queries are empty.');
    }

    const dedupedByUrl = new Map<string, EvidenceLink>();
    let totalResultsReported = 0;
    let localRank = 0;

    for (const query of queries) {
        const payload = await searchGoogle(query, perQueryLimit);
        const reported = Number(payload.searchInformation?.totalResults ?? 0);
        if (Number.isFinite(reported) && reported > 0) {
            totalResultsReported += reported;
        }

        const items = payload.items ?? [];
        for (const item of items) {
            const link = typeof item.link === 'string' ? normalizeUrl(item.link) : '';
            const domain = extractDomain(link);
            if (!link || !domain) {
                continue;
            }

            const trustScore = domainTrustScore(domain, trustedDomains);
            const trustedDomain = isTrustedDomain(domain, trustedDomains);
            localRank += 1;

            const evidence: EvidenceLink = {
                title:
                    typeof item.title === 'string' && item.title.trim().length > 0
                        ? normalizeWhitespace(item.title)
                        : link,
                url: link,
                domain,
                snippet: normalizeWhitespace(item.snippet ?? ''),
                rank: localRank,
                trustScore,
                trustLevel: trustLevelFromScore(trustScore),
                trustedDomain,
                query
            };

            // Keep the best-scoring candidate if multiple queries return the same URL.
            const existing = dedupedByUrl.get(link);
            if (!existing || evidence.trustScore > existing.trustScore) {
                dedupedByUrl.set(link, evidence);
            }
        }
    }

    const evidenceLinks = [...dedupedByUrl.values()]
        .sort((a, b) => b.trustScore - a.trustScore || a.rank - b.rank)
        .slice(0, Math.max(perQueryLimit * queries.length, perQueryLimit));

    return {
        queryCount: queries.length,
        totalResultsReported,
        evidenceLinks
    };
};
