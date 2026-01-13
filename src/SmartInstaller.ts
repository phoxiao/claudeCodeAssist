import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import * as https from 'https';

export interface ParsedUrl {
    type: 'file' | 'folder' | 'repo' | 'gist' | 'raw';
    repoUrl?: string;
    branch?: string;
    subPath?: string;
    rawUrl?: string;
    gistId?: string;
    owner?: string;
    repo?: string;
    skillName: string;
    skillType: 'skill' | 'agent';
}

export interface InstallResult {
    success: boolean;
    destPath?: string;
    error?: string;
}

export class SmartInstaller {
    private output: vscode.OutputChannel;

    constructor(output: vscode.OutputChannel) {
        this.output = output;
    }

    /**
     * Parse various URL formats into a normalized structure
     *
     * Supported formats:
     * - https://github.com/user/repo
     * - https://github.com/user/repo/tree/branch/path/to/folder
     * - https://github.com/user/repo/blob/branch/path/to/file.md
     * - https://raw.githubusercontent.com/user/repo/branch/path/to/file.md
     * - https://gist.github.com/user/gist-id
     * - gist:gist-id
     * - user/repo
     * - user/repo/path/to/folder
     */
    parseUrl(input: string): ParsedUrl | null {
        input = input.trim();
        this.output.appendLine(`SmartInstaller: Parsing input: ${input}`);

        // Shorthand: gist:id
        if (input.startsWith('gist:')) {
            const gistId = input.substring(5);
            return {
                type: 'gist',
                gistId,
                skillName: `gist-${gistId.substring(0, 8)}`,
                skillType: 'skill'
            };
        }

        // Gist URL: https://gist.github.com/user/id
        const gistMatch = input.match(/^https?:\/\/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/i);
        if (gistMatch) {
            return {
                type: 'gist',
                gistId: gistMatch[2],
                owner: gistMatch[1],
                skillName: `gist-${gistMatch[2].substring(0, 8)}`,
                skillType: 'skill'
            };
        }

        // Raw GitHub URL
        const rawMatch = input.match(/^https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/i);
        if (rawMatch) {
            const fileName = path.basename(rawMatch[4], path.extname(rawMatch[4]));
            return {
                type: 'raw',
                rawUrl: input,
                owner: rawMatch[1],
                repo: rawMatch[2],
                branch: rawMatch[3],
                subPath: rawMatch[4],
                skillName: this.sanitizeName(fileName),
                skillType: this.detectSkillType(rawMatch[4])
            };
        }

        // GitHub blob URL (single file)
        const blobMatch = input.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/i);
        if (blobMatch) {
            const filePath = blobMatch[4];
            const fileName = path.basename(filePath, path.extname(filePath));

            // Special handling: if it's SKILL.md or agent.md, treat as folder skill
            if (filePath.endsWith('SKILL.md') || filePath.endsWith('agent.md')) {
                const folderPath = path.dirname(filePath);
                const folderName = path.basename(folderPath);
                return {
                    type: 'folder',
                    repoUrl: `https://github.com/${blobMatch[1]}/${blobMatch[2]}.git`,
                    branch: blobMatch[3],
                    subPath: folderPath,
                    owner: blobMatch[1],
                    repo: blobMatch[2],
                    skillName: this.sanitizeName(folderName),
                    skillType: this.detectSkillType(filePath)
                };
            }

            return {
                type: 'file',
                repoUrl: `https://github.com/${blobMatch[1]}/${blobMatch[2]}.git`,
                branch: blobMatch[3],
                subPath: filePath,
                owner: blobMatch[1],
                repo: blobMatch[2],
                rawUrl: `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}/${filePath}`,
                skillName: this.sanitizeName(fileName),
                skillType: this.detectSkillType(filePath)
            };
        }

