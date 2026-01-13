import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

export interface InstalledPluginEntry {
    scope: string;
    installPath: string;
    version: string;
    installedAt: string;
    lastUpdated: string;
    gitCommitSha?: string;
}

export interface InstalledPluginsData {
    version: number;
    plugins: Record<string, InstalledPluginEntry[]>;
}

export interface PluginItem {
    id: string;
    name: string;
    marketplace: string;
    version: string;
    installPath: string;
    installedAt: Date;
    lastUpdated: Date;
    gitCommitSha?: string;
    scope: string;
}

export class PluginManager {
    constructor() { }

    private getPluginsBasePath(): string {
        return path.join(os.homedir(), '.claude', 'plugins');
    }

    private getInstalledPluginsPath(): string {
        return path.join(this.getPluginsBasePath(), 'installed_plugins.json');
    }

    private readInstalledPluginsJson(): InstalledPluginsData | null {
        const filePath = this.getInstalledPluginsPath();
        if (!fs.existsSync(filePath)) {
            return null;
        }
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Failed to read installed_plugins.json:', error);
            return null;
        }
    }

    private writeInstalledPluginsJson(data: InstalledPluginsData): void {
        const filePath = this.getInstalledPluginsPath();
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    public async getPlugins(): Promise<PluginItem[]> {
        const data = this.readInstalledPluginsJson();
        if (!data || !data.plugins) {
            return [];
        }

        const plugins: PluginItem[] = [];
        let needsCleanup = false;

        for (const [key, entries] of Object.entries(data.plugins)) {
            // key format: "pluginName@marketplaceName"
            const atIndex = key.indexOf('@');
            const name = atIndex > 0 ? key.substring(0, atIndex) : key;
            const marketplace = atIndex > 0 ? key.substring(atIndex + 1) : 'unknown';

            // Filter out entries where installPath no longer exists
            const validEntries = entries.filter(entry => {
                const exists = fs.existsSync(entry.installPath);
                if (!exists) {
                    needsCleanup = true;
                }
                return exists;
            });

            // Update data for cleanup
            if (validEntries.length !== entries.length) {
                if (validEntries.length === 0) {
                    delete data.plugins[key];
                } else {
                    data.plugins[key] = validEntries;
                }
            }

            for (const entry of validEntries) {
                plugins.push({
                    id: key,
                    name: name,
                    marketplace: marketplace,
                    version: entry.version,
                    installPath: entry.installPath,
                    installedAt: new Date(entry.installedAt),
                    lastUpdated: new Date(entry.lastUpdated),
                    gitCommitSha: entry.gitCommitSha,
                    scope: entry.scope
                });
            }
        }

        // Auto-cleanup invalid entries from JSON
        if (needsCleanup) {
            this.writeInstalledPluginsJson(data);
        }

        // Sort by name
        return plugins.sort((a, b) => a.name.localeCompare(b.name));
    }

    public async deletePlugin(plugin: PluginItem): Promise<void> {
        // Use claude CLI to uninstall plugin
        // Command format: claude plugin uninstall <pluginName>@<marketplace> --scope <scope>
        const pluginIdentifier = plugin.id; // format: "pluginName@marketplace"
        const scope = plugin.scope || 'user';

        const execFileAsync = promisify(execFile);

        try {
            await execFileAsync('claude', ['plugin', 'uninstall', pluginIdentifier, '--scope', scope]);
        } catch (error: unknown) {
            const execError = error as { stderr?: string; message?: string };
            const stderr = execError.stderr || execError.message || 'Unknown error';
            throw new Error(`Failed to uninstall plugin: ${stderr}`);
        }
    }

    private getProjectPluginsPath(): string | undefined {
        if (!vscode.workspace.workspaceFolders) {
            return undefined;
        }
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        const projectPathRel = config.get<string>('projectSkillsPath') || './.claude';
        return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, projectPathRel, 'plugins');
    }

    public async moveToUser(plugin: PluginItem): Promise<void> {
        await this.changePluginScope(plugin, 'user', true);
    }

    public async copyToUser(plugin: PluginItem): Promise<void> {
        await this.changePluginScope(plugin, 'user', false);
    }

    public async moveToProject(plugin: PluginItem): Promise<void> {
        await this.changePluginScope(plugin, 'project', true);
    }

    public async copyToProject(plugin: PluginItem): Promise<void> {
        await this.changePluginScope(plugin, 'project', false);
    }

    private async changePluginScope(plugin: PluginItem, targetScope: string, deleteSource: boolean): Promise<void> {
        if (plugin.scope === targetScope) { return; }

        // Calculate destination path
        let destBasePath: string | undefined;
        if (targetScope === 'user') {
            destBasePath = this.getPluginsBasePath();
        } else {
            destBasePath = this.getProjectPluginsPath();
            if (!destBasePath) {
                throw new Error('No workspace folder open');
            }
        }

        // Create cache directory structure: plugins/cache/<marketplace>/<pluginName>/<version>
        const destPath = path.join(destBasePath, 'cache', plugin.marketplace, plugin.name, plugin.version);

        if (fs.existsSync(destPath)) {
            throw new Error(`Plugin already exists in ${targetScope} scope`);
        }

        // Ensure destination directory exists
        fs.mkdirSync(destPath, { recursive: true });

        // Copy plugin files
        this.copyRecursiveSync(plugin.installPath, destPath);

        // Update installed_plugins.json
        const data = this.readInstalledPluginsJson();
        if (!data) {
            throw new Error('Failed to read installed_plugins.json');
        }

        const pluginKey = plugin.id; // format: "pluginName@marketplace"
        const entries = data.plugins[pluginKey] || [];

        // Find and update/add the entry
        const sourceEntry = entries.find(e => e.installPath === plugin.installPath);

        if (deleteSource && sourceEntry) {
            // Move: update existing entry
            sourceEntry.scope = targetScope;
            sourceEntry.installPath = destPath;

            // Delete source files
            this.deleteRecursiveSync(plugin.installPath);
        } else {
            // Copy: add new entry
            const newEntry: InstalledPluginEntry = {
                scope: targetScope,
                installPath: destPath,
                version: plugin.version,
                installedAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                gitCommitSha: plugin.gitCommitSha
            };
            entries.push(newEntry);
            data.plugins[pluginKey] = entries;
        }

        this.writeInstalledPluginsJson(data);
    }

    private copyRecursiveSync(src: string, dest: string): void {
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

}
