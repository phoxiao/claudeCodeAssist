import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CommandItem {
    name: string;
    path: string;
    scope: 'user' | 'project';
}

export class CommandManager {
    // 配置文件排除列表 - 这些文件不应被识别为 command
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

    private getUserCommandsPath(): string {
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        let basePath = config.get<string>('globalSkillsPath') || '~/.claude';
        if (basePath.startsWith('~')) {
            basePath = path.join(os.homedir(), basePath.slice(1));
        }
        return path.join(basePath, 'commands');
    }

    private getProjectCommandsPath(): string | undefined {
        if (!vscode.workspace.workspaceFolders) {
            return undefined;
        }
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        const projectPathRel = config.get<string>('projectSkillsPath') || './.claude';
        return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, projectPathRel, 'commands');
    }

    public async getCommands(): Promise<CommandItem[]> {
        const commands: CommandItem[] = [];

        // Scan user commands
        this.scanCommandsDirectory(this.getUserCommandsPath(), 'user', commands);

        // Scan project commands
        const projectPath = this.getProjectCommandsPath();
        if (projectPath) {
            this.scanCommandsDirectory(projectPath, 'project', commands);
        }

        return commands;
    }

    private scanCommandsDirectory(dirPath: string, scope: 'user' | 'project', commands: CommandItem[]): void {
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
                // 目录作为 command 单元
                commands.push({
                    name: entry.name,
                    path: entryPath,
                    scope: scope
                });
            } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
                // 只接受 .md 文件作为独立 command
                commands.push({
                    name: entry.name,
                    path: entryPath,
                    scope: scope
                });
            }
        }
    }

    public async deleteCommand(item: CommandItem): Promise<void> {
        if (fs.existsSync(item.path)) {
            const stats = fs.statSync(item.path);
            if (stats.isDirectory()) {
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

    public async moveToUser(command: CommandItem): Promise<void> {
        if (command.scope === 'user') { return; }

        const userCommandsPath = this.getUserCommandsPath();

        if (!fs.existsSync(userCommandsPath)) {
            fs.mkdirSync(userCommandsPath, { recursive: true });
        }

        const baseName = path.basename(command.path);
        const finalDestPath = path.join(userCommandsPath, baseName);

        if (fs.existsSync(finalDestPath)) {
            throw new Error('Command already exists in user scope');
        }

        fs.renameSync(command.path, finalDestPath);
    }

    public async copyToUser(command: CommandItem): Promise<void> {
        if (command.scope === 'user') { return; }

        const userCommandsPath = this.getUserCommandsPath();

        if (!fs.existsSync(userCommandsPath)) {
            fs.mkdirSync(userCommandsPath, { recursive: true });
        }

        const baseName = path.basename(command.path);
        const finalDestPath = path.join(userCommandsPath, baseName);

        if (fs.existsSync(finalDestPath)) {
            throw new Error('Command already exists in user scope');
        }

        if (fs.statSync(command.path).isDirectory()) {
            this.copyRecursiveSync(command.path, finalDestPath);
        } else {
            fs.copyFileSync(command.path, finalDestPath);
        }
    }

    private copyRecursiveSync(src: string, dest: string) {
        if (!fs.existsSync(dest)) {
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

    public async saveCommand(name: string, content: string, scope: 'user' | 'project'): Promise<void> {
        let basePath = scope === 'user' ? this.getUserCommandsPath() : this.getProjectCommandsPath();
        if (!basePath) {
            throw new Error('Project path not available');
        }

        if (!fs.existsSync(basePath)) {
            fs.mkdirSync(basePath, { recursive: true });
        }

        const filePath = path.join(basePath, `${name.replace(/\s+/g, '_')}.md`);
        fs.writeFileSync(filePath, content);
    }
}
