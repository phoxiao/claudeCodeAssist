import * as https from 'https';
import * as vscode from 'vscode';

export interface MarketplaceSkill {
    name: string;
    description: string;
    url: string;
    type: 'skill' | 'agent';
}

export class GitHubService {
    private static readonly AWESOME_REPO_URL = 'https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/README.md';

    public async fetchSkills(): Promise<MarketplaceSkill[]> {
        try {
            const content = await this.fetchUrl(GitHubService.AWESOME_REPO_URL);
            return this.parseReadme(content);
        } catch (error) {
            console.error('Failed to fetch skills:', error);
            vscode.window.showErrorMessage('Failed to fetch skills from GitHub');
            return [];
        }
    }

    private fetchUrl(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', (err) => reject(err));
        });
    }

    private parseReadme(content: string): MarketplaceSkill[] {
        const skills: MarketplaceSkill[] = [];
        // Simple parser for markdown tables or lists
        // Assuming format: | Name | Description | Link | ...
        // Or list: - [Name](Link) - Description

        // Let's try to find a table first
        const lines = content.split('\n');
        let inTable = false;

        for (const line of lines) {
            if (line.includes('| Name') && line.includes('| Description')) {
                inTable = true;
                continue;
            }
            if (inTable && line.trim().startsWith('|')) {
                if (line.includes('---')) { continue; } // Skip separator

                const parts = line.split('|').map(p => p.trim()).filter(p => p);
                if (parts.length >= 2) {
                    // Extract name and link from markdown link [Name](Link)
                    const nameMatch = parts[0].match(/\[(.*?)\]\((.*?)\)/);
                    const name = nameMatch ? nameMatch[1] : parts[0];
                    const url = nameMatch ? nameMatch[2] : '';
                    const description = parts[1];

                    if (name && url) {
                        skills.push({
                            name: name,
                            description: description,
                            url: url,
                            type: 'skill' // Default to skill, maybe refine later
                        });
                    }
                }
            } else if (inTable && line.trim() === '') {
                inTable = false;
            }
        }

        // If no table found, try list parsing
        if (skills.length === 0) {
            const listRegex = /-\s+\[(.*?)\]\((.*?)\)\s+-\s+(.*)/;
            for (const line of lines) {
                const match = line.match(listRegex);
                if (match) {
                    skills.push({
                        name: match[1],
                        url: match[2],
                        description: match[3],
                        type: 'skill'
                    });
                }
            }
        }

        // Sort skills alphabetically
        skills.sort((a, b) => a.name.localeCompare(b.name));

        return skills;
    }
}
