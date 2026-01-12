import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SkillItem, SkillManager } from './SkillManager';
import { SmartInstaller } from './SmartInstaller';
import { getFavoritesManager, FavoriteItem } from './FavoritesManager';

interface ExportData {
    version: number;
    exportedAt: string;
    skills: ExportedSkill[];
    favorites: FavoriteItem[];
}

interface ExportedSkill {
    name: string;
    type: 'skill' | 'agent';
    scope: 'global' | 'project';
    url?: string;
    path: string;
}

export class ImportExport {
    private output: vscode.OutputChannel;
    private skillManager: SkillManager;
    private smartInstaller: SmartInstaller;

    constructor(output: vscode.OutputChannel, skillManager: SkillManager, smartInstaller: SmartInstaller) {
        this.output = output;
        this.skillManager = skillManager;
        this.smartInstaller = smartInstaller;
    }

    /**
     * Export current skills and favorites to a JSON file
     */
    async exportConfig(): Promise<void> {
        try {
            const skills = await this.skillManager.getSkills();
            const favorites = getFavoritesManager().getAll();

            const exportedSkills: ExportedSkill[] = skills.map(skill => {
                // Try to find URL from .skill-meta.json
                let url: string | undefined;
                const metaPath = path.join(skill.path, '.skill-meta.json');
                if (fs.existsSync(metaPath)) {
                    try {
                        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                        url = meta.url;
                    } catch (e) {
                        // Ignore
                    }
                }

                return {
                    name: skill.name,
                    type: skill.type,
                    scope: skill.scope,
                    url,
                    path: skill.path
                };
            });

            const exportData: ExportData = {
                version: 1,
                exportedAt: new Date().toISOString(),
                skills: exportedSkills,
                favorites
            };

            // Ask user where to save
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('claude-skills-config.json'),
                filters: {
                    'JSON Files': ['json']
                },
                title: 'Export Claude Skills Configuration'
            });

            if (!saveUri) {
                return;
            }

            fs.writeFileSync(saveUri.fsPath, JSON.stringify(exportData, null, 2), 'utf-8');

            vscode.window.showInformationMessage(
                `Exported ${exportedSkills.length} skills and ${favorites.length} favorites to ${path.basename(saveUri.fsPath)}`
            );

            this.output.appendLine(`Exported configuration to ${saveUri.fsPath}`);

        } catch (error: any) {
            vscode.window.showErrorMessage(`Export failed: ${error.message}`);
            this.output.appendLine(`Export failed: ${error.message}`);
        }
    }

    /**
     * Import skills and favorites from a JSON file
     */
    async importConfig(): Promise<void> {
        try {
            // Ask user to select file
            const fileUris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    'JSON Files': ['json']
                },
                title: 'Import Claude Skills Configuration'
            });

            if (!fileUris || fileUris.length === 0) {
                return;
            }

            const filePath = fileUris[0].fsPath;
            const content = fs.readFileSync(filePath, 'utf-8');
            const data: ExportData = JSON.parse(content);

            if (!data.version || !data.skills) {
                throw new Error('Invalid configuration file format');
            }

            // Ask what to import
            const choices = await vscode.window.showQuickPick([
                { label: 'Skills and Favorites', value: 'all' },
                { label: 'Skills Only', value: 'skills' },
                { label: 'Favorites Only', value: 'favorites' }
            ], {
                placeHolder: 'What would you like to import?'
            });

            if (!choices) {
                return;
            }

            let skillsImported = 0;
            let skillsFailed = 0;
            let favoritesImported = 0;

            // Import skills
            if (choices.value === 'all' || choices.value === 'skills') {
                const skillsWithUrls = data.skills.filter(s => s.url);

                if (skillsWithUrls.length > 0) {
                    const confirm = await vscode.window.showWarningMessage(
                        `Import ${skillsWithUrls.length} skills? This will download them from their original URLs.`,
                        'Import', 'Cancel'
                    );

                    if (confirm === 'Import') {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: 'Importing skills...',
                            cancellable: false
                        }, async (progress) => {
                            for (let i = 0; i < skillsWithUrls.length; i++) {
                                const skill = skillsWithUrls[i];
                                progress.report({
                                    message: `(${i + 1}/${skillsWithUrls.length}) ${skill.name}`,
                                    increment: 100 / skillsWithUrls.length
                                });

                                try {
                                    const parsed = this.smartInstaller.parseUrl(skill.url!);
                                    if (parsed) {
                                        parsed.skillName = skill.name;
                                        parsed.skillType = skill.type;
                                        const result = await this.smartInstaller.install(parsed, skill.scope);
                                        if (result.success) {
                                            skillsImported++;
                                        } else {
                                            skillsFailed++;
                                            this.output.appendLine(`Failed to import ${skill.name}: ${result.error}`);
                                        }
                                    } else {
                                        skillsFailed++;
                                    }
                                } catch (e: any) {
                                    skillsFailed++;
                                    this.output.appendLine(`Failed to import ${skill.name}: ${e.message}`);
                                }
                            }
                        });
                    }
                }
            }

            // Import favorites
            if (choices.value === 'all' || choices.value === 'favorites') {
                const favoritesManager = getFavoritesManager();
                for (const fav of data.favorites) {
                    if (!favoritesManager.isFavorite(fav.url)) {
                        favoritesManager.add({
                            name: fav.name,
                            url: fav.url,
                            type: fav.type,
                            description: fav.description,
                            author: fav.author
                        });
                        favoritesImported++;
                    }
                }
            }

            // Show summary
            const messages: string[] = [];
            if (skillsImported > 0) {
                messages.push(`${skillsImported} skills imported`);
            }
            if (skillsFailed > 0) {
                messages.push(`${skillsFailed} skills failed`);
            }
            if (favoritesImported > 0) {
                messages.push(`${favoritesImported} favorites imported`);
            }

            if (messages.length > 0) {
                vscode.window.showInformationMessage(`Import complete: ${messages.join(', ')}`);
            } else {
                vscode.window.showInformationMessage('Nothing new to import');
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`Import failed: ${error.message}`);
            this.output.appendLine(`Import failed: ${error.message}`);
        }
    }
}
