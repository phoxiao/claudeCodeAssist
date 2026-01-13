import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SkillManager, SkillItem } from './SkillManager';
import { PluginManager, PluginItem } from './PluginManager';
import { CommandManager, CommandItem } from './CommandManager';

export class SkillTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SkillTreeItem | undefined | null | void> = new vscode.EventEmitter<SkillTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SkillTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private skillManager: SkillManager,
        private pluginManager: PluginManager,
        private commandManager: CommandManager
    ) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SkillTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SkillTreeItem): Thenable<SkillTreeItem[]> {
        if (element) {
            if (element.contextValue === 'scope') {
                return Promise.resolve([
                    new SkillTreeItem('Agents', vscode.TreeItemCollapsibleState.Expanded, 'category', element.scope, 'agent'),
                    new SkillTreeItem('Skills', vscode.TreeItemCollapsibleState.Expanded, 'category', element.scope, 'skill'),
                    new SkillTreeItem('Commands', vscode.TreeItemCollapsibleState.Expanded, 'category', element.scope, 'command'),
                    new SkillTreeItem('Plugins', vscode.TreeItemCollapsibleState.Expanded, 'category', element.scope, 'plugin')
                ]);
            } else if (element.contextValue === 'category') {
                if (element.type === 'command') {
                    return this.getCommands(element.scope!);
                } else if (element.type === 'plugin') {
                    return this.getPlugins(element.scope!);
                }
                return this.getSkills(element.scope!, element.type as 'skill' | 'agent');
            } else if (element.pluginItem) {
                // Handle plugin items - show directory contents
                if (fs.existsSync(element.pluginItem.installPath) && fs.statSync(element.pluginItem.installPath).isDirectory()) {
                    return this.getPluginDirectoryContents(element.pluginItem.installPath);
                }
                return Promise.resolve([]);
            } else if (element.contextValue === 'plugin-directory' || element.contextValue === 'plugin-file') {
                // Handle plugin subdirectories
                if (element.skillItem && fs.existsSync(element.skillItem.path) && fs.statSync(element.skillItem.path).isDirectory()) {
                    return this.getPluginDirectoryContents(element.skillItem.path);
                }
                return Promise.resolve([]);
            } else if (element.commandItem) {
                // Handle command items - show directory contents if it's a directory
                if (fs.existsSync(element.commandItem.path) && fs.statSync(element.commandItem.path).isDirectory()) {
                    return this.getCommandDirectoryContents(element.commandItem.path, element.scope!);
                }
                return Promise.resolve([]);
            } else if (element.skillItem) {
                // Handle any item that has a skillItem (skills, agents, subdirectories)
                if (fs.existsSync(element.skillItem.path) && fs.statSync(element.skillItem.path).isDirectory()) {
                    // skillItem can only be 'skill' or 'agent', not 'command'
                    return this.getDirectoryContents(element.skillItem.path, element.scope!, element.type as 'skill' | 'agent');
                }
                return Promise.resolve([]);
            }
            return Promise.resolve([]);
        } else {
            // Root: User and Project
            return Promise.resolve([
                new SkillTreeItem('User', vscode.TreeItemCollapsibleState.Expanded, 'scope', 'user'),
                new SkillTreeItem('Project', vscode.TreeItemCollapsibleState.Expanded, 'scope', 'project')
            ]);
        }
    }

    private async getPlugins(scope: 'user' | 'project'): Promise<SkillTreeItem[]> {
        const plugins = await this.pluginManager.getPlugins();
        return plugins
            .filter(plugin => plugin.scope === scope)
            .map(plugin => {
                // Check if plugin directory exists and has contents
                const isExpandable = fs.existsSync(plugin.installPath) && fs.statSync(plugin.installPath).isDirectory();
                return new SkillTreeItem(
                    plugin.name,
                    isExpandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    'plugin',
                    scope,
                    'plugin',
                    undefined,
                    plugin
                );
            });
    }

    private getPluginDirectoryContents(dirPath: string): Promise<SkillTreeItem[]> {
        const files = fs.readdirSync(dirPath);
        const items = files.map(file => {
            const filePath = path.join(dirPath, file);
            const isDir = fs.statSync(filePath).isDirectory();
            // Skip .git, .DS_Store, etc.
            if (file.startsWith('.')) { return null; }

            return new SkillTreeItem(
                file,
                isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                isDir ? 'plugin-directory' : 'plugin-file',
                undefined,
                undefined,
                { name: file, path: filePath, type: 'skill', scope: 'user' }
            );
        }).filter(item => item !== null) as SkillTreeItem[];

        return Promise.resolve(items);
    }

    private async getSkills(scope: 'user' | 'project', type: 'skill' | 'agent'): Promise<SkillTreeItem[]> {
        const allSkills = await this.skillManager.getSkills();
        return allSkills
            .filter(s => s.scope === scope && s.type === type)
            .map(s => {
                const isDir = fs.statSync(s.path).isDirectory();
                return new SkillTreeItem(
                    s.name,
                    isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    `${s.scope}-${s.type}`, // 'user-skill', 'project-skill', etc.
                    s.scope,
                    s.type,
                    s
                );
            });
    }

    private async getCommands(scope: 'user' | 'project'): Promise<SkillTreeItem[]> {
        const allCommands = await this.commandManager.getCommands();
        return allCommands
            .filter(c => c.scope === scope)
            .map(c => {
                const isDir = fs.existsSync(c.path) && fs.statSync(c.path).isDirectory();
                return new SkillTreeItem(
                    c.name,
                    isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    `${c.scope}-command`, // 'user-command', 'project-command'
                    c.scope,
                    'command',
                    undefined,
                    undefined,
                    c
                );
            });
    }

    private getCommandDirectoryContents(dirPath: string, scope: 'user' | 'project'): Promise<SkillTreeItem[]> {
        const files = fs.readdirSync(dirPath);
        const items = files.map(file => {
            const filePath = path.join(dirPath, file);
            const isDir = fs.statSync(filePath).isDirectory();
            // Skip .git, .DS_Store, etc.
            if (file.startsWith('.')) { return null; }

            return new SkillTreeItem(
                file,
                isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                isDir ? 'command-directory' : 'command-file',
                scope,
                'command',
                undefined,
                undefined,
                { name: file, path: filePath, scope: scope }
            );
        }).filter(item => item !== null) as SkillTreeItem[];

        return Promise.resolve(items);
    }

    private getDirectoryContents(dirPath: string, scope: 'user' | 'project', type: 'skill' | 'agent'): Promise<SkillTreeItem[]> {
        const files = fs.readdirSync(dirPath);
        const items = files.map(file => {
            const filePath = path.join(dirPath, file);
            const isDir = fs.statSync(filePath).isDirectory();
            // Skip .git, .DS_Store, etc.
            if (file.startsWith('.')) { return null; }

            return new SkillTreeItem(
                file,
                isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                isDir ? 'directory' : 'file',
                scope,
                type,
                { name: file, path: filePath, type: type, scope: scope }
            );
        }).filter(item => item !== null) as SkillTreeItem[];

        return Promise.resolve(items);
    }
}

