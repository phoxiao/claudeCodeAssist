import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SkillManager, SkillItem } from './SkillManager';
import { PluginManager, PluginItem } from './PluginManager';

export class SkillTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SkillTreeItem | undefined | null | void> = new vscode.EventEmitter<SkillTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SkillTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private skillManager: SkillManager, private pluginManager: PluginManager) { }

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
                    new SkillTreeItem('Skills', vscode.TreeItemCollapsibleState.Expanded, 'category', element.scope, 'skill')
                ]);
            } else if (element.contextValue === 'category') {
                return this.getSkills(element.scope!, element.type!);
            } else if (element.contextValue === 'plugins-root') {
                return this.getPlugins();
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
            } else if (element.skillItem) {
                // Handle any item that has a skillItem (skills, agents, subdirectories)
                if (fs.existsSync(element.skillItem.path) && fs.statSync(element.skillItem.path).isDirectory()) {
                    return this.getDirectoryContents(element.skillItem.path, element.scope!, element.type!);
                }
                return Promise.resolve([]);
            }
            return Promise.resolve([]);
        } else {
            // Root: Global, Project, and Plugins
            return Promise.resolve([
                new SkillTreeItem('Global', vscode.TreeItemCollapsibleState.Expanded, 'scope', 'global'),
                new SkillTreeItem('Project', vscode.TreeItemCollapsibleState.Expanded, 'scope', 'project'),
                new SkillTreeItem('Plugins', vscode.TreeItemCollapsibleState.Expanded, 'plugins-root')
            ]);
        }
    }

    private async getPlugins(): Promise<SkillTreeItem[]> {
        const plugins = await this.pluginManager.getPlugins();
        return plugins.map(plugin => {
            // Check if plugin directory exists and has contents
            const isExpandable = fs.existsSync(plugin.installPath) && fs.statSync(plugin.installPath).isDirectory();
            return new SkillTreeItem(
                plugin.name,
                isExpandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                'plugin',
                undefined,
                undefined,
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
                { name: file, path: filePath, type: 'skill', scope: 'global' }
            );
        }).filter(item => item !== null) as SkillTreeItem[];

        return Promise.resolve(items);
    }

    private async getSkills(scope: 'global' | 'project', type: 'skill' | 'agent'): Promise<SkillTreeItem[]> {
        const allSkills = await this.skillManager.getSkills();
        return allSkills
            .filter(s => s.scope === scope && s.type === type)
            .map(s => {
                const isDir = fs.statSync(s.path).isDirectory();
                return new SkillTreeItem(
                    s.name,
                    isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    `${s.scope}-${s.type}`, // 'global-skill', 'project-skill', etc.
                    s.scope,
                    s.type,
                    s
                );
            });
    }

    private getDirectoryContents(dirPath: string, scope: 'global' | 'project', type: 'skill' | 'agent'): Promise<SkillTreeItem[]> {
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
        public readonly scope?: 'global' | 'project',
        public readonly type?: 'skill' | 'agent',
        public readonly skillItem?: SkillItem,
        public readonly pluginItem?: PluginItem
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
        } else if (contextValue === 'plugins-root') {
            this.iconPath = new vscode.ThemeIcon('extensions');
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
