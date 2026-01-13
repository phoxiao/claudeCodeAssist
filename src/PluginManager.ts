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

}
