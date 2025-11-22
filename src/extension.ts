import * as vscode from 'vscode';
import { SkillManager } from './SkillManager';
import { SkillTreeProvider, SkillTreeItem } from './SkillTreeProvider';
import { MarketplacePanel } from './MarketplacePanel';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('Claude Code Assist');
    output.appendLine('Claude Code Assist: activate');
    console.log('Claude Code Assist: activate');

    const skillManager = new SkillManager();
    const skillTreeProvider = new SkillTreeProvider(skillManager);

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
                output.appendLine(`Deleted skill ${node.label}`);
            }
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.moveToGlobal', async (node: SkillTreeItem) => {
        output.appendLine('Command: moveToGlobal');
        if (node.skillItem && node.scope === 'project') {
            await skillManager.moveToGlobal(node.skillItem);
            vscode.window.showInformationMessage(`Moved ${node.label} to Global`);
            skillTreeProvider.refresh();
            output.appendLine(`Moved ${node.label} to global`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.openMarketplace', () => {
        output.appendLine('Command: openMarketplace');
        MarketplacePanel.createOrShow(context.extensionUri);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.downloadSkill', async (skill: any) => {
        output.appendLine(`Command: downloadSkill ${skill?.name ?? ''}`);
        // Ask user for scope
        const scope = await vscode.window.showQuickPick(['Global', 'Project'], { placeHolder: 'Select scope to download to' });
        if (!scope) { return; }

        const targetScope = scope.toLowerCase() as 'global' | 'project';
        // We need to expose a method in SkillManager to save a skill
        // For now, let's just use fs directly or add a method to SkillManager.
        // Let's add a method to SkillManager.
        await skillManager.saveSkill(skill.name, skill.content, skill.type, targetScope);
        vscode.window.showInformationMessage(`Downloaded ${skill.name} to ${scope}`);
        skillTreeProvider.refresh();
        output.appendLine(`Downloaded ${skill.name} to ${scope}`);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('claude-code-assist.checkConflicts', async () => {
        output.appendLine('Command: checkConflicts');
        const conflicts = await skillManager.checkConflicts();
        if (conflicts.length > 0) {
            vscode.window.showWarningMessage(`Found conflicts: ${conflicts.join(', ')}`);
            output.appendLine(`Conflicts: ${conflicts.join(', ')}`);
        } else {
            vscode.window.showInformationMessage('No conflicts found.');
            output.appendLine('No conflicts found');
        }
    }));
}

export function deactivate() { }
