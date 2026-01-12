import * as vscode from 'vscode';
import * as https from 'https';
import { MarketplaceSkill } from './sources';

interface RepoInfo {
    readme: string;
    files: string[];
    stars: number;
    forks: number;
    updatedAt: string;
    license: string | null;
    description: string;
}

export class SkillPreviewPanel {
    public static currentPanel: SkillPreviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _skill: MarketplaceSkill;

    public static createOrShow(extensionUri: vscode.Uri, skill: MarketplaceSkill) {
        const column = vscode.ViewColumn.Beside;

        if (SkillPreviewPanel.currentPanel) {
            SkillPreviewPanel.currentPanel._skill = skill;
            SkillPreviewPanel.currentPanel._panel.reveal(column);
            SkillPreviewPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'claudeSkillPreview',
            `Preview: ${skill.name}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        SkillPreviewPanel.currentPanel = new SkillPreviewPanel(panel, extensionUri, skill);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, skill: MarketplaceSkill) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._skill = skill;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'install':
                        vscode.commands.executeCommand('claude-code-assist.downloadSkill', this._skill);
                        return;
                    case 'openUrl':
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                        return;
                }
            },
            null,
            this._disposables
        );

        this._update();
    }

    public dispose() {
        SkillPreviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _update() {
        this._panel.title = `Preview: ${this._skill.name}`;
        this._panel.webview.html = this._getLoadingHtml();

        try {
            const repoInfo = await this._fetchRepoInfo();
            this._panel.webview.html = this._getHtmlForWebview(repoInfo);
        } catch (error) {
            this._panel.webview.html = this._getErrorHtml(String(error));
        }
    }

    private async _fetchRepoInfo(): Promise<RepoInfo> {
        const url = this._skill.url;

        // Extract owner/repo from GitHub URL
        const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (!match) {
            throw new Error('Not a valid GitHub URL');
        }

        const owner = match[1];
        const repo = match[2].replace(/\.git$/, '');

        // Fetch repo info
        const repoData = await this._fetchJson(`https://api.github.com/repos/${owner}/${repo}`);

        // Fetch README
        let readme = '';
        try {
            const readmeData = await this._fetchJson(`https://api.github.com/repos/${owner}/${repo}/readme`);
            if (readmeData.content) {
                readme = Buffer.from(readmeData.content, 'base64').toString('utf-8');
            }
        } catch (e) {
            readme = '*No README found*';
        }

        // Fetch file tree (root level)
        let files: string[] = [];
        try {
            const treeData = await this._fetchJson(`https://api.github.com/repos/${owner}/${repo}/contents`);
            if (Array.isArray(treeData)) {
                files = treeData.map((f: any) => {
                    const icon = f.type === 'dir' ? '📁' : '📄';
                    return `${icon} ${f.name}`;
                });
            }
        } catch (e) {
            // Ignore
        }

        return {
            readme,
            files,
            stars: repoData.stargazers_count || 0,
            forks: repoData.forks_count || 0,
            updatedAt: repoData.updated_at || '',
            license: repoData.license?.name || null,
            description: repoData.description || ''
        };
    }

    private _fetchJson(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'Claude-Code-Assist' } }, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Invalid JSON'));
                    }
                });
            }).on('error', reject);
        });
    }

    private _getLoadingHtml() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }
                .loader {
                    border: 3px solid var(--vscode-editor-background);
                    border-top: 3px solid var(--vscode-button-background);
                    border-radius: 50%;
                    width: 30px;
                    height: 30px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </head>
        <body>
            <h2>${this._escapeHtml(this._skill.name)}</h2>
            <div class="loader"></div>
            <p>Loading preview...</p>
        </body>
        </html>`;
    }

    private _getErrorHtml(error: string) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }
                .error { color: var(--vscode-errorForeground); }
                button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                    border-radius: 4px;
                    margin-top: 12px;
                }
            </style>
        </head>
        <body>
            <h2>${this._escapeHtml(this._skill.name)}</h2>
            <p class="error">Failed to load preview: ${this._escapeHtml(error)}</p>
            <button onclick="install()">Install Anyway</button>
            <script>
                const vscode = acquireVsCodeApi();
                function install() {
                    vscode.postMessage({ command: 'install' });
                }
            </script>
        </body>
        </html>`;
    }

    private _getHtmlForWebview(info: RepoInfo) {
        const updatedDate = info.updatedAt ? new Date(info.updatedAt).toLocaleDateString() : 'Unknown';

        // Convert markdown to simple HTML (basic conversion)
        const readmeHtml = this._markdownToHtml(info.readme);

        const filesHtml = info.files.length > 0
            ? `<ul class="file-list">${info.files.map(f => `<li>${this._escapeHtml(f)}</li>`).join('')}</ul>`
            : '<p class="muted">No files to display</p>';

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Preview: ${this._escapeHtml(this._skill.name)}</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    margin: 0;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    line-height: 1.6;
                }

                .header {
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 16px;
                    margin-bottom: 20px;
                }

                h1 {
                    margin: 0 0 8px 0;
                    font-size: 1.5em;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .tag {
                    font-size: 0.6em;
                    padding: 3px 8px;
                    border-radius: 3px;
                    color: white;
                    text-transform: uppercase;
                }
                .tag.skill { background-color: #28a745; }
                .tag.agent { background-color: #007acc; }
                .tag.plugin { background-color: #6f42c1; }

                .description {
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 16px;
                }

                .meta {
                    display: flex;
                    gap: 20px;
                    flex-wrap: wrap;
                    font-size: 0.9em;
                    margin-bottom: 16px;
                }

                .meta-item {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .meta-item.stars { color: #f0ad4e; }

                .actions {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 20px;
                }

                button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 10px 20px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 14px;
                }

                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }

                button.secondary {
                    background: transparent;
                    border: 1px solid var(--vscode-button-background);
                    color: var(--vscode-button-background);
                }

                .section {
                    margin-bottom: 24px;
                }

                .section-title {
                    font-size: 1.1em;
                    font-weight: bold;
                    margin-bottom: 12px;
                    color: var(--vscode-foreground);
                }

                .file-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    background: var(--vscode-input-background);
                    border-radius: 4px;
                    padding: 12px;
                    font-family: monospace;
                    font-size: 0.9em;
                }

                .file-list li {
                    padding: 4px 0;
                }

                .readme {
                    background: var(--vscode-input-background);
                    border-radius: 4px;
                    padding: 16px;
                    overflow-x: auto;
                }

                .readme h1, .readme h2, .readme h3 {
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 8px;
                }

                .readme pre {
                    background: var(--vscode-textCodeBlock-background);
                    padding: 12px;
                    border-radius: 4px;
                    overflow-x: auto;
                }

                .readme code {
                    background: var(--vscode-textCodeBlock-background);
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-family: monospace;
                }

                .readme pre code {
                    background: transparent;
                    padding: 0;
                }

                .muted {
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>
                    ${this._escapeHtml(this._skill.name)}
                    <span class="tag ${this._skill.type}">${this._skill.type}</span>
                </h1>
                <p class="description">${this._escapeHtml(info.description || this._skill.description)}</p>
                <div class="meta">
                    <span class="meta-item stars">★ ${info.stars} stars</span>
                    <span class="meta-item">🍴 ${info.forks} forks</span>
                    <span class="meta-item">📅 Updated: ${updatedDate}</span>
                    ${info.license ? `<span class="meta-item">📄 ${this._escapeHtml(info.license)}</span>` : ''}
                    ${this._skill.author ? `<span class="meta-item">👤 @${this._escapeHtml(this._skill.author)}</span>` : ''}
                </div>
                <div class="actions">
                    <button onclick="install()">Install</button>
                    <button class="secondary" onclick="openUrl('${this._escapeJs(this._skill.url)}')">View on GitHub</button>
                </div>
            </div>

            <div class="section">
                <div class="section-title">📁 Files</div>
                ${filesHtml}
            </div>

            <div class="section">
                <div class="section-title">📖 README</div>
                <div class="readme">
                    ${readmeHtml}
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                function install() {
                    vscode.postMessage({ command: 'install' });
                }

                function openUrl(url) {
                    vscode.postMessage({ command: 'openUrl', url });
                }
            </script>
        </body>
        </html>`;
    }

    private _markdownToHtml(markdown: string): string {
        // Basic markdown to HTML conversion
        let html = this._escapeHtml(markdown);

        // Headers
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Bold and italic
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Lists
        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';

        // Clean up empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>(<h[1-3]>)/g, '$1');
        html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)<\/p>/g, '$1');
        html = html.replace(/<p>(<pre>)/g, '$1');
        html = html.replace(/(<\/pre>)<\/p>/g, '$1');

        return html;
    }

    private _escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private _escapeJs(str: string): string {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"');
    }
}
