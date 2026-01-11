import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

        for (const [key, entries] of Object.entries(data.plugins)) {
            // key format: "pluginName@marketplaceName"
            const atIndex = key.indexOf('@');
            const name = atIndex > 0 ? key.substring(0, atIndex) : key;
            const marketplace = atIndex > 0 ? key.substring(atIndex + 1) : 'unknown';

            for (const entry of entries) {
                plugins.push({
                    id: key,
                    name: name,
                    marketplace: marketplace,
                    version: entry.version,
                    installPath: entry.installPath,
                    installedAt: new Date(entry.installedAt),
                    lastUpdated: new Date(entry.lastUpdated),
                    gitCommitSha: entry.gitCommitSha
                });
            }
        }

        // Sort by name
        return plugins.sort((a, b) => a.name.localeCompare(b.name));
    }

    public async deletePlugin(plugin: PluginItem): Promise<void> {
        // 1. Read current data
        const data = this.readInstalledPluginsJson();
        if (!data) {
            throw new Error('Could not read installed_plugins.json');
        }

        // 2. Remove the entry
        if (data.plugins[plugin.id]) {
            data.plugins[plugin.id] = data.plugins[plugin.id].filter(
                entry => entry.installPath !== plugin.installPath
            );

            // Remove key if no entries remain
            if (data.plugins[plugin.id].length === 0) {
                delete data.plugins[plugin.id];
            }
        }

        // 3. Write back
        this.writeInstalledPluginsJson(data);

        // 4. Delete cache directory
        if (fs.existsSync(plugin.installPath)) {
            fs.rmSync(plugin.installPath, { recursive: true, force: true });
        }

        // 5. Clean up empty parent directories
        this.cleanupEmptyDirectories(path.dirname(plugin.installPath));
    }

    private cleanupEmptyDirectories(dirPath: string): void {
        const pluginsBase = this.getPluginsBasePath();
        const cacheDir = path.join(pluginsBase, 'cache');

        // Only clean up within cache directory
        if (!dirPath.startsWith(cacheDir) || dirPath === cacheDir) {
            return;
        }

        try {
            const entries = fs.readdirSync(dirPath);
            if (entries.length === 0) {
                fs.rmdirSync(dirPath);
                // Recursively clean parent
                this.cleanupEmptyDirectories(path.dirname(dirPath));
            }
        } catch (error) {
            // Ignore errors - directory might not exist or have permissions issues
        }
    }
}
