import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

export interface MarketplaceSourceData {
    source: {
        source: string;  // 'github' | 'url'
        repo?: string;
        url?: string;
    };
    installLocation: string;
    lastUpdated: string;
}

export interface KnownMarketplacesData {
    [name: string]: MarketplaceSourceData;
}

export interface MarketplaceSource {
    name: string;
    source: {
        source: string;
        repo?: string;
        url?: string;
    };
    installLocation: string;
    lastUpdated: string;
    scope: 'user' | 'project';
}

export class MarketplaceManager {
    constructor() { }

    private getUserMarketplacesPath(): string {
        return path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json');
    }

    private getProjectMarketplacesPath(): string | undefined {
        if (!vscode.workspace.workspaceFolders) {
            return undefined;
        }
        const config = vscode.workspace.getConfiguration('claudeCodeAssist');
        const projectPathRel = config.get<string>('projectSkillsPath') || './.claude';
        return path.join(
            vscode.workspace.workspaceFolders[0].uri.fsPath,
            projectPathRel,
            'plugins',
            'known_marketplaces.json'
        );
    }

    private readMarketplacesJson(filePath: string): KnownMarketplacesData | null {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`Failed to read ${filePath}:`, error);
            return null;
        }
    }

    private writeMarketplacesJson(filePath: string, data: KnownMarketplacesData): void {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    public async getMarketplaces(): Promise<MarketplaceSource[]> {
        const marketplaces: MarketplaceSource[] = [];

        // Read user marketplaces
        const userPath = this.getUserMarketplacesPath();
        const userData = this.readMarketplacesJson(userPath);
        if (userData) {
            for (const [name, data] of Object.entries(userData)) {
                marketplaces.push({
                    name,
                    source: data.source,
                    installLocation: data.installLocation,
                    lastUpdated: data.lastUpdated,
                    scope: 'user'
                });
            }
        }

        // Read project marketplaces
        const projectPath = this.getProjectMarketplacesPath();
        if (projectPath) {
            const projectData = this.readMarketplacesJson(projectPath);
            if (projectData) {
                for (const [name, data] of Object.entries(projectData)) {
                    marketplaces.push({
                        name,
                        source: data.source,
                        installLocation: data.installLocation,
                        lastUpdated: data.lastUpdated,
                        scope: 'project'
                    });
                }
            }
        }

        // Sort by name
        return marketplaces.sort((a, b) => a.name.localeCompare(b.name));
    }

    public async addMarketplace(name: string, repo: string, scope: 'user' | 'project'): Promise<void> {
        const execFileAsync = promisify(execFile);

        // Try using claude CLI first
        try {
            const args = ['plugin', 'marketplace', 'add', repo];
            if (scope === 'project') {
                args.push('--scope', 'project');
            }
            await execFileAsync('claude', args);
            return;
        } catch (cliError) {
            // CLI not available or failed, fallback to direct file manipulation
            console.log('Claude CLI not available, using direct file manipulation');
        }

        // Fallback: Direct file manipulation
        const filePath = scope === 'user'
            ? this.getUserMarketplacesPath()
            : this.getProjectMarketplacesPath();

        if (!filePath) {
            throw new Error('No workspace folder open');
        }

        const data = this.readMarketplacesJson(filePath) || {};

        if (data[name]) {
            throw new Error(`Marketplace "${name}" already exists`);
        }

        // Determine install location
        const baseDir = scope === 'user'
            ? path.join(os.homedir(), '.claude', 'plugins', 'marketplaces')
            : path.join(path.dirname(filePath), 'marketplaces');

        data[name] = {
            source: {
                source: 'github',
                repo: repo
            },
            installLocation: path.join(baseDir, name),
            lastUpdated: new Date().toISOString()
        };

        this.writeMarketplacesJson(filePath, data);
    }

    public async removeMarketplace(name: string, scope: 'user' | 'project'): Promise<void> {
        const execFileAsync = promisify(execFile);

        // Try using claude CLI first
        try {
            const args = ['plugin', 'marketplace', 'remove', name];
            if (scope === 'project') {
                args.push('--scope', 'project');
            }
            await execFileAsync('claude', args);
            return;
        } catch (cliError) {
            // CLI not available or failed, fallback to direct file manipulation
            console.log('Claude CLI not available, using direct file manipulation');
        }

        // Fallback: Direct file manipulation
        const filePath = scope === 'user'
            ? this.getUserMarketplacesPath()
            : this.getProjectMarketplacesPath();

        if (!filePath) {
            throw new Error('No workspace folder open');
        }

        const data = this.readMarketplacesJson(filePath);
        if (!data || !data[name]) {
            throw new Error(`Marketplace "${name}" not found`);
        }

        // Optionally delete cached files
        const installLocation = data[name].installLocation;
        if (fs.existsSync(installLocation)) {
            this.deleteRecursiveSync(installLocation);
        }

        delete data[name];
        this.writeMarketplacesJson(filePath, data);
    }

    public async refreshMarketplace(name: string, scope: 'user' | 'project'): Promise<void> {
        const execFileAsync = promisify(execFile);

        // Try using claude CLI first
        try {
            const args = ['plugin', 'marketplace', 'refresh', name];
            if (scope === 'project') {
                args.push('--scope', 'project');
            }
            await execFileAsync('claude', args);
            return;
        } catch (cliError) {
            // CLI not available or failed, update timestamp only
            console.log('Claude CLI not available, updating timestamp only');
        }

        // Fallback: Update lastUpdated timestamp
        const filePath = scope === 'user'
            ? this.getUserMarketplacesPath()
            : this.getProjectMarketplacesPath();

        if (!filePath) {
            throw new Error('No workspace folder open');
        }

        const data = this.readMarketplacesJson(filePath);
        if (!data || !data[name]) {
            throw new Error(`Marketplace "${name}" not found`);
        }

        data[name].lastUpdated = new Date().toISOString();
        this.writeMarketplacesJson(filePath, data);
    }

    public async moveToUser(marketplace: MarketplaceSource): Promise<void> {
        if (marketplace.scope === 'user') { return; }

        const userFilePath = this.getUserMarketplacesPath();
        const projectFilePath = this.getProjectMarketplacesPath();

        if (!projectFilePath) {
            throw new Error('No workspace folder open');
        }

        const userData = this.readMarketplacesJson(userFilePath) || {};
        const projectData = this.readMarketplacesJson(projectFilePath);

        if (!projectData || !projectData[marketplace.name]) {
            throw new Error(`Marketplace "${marketplace.name}" not found in project scope`);
        }

        if (userData[marketplace.name]) {
            throw new Error(`Marketplace "${marketplace.name}" already exists in user scope`);
        }

        // Calculate new install location
        const newInstallLocation = path.join(
            os.homedir(), '.claude', 'plugins', 'marketplaces', marketplace.name
        );

        // Copy files if they exist
        if (fs.existsSync(marketplace.installLocation)) {
            this.copyRecursiveSync(marketplace.installLocation, newInstallLocation);
        }

        // Add to user scope
        userData[marketplace.name] = {
            source: projectData[marketplace.name].source,
            installLocation: newInstallLocation,
            lastUpdated: new Date().toISOString()
        };
        this.writeMarketplacesJson(userFilePath, userData);

        // Remove from project scope
        if (fs.existsSync(marketplace.installLocation)) {
            this.deleteRecursiveSync(marketplace.installLocation);
        }
        delete projectData[marketplace.name];
        this.writeMarketplacesJson(projectFilePath, projectData);
    }

    public async copyToUser(marketplace: MarketplaceSource): Promise<void> {
        if (marketplace.scope === 'user') { return; }

        const userFilePath = this.getUserMarketplacesPath();
        const projectFilePath = this.getProjectMarketplacesPath();

        if (!projectFilePath) {
            throw new Error('No workspace folder open');
        }

        const userData = this.readMarketplacesJson(userFilePath) || {};
        const projectData = this.readMarketplacesJson(projectFilePath);

        if (!projectData || !projectData[marketplace.name]) {
            throw new Error(`Marketplace "${marketplace.name}" not found in project scope`);
        }

        if (userData[marketplace.name]) {
            throw new Error(`Marketplace "${marketplace.name}" already exists in user scope`);
        }

        // Calculate new install location
        const newInstallLocation = path.join(
            os.homedir(), '.claude', 'plugins', 'marketplaces', marketplace.name
        );

        // Copy files if they exist
        if (fs.existsSync(marketplace.installLocation)) {
            this.copyRecursiveSync(marketplace.installLocation, newInstallLocation);
        }

        // Add to user scope (keep in project scope as well)
        userData[marketplace.name] = {
            source: projectData[marketplace.name].source,
            installLocation: newInstallLocation,
            lastUpdated: new Date().toISOString()
        };
        this.writeMarketplacesJson(userFilePath, userData);
    }

    public async moveToProject(marketplace: MarketplaceSource): Promise<void> {
        if (marketplace.scope === 'project') { return; }

        const userFilePath = this.getUserMarketplacesPath();
        const projectFilePath = this.getProjectMarketplacesPath();

        if (!projectFilePath) {
            throw new Error('No workspace folder open');
        }

        const userData = this.readMarketplacesJson(userFilePath);
        const projectData = this.readMarketplacesJson(projectFilePath) || {};

        if (!userData || !userData[marketplace.name]) {
            throw new Error(`Marketplace "${marketplace.name}" not found in user scope`);
        }

        if (projectData[marketplace.name]) {
            throw new Error(`Marketplace "${marketplace.name}" already exists in project scope`);
        }

        // Calculate new install location
        const newInstallLocation = path.join(
            path.dirname(projectFilePath), 'marketplaces', marketplace.name
        );

        // Copy files if they exist
        if (fs.existsSync(marketplace.installLocation)) {
            this.copyRecursiveSync(marketplace.installLocation, newInstallLocation);
        }

        // Add to project scope
        projectData[marketplace.name] = {
            source: userData[marketplace.name].source,
            installLocation: newInstallLocation,
            lastUpdated: new Date().toISOString()
        };
        this.writeMarketplacesJson(projectFilePath, projectData);

        // Remove from user scope
        if (fs.existsSync(marketplace.installLocation)) {
            this.deleteRecursiveSync(marketplace.installLocation);
        }
        delete userData[marketplace.name];
        this.writeMarketplacesJson(userFilePath, userData);
    }

    public async copyToProject(marketplace: MarketplaceSource): Promise<void> {
        if (marketplace.scope === 'project') { return; }

        const userFilePath = this.getUserMarketplacesPath();
        const projectFilePath = this.getProjectMarketplacesPath();

        if (!projectFilePath) {
            throw new Error('No workspace folder open');
        }

        const userData = this.readMarketplacesJson(userFilePath);
        const projectData = this.readMarketplacesJson(projectFilePath) || {};

        if (!userData || !userData[marketplace.name]) {
            throw new Error(`Marketplace "${marketplace.name}" not found in user scope`);
        }

        if (projectData[marketplace.name]) {
            throw new Error(`Marketplace "${marketplace.name}" already exists in project scope`);
        }

        // Calculate new install location
        const newInstallLocation = path.join(
            path.dirname(projectFilePath), 'marketplaces', marketplace.name
        );

        // Copy files if they exist
        if (fs.existsSync(marketplace.installLocation)) {
            this.copyRecursiveSync(marketplace.installLocation, newInstallLocation);
        }

        // Add to project scope (keep in user scope as well)
        projectData[marketplace.name] = {
            source: userData[marketplace.name].source,
            installLocation: newInstallLocation,
            lastUpdated: new Date().toISOString()
        };
        this.writeMarketplacesJson(projectFilePath, projectData);
    }

    private copyRecursiveSync(src: string, dest: string): void {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        if (fs.statSync(src).isDirectory()) {
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
        } else {
            fs.copyFileSync(src, dest);
        }
    }

    private deleteRecursiveSync(dirPath: string): void {
        if (fs.existsSync(dirPath)) {
            if (fs.statSync(dirPath).isDirectory()) {
                fs.readdirSync(dirPath).forEach((file) => {
                    const curPath = path.join(dirPath, file);
                    if (fs.statSync(curPath).isDirectory()) {
                        this.deleteRecursiveSync(curPath);
                    } else {
                        fs.unlinkSync(curPath);
                    }
                });
                fs.rmdirSync(dirPath);
            } else {
                fs.unlinkSync(dirPath);
            }
        }
    }
}
