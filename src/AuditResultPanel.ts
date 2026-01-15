import * as vscode from 'vscode';
import { AuditResult, SecurityIssue } from './SecurityAuditor';

export class AuditResultPanel {
    public static currentPanel: AuditResultPanel | undefined;
    private static readonly viewType = 'claudeAuditResults';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _results: AuditResult[] = [];

    public static createOrShow(extensionUri: vscode.Uri, results?: AuditResult[]) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (AuditResultPanel.currentPanel) {
            AuditResultPanel.currentPanel._panel.reveal(column);
            if (results) {
                AuditResultPanel.currentPanel.updateResults(results);
            }
            return AuditResultPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            AuditResultPanel.viewType,
            'Security Audit Results',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        AuditResultPanel.currentPanel = new AuditResultPanel(panel, extensionUri, results || []);
        return AuditResultPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, results: AuditResult[]) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._results = results;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openFile':
                        if (message.path) {
                            const uri = vscode.Uri.file(message.path);
                            vscode.window.showTextDocument(uri, {
                                selection: message.line
                                    ? new vscode.Range(message.line - 1, 0, message.line - 1, 0)
                                    : undefined
                            });
                        }
                        return;
                    case 'refresh':
                        this._update();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public updateResults(results: AuditResult[]) {
        this._results = results;
        this._update();
    }

