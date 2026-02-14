type ScrapeOptions = {
    timeoutMs?: number;
    maxHtmlBytes?: number;
    maxVisibleTextChars?: number;
};

export type ScrapeResult = {
    inputUrl: string;
    finalUrl: string;
    statusCode: number;
    contentType: string;
    title: string | null;
    description: string | null;
    visibleText: string;
    fetchedAt: string;
};

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_HTML_BYTES = 1_000_000;
const DEFAULT_MAX_VISIBLE_TEXT_CHARS = 6000;
const DEFAULT_USER_AGENT = 'ZedaHackathonBot/1.0';

export class ScrapeRequestError extends Error {
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

const resolveTimeoutMs = (): number => resolveNumberEnv('SCRAPE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
const resolveMaxHtmlBytes = (): number => resolveNumberEnv('SCRAPE_MAX_HTML_BYTES', DEFAULT_MAX_HTML_BYTES);
const resolveMaxVisibleChars = (): number =>
    resolveNumberEnv('SCRAPE_MAX_VISIBLE_TEXT_CHARS', DEFAULT_MAX_VISIBLE_TEXT_CHARS);

const normalizeWhitespace = (value: string): string =>
    value
        .replace(/\r/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const decodeHtmlEntities = (value: string): string => {
    const namedEntities: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' '
    };

    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entityRaw: string) => {
        const entity = entityRaw.toLowerCase();
        if (entity.startsWith('#x')) {
            const code = Number.parseInt(entity.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (entity.startsWith('#')) {
            const code = Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return namedEntities[entity] ?? match;
    });
};

const extractTitle = (html: string): string | null => {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match?.[1]) {
        return null;
    }

    const normalized = normalizeWhitespace(decodeHtmlEntities(match[1].replace(/<[^>]*>/g, ' ')));
    return normalized.length > 0 ? normalized : null;
};

const extractMetaDescription = (html: string): string | null => {
    const patterns = [
        /<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i,
        /<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
            const normalized = normalizeWhitespace(decodeHtmlEntities(match[1]));
            if (normalized.length > 0) {
                return normalized;
            }
        }
    }

    return null;
};

const extractVisibleText = (html: string): string => {
    // Remove non-visible and executable content before stripping remaining tags.
    const withoutNoise = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');

    const withBreaks = withoutNoise
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|tr|td|th)>/gi, '\n');

    const textOnly = withBreaks.replace(/<[^>]+>/g, ' ');
    return normalizeWhitespace(decodeHtmlEntities(textOnly));
};

const validateAndParseUrl = (rawUrl: string): URL => {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new ScrapeRequestError(400, 'Invalid URL format.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ScrapeRequestError(400, 'URL must use http or https.');
    }

    return parsed;
};

const supportsTextExtraction = (contentType: string): boolean =>
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml') ||
    contentType.includes('text/plain');

export const scrapeUrlContent = async (urlInput: string, options: ScrapeOptions = {}): Promise<ScrapeResult> => {
    if (!urlInput || typeof urlInput !== 'string') {
        throw new ScrapeRequestError(400, 'Missing URL content.');
    }

    const parsedUrl = validateAndParseUrl(urlInput.trim());
    const timeoutMs = options.timeoutMs ?? resolveTimeoutMs();
    const maxHtmlBytes = options.maxHtmlBytes ?? resolveMaxHtmlBytes();
    const maxVisibleTextChars = options.maxVisibleTextChars ?? resolveMaxVisibleChars();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(parsedUrl.toString(), {
            method: 'GET',
            redirect: 'follow',
            headers: {
                Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2',
                'User-Agent': process.env.SCRAPE_USER_AGENT ?? DEFAULT_USER_AGENT
            },
            signal: controller.signal
        });

        if (!response.ok) {
            const status = response.status >= 500 ? 502 : response.status;
            throw new ScrapeRequestError(status, `URL fetch failed with HTTP ${response.status}.`);
        }

        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        if (!supportsTextExtraction(contentType)) {
            throw new ScrapeRequestError(415, 'URL must return HTML or plain text content.');
        }

        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > maxHtmlBytes) {
            throw new ScrapeRequestError(
                413,
                `URL content exceeds ${Math.round(maxHtmlBytes / 1024)}KB limit.`
            );
        }

        const body = await response.text();
        const bodyBytes = Buffer.byteLength(body, 'utf8');
        if (bodyBytes > maxHtmlBytes) {
            throw new ScrapeRequestError(
                413,
                `URL content exceeds ${Math.round(maxHtmlBytes / 1024)}KB limit.`
            );
        }

        const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
        const title = isHtml ? extractTitle(body) : null;
        const description = isHtml ? extractMetaDescription(body) : null;
        let visibleText = isHtml ? extractVisibleText(body) : normalizeWhitespace(body);

        if (visibleText.length > maxVisibleTextChars) {
            visibleText = `${visibleText.slice(0, maxVisibleTextChars)}...`;
        }

        return {
            inputUrl: parsedUrl.toString(),
            finalUrl: response.url || parsedUrl.toString(),
            statusCode: response.status,
            contentType,
            title,
            description,
            visibleText,
            fetchedAt: new Date().toISOString()
        };
    } catch (error) {
        if (error instanceof ScrapeRequestError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new ScrapeRequestError(504, 'URL fetch request timed out.');
        }
        throw new ScrapeRequestError(502, 'Failed to fetch URL content.');
    } finally {
        clearTimeout(timeout);
    }
};
