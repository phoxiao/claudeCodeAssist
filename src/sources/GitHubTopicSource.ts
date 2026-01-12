import { BaseSkillSource, MarketplaceSkill } from './SkillSource';

interface GitHubRepo {
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    stargazers_count: number;
    updated_at: string;
    owner: {
        login: string;
    };
    topics: string[];
}

interface GitHubSearchResponse {
    total_count: number;
    incomplete_results: boolean;
    items: GitHubRepo[];
}

/**
 * Source that searches GitHub repositories by topic
 */
export class GitHubTopicSource extends BaseSkillSource {
    id: string;
    name: string;
    description?: string;

    private topics: string[];
    private minStars: number;

    constructor(
        id: string,
        name: string,
        topics: string[],
        options?: {
            description?: string;
            minStars?: number;
        }
    ) {
        super();
        this.id = id;
        this.name = name;
        this.topics = topics;
        this.description = options?.description;
        this.minStars = options?.minStars ?? 0;
    }

    async fetchSkills(): Promise<MarketplaceSkill[]> {
        if (!this.enabled) {
            return [];
        }

        const allSkills: MarketplaceSkill[] = [];

        for (const topic of this.topics) {
            try {
                const skills = await this.searchByTopic(topic);
                allSkills.push(...skills);
            } catch (error) {
                console.error(`GitHubTopicSource[${this.id}] search failed for topic ${topic}:`, error);
            }
        }

        // Deduplicate by URL
        const seen = new Set<string>();
        const uniqueSkills = allSkills.filter(skill => {
            if (seen.has(skill.url)) {
                return false;
            }
            seen.add(skill.url);
            return true;
        });

        // Sort by stars (descending)
        uniqueSkills.sort((a, b) => (b.stars || 0) - (a.stars || 0));

        return uniqueSkills;
    }

    private async searchByTopic(topic: string): Promise<MarketplaceSkill[]> {
        // Build search query
        let query = `topic:${topic}`;
        if (this.minStars > 0) {
            query += ` stars:>=${this.minStars}`;
        }

        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=50`;

        const response: GitHubSearchResponse = await this.fetchJson(url);

        return response.items.map(repo => this.repoToSkill(repo, topic));
    }

    private repoToSkill(repo: GitHubRepo, topic: string): MarketplaceSkill {
        // Detect type from repo name, description, or topics
        let type: 'skill' | 'agent' | 'plugin' = 'skill';

        const searchText = `${repo.name} ${repo.description || ''} ${repo.topics.join(' ')}`.toLowerCase();

        if (searchText.includes('agent')) {
            type = 'agent';
        } else if (searchText.includes('plugin')) {
            type = 'plugin';
        }

        return {
            name: repo.name,
            description: repo.description || 'No description',
            url: repo.html_url,
            type,
            source: this.id,
            author: repo.owner.login,
            stars: repo.stargazers_count,
            updatedAt: repo.updated_at,
            tags: repo.topics
        };
    }
}

/**
 * Default GitHub topic sources for Claude Code skills
 */
export const defaultGitHubTopicSources = [
    new GitHubTopicSource(
        'github-claude-skill',
        'GitHub: Claude Skills',
        ['claude-code-skill', 'claude-skill', 'claudecode-skill'],
        {
            description: 'Repositories tagged with Claude skill topics',
            minStars: 0
        }
    ),
    new GitHubTopicSource(
        'github-claude-agent',
        'GitHub: Claude Agents',
        ['claude-code-agent', 'claude-agent', 'claudecode-agent'],
        {
            description: 'Repositories tagged with Claude agent topics',
            minStars: 0
        }
    ),
    new GitHubTopicSource(
        'github-claude-plugin',
        'GitHub: Claude Plugins',
        ['claude-code-plugin', 'claude-plugin', 'claudecode-plugin'],
        {
            description: 'Repositories tagged with Claude plugin topics',
            minStars: 0
        }
    )
];
