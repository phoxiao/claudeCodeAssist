import * as vscode from 'vscode';
import { SmartInstaller } from './SmartInstaller';

export class ClipboardWatcher {
    private statusBarItem: vscode.StatusBarItem;
    private smartInstaller: SmartInstaller;
    private output: vscode.OutputChannel;
    private lastClipboardContent: string = '';
    private checkInterval: NodeJS.Timeout | null = null;
    private enabled: boolean = true;

    constructor(smartInstaller: SmartInstaller, output: vscode.OutputChannel) {
        this.smartInstaller = smartInstaller;
        this.output = output;

        // Create status bar item (hidden by default)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'claude-code-assist.installFromClipboard';
        this.statusBarItem.tooltip = 'Click to install Claude skill from clipboard';
    }

    /**
     * Start watching clipboard for GitHub URLs
     */
    start() {
        if (this.checkInterval) {
            return;
        }

        // Check clipboard every 2 seconds
        this.checkInterval = setInterval(() => {
            this.checkClipboard();
        }, 2000);

        this.output.appendLine('ClipboardWatcher: Started');
    }

    /**
     * Stop watching clipboard
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.hideStatusBar();
        this.output.appendLine('ClipboardWatcher: Stopped');
    }

    /**
     * Enable or disable the watcher
     */
    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (!enabled) {
            this.hideStatusBar();
        }
    }

    /**
     * Check clipboard content
     */
    private async checkClipboard() {
        if (!this.enabled) {
            return;
        }

        try {
            const content = await vscode.env.clipboard.readText();

            // Skip if same as last check
            if (content === this.lastClipboardContent) {
                return;
            }

            this.lastClipboardContent = content;

            // Check if it's a valid skill URL
            if (this.smartInstaller.isValidInput(content)) {
                const parsed = this.smartInstaller.parseUrl(content);
                if (parsed) {
                    this.showStatusBar(parsed.skillName);
                } else {
                    this.hideStatusBar();
                }
            } else {
                this.hideStatusBar();
            }
        } catch (e) {
            // Ignore clipboard read errors
        }
    }

    /**
     * Show status bar with skill info
     */
    private showStatusBar(skillName: string) {
        this.statusBarItem.text = `$(cloud-download) Install: ${skillName}`;
        this.statusBarItem.show();
    }

    /**
     * Hide status bar
     */
    private hideStatusBar() {
        this.statusBarItem.hide();
    }

    /**
     * Get the current clipboard content if it's a valid URL
     */
    async getClipboardUrl(): Promise<string | null> {
        try {
            const content = await vscode.env.clipboard.readText();
            if (this.smartInstaller.isValidInput(content)) {
                return content;
            }
        } catch (e) {
            // Ignore
        }
        return null;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.stop();
        this.statusBarItem.dispose();
    }
}
