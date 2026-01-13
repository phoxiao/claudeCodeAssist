import * as vscode from 'vscode';
import { MarketplaceManager, MarketplaceSource } from './MarketplaceManager';

export class MarketplaceConfigPanel {
    public static currentPanel: MarketplaceConfigPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _marketplaceManager: MarketplaceManager;
    private _disposables: vscode.Disposable[] = [];
    private _marketplaces: MarketplaceSource[] = [];

    public static createOrShow(extensionUri: vscode.Uri, marketplaceManager: MarketplaceManager) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (MarketplaceConfigPanel.currentPanel) {
            MarketplaceConfigPanel.currentPanel._panel.reveal(column);
            MarketplaceConfigPanel.currentPanel._refresh();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'claudeMarketplaceConfig',
            'Marketplace Sources',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        MarketplaceConfigPanel.currentPanel = new MarketplaceConfigPanel(panel, extensionUri, marketplaceManager);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, marketplaceManager: MarketplaceManager) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._marketplaceManager = marketplaceManager;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'getMarketplaces':
                        await this._refresh();
                        return;
                    case 'addMarketplace':
                        await this._handleAddMarketplace();
                        return;
                    case 'removeMarketplace':
                        await this._handleRemoveMarketplace(message.name, message.scope);
                        return;
                    case 'refreshMarketplace':
                        await this._handleRefreshMarketplace(message.name, message.scope);
                        return;
                    case 'moveToUser':
                        await this._handleMoveToUser(message.name, message.scope);
                        return;
                    case 'moveToProject':
                        await this._handleMoveToProject(message.name, message.scope);
                        return;
                }
            },
            null,
            this._disposables
        );

        this._refresh();
    }

    public dispose() {
        MarketplaceConfigPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _refresh() {
        try {
            this._marketplaces = await this._marketplaceManager.getMarketplaces();
            this._updateContent();
        } catch (error) {
            this._sendError(`Failed to load marketplaces: ${error}`);
        }
    }

    private _updateContent() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _sendError(message: string) {
        this._panel.webview.postMessage({ command: 'showError', message });
        vscode.window.showErrorMessage(message);
    }

    private _sendSuccess(message: string) {
        this._panel.webview.postMessage({ command: 'showSuccess', message });
        vscode.window.showInformationMessage(message);
    }

    private async _handleAddMarketplace() {
        // Ask for GitHub repo
        const repo = await vscode.window.showInputBox({
            prompt: 'Enter GitHub repository (e.g., owner/repo)',
            placeHolder: 'anthropics/claude-plugins-official',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Please enter a repository';
                }
                if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(value)) {
                    return 'Invalid format. Use owner/repo format';
                }
                return null;
            }
        });

        if (!repo) { return; }

        // Ask for name
        const defaultName = repo.split('/')[1];
        const name = await vscode.window.showInputBox({
            prompt: 'Enter marketplace name',
            value: defaultName,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Please enter a name';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Name can only contain letters, numbers, hyphens, and underscores';
                }
                return null;
            }
        });

        if (!name) { return; }

        // Ask for scope
        const scope = await vscode.window.showQuickPick(['User', 'Project'], {
            placeHolder: 'Select scope'
        });

        if (!scope) { return; }

        const targetScope = scope.toLowerCase() as 'user' | 'project';

        try {
            await this._marketplaceManager.addMarketplace(name, repo, targetScope);
            this._sendSuccess(`Added marketplace "${name}"`);
            await this._refresh();
        } catch (error) {
            this._sendError(`Failed to add marketplace: ${error}`);
        }
    }

    private async _handleRemoveMarketplace(name: string, scope: 'user' | 'project') {
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to remove marketplace "${name}"?`,
            { modal: true },
            'Yes', 'No'
        );

        if (answer !== 'Yes') { return; }

        try {
            await this._marketplaceManager.removeMarketplace(name, scope);
            this._sendSuccess(`Removed marketplace "${name}"`);
            await this._refresh();
        } catch (error) {
            this._sendError(`Failed to remove marketplace: ${error}`);
        }
    }

    private async _handleRefreshMarketplace(name: string, scope: 'user' | 'project') {
        try {
            await this._marketplaceManager.refreshMarketplace(name, scope);
            this._sendSuccess(`Refreshed marketplace "${name}"`);
            await this._refresh();
        } catch (error) {
            this._sendError(`Failed to refresh marketplace: ${error}`);
        }
    }

    private async _handleMoveToUser(name: string, scope: 'user' | 'project') {
        if (scope === 'user') { return; }

        const action = await vscode.window.showQuickPick(['Copy to User', 'Move to User'], {
            placeHolder: 'Select action'
        });

        if (!action) { return; }

        const marketplace = this._marketplaces.find(m => m.name === name && m.scope === scope);
        if (!marketplace) {
            this._sendError(`Marketplace "${name}" not found`);
            return;
        }

        try {
            if (action === 'Move to User') {
                await this._marketplaceManager.moveToUser(marketplace);
                this._sendSuccess(`Moved "${name}" to User scope`);
            } else {
                await this._marketplaceManager.copyToUser(marketplace);
                this._sendSuccess(`Copied "${name}" to User scope`);
            }
            await this._refresh();
        } catch (error) {
            this._sendError(`Failed to ${action === 'Move to User' ? 'move' : 'copy'} marketplace: ${error}`);
        }
    }

    private async _handleMoveToProject(name: string, scope: 'user' | 'project') {
        if (scope === 'project') { return; }

        const action = await vscode.window.showQuickPick(['Copy to Project', 'Move to Project'], {
            placeHolder: 'Select action'
        });

        if (!action) { return; }

        const marketplace = this._marketplaces.find(m => m.name === name && m.scope === scope);
        if (!marketplace) {
            this._sendError(`Marketplace "${name}" not found`);
            return;
        }

        try {
            if (action === 'Move to Project') {
                await this._marketplaceManager.moveToProject(marketplace);
                this._sendSuccess(`Moved "${name}" to Project scope`);
            } else {
                await this._marketplaceManager.copyToProject(marketplace);
                this._sendSuccess(`Copied "${name}" to Project scope`);
            }
            await this._refresh();
        } catch (error) {
            this._sendError(`Failed to ${action === 'Move to Project' ? 'move' : 'copy'} marketplace: ${error}`);
        }
    }

    private _getHtmlForWebview() {
        const userMarketplaces = this._marketplaces.filter(m => m.scope === 'user');
        const projectMarketplaces = this._marketplaces.filter(m => m.scope === 'project');
        const hasWorkspace = vscode.workspace.workspaceFolders !== undefined;

        const formatDate = (dateStr: string) => {
            try {
                const date = new Date(dateStr);
                return date.toLocaleDateString();
            } catch {
                return dateStr;
            }
        };

        const renderMarketplaceCard = (m: MarketplaceSource) => {
            const repo = m.source.repo || m.source.url || 'Unknown source';
            const moveButton = m.scope === 'user'
                ? `<button class="action-btn move-btn" onclick="moveToProject('${this._escapeJs(m.name)}', '${m.scope}')" title="Move to Project" ${!hasWorkspace ? 'disabled' : ''}>&#8595;</button>`
                : `<button class="action-btn move-btn" onclick="moveToUser('${this._escapeJs(m.name)}', '${m.scope}')" title="Move to User">&#8593;</button>`;

            return `
                <div class="marketplace-card">
                    <div class="card-header">
                        <span class="card-icon">&#128230;</span>
                        <div class="card-title">
                            <h3>${this._escapeHtml(m.name)}</h3>
                            <span class="card-repo">${this._escapeHtml(repo)}</span>
                        </div>
                    </div>
                    <div class="card-meta">
                        <span class="card-date">Updated: ${formatDate(m.lastUpdated)}</span>
                    </div>
                    <div class="card-actions">
                        ${moveButton}
                        <button class="action-btn refresh-btn" onclick="refreshMarketplace('${this._escapeJs(m.name)}', '${m.scope}')" title="Refresh">&#8635;</button>
                        <button class="action-btn delete-btn" onclick="removeMarketplace('${this._escapeJs(m.name)}', '${m.scope}')" title="Delete">&#128465;</button>
                    </div>
                </div>
            `;
        };

        const userCardsHtml = userMarketplaces.length > 0
            ? userMarketplaces.map(renderMarketplaceCard).join('')
            : '<div class="empty-state">No user marketplaces configured</div>';

        const projectCardsHtml = hasWorkspace
            ? (projectMarketplaces.length > 0
                ? projectMarketplaces.map(renderMarketplaceCard).join('')
                : '<div class="empty-state">No project marketplaces configured</div>')
            : '<div class="empty-state disabled">Open a workspace to manage project marketplaces</div>';

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Marketplace Sources</title>
            <style>
                :root {
                    --card-bg: var(--vscode-editor-background);
                    --card-border: var(--vscode-panel-border);
                    --button-bg: var(--vscode-button-background);
                    --button-fg: var(--vscode-button-foreground);
                    --button-hover: var(--vscode-button-hoverBackground);
                    --section-header-bg: var(--vscode-sideBarSectionHeader-background);
                }

                body {
                    font-family: var(--vscode-font-family);
                    padding: 16px;
                    margin: 0;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }

                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid var(--card-border);
                }

                h1 {
                    margin: 0;
                    font-size: 1.4em;
                }

                .add-btn {
                    background: var(--button-bg);
                    color: var(--button-fg);
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 13px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .add-btn:hover {
                    background: var(--button-hover);
                }

                .section {
                    margin-bottom: 24px;
                }

                .section-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: var(--section-header-bg);
                    border-radius: 4px;
                    margin-bottom: 12px;
                    cursor: pointer;
                    user-select: none;
                }

                .section-header:hover {
                    opacity: 0.9;
                }

                .section-header h2 {
                    margin: 0;
                    font-size: 1em;
                    font-weight: 600;
                    flex: 1;
                }

                .section-header .count {
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 0.85em;
                }

                .section-header .chevron {
                    transition: transform 0.2s;
                }

                .section.collapsed .section-header .chevron {
                    transform: rotate(-90deg);
                }

                .section.collapsed .section-content {
                    display: none;
                }

                .section-content {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .marketplace-card {
                    border: 1px solid var(--card-border);
                    padding: 12px 16px;
                    border-radius: 6px;
                    background: var(--card-bg);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .card-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    flex: 1;
                }

                .card-icon {
                    font-size: 1.5em;
                }

                .card-title {
                    flex: 1;
                }

                .card-title h3 {
                    margin: 0 0 4px 0;
                    font-size: 1em;
                }

                .card-repo {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                }

                .card-meta {
                    font-size: 0.8em;
                    color: var(--vscode-descriptionForeground);
                    min-width: 120px;
                }

                .card-actions {
                    display: flex;
                    gap: 4px;
                }

                .action-btn {
                    background: transparent;
                    border: 1px solid var(--card-border);
                    color: var(--vscode-foreground);
                    width: 28px;
                    height: 28px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .action-btn:hover:not(:disabled) {
                    background: var(--vscode-list-hoverBackground);
                }

                .action-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .action-btn.delete-btn:hover:not(:disabled) {
                    border-color: var(--vscode-errorForeground);
                    color: var(--vscode-errorForeground);
                }

                .action-btn.move-btn:hover:not(:disabled) {
                    border-color: var(--vscode-button-background);
                    color: var(--vscode-button-background);
                }

                .empty-state {
                    text-align: center;
                    padding: 24px;
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }

                .empty-state.disabled {
                    opacity: 0.6;
                }

                .toast {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    padding: 12px 20px;
                    border-radius: 4px;
                    background: var(--vscode-notifications-background);
                    border: 1px solid var(--vscode-notifications-border);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                    animation: slideIn 0.3s ease;
                    z-index: 1000;
                }

                .toast.error {
                    border-color: var(--vscode-errorForeground);
                }

                .toast.success {
                    border-color: var(--vscode-gitDecoration-addedResourceForeground);
                }

                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Marketplace Sources</h1>
                <button class="add-btn" onclick="addMarketplace()">
                    <span>+</span> Add Marketplace
                </button>
            </div>

            <div class="section" id="user-section">
                <div class="section-header" onclick="toggleSection('user-section')">
                    <span class="chevron">&#9660;</span>
                    <h2>User Marketplaces</h2>
                    <span class="count">${userMarketplaces.length}</span>
                </div>
                <div class="section-content">
                    ${userCardsHtml}
                </div>
            </div>

            <div class="section" id="project-section">
                <div class="section-header" onclick="toggleSection('project-section')">
                    <span class="chevron">&#9660;</span>
                    <h2>Project Marketplaces</h2>
                    <span class="count">${projectMarketplaces.length}</span>
                </div>
                <div class="section-content">
                    ${projectCardsHtml}
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                function toggleSection(sectionId) {
                    const section = document.getElementById(sectionId);
                    if (section) {
                        section.classList.toggle('collapsed');
                    }
                }

                function addMarketplace() {
                    vscode.postMessage({ command: 'addMarketplace' });
                }

                function removeMarketplace(name, scope) {
                    vscode.postMessage({ command: 'removeMarketplace', name, scope });
                }

                function refreshMarketplace(name, scope) {
                    vscode.postMessage({ command: 'refreshMarketplace', name, scope });
                }

                function moveToUser(name, scope) {
                    vscode.postMessage({ command: 'moveToUser', name, scope });
                }

                function moveToProject(name, scope) {
                    vscode.postMessage({ command: 'moveToProject', name, scope });
                }

                function showToast(message, type) {
                    const toast = document.createElement('div');
                    toast.className = 'toast ' + type;
                    toast.textContent = message;
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'showError') {
                        showToast(message.message, 'error');
                    } else if (message.command === 'showSuccess') {
                        showToast(message.message, 'success');
                    }
                });
            </script>
        </body>
        </html>`;
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
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n');
    }
}
