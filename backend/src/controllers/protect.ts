import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeInputWithGemini, GeminiRequestError } from '../lib/gemini';

const normalizeInputType = (value: unknown): 'text' | 'url' | 'image' | null => {
    if (typeof value !== 'string') {
        return null;
    }

    if (value === 'text' || value === 'url' || value === 'image') {
        return value;
    }

    return null;
};

type ProtectRequestBody = {
    inputType?: unknown;
    content?: unknown;
    text?: unknown;
    url?: unknown;
    pageUrl?: unknown;
    resources?: unknown;
    normalizedPayload?: {
        text?: unknown;
        url?: {
            input?: unknown;
            final?: unknown;
        };
        resources?: unknown;
    };
};

type PhishingFlag = {
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
};

type LookalikeMatch = {
    url: string;
    hostname: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
};

type PiiDetection = {
    type: 'email' | 'phone' | 'ssn' | 'credit_card';
    count: number;
    examples: string[];
};

type TrackerEntry = {
    domain: string;
    owner?: string;
    category?: string;
};

type TrackerMatch = {
    resourceUrl: string;
    hostname: string;
    trackerDomain: string;
    owner?: string;
    category?: string;
};

class ProtectError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

const normalizeWhitespace = (value: string): string =>
    value
        .replace(/\r/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const readStringArray = (value: unknown, maxItems = 200): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    const items: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') {
            continue;
        }
        const trimmed = entry.trim();
        if (!trimmed) {
            continue;
        }
        items.push(trimmed);
        if (items.length >= maxItems) {
            break;
        }
    }
    return items;
};

const readTextFromBody = (body: ProtectRequestBody): string => {
    const candidates = [body.text, body.content, body.normalizedPayload?.text];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') {
            continue;
        }
        const normalized = normalizeWhitespace(candidate);
        if (normalized.length > 0) {
            return normalized.slice(0, 12000);
        }
    }
    return '';
};

const looksLikeUrl = (value: string): boolean => /^https?:\/\/|^www\./i.test(value.trim());

const normalizeUrl = (rawUrl: string): string | null => {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return null;
    }
    const withScheme = trimmed.startsWith('//')
        ? `https:${trimmed}`
        : trimmed.startsWith('http://') || trimmed.startsWith('https://')
            ? trimmed
            : `https://${trimmed}`;
    try {
        return new URL(withScheme).toString();
    } catch {
        return null;
    }
};

const extractUrlsFromText = (text: string): string[] => {
    if (!text) {
        return [];
    }
    const matches = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
    const wwwMatches = text.match(/www\.[^\s)]+/gi) ?? [];
    return [...matches, ...wwwMatches];
};

const collectUrls = (body: ProtectRequestBody, text: string): string[] => {
    const candidates: string[] = [];
    const direct = [body.url, body.content, body.normalizedPayload?.url?.input, body.normalizedPayload?.url?.final];
    for (const candidate of direct) {
        if (typeof candidate === 'string' && looksLikeUrl(candidate)) {
            candidates.push(candidate);
        }
    }

    for (const extracted of extractUrlsFromText(text)) {
        candidates.push(extracted);
    }

    const normalized: string[] = [];
    for (const candidate of candidates) {
        const normalizedUrl = normalizeUrl(candidate);
        if (!normalizedUrl) {
            continue;
        }
        if (!normalized.includes(normalizedUrl)) {
            normalized.push(normalizedUrl);
        }
    }
    return normalized;
};

const collectResourceUrls = (body: ProtectRequestBody, text: string): string[] => {
    const candidates: string[] = [];
    const resources = readStringArray(body.resources);
    const normalizedResources = readStringArray(body.normalizedPayload?.resources);
    candidates.push(...resources, ...normalizedResources);

    if (candidates.length === 0) {
        candidates.push(...extractUrlsFromText(text));
    } else {
        candidates.push(...extractUrlsFromText(text));
    }

    const normalized: string[] = [];
    for (const candidate of candidates) {
        const normalizedUrl = normalizeUrl(candidate);
        if (!normalizedUrl) {
            continue;
        }
        if (!normalized.includes(normalizedUrl)) {
            normalized.push(normalizedUrl);
        }
    }
    return normalized;
};

