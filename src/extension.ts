import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import { SkillManager } from './SkillManager';
import { PluginManager } from './PluginManager';
import { CommandManager } from './CommandManager';
import { SkillTreeProvider, SkillTreeItem } from './SkillTreeProvider';
import { MarketplacePanel } from './MarketplacePanel';
import { SecurityAuditor, AuditResult } from './SecurityAuditor';
import { AuditResultPanel } from './AuditResultPanel';
import { SmartInstaller, ParsedUrl } from './SmartInstaller';
import { ClipboardWatcher } from './ClipboardWatcher';
import { UpdateChecker } from './UpdateChecker';
import { ImportExport } from './ImportExport';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('Claude Code Assist');
    output.appendLine('Claude Code Assist: activate');
    console.log('Claude Code Assist: activate');

    const skillManager = new SkillManager();
    const pluginManager = new PluginManager();
    const commandManager = new CommandManager();
    const skillTreeProvider = new SkillTreeProvider(skillManager, pluginManager, commandManager);
    const securityAuditor = new SecurityAuditor(output);
    const smartInstaller = new SmartInstaller(output);
    const clipboardWatcher = new ClipboardWatcher(smartInstaller, output);
    const updateChecker = new UpdateChecker(output);
    const importExport = new ImportExport(output, skillManager, smartInstaller);

    // Start clipboard watcher if enabled
    const config = vscode.workspace.getConfiguration('claudeCodeAssist');
    if (config.get<boolean>('enableClipboardWatcher', true)) {
        clipboardWatcher.start();
    }

    // Listen for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('claudeCodeAssist.enableClipboardWatcher')) {
                const enabled = vscode.workspace.getConfiguration('claudeCodeAssist')
                    .get<boolean>('enableClipboardWatcher', true);
                if (enabled) {
                    clipboardWatcher.start();
                } else {
                    clipboardWatcher.stop();
                }
            }
        })
    );

    context.subscriptions.push(clipboardWatcher);

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

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.moveToUser', async (node: SkillTreeItem) => {
        output.appendLine('Command: moveToUser');
        if (node.skillItem && node.scope === 'project') {
            // Ask user if they want to Move or Copy
            const action = await vscode.window.showQuickPick(['Copy to User', 'Move to User'], { placeHolder: 'Select action' });
            if (!action) { return; }

            try {
                if (action === 'Move to User') {
                    await skillManager.moveToUser(node.skillItem);
                    vscode.window.showInformationMessage(`Moved ${node.label} to User`);
                    output.appendLine(`Moved ${node.label} to user`);
                } else {
                    await skillManager.copyToUser(node.skillItem);
                    vscode.window.showInformationMessage(`Copied ${node.label} to User`);
                    output.appendLine(`Copied ${node.label} to user`);
                }
                skillTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to ${action === 'Move to User' ? 'move' : 'copy'} skill: ${error}`);
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.moveToProject', async (node: SkillTreeItem) => {
        output.appendLine('Command: moveToProject');
        if (node.skillItem && node.scope === 'user') {
            const action = await vscode.window.showQuickPick(['Copy to Project', 'Move to Project'], { placeHolder: 'Select action' });
            if (!action) { return; }

            try {
                if (action === 'Move to Project') {
                    await skillManager.moveToProject(node.skillItem);
                    vscode.window.showInformationMessage(`Moved ${node.label} to Project`);
                    output.appendLine(`Moved ${node.label} to project`);
                } else {
                    await skillManager.copyToProject(node.skillItem);
                    vscode.window.showInformationMessage(`Copied ${node.label} to Project`);
                    output.appendLine(`Copied ${node.label} to project`);
                }
                skillTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to ${action === 'Move to Project' ? 'move' : 'copy'} skill: ${error}`);
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.openMarketplace', () => {
        output.appendLine('Command: openMarketplace');
        MarketplacePanel.createOrShow(context.extensionUri);
    }));

    // Smart Install: Install from URL command
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.installFromUrl', async () => {
        output.appendLine('Command: installFromUrl');

        // Show input box for URL
        const input = await vscode.window.showInputBox({
            prompt: 'Enter GitHub URL or shorthand (e.g., user/repo, gist:id)',
            placeHolder: 'https://github.com/user/repo/tree/main/skills/my-skill',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Please enter a URL';
                }
                if (!smartInstaller.isValidInput(value)) {
                    return 'Invalid format. Use GitHub URL, user/repo, or gist:id';
                }
                return null;
            }
        });

        if (!input) {
            return;
        }

        await installFromInput(input);
    }));

    // Smart Install: Install from clipboard command
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.installFromClipboard', async () => {
        output.appendLine('Command: installFromClipboard');

        const clipboardUrl = await clipboardWatcher.getClipboardUrl();
        if (!clipboardUrl) {
            vscode.window.showWarningMessage('No valid skill URL found in clipboard');
            return;
        }

        await installFromInput(clipboardUrl);
    }));

    // Helper function for smart install
    async function installFromInput(input: string) {
        const parsed = smartInstaller.parseUrl(input);
        if (!parsed) {
            vscode.window.showErrorMessage('Could not parse URL');
            return;
        }

        // Ask for scope
        const scope = await vscode.window.showQuickPick(['User', 'Project'], {
            placeHolder: `Install "${parsed.skillName}" to...`
        });
        if (!scope) {
            return;
        }

        const targetScope = scope.toLowerCase() as 'user' | 'project';

        // Allow user to customize name
        const customName = await vscode.window.showInputBox({
            prompt: 'Skill name (press Enter to use default)',
            value: parsed.skillName,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Name can only contain letters, numbers, hyphens, and underscores';
                }
                return null;
            }
        });

        if (!customName) {
            return;
        }

        // Update parsed name if customized
        parsed.skillName = customName;

        // Install with progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing ${parsed.skillName}...`,
            cancellable: false
        }, async () => {
            const result = await smartInstaller.install(parsed, targetScope);

            if (result.success) {
                vscode.window.showInformationMessage(`Installed ${parsed.skillName} to ${scope}`);
                skillTreeProvider.refresh();

                // Trigger post-install audit if enabled
                const autoAudit = vscode.workspace.getConfiguration('claudeCodeAssist')
                    .get<boolean>('autoAuditOnInstall', true);
                if (autoAudit && result.destPath) {
                    triggerPostInstallAudit(result.destPath, parsed.skillName, parsed.skillType);
                }
            } else {
                vscode.window.showErrorMessage(`Install failed: ${result.error}`);
            }
        });
    }

    // Helper function for post-install audit
    async function triggerPostInstallAudit(destPath: string, itemName: string, itemType: 'skill' | 'agent') {
        setTimeout(async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Security audit: ${itemName}...`,
                cancellable: false
            }, async () => {
                try {
                    const result = await securityAuditor.auditPath(destPath, itemName, itemType);
                    if (result.status === 'danger') {
                        const action = await vscode.window.showWarningMessage(
                            `Security issues found in ${itemName}!`,
                            'View Details', 'Delete'
                        );
                        if (action === 'View Details') {
                            AuditResultPanel.createOrShow(context.extensionUri, [result]);
                        } else if (action === 'Delete') {
                            fs.rmSync(destPath, { recursive: true, force: true });
                            skillTreeProvider.refresh();
                            vscode.window.showInformationMessage(`Deleted ${itemName} due to security concerns.`);
                        }
                    } else if (result.status === 'warning') {
                        const action = await vscode.window.showWarningMessage(
                            `Warnings found in ${itemName}.`,
                            'View Details'
                        );
                        if (action === 'View Details') {
                            AuditResultPanel.createOrShow(context.extensionUri, [result]);
                        }
                    } else {
                        output.appendLine(`${itemName} passed security audit.`);
                    }
                } catch (error) {
                    output.appendLine(`Post-install audit failed: ${error}`);
                }
            });
        }, 500);
    }

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.downloadSkill', async (skill: any) => {
        output.appendLine(`Command: downloadSkill ${skill?.name ?? ''} `);
        // Ask user for scope
        const scope = await vscode.window.showQuickPick(['User', 'Project'], { placeHolder: 'Select scope to download to' });
        if (!scope) { return; }

        const targetScope = scope.toLowerCase() as 'user' | 'project';

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
                            if (targetScope === 'user') {
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

                            // Trigger post-install security audit
                            const autoAudit = config.get<boolean>('autoAuditOnInstall', true);
                            if (autoAudit) {
                                // Schedule audit after download completes
                                setTimeout(async () => {
                                    await vscode.window.withProgress({
                                        location: vscode.ProgressLocation.Notification,
                                        title: `Security audit: ${skill.name}...`,
                                        cancellable: false
                                    }, async () => {
                                        try {
                                            const result = await securityAuditor.auditPath(destPath, skill.name, skill.type);
                                            if (result.status === 'danger') {
                                                vscode.window.showWarningMessage(
                                                    `Security issues found in ${skill.name}!`,
                                                    'View Details', 'Delete'
                                                ).then(action => {
                                                    if (action === 'View Details') {
                                                        AuditResultPanel.createOrShow(context.extensionUri, [result]);
                                                    } else if (action === 'Delete') {
                                                        fs.rmSync(destPath, { recursive: true, force: true });
                                                        skillTreeProvider.refresh();
                                                        vscode.window.showInformationMessage(`Deleted ${skill.name} due to security concerns.`);
                                                    }
                                                });
                                            } else if (result.status === 'warning') {
                                                vscode.window.showWarningMessage(
                                                    `Warnings found in ${skill.name}.`,
                                                    'View Details'
                                                ).then(action => {
                                                    if (action === 'View Details') {
                                                        AuditResultPanel.createOrShow(context.extensionUri, [result]);
                                                    }
                                                });
                                            } else {
                                                output.appendLine(`${skill.name} passed security audit.`);
                                            }
                                        } catch (error) {
                                            output.appendLine(`Post-install audit failed: ${error}`);
                                        }
                                    });
                                }, 500);
                            }

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

    // Security Audit Commands
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.auditAll', async () => {
        output.appendLine('Command: auditAll');

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Security Audit',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: 'Loading items to audit...' });

            const skills = await skillManager.getSkills();
            const plugins = await pluginManager.getPlugins();

            if (skills.length === 0 && plugins.length === 0) {
                vscode.window.showInformationMessage('No skills or plugins to audit.');
                return;
            }

            const results: AuditResult[] = await securityAuditor.auditAll(
                skills,
                plugins,
                (auditProgress) => {
                    const percent = Math.round((auditProgress.current / auditProgress.total) * 100);
                    progress.report({
                        message: `(${auditProgress.current}/${auditProgress.total}) ${auditProgress.currentItem}`,
                        increment: 100 / auditProgress.total
                    });
                }
            );

            // Show results in WebView
            AuditResultPanel.createOrShow(context.extensionUri, results);

            // Show summary notification
            const dangerCount = results.filter(r => r.status === 'danger').length;
            const warningCount = results.filter(r => r.status === 'warning').length;

            if (dangerCount > 0) {
                vscode.window.showWarningMessage(
                    `Security audit complete: ${dangerCount} dangerous, ${warningCount} warnings found!`,
                    'View Results'
                ).then(action => {
                    if (action === 'View Results') {
                        AuditResultPanel.createOrShow(context.extensionUri, results);
                    }
                });
            } else if (warningCount > 0) {
                vscode.window.showWarningMessage(
                    `Security audit complete: ${warningCount} warnings found.`,
                    'View Results'
                ).then(action => {
                    if (action === 'View Results') {
                        AuditResultPanel.createOrShow(context.extensionUri, results);
                    }
                });
            } else {
                vscode.window.showInformationMessage('Security audit complete: All items are safe!');
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.auditSkill', async (node: SkillTreeItem) => {
        output.appendLine('Command: auditSkill');

        if (!node.skillItem) {
            vscode.window.showErrorMessage('No skill selected for audit.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Auditing ${node.skillItem.name}...`,
            cancellable: false
        }, async () => {
            const result = await securityAuditor.auditSkill(node.skillItem!);
            AuditResultPanel.createOrShow(context.extensionUri, [result]);
            showAuditNotification(result);
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.auditPlugin', async (node: SkillTreeItem) => {
        output.appendLine('Command: auditPlugin');

        if (!node.pluginItem) {
            vscode.window.showErrorMessage('No plugin selected for audit.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Auditing plugin ${node.pluginItem.name}...`,
            cancellable: false
        }, async () => {
            const result = await securityAuditor.auditPlugin(node.pluginItem!);
            AuditResultPanel.createOrShow(context.extensionUri, [result]);
            showAuditNotification(result);
        });
    }));

    // Helper function to show audit notification
    function showAuditNotification(result: AuditResult) {
        if (result.status === 'danger') {
            vscode.window.showWarningMessage(
                `Security issues found in ${result.itemName}!`,
                'View Details'
            ).then(action => {
                if (action === 'View Details') {
                    AuditResultPanel.createOrShow(context.extensionUri, [result]);
                }
            });
        } else if (result.status === 'warning') {
            vscode.window.showWarningMessage(
                `Warnings found in ${result.itemName}.`,
                'View Details'
            ).then(action => {
                if (action === 'View Details') {
                    AuditResultPanel.createOrShow(context.extensionUri, [result]);
                }
            });
        } else if (result.status === 'error') {
            vscode.window.showErrorMessage(`Audit failed for ${result.itemName}: Check output for details.`);
            securityAuditor.showOutput();
        } else {
            vscode.window.showInformationMessage(`${result.itemName} is safe!`);
        }
    }

    // Check for updates command
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.checkUpdates', async () => {
        output.appendLine('Command: checkUpdates');

        const skills = await skillManager.getSkills();
        if (skills.length === 0) {
            vscode.window.showInformationMessage('No skills installed to check for updates.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Checking for updates...',
            cancellable: false
        }, async (progress) => {
            const results = await updateChecker.checkAll(skills, (current, total, name) => {
                progress.report({
                    message: `(${current}/${total}) ${name}`,
                    increment: 100 / total
                });
            });

            const updatesAvailable = results.filter(r => r.hasUpdate);

            if (updatesAvailable.length > 0) {
                vscode.window.showInformationMessage(
                    `${updatesAvailable.length} skill(s) have updates available: ${updatesAvailable.map(u => u.skillName).join(', ')}`,
                    'View Details'
                ).then(action => {
                    if (action === 'View Details') {
                        output.show();
                        output.appendLine('--- Update Check Results ---');
                        for (const result of results) {
                            if (result.hasUpdate) {
                                output.appendLine(`  [UPDATE] ${result.skillName}`);
                            } else if (result.error) {
                                output.appendLine(`  [ERROR] ${result.skillName}: ${result.error}`);
                            } else {
                                output.appendLine(`  [OK] ${result.skillName}`);
                            }
                        }
                    }
                });
            } else {
                vscode.window.showInformationMessage('All skills are up to date!');
            }
        });
    }));

    // Export configuration command
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.exportConfig', async () => {
        output.appendLine('Command: exportConfig');
        await importExport.exportConfig();
    }));

    // Import configuration command
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.importConfig', async () => {
        output.appendLine('Command: importConfig');
        await importExport.importConfig();
        skillTreeProvider.refresh();
    }));

    // Delete command
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.deleteCommand', async (node: SkillTreeItem) => {
        output.appendLine('Command: deleteCommand');
        if (node.commandItem) {
            const answer = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.label}?`, 'Yes', 'No');
            if (answer === 'Yes') {
                await commandManager.deleteCommand(node.commandItem);
                skillTreeProvider.refresh();
                output.appendLine(`Deleted command ${node.label}`);
            }
        }
    }));

    // Move command to user
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.moveCommandToUser', async (node: SkillTreeItem) => {
        output.appendLine('Command: moveCommandToUser');
        if (node.commandItem && node.scope === 'project') {
            // Ask user if they want to Move or Copy
            const action = await vscode.window.showQuickPick(['Copy to User', 'Move to User'], { placeHolder: 'Select action' });
            if (!action) { return; }

            try {
                if (action === 'Move to User') {
                    await commandManager.moveToUser(node.commandItem);
                    vscode.window.showInformationMessage(`Moved ${node.label} to User`);
                    output.appendLine(`Moved command ${node.label} to user`);
                } else {
                    await commandManager.copyToUser(node.commandItem);
                    vscode.window.showInformationMessage(`Copied ${node.label} to User`);
                    output.appendLine(`Copied command ${node.label} to user`);
                }
                skillTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to ${action === 'Move to User' ? 'move' : 'copy'} command: ${error}`);
            }
        }
    }));

    // Move command to project
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.moveCommandToProject', async (node: SkillTreeItem) => {
        output.appendLine('Command: moveCommandToProject');
        if (node.commandItem && node.scope === 'user') {
            const action = await vscode.window.showQuickPick(['Copy to Project', 'Move to Project'], { placeHolder: 'Select action' });
            if (!action) { return; }

            try {
                if (action === 'Move to Project') {
                    await commandManager.moveToProject(node.commandItem);
                    vscode.window.showInformationMessage(`Moved ${node.label} to Project`);
                    output.appendLine(`Moved command ${node.label} to project`);
                } else {
                    await commandManager.copyToProject(node.commandItem);
                    vscode.window.showInformationMessage(`Copied ${node.label} to Project`);
                    output.appendLine(`Copied command ${node.label} to project`);
                }
                skillTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to ${action === 'Move to Project' ? 'move' : 'copy'} command: ${error}`);
            }
        }
    }));

    // Move plugin to user
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.movePluginToUser', async (node: SkillTreeItem) => {
        output.appendLine('Command: movePluginToUser');
        if (node.pluginItem && node.scope === 'project') {
            const action = await vscode.window.showQuickPick(['Copy to User', 'Move to User'], { placeHolder: 'Select action' });
            if (!action) { return; }

            try {
                if (action === 'Move to User') {
                    await pluginManager.moveToUser(node.pluginItem);
                    vscode.window.showInformationMessage(`Moved ${node.label} to User`);
                    output.appendLine(`Moved plugin ${node.label} to user`);
                } else {
                    await pluginManager.copyToUser(node.pluginItem);
                    vscode.window.showInformationMessage(`Copied ${node.label} to User`);
                    output.appendLine(`Copied plugin ${node.label} to user`);
                }
                skillTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to ${action === 'Move to User' ? 'move' : 'copy'} plugin: ${error}`);
            }
        }
    }));

    // Move plugin to project
    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.movePluginToProject', async (node: SkillTreeItem) => {
        output.appendLine('Command: movePluginToProject');
        if (node.pluginItem && node.scope === 'user') {
            const action = await vscode.window.showQuickPick(['Copy to Project', 'Move to Project'], { placeHolder: 'Select action' });
            if (!action) { return; }

            try {
                if (action === 'Move to Project') {
                    await pluginManager.moveToProject(node.pluginItem);
                    vscode.window.showInformationMessage(`Moved ${node.label} to Project`);
                    output.appendLine(`Moved plugin ${node.label} to project`);
                } else {
                    await pluginManager.copyToProject(node.pluginItem);
                    vscode.window.showInformationMessage(`Copied ${node.label} to Project`);
                    output.appendLine(`Copied plugin ${node.label} to project`);
                }
                skillTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to ${action === 'Move to Project' ? 'move' : 'copy'} plugin: ${error}`);
            }
        }
    }));
}

export function deactivate() { }
