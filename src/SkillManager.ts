import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import * as os from 'os';

export interface SkillItem {
    name: string;
    path: string;
    type: 'skill' | 'agent';
    scope: 'global' | 'project';
}

export class SkillManager {
    constructor() { }

    private getGlobalPath(): string {
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        let globalPath = config.get<string>('globalSkillsPath') || '~/.claude';
        if (globalPath.startsWith('~')) {
            globalPath = path.join(os.homedir(), globalPath.slice(1));
        }
        return globalPath;
    }

    private getProjectPath(): string | undefined {
        if (!vscode.workspace.workspaceFolders) {
            return undefined;
        }
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        const projectPathRel = config.get<string>('projectSkillsPath') || './.claude';
        return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, projectPathRel);
    }

    public async getSkills(): Promise<SkillItem[]> {
        const skills: SkillItem[] = [];
        const globalPath = this.getGlobalPath();
        const projectPath = this.getProjectPath();

        // Helper to read directory
        const readDir = async (basePath: string, scope: 'global' | 'project') => {
            if (!fs.existsSync(basePath)) {
                return;
            }

            // 1. Scan top-level skills/ directory
            const skillFiles = glob.sync('skills/**/*.{md,txt,json}', { cwd: basePath });
            skillFiles.forEach(f => {
                skills.push({
                    name: path.basename(f),
                    path: path.join(basePath, f),
                    type: 'skill',
                    scope: scope
                });
            });

            // 2. Scan top-level agents/ directory
            const agentFiles = glob.sync('agents/**/*.{md,txt,json}', { cwd: basePath });
            agentFiles.forEach(f => {
                skills.push({
                    name: path.basename(f),
                    path: path.join(basePath, f),
                    type: 'agent',
                    scope: scope
                });
            });

            // 3. Scan plugins/ directory with proper structure recognition
            const pluginsDir = path.join(basePath, 'plugins');
            if (fs.existsSync(pluginsDir)) {
                this.scanPluginsDirectory(pluginsDir, scope, skills);
            }

            // Fallback: if no standard directories exist, scan all files
            if (skillFiles.length === 0 && agentFiles.length === 0 && !fs.existsSync(pluginsDir)) {
                const allFiles = glob.sync('**/*.{md,txt,json}', { cwd: basePath, ignore: ['**/node_modules/**'] });
                allFiles.forEach(f => {
                    const type = f.includes('agent') ? 'agent' : 'skill';
                    skills.push({
                        name: path.basename(f),
                        path: path.join(basePath, f),
                        type: type,
                        scope: scope
                    });
                });
            }
        };

        await readDir(globalPath, 'global');
        if (projectPath) {
            await readDir(projectPath, 'project');
        }

        return skills;
    }

    private scanPluginsDirectory(pluginsDir: string, scope: 'global' | 'project', skills: SkillItem[]): void {
        if (!fs.existsSync(pluginsDir)) {
            return;
        }

        // Get all subdirectories in plugins/ (each could be a plugin or a category like 'marketplaces')
        const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const entryPath = path.join(pluginsDir, entry.name);

            // Check if this directory has .claude-plugin/ (it's a plugin root)
            const hasPluginMetadata = fs.existsSync(path.join(entryPath, '.claude-plugin'));

            if (hasPluginMetadata) {
                // This is a plugin root, scan its skills/ and agents/
                this.scanPluginRoot(entryPath, scope, skills);
            } else {
                // This might be a category folder (like 'marketplaces'), recurse into it
                const subEntries = fs.readdirSync(entryPath, { withFileTypes: true });
                for (const subEntry of subEntries) {
                    if (subEntry.isDirectory()) {
                        const subPath = path.join(entryPath, subEntry.name);
                        this.scanPluginRoot(subPath, scope, skills);
                    }
                }
            }
        }
    }

    private scanPluginRoot(pluginPath: string, scope: 'global' | 'project', skills: SkillItem[]): void {
        // 1. Check direct subdirectories for SKILL.md (as seen in anthropic-agent-skills)
        const entries = fs.readdirSync(pluginPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const subPath = path.join(pluginPath, entry.name);
                // Skip .git, node_modules, etc.
                if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                    continue;
                }

                // Check if this subdirectory is a skill itself (contains SKILL.md)
                if (fs.existsSync(path.join(subPath, 'SKILL.md'))) {
                    skills.push({
                        name: entry.name,
                        path: subPath,
                        type: 'skill',
                        scope: scope
                    });
                }
            }
        }

        // 2. Scan skills/ directory within the plugin (standard structure)
        // Skills are folders containing SKILL.md
        const skillsDir = path.join(pluginPath, 'skills');
        if (fs.existsSync(skillsDir)) {
            const skillFolders = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const folder of skillFolders) {
                if (folder.isDirectory()) {
                    const skillPath = path.join(skillsDir, folder.name);
                    const skillMdPath = path.join(skillPath, 'SKILL.md');

                    // Avoid duplicates if skills/ folder was already scanned by step 1
                    // (Step 1 scans direct subdirs of pluginPath. 'skills' is a subdir. 
                    // But 'skills' itself usually doesn't contain SKILL.md, its subdirs do.
                    // So step 1 won't add 'skills' folder as a skill.
                    // But if we have plugin/skills/my-skill/SKILL.md:
                    // Step 1 sees 'skills' dir, checks for SKILL.md inside 'skills' root -> No.
                    // So we need this explicit check for skills/ directory structure.)

                    if (fs.existsSync(skillMdPath)) {
                        // Check if already added to avoid duplicates
                        if (!skills.some(s => s.path === skillPath)) {
                            skills.push({
                                name: folder.name,
                                path: skillPath,
                                type: 'skill',
                                scope: scope
                            });
                        }
                    }
                }
            }
        }

        // Scan agents/ directory within the plugin
        const agentsDir = path.join(pluginPath, 'agents');
        if (fs.existsSync(agentsDir)) {
            const agentFiles = glob.sync('*.{md,txt,json}', { cwd: agentsDir });
            agentFiles.forEach(f => {
                skills.push({
                    name: path.basename(f, path.extname(f)),
                    path: path.join(agentsDir, f),
                    type: 'agent',
                    scope: scope
                });
            });
        }
    }

    public async deleteSkill(item: SkillItem): Promise<void> {
        if (fs.existsSync(item.path)) {
            fs.unlinkSync(item.path);
        }
    }

    public async moveToGlobal(item: SkillItem): Promise<void> {
        if (item.scope === 'global') {
            return;
        }
        const globalPath = this.getGlobalPath();
        // Determine target subfolder
        let targetDir = globalPath;
        if (item.type === 'agent') {
            targetDir = path.join(globalPath, 'agents');
        } else {
            targetDir = path.join(globalPath, 'skills');
        }

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const targetPath = path.join(targetDir, path.basename(item.path));
        fs.renameSync(item.path, targetPath);
    }

    public async saveSkill(name: string, content: string, type: 'skill' | 'agent', scope: 'global' | 'project'): Promise<void> {
        let basePath = scope === 'global' ? this.getGlobalPath() : this.getProjectPath();
        if (!basePath) {
            throw new Error('Project path not available');
        }

        const targetDir = path.join(basePath, type === 'agent' ? 'agents' : 'skills');
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const filePath = path.join(targetDir, `${name.replace(/\s+/g, '_')}.md`);
        fs.writeFileSync(filePath, content);
    }

    public async checkConflicts(): Promise<string[]> {
        const skills = await this.getSkills();
        const names = new Set<string>();
        const conflicts: string[] = [];

        for (const skill of skills) {
            if (names.has(skill.name)) {
                conflicts.push(skill.name);
            }
            names.add(skill.name);
        }

        return conflicts;
    }
}