const resolvePrimaryUrl = (body: ProtectRequestBody, fallbackUrls: string[]): string | null => {
    const direct = [
        body.pageUrl,
        body.url,
        body.normalizedPayload?.url?.final,
        body.normalizedPayload?.url?.input
    ];
    for (const candidate of direct) {
        if (typeof candidate !== 'string') {
            continue;
        }
        const normalized = normalizeUrl(candidate);
        if (normalized) {
            return normalized;
        }
    }
    return fallbackUrls[0] ?? null;
};

const URGENCY_PATTERNS = [
    /urgent/i,
    /immediately/i,
    /action required/i,
    /within (?:24|48) hours/i,
    /final notice/i,
    /suspend(ed|ing)/i,
    /account (?:locked|limited|suspended)/i
];

const CREDENTIAL_PATTERNS = [
    /password/i,
    /login/i,
    /sign in/i,
    /verification code/i,
    /one[- ]time code/i,
    /ssn|social security/i,
    /bank account/i,
    /routing number/i,
    /credit card/i
];

const PAYMENT_PATTERNS = [
    /wire transfer/i,
    /gift card/i,
    /crypto/i,
    /bitcoin|ethereum|usdt/i,
    /payment required/i,
    /invoice/i
];

const buildPhishingFlags = (text: string): PhishingFlag[] => {
    const flags: PhishingFlag[] = [];
    const normalized = text.toLowerCase();

    if (URGENCY_PATTERNS.some((pattern) => pattern.test(normalized))) {
        flags.push({
            type: 'Urgency & pressure',
            description: 'Message uses urgent or threatening language to prompt quick action.',
            severity: 'medium'
        });
    }

    if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
        flags.push({
            type: 'Credential request',
            description: 'Message asks for passwords, codes, or sensitive account details.',
            severity: 'high'
        });
    }

    if (PAYMENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
        flags.push({
            type: 'Payment pressure',
            description: 'Message references transfers, crypto, or invoices that can indicate fraud.',
            severity: 'high'
        });
    }

    if (/click here|tap here|open the link|verify now/i.test(normalized)) {
        flags.push({
            type: 'Call-to-action link',
            description: 'Message encourages clicking a link, which is common in phishing.',
            severity: 'medium'
        });
    }

    return flags;
};

const SUSPICIOUS_TLDS = new Set([
    'zip',
    'mov',
    'xyz',
    'top',
    'click',
    'link',
    'live',
    'work',
    'shop',
    'gq',
    'cf',
    'tk',
    'ml'
]);

const SECOND_LEVEL_TLDS = new Set([
    'co.uk',
    'org.uk',
    'ac.uk',
    'gov.uk',
    'co.jp',
    'ne.jp',
    'or.jp',
    'com.au',
    'net.au',
    'org.au',
    'com.br',
    'com.mx',
    'com.tr',
    'com.sg',
    'com.hk',
    'com.tw',
    'com.my',
    'co.in',
    'com.ng',
    'co.za'
]);

const BRAND_DOMAINS: Record<string, string[]> = {
    paypal: ['paypal.com'],
    google: ['google.com'],
    gmail: ['gmail.com'],
    apple: ['apple.com', 'icloud.com'],
    amazon: ['amazon.com'],
    microsoft: ['microsoft.com', 'outlook.com', 'live.com'],
    facebook: ['facebook.com'],
    instagram: ['instagram.com'],
    netflix: ['netflix.com'],
    chase: ['chase.com'],
    wells: ['wellsfargo.com'],
    bankofamerica: ['bankofamerica.com'],
    capitalone: ['capitalone.com'],
    venmo: ['venmo.com'],
    zelle: ['zellepay.com'],
    cashapp: ['cash.app'],
    linkedin: ['linkedin.com'],
    discord: ['discord.com'],
    roblox: ['roblox.com'],
    steam: ['steampowered.com']
};

const getRegistrableDomain = (hostname: string): string => {
    const parts = hostname.toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) {
        return hostname.toLowerCase();
    }
    const lastTwo = parts.slice(-2).join('.');
    if (SECOND_LEVEL_TLDS.has(lastTwo) && parts.length >= 3) {
        return parts.slice(-3).join('.');
    }
    return lastTwo;
};

