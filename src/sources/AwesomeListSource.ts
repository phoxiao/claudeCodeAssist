import { BaseSkillSource, MarketplaceSkill } from './SkillSource';

/**
 * Source that parses awesome-list style markdown files
 */
export class AwesomeListSource extends BaseSkillSource {
    id: string;
    name: string;
    description?: string;

    private url: string;

    constructor(id: string, name: string, url: string, description?: string) {
        super();
        this.id = id;
        this.name = name;
        this.url = url;
        this.description = description;
    }

    async fetchSkills(): Promise<MarketplaceSkill[]> {
        if (!this.enabled) {
            return [];
        }

        try {
            const content = await this.fetchUrl(this.url);
            return this.parseMarkdown(content);
        } catch (error) {
            console.error(`AwesomeListSource[${this.id}] fetch failed:`, error);
            return [];
        }
    }

    /**
     * Parse markdown content to extract skills
     * Supports multiple formats:
     * - Tables: | Name | Description |
     * - Lists: - [Name](URL) - Description
     * - Links with description: [Name](URL) Description
     */
    private parseMarkdown(content: string): MarketplaceSkill[] {
        const skills: MarketplaceSkill[] = [];
        const lines = content.split('\n');

        // Try table format first
        let inTable = false;
        let tableHeaderFound = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Detect table header
            if (line.includes('| Name') || line.includes('| Skill') || line.includes('|name')) {
                inTable = true;
                tableHeaderFound = true;
                continue;
            }

            // Skip table separator
            if (inTable && line.match(/^\|[\s-|]+\|$/)) {
                continue;
            }

            // Parse table row
            if (inTable && line.trim().startsWith('|')) {
                const skill = this.parseTableRow(line);
                if (skill) {
                    skills.push(skill);
                }
                continue;
            }

            // End of table
            if (inTable && line.trim() === '') {
                inTable = false;
            }

            // Parse list format: - [Name](URL) - Description
            const listMatch = line.match(/^[\s]*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–:]?\s*(.*)/);
            if (listMatch) {
                const skill = this.createSkill(listMatch[1], listMatch[2], listMatch[3]);
                if (skill) {
                    skills.push(skill);
                }
            }
        }

        // Sort by name
        skills.sort((a, b) => a.name.localeCompare(b.name));

        return skills;
    }

    /**
     * Parse a markdown table row
     */
    private parseTableRow(line: string): MarketplaceSkill | null {
        const cells = line.split('|').map(c => c.trim()).filter(c => c);

        if (cells.length < 1) {
            return null;
        }

        // Extract name and URL from first cell (usually markdown link)
        const linkMatch = cells[0].match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (!linkMatch) {
            return null;
        }

        const name = linkMatch[1];
        const url = linkMatch[2];
        const description = cells.length > 1 ? cells[1] : '';

        return this.createSkill(name, url, description);
    }

    /**
     * Create a skill object with proper type detection
     */
    private createSkill(name: string, url: string, description: string): MarketplaceSkill | null {
        if (!name || !url) {
            return null;
        }

        // Detect type from name, URL, or description
        let type: 'skill' | 'agent' | 'plugin' = 'skill';
        const lowerName = name.toLowerCase();
        const lowerUrl = url.toLowerCase();
        const lowerDesc = description.toLowerCase();

        if (lowerName.includes('agent') || lowerUrl.includes('agent') || lowerDesc.includes('agent')) {
            type = 'agent';
        } else if (lowerName.includes('plugin') || lowerUrl.includes('plugin') || lowerDesc.includes('plugin')) {
            type = 'plugin';
        }

        // Extract author from GitHub URL
        let author: string | undefined;
        const githubMatch = url.match(/github\.com\/([^\/]+)/);
        if (githubMatch) {
            author = githubMatch[1];
        }

        return {
            name: name.trim(),
            description: description.trim(),
            url: url.trim(),
            type,
            source: this.id,
            author
        };
    }
}

/**
 * Default awesome-claude-skills source
 */
export const defaultAwesomeListSource = new AwesomeListSource(
    'awesome-claude-skills',
    'Awesome Claude Skills',
    'https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/README.md',
    'Community-curated list of Claude Code skills and agents'
);