        // GitHub tree URL (folder)
        const treeMatch = input.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)(?:\/(.+))?$/i);
        if (treeMatch) {
            const subPath = treeMatch[4] || '';
            const folderName = subPath ? path.basename(subPath) : treeMatch[2];
            return {
                type: 'folder',
                repoUrl: `https://github.com/${treeMatch[1]}/${treeMatch[2]}.git`,
                branch: treeMatch[3],
                subPath: subPath,
                owner: treeMatch[1],
                repo: treeMatch[2],
                skillName: this.sanitizeName(folderName),
                skillType: this.detectSkillType(subPath)
            };
        }

        // GitHub repo URL (no tree/blob)
        const repoMatch = input.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/?$/i);
        if (repoMatch) {
            return {
                type: 'repo',
                repoUrl: `https://github.com/${repoMatch[1]}/${repoMatch[2]}.git`,
                owner: repoMatch[1],
                repo: repoMatch[2],
                skillName: this.sanitizeName(repoMatch[2]),
                skillType: 'skill'
            };
        }

        // Shorthand: user/repo or user/repo/path
        const shorthandMatch = input.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)(?:\/(.+))?$/);
        if (shorthandMatch) {
            const subPath = shorthandMatch[3] || '';
            const skillName = subPath ? path.basename(subPath) : shorthandMatch[2];

            if (subPath) {
                return {
                    type: 'folder',
                    repoUrl: `https://github.com/${shorthandMatch[1]}/${shorthandMatch[2]}.git`,
                    branch: 'main',
                    subPath: subPath,
                    owner: shorthandMatch[1],
                    repo: shorthandMatch[2],
                    skillName: this.sanitizeName(skillName),
                    skillType: this.detectSkillType(subPath)
                };
            } else {
                return {
                    type: 'repo',
                    repoUrl: `https://github.com/${shorthandMatch[1]}/${shorthandMatch[2]}.git`,
                    owner: shorthandMatch[1],
                    repo: shorthandMatch[2],
                    skillName: this.sanitizeName(shorthandMatch[2]),
                    skillType: 'skill'
                };
            }
        }

        this.output.appendLine(`SmartInstaller: Could not parse input: ${input}`);
        return null;
    }

    /**
     * Install from a parsed URL
     */
    async install(parsed: ParsedUrl, scope: 'user' | 'project'): Promise<InstallResult> {
        this.output.appendLine(`SmartInstaller: Installing ${parsed.skillName} (${parsed.type}) to ${scope}`);

        try {
            const destPath = await this.getDestinationPath(parsed.skillName, parsed.skillType, scope);

            if (fs.existsSync(destPath)) {
                return { success: false, error: `${parsed.skillName} already exists in ${scope}` };
            }

            switch (parsed.type) {
                case 'file':
                case 'raw':
                    return await this.installFile(parsed, destPath);
                case 'folder':
                case 'repo':
                    return await this.installFolder(parsed, destPath);
                case 'gist':
                    return await this.installGist(parsed, destPath);
                default:
                    return { success: false, error: `Unknown type: ${parsed.type}` };
            }
        } catch (error: any) {
            this.output.appendLine(`SmartInstaller: Install failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Install a single file
     */
    private async installFile(parsed: ParsedUrl, destPath: string): Promise<InstallResult> {
        const url = parsed.rawUrl!;
        this.output.appendLine(`SmartInstaller: Downloading file from ${url}`);

        const content = await this.fetchContent(url);

        // Create parent directory if needed
        const parentDir = path.dirname(destPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        // Add extension if not present
        let finalPath = destPath;
        if (!path.extname(destPath)) {
            finalPath = destPath + '.md';
        }

        fs.writeFileSync(finalPath, content, 'utf-8');
        this.output.appendLine(`SmartInstaller: Saved to ${finalPath}`);

        return { success: true, destPath: finalPath };
    }

    /**
     * Install a folder via git clone
     */
    private async installFolder(parsed: ParsedUrl, destPath: string): Promise<InstallResult> {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-skill-'));

        try {
            // Clone repository using execFileSync to avoid shell injection
            const branch = parsed.branch || 'main';
            const repoUrl = parsed.repoUrl!;

            this.output.appendLine(`SmartInstaller: Cloning ${repoUrl} (branch: ${branch}) to ${tempDir}`);

            try {
                // Use execFileSync instead of execSync to prevent shell injection
                cp.execFileSync('git', ['clone', '--depth', '1', '--branch', branch, repoUrl, '.'], {
                    cwd: tempDir,
                    stdio: 'pipe'
                });
            } catch (e: any) {
                // Try without branch specification (use default branch)
                this.output.appendLine(`SmartInstaller: Branch clone failed, trying default branch`);
                cp.execFileSync('git', ['clone', '--depth', '1', repoUrl, '.'], {
                    cwd: tempDir,
                    stdio: 'pipe'
                });
            }

            // Determine source path
            let sourcePath = parsed.subPath ? path.join(tempDir, parsed.subPath) : tempDir;

            // Check if source exists, try fuzzy match if not
            if (!fs.existsSync(sourcePath) && parsed.subPath) {
                const files = fs.readdirSync(tempDir);
                const match = files.find(f =>
                    f.toLowerCase().includes(parsed.subPath!.toLowerCase()) ||
                    parsed.subPath!.toLowerCase().includes(f.toLowerCase())
                );
                if (match) {
                    this.output.appendLine(`SmartInstaller: Path ${parsed.subPath} not found, using similar: ${match}`);
                    sourcePath = path.join(tempDir, match);
                } else {
                    throw new Error(`Path ${parsed.subPath} not found in repo. Available: ${files.join(', ')}`);
                }
            }

            // Create destination directory
            const parentDir = path.dirname(destPath);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }

            // Copy files
            if (fs.statSync(sourcePath).isDirectory()) {
                fs.mkdirSync(destPath, { recursive: true });
                this.copyRecursive(sourcePath, destPath);
            } else {
                fs.copyFileSync(sourcePath, destPath);
            }

            this.output.appendLine(`SmartInstaller: Installed to ${destPath}`);
            return { success: true, destPath };

        } finally {
            // Cleanup temp directory
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Install from a GitHub Gist
     */
    private async installGist(parsed: ParsedUrl, destPath: string): Promise<InstallResult> {
        const gistUrl = `https://api.github.com/gists/${parsed.gistId}`;
        this.output.appendLine(`SmartInstaller: Fetching gist from ${gistUrl}`);

        const gistData = await this.fetchJson(gistUrl);

        if (!gistData.files || Object.keys(gistData.files).length === 0) {
            return { success: false, error: 'Gist has no files' };
        }

        // Create parent directory
        const parentDir = path.dirname(destPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        const files = Object.values(gistData.files) as any[];

        if (files.length === 1) {
            // Single file gist - save directly
            const file = files[0];
            const content = file.content || await this.fetchContent(file.raw_url);
            const ext = path.extname(file.filename) || '.md';
            const finalPath = destPath + ext;
            fs.writeFileSync(finalPath, content, 'utf-8');
            return { success: true, destPath: finalPath };
        } else {
            // Multi-file gist - create folder
            fs.mkdirSync(destPath, { recursive: true });
            for (const file of files) {
                const content = file.content || await this.fetchContent(file.raw_url);
                fs.writeFileSync(path.join(destPath, file.filename), content, 'utf-8');
            }
            return { success: true, destPath };
        }
    }

    /**
     * Get the destination path for a skill
     */
    private async getDestinationPath(name: string, type: 'skill' | 'agent', scope: 'user' | 'project'): Promise<string> {
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        let destRoot: string;

        if (scope === 'user') {
            destRoot = config.get<string>('globalSkillsPath') || path.join(os.homedir(), '.claude');
            if (destRoot.startsWith('~')) {
                destRoot = path.join(os.homedir(), destRoot.slice(1));
            }
        } else {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace open');
            }
            const projectPathRel = config.get<string>('projectSkillsPath') || './.claude';
            destRoot = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, projectPathRel);
        }

        const container = type === 'skill' ? 'skills' : 'agents';
        return path.join(destRoot, container, name);
    }

    /**
     * Fetch content from a URL
     */
    private fetchContent(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const get = (targetUrl: string, redirectCount = 0) => {
                if (redirectCount > 5) {
                    reject(new Error('Too many redirects'));
                    return;
                }

                https.get(targetUrl, { headers: { 'User-Agent': 'Claude-Code-Assist' } }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        get(res.headers.location, redirectCount + 1);
                        return;
                    }

                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }

                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                            reject(new Error('Received HTML instead of raw content'));
                        } else {
                            resolve(data);
                        }
                    });
                }).on('error', reject);
            };

            get(url);
        });
    }

    /**
     * Fetch JSON from a URL
     */
    private fetchJson(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'Claude-Code-Assist' } }, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * Copy directory recursively
     */
    private copyRecursive(src: string, dest: string) {
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            // Skip .git directory
            if (entry.name === '.git') continue;

            if (entry.isDirectory()) {
                fs.mkdirSync(destPath, { recursive: true });
                this.copyRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * Sanitize a name for use as a filename
     */
    private sanitizeName(name: string): string {
        return name
            .replace(/[^a-zA-Z0-9_-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
    }

    /**
     * Detect skill type from path
     */
    private detectSkillType(filePath: string): 'skill' | 'agent' {
        const lower = filePath.toLowerCase();
        if (lower.includes('agent') || lower.endsWith('agent.md')) {
            return 'agent';
        }
        return 'skill';
    }

    /**
     * Validate if a string looks like a valid input
     */
    isValidInput(input: string): boolean {
        input = input.trim();

        // Gist shorthand
        if (input.startsWith('gist:')) return true;

        // URL
        if (input.startsWith('http://') || input.startsWith('https://')) return true;

        // Shorthand user/repo
        if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/.test(input)) return true;

        return false;
    }
}