const levenshteinDistance = (a: string, b: string): number => {
    const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) {
        matrix[i]![0] = i;
    }
    for (let j = 0; j <= b.length; j += 1) {
        matrix[0]![j] = j;
    }
    for (let i = 1; i <= a.length; i += 1) {
        const row = matrix[i]!;
        const prevRow = matrix[i - 1]!;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const prevRowJ = prevRow[j]!;
            const rowJMinus = row[j - 1]!;
            const prevRowJMinus = prevRow[j - 1]!;
            row[j] = Math.min(prevRowJ + 1, rowJMinus + 1, prevRowJMinus + cost);
        }
    }
    return matrix[a.length]![b.length]!;
};

const isIpAddress = (hostname: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);

const buildLookalikeMatches = (urls: string[]): LookalikeMatch[] => {
    const matches: LookalikeMatch[] = [];
    for (const rawUrl of urls) {
        let parsed: URL;
        try {
            parsed = new URL(rawUrl);
        } catch {
            continue;
        }
        const hostname = parsed.hostname.toLowerCase();
        const registrable = getRegistrableDomain(hostname);
        const tld = registrable.split('.').slice(1).join('.');
        const sld = registrable.split('.')[0] ?? hostname;

        if (hostname.startsWith('xn--')) {
            matches.push({
                url: rawUrl,
                hostname,
                reason: 'Punycode domain detected (possible lookalike Unicode characters).',
                severity: 'high'
            });
        }

        if (isIpAddress(hostname)) {
            matches.push({
                url: rawUrl,
                hostname,
                reason: 'URL uses a raw IP address instead of a domain.',
                severity: 'medium'
            });
        }

        if (SUSPICIOUS_TLDS.has(tld)) {
            matches.push({
                url: rawUrl,
                hostname,
                reason: `Uncommon or high-risk top-level domain (.${tld}).`,
                severity: 'medium'
            });
        }

        if (/[0-9]/.test(sld) || sld.includes('-')) {
            matches.push({
                url: rawUrl,
                hostname,
                reason: 'Domain includes digits or hyphens (common in phishing kits).',
                severity: 'low'
            });
        }

        for (const [brand, domains] of Object.entries(BRAND_DOMAINS)) {
            const normalizedBrand = brand.replace(/[^a-z0-9]/g, '');
            const normalizedSld = sld.replace(/[^a-z0-9]/g, '');

            if (!normalizedBrand || !normalizedSld) {
                continue;
            }

            const containsBrand = hostname.includes(normalizedBrand);
            const isOfficial = domains.some((domain) => hostname.endsWith(domain));

            if (containsBrand && !isOfficial) {
                matches.push({
                    url: rawUrl,
                    hostname,
                    reason: `Domain references ${brand} but does not match official domains.`,
                    severity: 'high'
                });
            }

            if (!isOfficial && normalizedSld !== normalizedBrand) {
                const distance = levenshteinDistance(normalizedSld, normalizedBrand);
                if (distance > 0 && distance <= 2) {
                    matches.push({
                        url: rawUrl,
                        hostname,
                        reason: `Domain looks similar to ${brand} (edit distance ${distance}).`,
                        severity: 'high'
                    });
                }
            }
        }
    }

    const unique: LookalikeMatch[] = [];
    for (const match of matches) {
        if (!unique.some((existing) => existing.url === match.url && existing.reason === match.reason)) {
            unique.push(match);
        }
    }
    return unique;
};

const FALLBACK_TRACKER_DOMAINS = [
    'google-analytics.com',
    'googletagmanager.com',
    'doubleclick.net',
    'facebook.net',
    'connect.facebook.net',
    'hotjar.com',
    'segment.com',
    'mixpanel.com',
    'amplitude.com',
    'clarity.ms'
];

const normalizeDomain = (value: string): string | null => {
    if (!value) {
        return null;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
        return null;
    }
    const withoutScheme = trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '');
    const domain = withoutScheme.split('/')[0]?.trim() ?? '';
    return domain || null;
};

