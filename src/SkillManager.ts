import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SkillItem {
    name: string;
    path: string;
    type: 'skill' | 'agent';
    scope: 'user' | 'project';
}

export class SkillManager {
    // 配置文件排除列表 - 这些文件不应被识别为 skill 或 agent
    private readonly CONFIG_FILES = new Set([
        'settings.json',
        'settings.local.json',
        'CLAUDE.md',
        'rules.md',
        'context.md',
        'prompts.md',
        '.mcp.json'
    ]);

    constructor() { }

    private getUserPath(): string {
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        let userPath = config.get<string>('globalSkillsPath') || '~/.claude';
        if (userPath.startsWith('~')) {
            userPath = path.join(os.homedir(), userPath.slice(1));
        }
        return userPath;
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
        const userPath = this.getUserPath();
        const projectPath = this.getProjectPath();

        // Helper to read directory
        const readDir = async (basePath: string, scope: 'user' | 'project') => {
            if (!fs.existsSync(basePath)) {
                return;
            }

            // 只扫描独立的 skills/ 和 agents/ 目录
            // Plugin 内的 skills/agents 由 SkillTreeProvider 的 plugin 展开逻辑处理
            this.scanTypeDirectory(path.join(basePath, 'skills'), 'skill', scope, skills);
            this.scanTypeDirectory(path.join(basePath, 'agents'), 'agent', scope, skills);

            // 不再扫描 plugins/ 目录 - plugin 内容只在 Plugins 节点下展示
        };

        await readDir(userPath, 'user');
        if (projectPath) {
            await readDir(projectPath, 'project');
        }

        return skills;
    }

    /**
     * Scan a skills/ or agents/ directory
     * - Folders are treated as a single skill/agent unit
     * - Individual .md files are treated as standalone skills/agents
     */
    private scanTypeDirectory(dirPath: string, type: 'skill' | 'agent', scope: 'user' | 'project', skills: SkillItem[]): void {
        if (!fs.existsSync(dirPath)) {
            return;
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // 跳过隐藏文件和配置文件
            if (entry.name.startsWith('.') || this.CONFIG_FILES.has(entry.name)) {
                continue;
            }

            const entryPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                // 目录作为 skill/agent 单元
                skills.push({
                    name: entry.name,
                    path: entryPath,
                    type: type,
                    scope: scope
                });
            } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
                // 只接受 .md 文件作为独立 skill/agent
                skills.push({
                    name: entry.name,
                    path: entryPath,
                    type: type,
                    scope: scope
                });
            }
        }
    }

    public async deleteSkill(item: SkillItem): Promise<void> {
        if (fs.existsSync(item.path)) {
            const stats = fs.statSync(item.path);
            if (stats.isDirectory()) {
                // Recursively delete directory
                this.deleteRecursiveSync(item.path);
            } else {
                fs.unlinkSync(item.path);
            }
        }
    }

    private deleteRecursiveSync(dirPath: string): void {
        if (fs.existsSync(dirPath)) {
            fs.readdirSync(dirPath).forEach((file) => {
                const curPath = path.join(dirPath, file);
                if (fs.statSync(curPath).isDirectory()) {
                    this.deleteRecursiveSync(curPath);
                } else {
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(dirPath);
        }
    }

    public async moveToUser(skill: SkillItem): Promise<void> {
        if (skill.scope === 'user') { return; }

        const userRoot = this.getUserPath();
        const userPath = path.join(userRoot, skill.type === 'skill' ? 'skills' : 'agents');

        if (!fs.existsSync(userPath)) {
            fs.mkdirSync(userPath, { recursive: true });
        }

        const baseName = path.basename(skill.path);
        const finalDestPath = path.join(userPath, baseName);

        if (fs.existsSync(finalDestPath)) {
            throw new Error('Skill already exists in user scope');
        }

        fs.renameSync(skill.path, finalDestPath);
    }

    async copyToUser(skill: SkillItem): Promise<void> {
        if (skill.scope === 'user') { return; }

        const userRoot = this.getUserPath();
        const userPath = path.join(userRoot, skill.type === 'skill' ? 'skills' : 'agents');

        if (!fs.existsSync(userPath)) {
            fs.mkdirSync(userPath, { recursive: true });
        }

        const baseName = path.basename(skill.path);
        const finalDestPath = path.join(userPath, baseName);

        if (fs.existsSync(finalDestPath)) {
            throw new Error('Skill already exists in user scope');
        }

        // Copy file or directory
        if (fs.statSync(skill.path).isDirectory()) {
            // Recursive copy for directory
            this.copyRecursiveSync(skill.path, finalDestPath);
        } else {
            fs.copyFileSync(skill.path, finalDestPath);
        }
    }

    private copyRecursiveSync(src: string, dest: string) {
        if (fs.existsSync(dest)) {
            const stats = fs.statSync(dest);
            if (stats.isDirectory()) {
                // Directory exists
            } else {
                // It's a file, error? Or overwrite? For now assume we shouldn't be here if check above passed
            }
        } else {
            fs.mkdirSync(dest, { recursive: true });
        }

        fs.readdirSync(src).forEach((childItemName) => {
            const childItemPath = path.join(src, childItemName);
            const childItemDestPath = path.join(dest, childItemName);
            const childStats = fs.statSync(childItemPath);

            if (childStats.isDirectory()) {
                this.copyRecursiveSync(childItemPath, childItemDestPath);
            } else {
                fs.copyFileSync(childItemPath, childItemDestPath);
            }
        });
    }

    public async moveToProject(skill: SkillItem): Promise<void> {
        if (skill.scope === 'project') { return; }

        const projectRoot = this.getProjectPath();
        if (!projectRoot) {
            throw new Error('No workspace folder open');
        }

        const projectPath = path.join(projectRoot, skill.type === 'skill' ? 'skills' : 'agents');
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath, { recursive: true });
        }

        const baseName = path.basename(skill.path);
        const finalDestPath = path.join(projectPath, baseName);

        if (fs.existsSync(finalDestPath)) {
            throw new Error('Skill already exists in project scope');
        }

        fs.renameSync(skill.path, finalDestPath);
    }

    public async copyToProject(skill: SkillItem): Promise<void> {
        if (skill.scope === 'project') { return; }

        const projectRoot = this.getProjectPath();
        if (!projectRoot) {
            throw new Error('No workspace folder open');
        }

        const projectPath = path.join(projectRoot, skill.type === 'skill' ? 'skills' : 'agents');
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath, { recursive: true });
        }

        const baseName = path.basename(skill.path);
        const finalDestPath = path.join(projectPath, baseName);

        if (fs.existsSync(finalDestPath)) {
            throw new Error('Skill already exists in project scope');
        }

        if (fs.statSync(skill.path).isDirectory()) {
            this.copyRecursiveSync(skill.path, finalDestPath);
        } else {
            fs.copyFileSync(skill.path, finalDestPath);
        }
    }

    public async saveSkill(name: string, content: string, type: 'skill' | 'agent', scope: 'user' | 'project'): Promise<void> {
        let basePath = scope === 'user' ? this.getUserPath() : this.getProjectPath();
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
