import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SkillItem } from './SkillManager';

interface UpdateInfo {
    skillName: string;
    skillPath: string;
    currentCommit?: string;
    latestCommit?: string;
    hasUpdate: boolean;
    repoUrl?: string;
    error?: string;
}

interface InstalledSkillMeta {
    url?: string;
    installedAt?: string;
    commitSha?: string;
}

export class UpdateChecker {
    private output: vscode.OutputChannel;

    constructor(output: vscode.OutputChannel) {
        this.output = output;
    }

    /**
     * Check for updates on a single skill
     */
    async checkSkill(skill: SkillItem): Promise<UpdateInfo> {
        const result: UpdateInfo = {
            skillName: skill.name,
            skillPath: skill.path,
            hasUpdate: false
        };

        try {
            // Try to find .git directory or .skill-meta.json
            const metaPath = path.join(skill.path, '.skill-meta.json');
            const gitPath = path.join(skill.path, '.git');

            let repoUrl: string | undefined;
            let currentCommit: string | undefined;

            // Check for meta file
            if (fs.existsSync(metaPath)) {
                const meta: InstalledSkillMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                repoUrl = meta.url;
                currentCommit = meta.commitSha;
            }

            // Check for .git directory
            if (fs.existsSync(gitPath)) {
                try {
                    const headPath = path.join(gitPath, 'HEAD');
                    if (fs.existsSync(headPath)) {
                        const headContent = fs.readFileSync(headPath, 'utf-8').trim();
                        if (headContent.startsWith('ref:')) {
                            const refPath = path.join(gitPath, headContent.substring(5).trim());
                            if (fs.existsSync(refPath)) {
                                currentCommit = fs.readFileSync(refPath, 'utf-8').trim();
                            }
                        } else {
                            currentCommit = headContent;
                        }
                    }

                    // Try to get remote URL
                    const configPath = path.join(gitPath, 'config');
                    if (fs.existsSync(configPath)) {
                        const config = fs.readFileSync(configPath, 'utf-8');
                        const urlMatch = config.match(/url\s*=\s*(.+)/);
                        if (urlMatch) {
                            repoUrl = urlMatch[1].trim();
                        }
                    }
                } catch (e) {
                    // Ignore git parsing errors
                }
            }

            if (!repoUrl) {
                result.error = 'No repository URL found';
                return result;
            }

            result.repoUrl = repoUrl;
            result.currentCommit = currentCommit;

            // Extract owner/repo from URL
            const match = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
            if (!match) {
                result.error = 'Not a GitHub repository';
                return result;
            }

            const owner = match[1];
            const repo = match[2];

            // Fetch latest commit from GitHub API
            const latestCommit = await this.fetchLatestCommit(owner, repo);
            result.latestCommit = latestCommit;

            if (currentCommit && latestCommit) {
                result.hasUpdate = currentCommit !== latestCommit;
            } else if (latestCommit && !currentCommit) {
                // Can't determine, assume no update
                result.hasUpdate = false;
            }

            return result;

        } catch (error: any) {
            result.error = error.message;
            return result;
        }
    }

    /**
     * Check for updates on multiple skills
     */
    async checkAll(skills: SkillItem[], onProgress?: (current: number, total: number, name: string) => void): Promise<UpdateInfo[]> {
        const results: UpdateInfo[] = [];

        for (let i = 0; i < skills.length; i++) {
            const skill = skills[i];
            onProgress?.(i + 1, skills.length, skill.name);

            const result = await this.checkSkill(skill);
            results.push(result);
        }

        return results;
    }

    /**
     * Fetch latest commit SHA from GitHub
     */
    private fetchLatestCommit(owner: string, repo: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`;

            https.get(url, { headers: { 'User-Agent': 'Claude-Code-Assist' } }, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    resolve(undefined);
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const commits = JSON.parse(data);
                        if (Array.isArray(commits) && commits.length > 0) {
                            resolve(commits[0].sha);
                        } else {
                            resolve(undefined);
                        }
                    } catch (e) {
                        resolve(undefined);
                    }
                });
            }).on('error', () => {
                resolve(undefined);
            });
        });
    }

    /**
     * Save skill metadata after installation
     */
    static saveSkillMeta(skillPath: string, url: string, commitSha?: string): void {
        const meta: InstalledSkillMeta = {
            url,
            installedAt: new Date().toISOString(),
            commitSha
        };

        const metaPath = path.join(skillPath, '.skill-meta.json');
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    }
}