const loadTrackerList = (): TrackerEntry[] => {
    const trackerPath = path.resolve(__dirname, '../lib/tracker-list.json');
    try {
        const raw = fs.readFileSync(trackerPath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        const entries: TrackerEntry[] = [];
        for (const item of parsed) {
            if (typeof item === 'string') {
                const domain = normalizeDomain(item);
                if (domain) {
                    entries.push({ domain });
                }
                continue;
            }
            if (item && typeof item === 'object') {
                const record = item as { domain?: unknown; owner?: unknown; category?: unknown };
                if (typeof record.domain !== 'string') {
                    continue;
                }
                const domain = normalizeDomain(record.domain);
                if (!domain) {
                    continue;
                }
                const entry: TrackerEntry = { domain };
                if (typeof record.owner === 'string') {
                    entry.owner = record.owner;
                }
                if (typeof record.category === 'string') {
                    entry.category = record.category;
                }
                entries.push(entry);
            }
        }
        return entries;
    } catch (error) {
        console.warn('[Protect] Failed to load tracker list:', error);
        return [];
    }
};

const buildTrackerAudit = (
    primaryUrl: string | null,
    resourceUrls: string[]
): {
    primaryDomain: string | null;
    thirdPartyResources: string[];
    trackerMatches: TrackerMatch[];
    trackersFound: number;
    thirdPartyCount: number;
} => {
    const trackerEntries = loadTrackerList();
    const fallbackEntries: TrackerEntry[] = FALLBACK_TRACKER_DOMAINS.map((domain) => ({ domain }));
    const trackers = trackerEntries.length > 0 ? trackerEntries : fallbackEntries;

    let primaryDomain: string | null = null;
    if (primaryUrl) {
        try {
            const primaryHostname = new URL(primaryUrl).hostname.toLowerCase();
            primaryDomain = getRegistrableDomain(primaryHostname);
        } catch {
            primaryDomain = null;
        }
    }

    const thirdPartyResources: string[] = [];
    const trackerMatches: TrackerMatch[] = [];

    for (const resourceUrl of resourceUrls) {
        let parsed: URL;
        try {
            parsed = new URL(resourceUrl);
        } catch {
            continue;
        }
        const hostname = parsed.hostname.toLowerCase();
        const registrable = getRegistrableDomain(hostname);
        const isThirdParty = primaryDomain ? registrable !== primaryDomain : true;

        if (isThirdParty) {
            if (!thirdPartyResources.includes(resourceUrl)) {
                thirdPartyResources.push(resourceUrl);
            }
        } else {
            continue;
        }

        for (const tracker of trackers) {
            const trackerDomain = tracker.domain.toLowerCase();
            if (hostname === trackerDomain || hostname.endsWith(`.${trackerDomain}`)) {
                const match: TrackerMatch = {
                    resourceUrl,
                    hostname,
                    trackerDomain
                };
                if (tracker.owner) {
                    match.owner = tracker.owner;
                }
                if (tracker.category) {
                    match.category = tracker.category;
                }
                trackerMatches.push(match);
            }
        }
    }

    const uniqueTrackerMatches: TrackerMatch[] = [];
    for (const match of trackerMatches) {
        if (
            !uniqueTrackerMatches.some(
                (existing) =>
                    existing.hostname === match.hostname &&
                    existing.trackerDomain === match.trackerDomain &&
                    existing.resourceUrl === match.resourceUrl
            )
        ) {
            uniqueTrackerMatches.push(match);
        }
    }

    const uniqueTrackerDomains = new Set(uniqueTrackerMatches.map((match) => match.trackerDomain));

    return {
        primaryDomain,
        thirdPartyResources,
        trackerMatches: uniqueTrackerMatches,
        trackersFound: uniqueTrackerDomains.size,
        thirdPartyCount: thirdPartyResources.length
    };
};

const maskEmail = (value: string): string => {
    const parts = value.split('@');
    const name = parts[0] ?? '';
    const domain = parts[1];
    if (!domain) {
        return '[REDACTED_EMAIL]';
    }
    const safeName = name.length <= 2 ? `${name[0] ?? ''}*` : `${name[0]}***${name[name.length - 1]}`;
    return `${safeName}@${domain}`;
};

const maskPhone = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    const last4 = digits.slice(-4);
    return `(***) ***-${last4 || '****'}`;
};

const maskSsn = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    const last4 = digits.slice(-4);
    return `***-**-${last4 || '****'}`;
};

const luhnCheck = (digits: string): boolean => {
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
        let digit = Number(digits[i]);
        if (Number.isNaN(digit)) {
            return false;
        }
        if (shouldDouble) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }
        sum += digit;
        shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
};

const maskCreditCard = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    const last4 = digits.slice(-4);
    return `**** **** **** ${last4 || '****'}`;
};

