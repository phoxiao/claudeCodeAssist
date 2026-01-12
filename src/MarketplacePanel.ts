import * as vscode from 'vscode';
import { getSourceAggregator, MarketplaceSkill, SourceInfo } from './sources';
import { SkillPreviewPanel } from './SkillPreviewPanel';

export class MarketplacePanel {
    public static currentPanel: MarketplacePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _currentFilter: 'all' | 'skill' | 'agent' | 'plugin' = 'all';
    private _currentSource: string = 'all';
    private _searchQuery: string = '';
    private _skills: MarketplaceSkill[] = [];
    private _sources: SourceInfo[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (MarketplacePanel.currentPanel) {
            MarketplacePanel.currentPanel._panel.reveal(column);
            MarketplacePanel.currentPanel._refresh();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'claudeMarketplace',
            'Claude Code Marketplace',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        MarketplacePanel.currentPanel = new MarketplacePanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'download':
                        vscode.commands.executeCommand('claude-code-assist.downloadSkill', message.skill);
                        return;
                    case 'preview':
                        SkillPreviewPanel.createOrShow(this._extensionUri, message.skill);
                        return;
                    case 'filter':
                        this._currentFilter = message.type;
                        this._updateContent();
                        return;
                    case 'source':
                        this._currentSource = message.sourceId;
                        this._updateContent();
                        return;
                    case 'search':
                        this._searchQuery = message.query;
                        this._updateListOnly();
                        return;
                    case 'refresh':
                        await this._refresh(true);
                        return;
                }
            },
            null,
            this._disposables
        );

        this._refresh();
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

    private async _refresh(forceRefresh: boolean = false) {
        this._panel.webview.html = this._getLoadingHtml();

        try {
            const aggregator = getSourceAggregator();
            aggregator.loadCustomSources();

            const result = await aggregator.fetchAll({ forceRefresh });
            this._skills = result.skills;
            this._sources = result.sources;

            this._updateContent();
        } catch (error) {
            this._panel.webview.html = this._getErrorHtml(String(error));
        }
    }

    private _updateContent() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _updateListOnly() {
        const filteredSkills = this._getFilteredSkills();
        const totalCount = this._skills.length;
        const filteredCount = filteredSkills.length;

        this._panel.webview.postMessage({
            command: 'updateList',
            skills: filteredSkills,
            stats: {
                filtered: filteredCount,
                total: totalCount,
                sourceCount: this._sources.filter(s => s.count > 0).length
            },
            sources: this._sources
        });
    }

    private _getFilteredSkills(): MarketplaceSkill[] {
        let filtered = this._skills;

        // Filter by type
        if (this._currentFilter !== 'all') {
            filtered = filtered.filter(s => s.type === this._currentFilter);
        }

        // Filter by source
        if (this._currentSource !== 'all') {
            filtered = filtered.filter(s => s.source === this._currentSource);
        }

        // Filter by search query
        if (this._searchQuery) {
            const query = this._searchQuery.toLowerCase();
            filtered = filtered.filter(s => {
                const text = `${s.name} ${s.description} ${s.author || ''} ${(s.tags || []).join(' ')}`.toLowerCase();
                return text.includes(query);
            });
        }

        return filtered;
    }

    private _getLoadingHtml() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 40px;
                    text-align: center;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }
                .loader {
                    border: 4px solid var(--vscode-editor-background);
                    border-top: 4px solid var(--vscode-button-background);
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
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
            <div class="loader"></div>
            <p>Loading skills from multiple sources...</p>
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
                    padding: 40px;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }
                .error { color: var(--vscode-errorForeground); }
            </style>
        </head>
        <body>
            <h2 class="error">Failed to load marketplace</h2>
            <p>${this._escapeHtml(error)}</p>
            <button onclick="location.reload()">Retry</button>
        </body>
        </html>`;
    }

    private _getHtmlForWebview() {
        const filteredSkills = this._getFilteredSkills();

        const skillsHtml = filteredSkills.map(skill => `
            <div class="skill-card" onclick="preview('${this._escapeJs(skill.name)}', '${skill.type}', '${this._escapeJs(skill.url)}', '${this._escapeJs(skill.description)}', '${this._escapeJs(skill.author || '')}', ${skill.stars || 0}, '${this._escapeJs(skill.source || '')}')">
                <div class="skill-header">
                    <h3>${this._escapeHtml(skill.name)}</h3>
                    <span class="tag ${skill.type}">${skill.type}</span>
                </div>
                <p class="description">${this._escapeHtml(skill.description)}</p>
                <div class="skill-meta">
                    ${skill.author ? `<span class="author">@${this._escapeHtml(skill.author)}</span>` : ''}
                    ${skill.stars !== undefined ? `<span class="stars">★ ${skill.stars}</span>` : ''}
                    ${skill.source ? `<span class="source">${this._escapeHtml(this._getSourceName(skill.source))}</span>` : ''}
                </div>
                <div class="skill-actions">
                    <button class="preview-btn" onclick="event.stopPropagation(); preview('${this._escapeJs(skill.name)}', '${skill.type}', '${this._escapeJs(skill.url)}', '${this._escapeJs(skill.description)}', '${this._escapeJs(skill.author || '')}', ${skill.stars || 0}, '${this._escapeJs(skill.source || '')}')">
                        Preview
                    </button>
                    <button onclick="event.stopPropagation(); download('${this._escapeJs(skill.name)}', '${skill.type}', '${this._escapeJs(skill.url)}')">
                        Install
                    </button>
                </div>
            </div>
        `).join('');

        const sourceOptions = this._sources.map(s =>
            `<option value="${s.id}" ${s.id === this._currentSource ? 'selected' : ''}>${this._escapeHtml(s.name)} (${s.count})</option>`
        ).join('');

        const totalCount = this._skills.length;
        const filteredCount = filteredSkills.length;

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Claude Marketplace</title>
            <style>
                :root {
                    --card-bg: var(--vscode-editor-background);
                    --card-border: var(--vscode-panel-border);
                    --button-bg: var(--vscode-button-background);
                    --button-fg: var(--vscode-button-foreground);
                    --button-hover: var(--vscode-button-hoverBackground);
                    --input-bg: var(--vscode-input-background);
                    --input-border: var(--vscode-input-border);
                    --input-fg: var(--vscode-input-foreground);
                }

                body {
                    font-family: var(--vscode-font-family);
                    padding: 16px;
                    margin: 0;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }

                .header {
                    position: sticky;
                    top: 0;
                    background: var(--vscode-editor-background);
                    padding-bottom: 16px;
                    border-bottom: 1px solid var(--card-border);
                    margin-bottom: 16px;
                    z-index: 100;
                }

                h1 {
                    margin: 0 0 16px 0;
                    font-size: 1.5em;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .refresh-btn {
                    background: transparent;
                    border: 1px solid var(--card-border);
                    color: var(--vscode-foreground);
                    padding: 4px 8px;
                    cursor: pointer;
                    border-radius: 3px;
                    font-size: 0.8em;
                }

                .refresh-btn:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .controls {
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                    align-items: center;
                }

                .search-box {
                    flex: 1;
                    min-width: 200px;
                    padding: 8px 12px;
                    border: 1px solid var(--input-border);
                    background: var(--input-bg);
                    color: var(--input-fg);
                    border-radius: 4px;
                    font-size: 14px;
                }

                .filter-group {
                    display: flex;
                    gap: 4px;
                }

                .filter-btn {
                    padding: 6px 12px;
                    border: 1px solid var(--card-border);
                    background: transparent;
                    color: var(--vscode-foreground);
                    cursor: pointer;
                    border-radius: 3px;
                    font-size: 13px;
                }

                .filter-btn.active {
                    background: var(--button-bg);
                    color: var(--button-fg);
                    border-color: var(--button-bg);
                }

                .filter-btn:hover:not(.active) {
                    background: var(--vscode-list-hoverBackground);
                }

                select {
                    padding: 6px 12px;
                    border: 1px solid var(--input-border);
                    background: var(--input-bg);
                    color: var(--input-fg);
                    border-radius: 4px;
                    font-size: 13px;
                }

                .stats {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 12px;
                }

                .skills-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 12px;
                }

                .skill-card {
                    border: 1px solid var(--card-border);
                    padding: 16px;
                    border-radius: 6px;
                    background: var(--card-bg);
                    display: flex;
                    flex-direction: column;
                }

                .skill-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                }

                .skill-header h3 {
                    margin: 0;
                    font-size: 1em;
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .tag {
                    font-size: 0.75em;
                    padding: 2px 6px;
                    border-radius: 3px;
                    color: white;
                    text-transform: uppercase;
                    flex-shrink: 0;
                }
                .tag.skill { background-color: #28a745; }
                .tag.agent { background-color: #007acc; }
                .tag.plugin { background-color: #6f42c1; }

                .description {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin: 0 0 12px 0;
                    flex: 1;
                    overflow: hidden;
                    display: -webkit-box;
                    -webkit-line-clamp: 3;
                    -webkit-box-orient: vertical;
                }

                .skill-meta {
                    display: flex;
                    gap: 12px;
                    font-size: 0.8em;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 12px;
                    flex-wrap: wrap;
                }

                .skill-meta .stars {
                    color: #f0ad4e;
                }

                .skill-actions {
                    display: flex;
                    gap: 8px;
                }

                .skill-card button {
                    background-color: var(--button-bg);
                    color: var(--button-fg);
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 13px;
                }

                .skill-card button.preview-btn {
                    background: transparent;
                    border: 1px solid var(--vscode-button-background);
                    color: var(--vscode-button-background);
                }

                .skill-card button:hover {
                    background-color: var(--button-hover);
                }

                .skill-card button.preview-btn:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .skill-card {
                    cursor: pointer;
                    transition: border-color 0.2s;
                }

                .skill-card:hover {
                    border-color: var(--vscode-button-background);
                }

                .empty-state {
                    text-align: center;
                    padding: 40px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>
                    Claude Code Marketplace
                    <button class="refresh-btn" onclick="refresh()">↻ Refresh</button>
                </h1>
                <div class="controls">
                    <input type="text"
                           class="search-box"
                           placeholder="Search skills..."
                           value="${this._escapeHtml(this._searchQuery)}"
                           oninput="search(this.value)">

                    <div class="filter-group">
                        <button class="filter-btn ${this._currentFilter === 'all' ? 'active' : ''}"
                                onclick="filter('all')">All</button>
                        <button class="filter-btn ${this._currentFilter === 'skill' ? 'active' : ''}"
                                onclick="filter('skill')">Skills</button>
                        <button class="filter-btn ${this._currentFilter === 'agent' ? 'active' : ''}"
                                onclick="filter('agent')">Agents</button>
                        <button class="filter-btn ${this._currentFilter === 'plugin' ? 'active' : ''}"
                                onclick="filter('plugin')">Plugins</button>
                    </div>

                    <select onchange="selectSource(this.value)">
                        <option value="all" ${this._currentSource === 'all' ? 'selected' : ''}>All Sources (${totalCount})</option>
                        ${sourceOptions}
                    </select>
                </div>
            </div>

            <div class="stats">
                Showing ${filteredCount} of ${totalCount} items
                ${this._sources.length > 0 ? ` from ${this._sources.filter(s => s.count > 0).length} sources` : ''}
            </div>

            <div class="skills-grid">
                ${skillsHtml || '<div class="empty-state">No skills found matching your criteria</div>'}
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                let searchTimeout;
                function search(query) {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        vscode.postMessage({ command: 'search', query });
                    }, 300);
                }

                function filter(type) {
                    vscode.postMessage({ command: 'filter', type });
                }

                function selectSource(sourceId) {
                    vscode.postMessage({ command: 'source', sourceId });
                }

                function download(name, type, url) {
                    vscode.postMessage({
                        command: 'download',
                        skill: { name, type, url }
                    });
                }

                function preview(name, type, url, description, author, stars, source) {
                    vscode.postMessage({
                        command: 'preview',
                        skill: { name, type, url, description, author, stars, source }
                    });
                }

                function refresh() {
                    vscode.postMessage({ command: 'refresh' });
                }

                function escapeHtml(str) {
                    if (!str) return '';
                    const div = document.createElement('div');
                    div.textContent = str;
                    return div.innerHTML;
                }

                function getSourceName(sourceId, sources) {
                    const source = sources.find(s => s.id === sourceId);
                    return source ? source.name : sourceId;
                }

                function createSkillCard(skill, sources) {
                    const card = document.createElement('div');
                    card.className = 'skill-card';
                    card.onclick = () => preview(skill.name, skill.type, skill.url, skill.description, skill.author || '', skill.stars || 0, skill.source || '');

                    const header = document.createElement('div');
                    header.className = 'skill-header';

                    const h3 = document.createElement('h3');
                    h3.textContent = skill.name;

                    const tag = document.createElement('span');
                    tag.className = 'tag ' + skill.type;
                    tag.textContent = skill.type;

                    header.appendChild(h3);
                    header.appendChild(tag);

                    const desc = document.createElement('p');
                    desc.className = 'description';
                    desc.textContent = skill.description;

                    const meta = document.createElement('div');
                    meta.className = 'skill-meta';

                    if (skill.author) {
                        const author = document.createElement('span');
                        author.className = 'author';
                        author.textContent = '@' + skill.author;
                        meta.appendChild(author);
                    }

                    if (skill.stars !== undefined) {
                        const stars = document.createElement('span');
                        stars.className = 'stars';
                        stars.textContent = '★ ' + skill.stars;
                        meta.appendChild(stars);
                    }

                    if (skill.source) {
                        const source = document.createElement('span');
                        source.className = 'source';
                        source.textContent = getSourceName(skill.source, sources);
                        meta.appendChild(source);
                    }

                    const actions = document.createElement('div');
                    actions.className = 'skill-actions';

                    const previewBtn = document.createElement('button');
                    previewBtn.className = 'preview-btn';
                    previewBtn.textContent = 'Preview';
                    previewBtn.onclick = (e) => {
                        e.stopPropagation();
                        preview(skill.name, skill.type, skill.url, skill.description, skill.author || '', skill.stars || 0, skill.source || '');
                    };

                    const installBtn = document.createElement('button');
                    installBtn.textContent = 'Install';
                    installBtn.onclick = (e) => {
                        e.stopPropagation();
                        download(skill.name, skill.type, skill.url);
                    };

                    actions.appendChild(previewBtn);
                    actions.appendChild(installBtn);

                    card.appendChild(header);
                    card.appendChild(desc);
                    card.appendChild(meta);
                    card.appendChild(actions);

                    return card;
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'updateList') {
                        const grid = document.querySelector('.skills-grid');
                        const stats = document.querySelector('.stats');

                        if (grid) {
                            grid.replaceChildren();
                            if (message.skills.length > 0) {
                                message.skills.forEach(skill => {
                                    grid.appendChild(createSkillCard(skill, message.sources));
                                });
                            } else {
                                const empty = document.createElement('div');
                                empty.className = 'empty-state';
                                empty.textContent = 'No skills found matching your criteria';
                                grid.appendChild(empty);
                            }
                        }

                        if (stats) {
                            let text = 'Showing ' + message.stats.filtered + ' of ' + message.stats.total + ' items';
                            if (message.stats.sourceCount > 0) {
                                text += ' from ' + message.stats.sourceCount + ' sources';
                            }
                            stats.textContent = text;
                        }
                    }
                });
            </script>
        </body>
        </html>`;
    }

    private _getSourceName(sourceId: string): string {
        const source = this._sources.find(s => s.id === sourceId);
        return source?.name || sourceId;
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
