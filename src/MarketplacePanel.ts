import * as vscode from 'vscode';
import * as path from 'path';
import { GitHubService, MarketplaceSkill } from './GitHubService';

export class MarketplacePanel {
    public static currentPanel: MarketplacePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _githubService: GitHubService;

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (MarketplacePanel.currentPanel) {
            MarketplacePanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'claudeMarketplace',
            'Claude Skills Marketplace',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        MarketplacePanel.currentPanel = new MarketplacePanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._githubService = new GitHubService();

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'download':
                        vscode.commands.executeCommand('claude-code-assist.downloadSkill', message.skill);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        MarketplacePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getLoadingHtml();

        const skills = await this._githubService.fetchSkills();
        this._panel.webview.html = this._getHtmlForWebview(webview, skills);
    }

    private _getLoadingHtml() {
        return `<!DOCTYPE html>
        <html lang="en">
        <body>
            <h1>Loading Marketplace...</h1>
        </body>
        </html>`;
    }

    private _getHtmlForWebview(webview: vscode.Webview, skills: MarketplaceSkill[]) {
        const skillsHtml = skills.map(skill => `
            <div class="skill-card">
                <h3>${skill.name} <span class="tag ${skill.type}">${skill.type}</span></h3>
                <p>${skill.description}</p>
                <button onclick="download('${skill.name}', '${skill.type}', '${skill.url}')">Download</button>
            </div>
        `).join('');

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Claude Marketplace</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
                .skill-card { border: 1px solid #ccc; padding: 15px; margin-bottom: 10px; border-radius: 5px; }
                .tag { font-size: 0.8em; padding: 2px 5px; border-radius: 3px; color: white; }
                .tag.agent { background-color: #007acc; }
                .tag.skill { background-color: #28a745; }
                button { background-color: #007acc; color: white; border: none; padding: 8px 15px; cursor: pointer; border-radius: 3px; }
                button:hover { background-color: #005fa3; }
            </style>
        </head>
        <body>
            <h1>Claude Skills Marketplace</h1>
            <p>Source: ComposioHQ/awesome-claude-skills</p>
            <div id="skills-list">
                ${skillsHtml}
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                function download(name, type, url) {
                    vscode.postMessage({
                        command: 'download',
                        skill: { name, type, url }
                    });
                }
            </script>
        </body>
        </html>`;
    }
}