const detectAndMaskPii = (text: string): { maskedText: string; detections: PiiDetection[]; totalCount: number } => {
    if (!text) {
        return { maskedText: '', detections: [], totalCount: 0 };
    }

    const detections: Record<PiiDetection['type'], PiiDetection> = {
        email: { type: 'email', count: 0, examples: [] },
        phone: { type: 'phone', count: 0, examples: [] },
        ssn: { type: 'ssn', count: 0, examples: [] },
        credit_card: { type: 'credit_card', count: 0, examples: [] }
    };

    let maskedText = text;

    maskedText = maskedText.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (match) => {
        detections.email.count += 1;
        const masked = maskEmail(match);
        if (detections.email.examples.length < 3) {
            detections.email.examples.push(masked);
        }
        return masked;
    });

    maskedText = maskedText.replace(
        /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g,
        (match) => {
            detections.phone.count += 1;
            const masked = maskPhone(match);
            if (detections.phone.examples.length < 3) {
                detections.phone.examples.push(masked);
            }
            return masked;
        }
    );

    maskedText = maskedText.replace(/\b\d{3}-\d{2}-\d{4}\b/g, (match) => {
        detections.ssn.count += 1;
        const masked = maskSsn(match);
        if (detections.ssn.examples.length < 3) {
            detections.ssn.examples.push(masked);
        }
        return masked;
    });

    maskedText = maskedText.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
        const digits = match.replace(/\D/g, '');
        if (digits.length < 13 || digits.length > 19 || !luhnCheck(digits)) {
            return match;
        }
        detections.credit_card.count += 1;
        const masked = maskCreditCard(match);
        if (detections.credit_card.examples.length < 3) {
            detections.credit_card.examples.push(masked);
        }
        return masked;
    });

    const detectionList = Object.values(detections).filter((item) => item.count > 0);
    const totalCount = detectionList.reduce((sum, item) => sum + item.count, 0);
    return {
        maskedText,
        detections: detectionList,
        totalCount
    };
};

const summarizeRiskLevel = (score: number): 'Low' | 'Medium' | 'High' => {
    if (score >= 70) {
        return 'High';
    }
    if (score >= 40) {
        return 'Medium';
    }
    return 'Low';
};

export const handleProtect = async (req: Request, res: Response): Promise<void> => {
    try {
        const body = (req.body ?? {}) as ProtectRequestBody;
        const text = readTextFromBody(body);
        const urls = collectUrls(body, text);
        const resourceUrls = collectResourceUrls(body, text);
        const primaryUrl = resolvePrimaryUrl(body, urls.length > 0 ? urls : resourceUrls);

        if (!text && urls.length === 0 && resourceUrls.length === 0) {
            throw new ProtectError(400, 'Provide text, URL, or resource list for protection checks.');
        }

        const phishingFlags = buildPhishingFlags(text);
        const lookalikeMatches = buildLookalikeMatches(urls);
        const { maskedText, detections, totalCount } = detectAndMaskPii(text);
        const trackerAudit = buildTrackerAudit(primaryUrl, resourceUrls);

        const phishingScore = clamp(phishingFlags.length * 15 + lookalikeMatches.length * 18, 0, 100);
        const piiScore = clamp(totalCount * 18, 0, 100);
        const privacyScore = clamp(trackerAudit.thirdPartyCount * 8 + trackerAudit.trackersFound * 18, 0, 100);

        res.status(200).json({
            status: 'success',
            data: {
                phishingRisk: {
                    score: phishingScore,
                    level: summarizeRiskLevel(phishingScore),
                    flags: phishingFlags,
                    lookalikeMatches
                },
                piiRisk: {
                    score: piiScore,
                    level: summarizeRiskLevel(piiScore),
                    detections,
                    maskedText
                },
                privacyRisk: {
                    score: privacyScore,
                    level: summarizeRiskLevel(privacyScore),
                    primaryDomain: trackerAudit.primaryDomain,
                    thirdPartyCount: trackerAudit.thirdPartyCount,
                    trackersFound: trackerAudit.trackersFound,
                    thirdPartyResources: trackerAudit.thirdPartyResources,
                    trackerMatches: trackerAudit.trackerMatches
                },
                analyzed: {
                    textLength: text.length,
                    urlCount: urls.length,
                    resourceCount: resourceUrls.length
                }
            }
        });
    } catch (error) {
        if (error instanceof ProtectError) {
            res.status(error.status).json({ status: 'error', message: error.message });
            return;
        }

        console.error('[Protect Error]:', error);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
};
