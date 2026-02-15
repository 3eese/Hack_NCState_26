import type { Request, Response } from 'express';
import {
    extractClaimFromText,
    OpenAIRequestError,
    type ClaimExtractionResult
} from '../lib/openai';
import {
    searchEvidenceForQueries,
    SearchRequestError,
    type EvidenceLink
} from '../lib/search';

type VerifyRequestBody = {
    inputType?: unknown;
    content?: unknown;
    text?: unknown;
    normalizedPayload?: {
        text?: unknown;
    };
};

class VerifyError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

const STOP_WORDS = new Set([
    'the',
    'and',
    'for',
    'that',
    'this',
    'with',
    'from',
    'have',
    'has',
    'been',
    'were',
    'was',
    'will',
    'would',
    'about',
    'into',
    'your',
    'their',
    'after',
    'before',
    'while',
    'than',
    'then',
    'they',
    'them',
    'there',
    'where',
    'what',
    'when',
    'which',
    'also',
    'just',
    'over',
    'under',
    'more',
    'most',
    'very',
    'only'
]);

const normalizeWhitespace = (value: string): string =>
    value
        .replace(/\r/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const readTextFromBody = (body: VerifyRequestBody): string => {
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
    throw new VerifyError(400, 'Missing text content to verify.');
};

const heuristicClaimExtraction = (text: string): ClaimExtractionResult => {
    const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [];
    const summary = normalizeWhitespace(sentences.slice(0, 2).join(' ') || text).slice(0, 320);
    return {
        claimSummary: summary,
        keyEntities: [],
        searchQueries: [summary, `${summary} official source`].map((query) => normalizeWhitespace(query)).slice(0, 2),
        extractionMethod: 'heuristic-fallback'
    };
};

const extractSignificantTerms = (claimSummary: string): string[] => {
    const terms = claimSummary
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 4 && !STOP_WORDS.has(term));

    return [...new Set(terms)].slice(0, 8);
};

const evidenceMatchesClaim = (evidence: EvidenceLink, claimTerms: string[]): boolean => {
    if (claimTerms.length === 0) {
        return false;
    }

    const combined = `${evidence.title} ${evidence.snippet}`.toLowerCase();
    let hits = 0;
    for (const term of claimTerms) {
        if (combined.includes(term)) {
            hits += 1;
        }
        if (hits >= 2) {
            return true;
        }
    }
    return false;
};

const buildTrustScore = (claimSummary: string, evidenceLinks: EvidenceLink[]): number => {
    if (evidenceLinks.length === 0) {
        return 22;
    }

    const averageTrust = evidenceLinks.reduce((sum, link) => sum + link.trustScore, 0) / evidenceLinks.length;
    const trustedCount = evidenceLinks.filter((link) => link.trustedDomain).length;
    const uniqueDomains = new Set(evidenceLinks.map((link) => link.domain)).size;
    const claimTerms = extractSignificantTerms(claimSummary);
    const supportingEvidence = evidenceLinks.filter((link) => evidenceMatchesClaim(link, claimTerms)).length;

    // Weighted heuristic keeps scoring interpretable for demo use.
    const rawScore =
        15 +
        averageTrust * 45 +
        Math.min(24, trustedCount * 6) +
        Math.min(12, uniqueDomains * 2.5) +
        Math.min(14, supportingEvidence * 4);

    return clamp(Math.round(rawScore), 0, 100);
};

const buildVerdict = (trustScore: number): 'Likely Real' | 'Unverified' | 'Likely Misleading' => {
    if (trustScore >= 75) {
        return 'Likely Real';
    }
    if (trustScore >= 40) {
        return 'Unverified';
    }
    return 'Likely Misleading';
};

