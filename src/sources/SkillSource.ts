/**
 * Interface for skill data sources
 */
export interface MarketplaceSkill {
    name: string;
    description: string;
    url: string;
    type: 'skill' | 'agent' | 'plugin';
    source?: string;
    author?: string;
    stars?: number;
    updatedAt?: string;
    tags?: string[];
}

export interface SkillSource {
    /**
     * Unique identifier for this source
     */
    id: string;

    /**
     * Display name for this source
     */
    name: string;

    /**
     * Optional description
     */
    description?: string;

    /**
     * Fetch skills from this source
     */
    fetchSkills(): Promise<MarketplaceSkill[]>;

    /**
     * Whether this source is enabled
     */
    isEnabled(): boolean;

    /**
     * Enable or disable this source
     */
    setEnabled(enabled: boolean): void;
}

/**
 * Base class for skill sources with common functionality
 */
export abstract class BaseSkillSource implements SkillSource {
    abstract id: string;
    abstract name: string;
    description?: string;

    protected enabled: boolean = true;

    abstract fetchSkills(): Promise<MarketplaceSkill[]>;

    isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * Helper to fetch content from a URL
     */
    protected fetchUrl(url: string): Promise<string> {
        const https = require('https');
        return new Promise((resolve, reject) => {
            const get = (targetUrl: string, redirectCount = 0) => {
                if (redirectCount > 5) {
                    reject(new Error('Too many redirects'));
                    return;
                }

                https.get(targetUrl, { headers: { 'User-Agent': 'Claude-Code-Assist' } }, (res: any) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        get(res.headers.location, redirectCount + 1);
                        return;
                    }

                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }

                    let data = '';
                    res.on('data', (chunk: string) => data += chunk);
                    res.on('end', () => resolve(data));
                }).on('error', reject);
            };

            get(url);
        });
    }

    /**
     * Helper to fetch JSON from a URL
     */
    protected async fetchJson(url: string): Promise<any> {
        const content = await this.fetchUrl(url);
        return JSON.parse(content);
    }
}
