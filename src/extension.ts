import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import { SkillManager } from './SkillManager';
import { PluginManager } from './PluginManager';
import { SkillTreeProvider, SkillTreeItem } from './SkillTreeProvider';
import { MarketplacePanel } from './MarketplacePanel';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('Claude Code Assist');
    output.appendLine('Claude Code Assist: activate');
    console.log('Claude Code Assist: activate');

    const skillManager = new SkillManager();
    const pluginManager = new PluginManager();
    const skillTreeProvider = new SkillTreeProvider(skillManager, pluginManager);

    vscode.window.registerTreeDataProvider('claudeSkills', skillTreeProvider);
    output.appendLine('Registered tree data provider');

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.refreshSkills', () => {
        output.appendLine('Command: refreshSkills');
        skillTreeProvider.refresh();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.deleteSkill', async (node: SkillTreeItem) => {
        output.appendLine('Command: deleteSkill');
        if (node.skillItem) {
            const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.label}?`, 'Yes', 'No');
            if (answer === 'Yes') {
                await skillManager.deleteSkill(node.skillItem);
                skillTreeProvider.refresh();
                output.appendLine(`Deleted skill ${node.label} `);
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.moveToGlobal', async (node: SkillTreeItem) => {
        output.appendLine('Command: moveToGlobal');
        if (node.skillItem && node.scope === 'project') {
            // Ask user if they want to Move or Copy
            const action = await vscode.window.showQuickPick(['Copy to Global', 'Move to Global'], { placeHolder: 'Select action' });
            if (!action) { return; }

            try {
                if (action === 'Move to Global') {
                    await skillManager.moveToGlobal(node.skillItem);
                    vscode.window.showInformationMessage(`Moved ${node.label} to Global`);
                    output.appendLine(`Moved ${node.label} to global`);
                } else {
                    await skillManager.copyToGlobal(node.skillItem);
                    vscode.window.showInformationMessage(`Copied ${node.label} to Global`);
                    output.appendLine(`Copied ${node.label} to global`);
                }
                skillTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to ${action === 'Move to Global' ? 'move' : 'copy'} skill: ${error}`);
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.openMarketplace', () => {
        output.appendLine('Command: openMarketplace');
        MarketplacePanel.createOrShow(context.extensionUri);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.downloadSkill', async (skill: any) => {
        output.appendLine(`Command: downloadSkill ${skill?.name ?? ''} `);
        // Ask user for scope
        const scope = await vscode.window.showQuickPick(['Global', 'Project'], { placeHolder: 'Select scope to download to' });
        if (!scope) { return; }

        const targetScope = scope.toLowerCase() as 'global' | 'project';

        try {
            // If skill has a URL, fetch content from there
            if (skill.url) {
                output.appendLine(`Processing URL: ${skill.url}`);
                let fetchUrl = skill.url;

                // Handle GitHub URLs
                if (fetchUrl.includes('github.com')) {
                    // Special handling for SKILL.md or agent.md that imply a folder skill
                    // If the URL points to SKILL.md, we want to download the containing folder
                    if (fetchUrl.includes('/blob/') && (fetchUrl.endsWith('SKILL.md') || fetchUrl.endsWith('agent.md'))) {
                        // Convert blob URL to tree URL for the parent folder
                        // https://github.com/user/repo/blob/main/folder/SKILL.md -> https://github.com/user/repo/tree/main/folder
                        fetchUrl = fetchUrl.replace('/blob/', '/tree/');
                        fetchUrl = fetchUrl.substring(0, fetchUrl.lastIndexOf('/'));
                        output.appendLine(`Converted File URL to Folder URL: ${fetchUrl}`);
                    }

                    // Case 1: Blob URL (File) -> Convert to Raw and download file
                    if (fetchUrl.includes('/blob/')) {
                        fetchUrl = fetchUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
                        output.appendLine(`Downloading file from: ${fetchUrl}`);

                        const https = require('https');
                        const content = await new Promise<string>((resolve, reject) => {
                            https.get(fetchUrl, (res: any) => {
                                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                    https.get(res.headers.location, (res2: any) => {
                                        let data = '';
                                        res2.on('data', (chunk: any) => data += chunk);
                                        res2.on('end', () => resolve(data));
                                    }).on('error', (err: any) => reject(err));
                                    return;
                                }
                                let data = '';
                                res.on('data', (chunk: any) => data += chunk);
                                res.on('end', () => {
                                    if (data.trim().startsWith('<!DOCTYPE html>') || data.trim().startsWith('<html')) {
                                        reject(new Error('Downloaded content appears to be HTML.'));
                                    } else {
                                        resolve(data);
                                    }
                                });
                            }).on('error', (err: any) => reject(err));
                        });
                        await skillManager.saveSkill(skill.name, content, skill.type, targetScope);
                    }
                    // Case 2: Tree URL (Folder) or Repo Root -> Git Clone
                    else {
                        output.appendLine(`Detected folder/repo URL. Attempting git clone...`);

                        // Parse URL
                        // Formats: 
                        // https://github.com/user/repo
                        // https://github.com/user/repo/tree/branch/path/to/folder

                        const repoMatch = fetchUrl.match(/(https:\/\/github\.com\/[^\/]+\/[^\/]+?)(?:\.git)?(?:\/|$)/);
                        if (!repoMatch) { throw new Error('Invalid GitHub URL'); }
                        const repoUrl = repoMatch[1] + '.git';

                        let branch = 'main'; // Default, but we should try to detect
                        let subPath = '';

                        if (fetchUrl.includes('/tree/')) {
                            const parts = fetchUrl.split('/tree/');
                            if (parts.length > 1) {
                                const branchAndPath = parts[1].split('/');
                                branch = branchAndPath[0];
                                subPath = branchAndPath.slice(1).join('/');
                            }
                        }

                        // Create temp dir
                        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-skill-'));

                        try {
                            output.appendLine(`Cloning ${repoUrl} (branch: ${branch}) to ${tempDir}`);
                            // Try cloning specific branch, fallback to default if fails (or just clone default if branch not specified in URL?)
                            // If URL didn't have /tree/, it's repo root, so use default branch.
                            // If URL had /tree/branch, use that branch.

                            let cloneCmd = `git clone --depth 1 ${repoUrl} .`;

                            if (fetchUrl.includes('/tree/')) {
                                cloneCmd = `git clone --depth 1 --branch ${branch} ${repoUrl} .`;
                            }

                            output.appendLine(`Executing: ${cloneCmd}`);

                            try {
                                cp.execSync(cloneCmd, { cwd: tempDir });
                                output.appendLine(`Clone success.`);
                            } catch (e: any) {
                                output.appendLine(`Clone failed: ${e.message}`);
                                throw e;
                            }

                            const files = fs.readdirSync(tempDir);
                            let sourcePath = subPath ? path.join(tempDir, subPath) : tempDir;

                            // Check if sourcePath exists
                            if (!fs.existsSync(sourcePath)) {
                                // Try fuzzy match
                                // e.g. artifacts-builder -> web-artifacts-builder
                                const match = files.find(f => f.includes(subPath) || subPath.includes(f));
                                if (match) {
                                    output.appendLine(`Path ${subPath} not found, but found similar directory: ${match}. Using that.`);
                                    sourcePath = path.join(tempDir, match);
                                } else {
                                    throw new Error(`Path ${subPath} not found in repo. Available: ${files.join(', ')}`);
                                }
                            }

                            // Determine destination
                            const config = vscode.workspace.getConfiguration('claudeCodeAssist');
                            let destRoot = '';
                            if (targetScope === 'global') {
                                destRoot = config.get<string>('globalSkillsPath') || path.join(os.homedir(), '.claude');
                                if (destRoot.startsWith('~')) { destRoot = path.join(os.homedir(), destRoot.slice(1)); }
                            } else {
                                if (!vscode.workspace.workspaceFolders) { throw new Error('No workspace open'); }
                                const projectPathRel = config.get<string>('projectSkillsPath') || './.claude';
                                destRoot = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, projectPathRel);
                            }

                            const destContainer = path.join(destRoot, skill.type === 'skill' ? 'skills' : 'agents');
                            // Ensure destination parent exists
                            if (!fs.existsSync(destContainer)) { fs.mkdirSync(destContainer, { recursive: true }); }

                            const destPath = path.join(destContainer, skill.name);

                            if (fs.existsSync(destPath)) {
                                throw new Error(`Skill ${skill.name} already exists in ${targetScope}`);
                            }

                            if (fs.statSync(sourcePath).isDirectory()) {
                                // Ensure we create the destination directory
                                fs.mkdirSync(destPath, { recursive: true });

                                // Use cpSync with recursive: true
                                if (fs.cpSync) {
                                    // Copy content of sourcePath to destPath
                                    fs.cpSync(sourcePath, destPath, { recursive: true });
                                } else {
                                    // Fallback for older Node versions (though VS Code should have new enough Node)
                                    // Simple recursive copy function
                                    const copyRecursive = (src: string, dest: string) => {
                                        if (fs.statSync(src).isDirectory()) {
                                            if (!fs.existsSync(dest)) { fs.mkdirSync(dest); }
                                            fs.readdirSync(src).forEach(child => {
                                                copyRecursive(path.join(src, child), path.join(dest, child));
                                            });
                                        } else {
                                            fs.copyFileSync(src, dest);
                                        }
                                    };
                                    copyRecursive(sourcePath, destPath);
                                }
                            } else {
                                // If source is a file, we still want to put it in a folder if the user requested "manage in folder"
                                // But typically single file skills are just files.
                                // However, if the user insists on folder management for everything, we could do:
                                // fs.mkdirSync(destPath);
                                // fs.copyFileSync(sourcePath, path.join(destPath, path.basename(sourcePath)));

                                // For now, stick to: File -> File, Folder -> Folder.
                                // Unless sourcePath was a file but we expected a folder?
                                fs.copyFileSync(sourcePath, destPath);
                            }

                            output.appendLine(`Installed to ${destPath}`);

                        } finally {
                            // Cleanup
                            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
                        }
                    }
                } else {
                    // Non-GitHub URL?
                    throw new Error('Only GitHub URLs are supported for now');
                }
            } else if (skill.content) {
                await skillManager.saveSkill(skill.name, skill.content, skill.type, targetScope);
            } else {
                const content = '# ' + skill.name + '\n\n' + skill.description;
                await skillManager.saveSkill(skill.name, content, skill.type, targetScope);
            }

            vscode.window.showInformationMessage(`Downloaded ${skill.name} to ${scope}`);
            skillTreeProvider.refresh();
            output.appendLine(`Downloaded ${skill.name} to ${scope}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to download skill: ${error}`);
            output.appendLine(`Failed to download: ${error}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.checkConflicts', async () => {
        output.appendLine('Command: checkConflicts');
        const conflicts = await skillManager.checkConflicts();
        if (conflicts.length > 0) {
            vscode.window.showWarningMessage(`Found conflicts: ${conflicts.join(', ')} `);
            output.appendLine(`Conflicts: ${conflicts.join(', ')} `);
        } else {
            vscode.window.showInformationMessage('No conflicts found.');
            output.appendLine('No conflicts found');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.deletePlugin', async (node: SkillTreeItem) => {
        output.appendLine('Command: deletePlugin');
        if (node.pluginItem) {
            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to delete plugin "${node.pluginItem.name}" from ${node.pluginItem.marketplace}?`,
                { modal: true },
                'Yes', 'No'
            );
            if (answer === 'Yes') {
                try {
                    await pluginManager.deletePlugin(node.pluginItem);
                    skillTreeProvider.refresh();
                    vscode.window.showInformationMessage(`Deleted plugin ${node.pluginItem.name}`);
                    output.appendLine(`Deleted plugin ${node.pluginItem.name}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete plugin: ${error}`);
                    output.appendLine(`Failed to delete plugin: ${error}`);
                }
            }
        }
    }));
}

export function deactivate() { }