const buildReasons = (
    trustScore: number,
    evidenceLinks: EvidenceLink[],
    extractionMethod: ClaimExtractionResult['extractionMethod'],
    searchWarning: string | null
): string[] => {
    const reasons: string[] = [];
    const uniqueDomains = new Set(evidenceLinks.map((link) => link.domain));
    const trustedCount = evidenceLinks.filter((link) => link.trustedDomain).length;

    if (evidenceLinks.length > 0) {
        reasons.push(`Found ${evidenceLinks.length} evidence links across ${uniqueDomains.size} domains.`);
        reasons.push(`${trustedCount} sources are from trusted domains (.gov/.edu/allowlist).`);
    } else {
        reasons.push('No external evidence links were returned for this claim.');
    }

    if (searchWarning) {
        reasons.push(`Search warning: ${searchWarning}`);
    }

    if (extractionMethod === 'heuristic-fallback') {
        reasons.push('Claim extraction used fallback logic due LLM response constraints.');
    }

    if (trustScore >= 75) {
        reasons.push('The claim aligns with multiple higher-trust sources.');
    } else if (trustScore < 40) {
        reasons.push('Limited corroboration detected from trusted and matching sources.');
    }

    return reasons.slice(0, 4);
};

const dedupeQueries = (queries: string[], claimSummary: string): string[] => {
    const merged = [...queries, claimSummary];
    const deduped: string[] = [];
    for (const query of merged) {
        const normalized = normalizeWhitespace(query);
        if (!normalized) {
            continue;
        }
        if (!deduped.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
            deduped.push(normalized);
        }
        if (deduped.length >= 3) {
            break;
        }
    }
    return deduped;
};

export const handleVerify = async (req: Request, res: Response): Promise<void> => {
    try {
        const body = (req.body ?? {}) as VerifyRequestBody;
        const sourceText = readTextFromBody(body);

        let extraction = heuristicClaimExtraction(sourceText);
        try {
            extraction = await extractClaimFromText(sourceText);
        } catch (error) {
            if (error instanceof OpenAIRequestError) {
                console.warn('[Verify] Claim extraction fallback:', error.message);
            } else {
                throw error;
            }
        }

        const searchQueries = dedupeQueries(extraction.searchQueries, extraction.claimSummary);

        let evidenceLinks: EvidenceLink[] = [];
        let totalResultsReported = 0;
        let searchWarning: string | null = null;

        try {
            const searchResult = await searchEvidenceForQueries(searchQueries);
            evidenceLinks = searchResult.evidenceLinks;
            totalResultsReported = searchResult.totalResultsReported;
        } catch (error) {
            if (error instanceof SearchRequestError && error.status >= 500) {
                searchWarning = error.message;
            } else {
                throw error;
            }
        }

        const trustScore = buildTrustScore(extraction.claimSummary, evidenceLinks);
        const verdict = buildVerdict(trustScore);
        const reasons = buildReasons(trustScore, evidenceLinks, extraction.extractionMethod, searchWarning);

        res.status(200).json({
            status: 'success',
            data: {
                verdict,
                trustScore,
                claimSummary: extraction.claimSummary,
                keyEntities: extraction.keyEntities,
                evidenceLinks: evidenceLinks.map((link) => ({
                    title: link.title,
                    url: link.url,
                    domain: link.domain,
                    snippet: link.snippet,
                    trustLevel: link.trustLevel,
                    trustedDomain: link.trustedDomain,
                    matchedQuery: link.query
                })),
                reasons,
                verifyMeta: {
                    extractionMethod: extraction.extractionMethod,
                    searchQueries,
                    evidenceCount: evidenceLinks.length,
                    totalResultsReported
                }
            }
        });
    } catch (error) {
        if (error instanceof VerifyError) {
            res.status(error.status).json({ status: 'error', message: error.message });
            return;
        }

        if (error instanceof OpenAIRequestError) {
            res.status(error.status).json({ status: 'error', message: error.message });
            return;
        }

        if (error instanceof SearchRequestError) {
            res.status(error.status).json({ status: 'error', message: error.message });
            return;
        }

        console.error('[Verify Error]:', error);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
};