    public addResult(result: AuditResult) {
        this._results.push(result);
        this._update();
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    public dispose() {
        AuditResultPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _getHtmlForWebview(): string {
        const summary = this._getSummary();
        const resultsHtml = this._results.map(r => this._renderResult(r)).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Audit Results</title>
    <style>
        :root {
            --safe-color: #28a745;
            --warning-color: #ffc107;
            --danger-color: #dc3545;
            --error-color: #6c757d;
            --bg-color: var(--vscode-editor-background);
            --text-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --card-bg: var(--vscode-editorWidget-background);
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--text-color);
            background-color: var(--bg-color);
            padding: 20px;
            margin: 0;
        }

        h1 {
            font-size: 1.5em;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .summary {
            display: flex;
            gap: 20px;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }

        .summary-card {
            padding: 15px 25px;
            border-radius: 8px;
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            text-align: center;
            min-width: 100px;
        }

        .summary-card.safe { border-left: 4px solid var(--safe-color); }
        .summary-card.warning { border-left: 4px solid var(--warning-color); }
        .summary-card.danger { border-left: 4px solid var(--danger-color); }
        .summary-card.error { border-left: 4px solid var(--error-color); }

        .summary-card .count {
            font-size: 2em;
            font-weight: bold;
        }

        .summary-card.safe .count { color: var(--safe-color); }
        .summary-card.warning .count { color: var(--warning-color); }
        .summary-card.danger .count { color: var(--danger-color); }
        .summary-card.error .count { color: var(--error-color); }

        .summary-card .label {
            font-size: 0.9em;
            opacity: 0.8;
        }

        .results {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .result-card {
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            overflow: hidden;
        }

        .result-header {
            padding: 15px;
            display: flex;
            align-items: center;
            gap: 15px;
            cursor: pointer;
            user-select: none;
        }

        .result-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .status-badge {
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 0.85em;
            font-weight: bold;
            text-transform: uppercase;
        }

        .status-badge.safe { background-color: var(--safe-color); color: white; }
        .status-badge.warning { background-color: var(--warning-color); color: black; }
        .status-badge.danger { background-color: var(--danger-color); color: white; }
        .status-badge.error { background-color: var(--error-color); color: white; }

        .result-info {
            flex: 1;
        }

        .result-name {
            font-weight: bold;
            font-size: 1.1em;
        }

        .result-type {
            font-size: 0.85em;
            opacity: 0.7;
        }

        .result-path {
            font-size: 0.8em;
            opacity: 0.6;
            font-family: monospace;
        }

        .issue-count {
            font-size: 0.9em;
            opacity: 0.8;
        }

        .expand-icon {
            font-size: 1.2em;
            transition: transform 0.2s;
        }

        .result-card.expanded .expand-icon {
            transform: rotate(90deg);
        }

        .result-details {
            display: none;
            border-top: 1px solid var(--border-color);
            padding: 15px;
        }

        .result-card.expanded .result-details {
            display: block;
        }

        .issues-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .issue-item {
            padding: 12px;
            background-color: var(--vscode-editor-background);
            border-radius: 6px;
            border-left: 3px solid;
        }

        .issue-item.low { border-left-color: #17a2b8; }
        .issue-item.medium { border-left-color: var(--warning-color); }
        .issue-item.high { border-left-color: #fd7e14; }
        .issue-item.critical { border-left-color: var(--danger-color); }

        .issue-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }

        .severity-badge {
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 0.75em;
            font-weight: bold;
            text-transform: uppercase;
        }

        .severity-badge.low { background-color: #17a2b8; color: white; }
        .severity-badge.medium { background-color: var(--warning-color); color: black; }
        .severity-badge.high { background-color: #fd7e14; color: white; }
        .severity-badge.critical { background-color: var(--danger-color); color: white; }

        .issue-type {
            font-family: monospace;
            font-size: 0.85em;
            opacity: 0.8;
        }

        .issue-description {
            margin-bottom: 8px;
        }

        .issue-location {
            font-size: 0.85em;
            font-family: monospace;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            display: inline-block;
        }

        .issue-location:hover {
            text-decoration: underline;
        }

        .issue-suggestion {
            font-size: 0.85em;
            opacity: 0.8;
            margin-top: 8px;
            padding: 8px;
            background-color: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
        }

        .issue-suggestion::before {
            content: "Suggestion: ";
            font-weight: bold;
        }

        .no-issues {
            text-align: center;
            padding: 20px;
            opacity: 0.7;
        }

        .timestamp {
            font-size: 0.8em;
            opacity: 0.6;
            margin-top: 10px;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            opacity: 0.7;
        }

        .empty-state h2 {
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <h1>Security Audit Results</h1>

    ${this._results.length === 0 ? `
        <div class="empty-state">
            <h2>No audit results yet</h2>
            <p>Run a security audit to see results here.</p>
        </div>
    ` : `
        <div class="summary">
            <div class="summary-card safe">
                <div class="count">${summary.safe}</div>
                <div class="label">Safe</div>
            </div>
            <div class="summary-card warning">
                <div class="count">${summary.warning}</div>
                <div class="label">Warning</div>
            </div>
            <div class="summary-card danger">
                <div class="count">${summary.danger}</div>
                <div class="label">Danger</div>
            </div>
            <div class="summary-card error">
                <div class="count">${summary.error}</div>
                <div class="label">Error</div>
            </div>
        </div>

        <div class="results">
            ${resultsHtml}
        </div>
    `}

    <script>
        const vscode = acquireVsCodeApi();

        document.querySelectorAll('.result-header').forEach(header => {
            header.addEventListener('click', () => {
                header.parentElement.classList.toggle('expanded');
            });
        });

        document.querySelectorAll('.issue-location').forEach(loc => {
            loc.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = loc.dataset.path;
                const line = parseInt(loc.dataset.line) || 0;
                vscode.postMessage({
                    command: 'openFile',
                    path: path,
                    line: line
                });
            });
        });
    </script>
</body>
</html>`;
    }

    private _getSummary(): { safe: number; warning: number; danger: number; error: number } {
        return {
            safe: this._results.filter(r => r.status === 'safe').length,
            warning: this._results.filter(r => r.status === 'warning').length,
            danger: this._results.filter(r => r.status === 'danger').length,
            error: this._results.filter(r => r.status === 'error').length
        };
    }

    private _renderResult(result: AuditResult): string {
        let issuesHtml: string;

        if (result.issues.length > 0) {
            issuesHtml = result.issues.map(issue => this._renderIssue(issue, result.itemPath)).join('');
        } else if (result.status !== 'safe') {
            // status 是 warning/danger/error 但没有具体 issues 时，显示通用提示
            const severity = result.status === 'danger' ? 'high' : 'medium';
            issuesHtml = `
                <div class="issue-item ${severity}">
                    <div class="issue-header">
                        <span class="severity-badge ${severity}">${severity}</span>
                        <span class="issue-type">review_required</span>
                    </div>
                    <div class="issue-description">
                        Security concerns detected but details not available. Manual review recommended.
                    </div>
                    <div class="issue-suggestion">
                        Check the raw audit response or re-run the audit for more details.
                    </div>
                </div>
            `;
        } else {
            issuesHtml = '<div class="no-issues">No security issues detected</div>';
        }

        // 当有具体 issues 或 status 非 safe 时都认为有问题需要显示
        const hasIssues = result.issues.length > 0 || result.status !== 'safe';
        const expandedClass = result.status !== 'safe' ? 'expanded' : '';

        return `
            <div class="result-card ${expandedClass}">
                <div class="result-header">
                    <span class="status-badge ${result.status}">${result.status}</span>
                    <div class="result-info">
                        <div class="result-name">${this._escapeHtml(result.itemName)}</div>
                        <div class="result-type">${result.itemType}</div>
                        <div class="result-path">${this._escapeHtml(result.itemPath)}</div>
                    </div>
                    ${hasIssues ? `<span class="issue-count">${result.issues.length || 1} issue${(result.issues.length || 1) !== 1 ? 's' : ''}</span>` : ''}
                    <span class="expand-icon">▶</span>
                </div>
                <div class="result-details">
                    <div class="issues-list">
                        ${issuesHtml}
                    </div>
                    <div class="timestamp">Audited: ${result.auditedAt.toLocaleString()}</div>
                </div>
            </div>
        `;
    }

    private _renderIssue(issue: SecurityIssue, basePath: string): string {
        const filePath = issue.file ? `${basePath}/${issue.file}` : basePath;

        return `
            <div class="issue-item ${issue.severity}">
                <div class="issue-header">
                    <span class="severity-badge ${issue.severity}">${issue.severity}</span>
                    <span class="issue-type">${this._escapeHtml(issue.type)}</span>
                </div>
                <div class="issue-description">${this._escapeHtml(issue.description)}</div>
                ${issue.file ? `
                    <span class="issue-location" data-path="${this._escapeHtml(filePath)}" data-line="${issue.line || 0}">
                        ${this._escapeHtml(issue.file)}${issue.line ? `:${issue.line}` : ''}
                    </span>
                ` : ''}
                ${issue.suggestion ? `
                    <div class="issue-suggestion">${this._escapeHtml(issue.suggestion)}</div>
                ` : ''}
            </div>
        `;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
