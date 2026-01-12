import * as vscode from 'vscode';
import { SkillSource, MarketplaceSkill } from './SkillSource';
import { AwesomeListSource, defaultAwesomeListSource } from './AwesomeListSource';
import { GitHubTopicSource, defaultGitHubTopicSources } from './GitHubTopicSource';

export interface AggregatedResult {
    skills: MarketplaceSkill[];
    sources: SourceInfo[];
    errors: SourceError[];
}

export interface SourceInfo {
    id: string;
    name: string;
    count: number;
    enabled: boolean;
}

export interface SourceError {
    sourceId: string;
    sourceName: string;
    error: string;
}

/**
 * Aggregates skills from multiple sources
 */
export class SourceAggregator {
    private sources: Map<string, SkillSource> = new Map();
    private cache: Map<string, { skills: MarketplaceSkill[]; timestamp: number }> = new Map();
    private cacheDuration = 5 * 60 * 1000; // 5 minutes

    constructor() {
        // Register default sources
        this.registerSource(defaultAwesomeListSource);
        for (const source of defaultGitHubTopicSources) {
            this.registerSource(source);
        }
    }

    /**
     * Register a skill source
     */
    registerSource(source: SkillSource): void {
        this.sources.set(source.id, source);
    }

    /**
     * Unregister a skill source
     */
    unregisterSource(id: string): void {
        this.sources.delete(id);
        this.cache.delete(id);
    }

    /**
     * Get all registered sources
     */
    getSources(): SkillSource[] {
        return Array.from(this.sources.values());
    }

    /**
     * Get a specific source by ID
     */
    getSource(id: string): SkillSource | undefined {
        return this.sources.get(id);
    }

    /**
     * Load custom sources from VS Code settings
     */
    loadCustomSources(): void {
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        const customUrls = config.get<string[]>('customSources', []);

        // Remove old custom sources
        for (const [id] of this.sources) {
            if (id.startsWith('custom-')) {
                this.sources.delete(id);
            }
        }

        // Add new custom sources
        customUrls.forEach((url, index) => {
            const id = `custom-${index}`;
            const name = `Custom Source ${index + 1}`;
            const source = new AwesomeListSource(id, name, url, `Custom awesome-list from ${url}`);
            this.registerSource(source);
        });
    }

    /**
     * Fetch skills from all enabled sources
     */
    async fetchAll(options?: {
        forceRefresh?: boolean;
        sourceIds?: string[];
    }): Promise<AggregatedResult> {
        const forceRefresh = options?.forceRefresh ?? false;
        const sourceIds = options?.sourceIds;

        const sourcesToFetch = sourceIds
            ? Array.from(this.sources.values()).filter(s => sourceIds.includes(s.id))
            : Array.from(this.sources.values()).filter(s => s.isEnabled());

        const allSkills: MarketplaceSkill[] = [];
        const sourceInfos: SourceInfo[] = [];
        const errors: SourceError[] = [];

        // Fetch from all sources in parallel
        const results = await Promise.allSettled(
            sourcesToFetch.map(async source => {
                // Check cache
                if (!forceRefresh) {
                    const cached = this.cache.get(source.id);
                    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
                        return { source, skills: cached.skills };
                    }
                }

                // Fetch fresh
                const skills = await source.fetchSkills();
                this.cache.set(source.id, { skills, timestamp: Date.now() });
                return { source, skills };
            })
        );

        // Process results
        for (const result of results) {
            if (result.status === 'fulfilled') {
                const { source, skills } = result.value;
                allSkills.push(...skills);
                sourceInfos.push({
                    id: source.id,
                    name: source.name,
                    count: skills.length,
                    enabled: source.isEnabled()
                });
            } else {
                // Extract source info from error if possible
                const errorMessage = result.reason?.message || 'Unknown error';
                errors.push({
                    sourceId: 'unknown',
                    sourceName: 'Unknown',
                    error: errorMessage
                });
            }
        }

        // Add info for sources not fetched
        for (const source of this.sources.values()) {
            if (!sourceInfos.find(s => s.id === source.id)) {
                sourceInfos.push({
                    id: source.id,
                    name: source.name,
                    count: 0,
                    enabled: source.isEnabled()
                });
            }
        }

        // Deduplicate skills by URL
        const seen = new Set<string>();
        const uniqueSkills = allSkills.filter(skill => {
            if (seen.has(skill.url)) {
                return false;
            }
            seen.add(skill.url);
            return true;
        });

        return {
            skills: uniqueSkills,
            sources: sourceInfos,
            errors
        };
    }

    /**
     * Search skills across all sources
     */
    async search(query: string, options?: {
        type?: 'skill' | 'agent' | 'plugin';
        sourceId?: string;
    }): Promise<MarketplaceSkill[]> {
        const result = await this.fetchAll({
            sourceIds: options?.sourceId ? [options.sourceId] : undefined
        });

        const queryLower = query.toLowerCase();

        return result.skills.filter(skill => {
            // Type filter
            if (options?.type && skill.type !== options.type) {
                return false;
            }

            // Text search
            const searchText = `${skill.name} ${skill.description} ${skill.author || ''} ${(skill.tags || []).join(' ')}`.toLowerCase();
            return searchText.includes(queryLower);
        });
    }

    /**
     * Get skills by type
     */
    async getByType(type: 'skill' | 'agent' | 'plugin'): Promise<MarketplaceSkill[]> {
        const result = await this.fetchAll();
        return result.skills.filter(skill => skill.type === type);
    }

    /**
     * Clear cache for all or specific source
     */
    clearCache(sourceId?: string): void {
        if (sourceId) {
            this.cache.delete(sourceId);
        } else {
            this.cache.clear();
        }
    }
}

// Singleton instance
let aggregatorInstance: SourceAggregator | null = null;

export function getSourceAggregator(): SourceAggregator {
    if (!aggregatorInstance) {
        aggregatorInstance = new SourceAggregator();
    }
    return aggregatorInstance;
}