export class SkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly scope?: 'user' | 'project',
        public readonly type?: 'skill' | 'agent' | 'command' | 'plugin',
        public readonly skillItem?: SkillItem,
        public readonly pluginItem?: PluginItem,
        public readonly commandItem?: CommandItem
    ) {
        super(label, collapsibleState);
        this.tooltip = this.label;

        // Handle plugin items
        if (contextValue === 'plugin' && pluginItem) {
            this.iconPath = new vscode.ThemeIcon('package');
            const versionDisplay = pluginItem.version.length > 7 ? pluginItem.version.substring(0, 7) : pluginItem.version;
            this.description = `${pluginItem.marketplace} v${versionDisplay}`;
            this.tooltip = new vscode.MarkdownString(
                `**Plugin:** ${pluginItem.name}\n\n` +
                `**Marketplace:** ${pluginItem.marketplace}\n\n` +
                `**Version:** ${pluginItem.version}\n\n` +
                `**Installed:** ${pluginItem.installedAt.toLocaleDateString()}\n\n` +
                `**Path:** ${pluginItem.installPath}`
            );
        } else if (contextValue.includes('command')) {
            // Handle command items
            if (commandItem) {
                const isDir = fs.existsSync(commandItem.path) && fs.statSync(commandItem.path).isDirectory();
                if (isDir) {
                    this.iconPath = vscode.ThemeIcon.Folder;
                } else {
                    this.iconPath = new vscode.ThemeIcon('terminal');
                    this.command = {
                        command: 'vscode.open',
                        title: 'Open File',
                        arguments: [vscode.Uri.file(commandItem.path)]
                    };
                }
            } else if (contextValue === 'command-file') {
                this.iconPath = vscode.ThemeIcon.File;
            } else if (contextValue === 'command-directory') {
                this.iconPath = vscode.ThemeIcon.Folder;
            }
        } else if (contextValue.includes('skill') || contextValue.includes('agent')) {
            // Check if it's a skill/agent item based on contextValue or skillItem presence
            const isDir = skillItem && fs.existsSync(skillItem.path) && fs.statSync(skillItem.path).isDirectory();

            if (isDir) {
                this.iconPath = vscode.ThemeIcon.Folder;
            } else {
                this.iconPath = vscode.ThemeIcon.File;
                this.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [vscode.Uri.file(skillItem!.path)]
                };
            }
        } else if (contextValue === 'file' || contextValue === 'plugin-file') {
            this.iconPath = vscode.ThemeIcon.File;
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(skillItem!.path)]
            };
        } else if (contextValue === 'directory' || contextValue === 'plugin-directory') {
            this.iconPath = vscode.ThemeIcon.Folder;
        }
    }
}
