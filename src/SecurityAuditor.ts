import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { SkillItem } from './SkillManager';
import { PluginItem } from './PluginManager';

/**
 * Execute a command with input via stdin
 * This avoids shell command length limits by not passing data as arguments
 */
async function execWithStdin(
    command: string,
    args: string[],
    input: string,
    options: { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = cp.spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: options.timeout || 120000
        });

        let stdout = '';
        let stderr = '';
        let killed = false;

        // Set up timeout
        const timeoutId = setTimeout(() => {
            killed = true;
            child.kill('SIGTERM');
            reject(new Error(`Command timed out after ${options.timeout || 120000}ms`));
        }, options.timeout || 120000);

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timeoutId);
            if (killed) return;

            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const error = new Error(`Command failed with exit code ${code}`) as any;
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            }
        });

        // Write input to stdin and close it
        child.stdin?.write(input);
        child.stdin?.end();
    });
}

export interface SecurityIssue {
    severity: 'low' | 'medium' | 'high' | 'critical';
    type: string;
    description: string;
    file?: string;
    line?: number;
    suggestion?: string;
}

export interface AuditResult {
    itemName: string;
    itemPath: string;
    itemType: 'skill' | 'agent' | 'command' | 'plugin';
    status: 'safe' | 'warning' | 'danger' | 'error';
    issues: SecurityIssue[];
    auditedAt: Date;
    rawResponse?: string;
}

export interface AuditProgress {
    current: number;
    total: number;
    currentItem: string;
}

export class SecurityAuditor {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.outputChannel = outputChannel || vscode.window.createOutputChannel('Claude Code Security Audit');
    }

    /**
     * Audit a single skill or agent
     */
    public async auditSkill(skill: SkillItem): Promise<AuditResult> {
        this.outputChannel.appendLine(`\n=== Auditing ${skill.type}: ${skill.name} ===`);
        this.outputChannel.appendLine(`Path: ${skill.path}`);

        try {
            const result = await this.runClaudeCodeAudit(skill.path, skill.name, skill.type);
            this.logAuditResult(result);
            return result;
        } catch (error) {
            const errorResult: AuditResult = {
                itemName: skill.name,
                itemPath: skill.path,
                itemType: skill.type,
                status: 'error',
                issues: [{
                    severity: 'high',
                    type: 'audit_error',
                    description: `Audit failed: ${error instanceof Error ? error.message : String(error)}`
                }],
                auditedAt: new Date()
            };
            this.logAuditResult(errorResult);
            return errorResult;
        }
    }

    /**
     * Audit a plugin
     */
    public async auditPlugin(plugin: PluginItem): Promise<AuditResult> {
        this.outputChannel.appendLine(`\n=== Auditing plugin: ${plugin.name} ===`);
        this.outputChannel.appendLine(`Path: ${plugin.installPath}`);

        try {
            const result = await this.runClaudeCodeAudit(plugin.installPath, plugin.name, 'plugin');
            this.logAuditResult(result);
            return result;
        } catch (error) {
            const errorResult: AuditResult = {
                itemName: plugin.name,
                itemPath: plugin.installPath,
                itemType: 'plugin',
                status: 'error',
                issues: [{
                    severity: 'high',
                    type: 'audit_error',
                    description: `Audit failed: ${error instanceof Error ? error.message : String(error)}`
                }],
                auditedAt: new Date()
            };
            this.logAuditResult(errorResult);
            return errorResult;
        }
    }

    /**
     * Audit a path directly (for post-installation audit)
     */
    public async auditPath(targetPath: string, name: string, type: 'skill' | 'agent' | 'command' | 'plugin'): Promise<AuditResult> {
        this.outputChannel.appendLine(`\n=== Auditing ${type}: ${name} ===`);
        this.outputChannel.appendLine(`Path: ${targetPath}`);

        try {
            const result = await this.runClaudeCodeAudit(targetPath, name, type);
            this.logAuditResult(result);
            return result;
        } catch (error) {
            const errorResult: AuditResult = {
                itemName: name,
                itemPath: targetPath,
                itemType: type,
                status: 'error',
                issues: [{
                    severity: 'high',
                    type: 'audit_error',
                    description: `Audit failed: ${error instanceof Error ? error.message : String(error)}`
                }],
                auditedAt: new Date()
            };
            this.logAuditResult(errorResult);
            return errorResult;
        }
    }

    /**
     * Audit all skills, agents, and plugins
     */
    public async auditAll(
        skills: SkillItem[],
        plugins: PluginItem[],
        progressCallback?: (progress: AuditProgress) => void
    ): Promise<AuditResult[]> {
        const results: AuditResult[] = [];
        const total = skills.length + plugins.length;
        let current = 0;

        this.outputChannel.appendLine(`\n========================================`);
        this.outputChannel.appendLine(`Starting full security audit`);
        this.outputChannel.appendLine(`Total items: ${total} (${skills.length} skills/agents, ${plugins.length} plugins)`);
        this.outputChannel.appendLine(`========================================\n`);

        // Audit skills/agents
        for (const skill of skills) {
            current++;
            progressCallback?.({
                current,
                total,
                currentItem: `${skill.type}: ${skill.name}`
            });

            const result = await this.auditSkill(skill);
            results.push(result);
        }

        // Audit plugins
        for (const plugin of plugins) {
            current++;
            progressCallback?.({
                current,
                total,
                currentItem: `plugin: ${plugin.name}`
            });

            const result = await this.auditPlugin(plugin);
            results.push(result);
        }

        this.outputChannel.appendLine(`\n========================================`);
        this.outputChannel.appendLine(`Audit complete. Results summary:`);
        this.outputChannel.appendLine(`  Safe: ${results.filter(r => r.status === 'safe').length}`);
        this.outputChannel.appendLine(`  Warning: ${results.filter(r => r.status === 'warning').length}`);
        this.outputChannel.appendLine(`  Danger: ${results.filter(r => r.status === 'danger').length}`);
        this.outputChannel.appendLine(`  Error: ${results.filter(r => r.status === 'error').length}`);
        this.outputChannel.appendLine(`========================================\n`);

        return results;
    }

    /**
     * Run Claude Code CLI to audit a target
     */
    private async runClaudeCodeAudit(
        targetPath: string,
        itemName: string,
        itemType: 'skill' | 'agent' | 'command' | 'plugin'
    ): Promise<AuditResult> {
        // Check if target exists
        if (!fs.existsSync(targetPath)) {
            throw new Error(`Target path does not exist: ${targetPath}`);
        }

        // Collect file contents for audit
        const fileContents = await this.collectFileContents(targetPath);

        if (fileContents.length === 0) {
            return {
                itemName,
                itemPath: targetPath,
                itemType,
                status: 'safe',
                issues: [],
                auditedAt: new Date(),
                rawResponse: 'No files to audit'
            };
        }

        // Build audit prompt
        const auditPrompt = this.buildAuditPrompt(fileContents, itemName, itemType);

        // Execute Claude CLI using stdin to avoid shell command length limits
        try {
            const { stdout, stderr } = await execWithStdin(
                'claude',
                ['--output-format', 'json'],
                auditPrompt,
                { timeout: 120000 } // 2 minute timeout
            );

            if (stderr) {
                this.outputChannel.appendLine(`Claude CLI stderr: ${stderr}`);
            }

            return this.parseClaudeResponse(stdout, itemName, targetPath, itemType);
        } catch (error: any) {
            // Check if Claude CLI is installed
            if (error.message?.includes('command not found') ||
                error.message?.includes('ENOENT') ||
                error.code === 'ENOENT') {
                throw new Error('Claude Code CLI not found. Please ensure Claude Code is installed and available in PATH.');
            }

            // If there's output despite error, try to parse it
            if (error.stdout) {
                try {
                    return this.parseClaudeResponse(error.stdout, itemName, targetPath, itemType);
                } catch {
                    // Fall through to throw original error
                }
            }

            throw error;
        }
    }

    /**
     * Collect contents of files to audit
     */
    private async collectFileContents(targetPath: string): Promise<{ file: string; content: string }[]> {
        const results: { file: string; content: string }[] = [];
        const extensions = ['.md', '.txt', '.json', '.js', '.ts', '.py', '.sh', '.yaml', '.yml'];
        const maxFileSize = 100 * 1024; // 100KB max per file

        const processPath = (currentPath: string, basePath: string) => {
            const stats = fs.statSync(currentPath);

            if (stats.isFile()) {
                const ext = path.extname(currentPath).toLowerCase();
                if (extensions.includes(ext) && stats.size <= maxFileSize) {
                    try {
                        const content = fs.readFileSync(currentPath, 'utf-8');
                        const relativePath = path.relative(basePath, currentPath);
                        results.push({ file: relativePath || path.basename(currentPath), content });
                    } catch {
                        // Skip files that can't be read
                    }
                }
            } else if (stats.isDirectory()) {
                // Skip hidden directories and node_modules
                const dirName = path.basename(currentPath);
                if (dirName.startsWith('.') || dirName === 'node_modules') {
                    return;
                }

                const entries = fs.readdirSync(currentPath);
                for (const entry of entries) {
                    processPath(path.join(currentPath, entry), basePath);
                }
            }
        };

        processPath(targetPath, targetPath);
        return results;
    }

    /**
     * Build the audit prompt for Claude
     */
    private buildAuditPrompt(
        files: { file: string; content: string }[],
        itemName: string,
        itemType: string
    ): string {
        const filesContent = files.map(f =>
            `=== File: ${f.file} ===\n${f.content}\n`
        ).join('\n');

        return `You are a security auditor for Claude Code extensions. Analyze the following ${itemType} named "${itemName}" for security risks.

Check for these security issues:
1. **API Key Exposure** (critical): Hardcoded API keys, tokens, passwords, or secrets
2. **Data Exfiltration** (critical): Code that sends user data, environment variables, or file contents to external servers
3. **Sensitive File Access** (high): Reading ~/.ssh, ~/.aws, ~/.claude, or other sensitive directories
4. **Shell Injection** (high): Unsafe command execution or shell injection vulnerabilities
5. **Suspicious URLs** (high): Requests to unknown or suspicious external services
6. **Environment Variable Access** (medium): Accessing sensitive env vars like API keys, credentials
7. **Credential Harvesting** (critical): Patterns that collect and transmit credentials
8. **Obfuscated Code** (high): Base64 encoded commands, dynamic code execution, or obfuscated logic

FILES TO AUDIT:
${filesContent}

Respond with a JSON object in this exact format:
{
  "status": "safe" | "warning" | "danger",
  "issues": [
    {
      "severity": "low" | "medium" | "high" | "critical",
      "type": "api_key_exposure" | "data_exfiltration" | "sensitive_file_access" | "shell_injection" | "suspicious_url" | "env_var_access" | "credential_harvesting" | "obfuscated_code" | "other",
      "description": "Description of the issue",
      "file": "filename where issue was found",
      "line": 123,
      "suggestion": "How to fix or mitigate"
    }
  ],
  "summary": "Brief overall assessment"
}

If no issues found, return: {"status": "safe", "issues": [], "summary": "No security issues detected"}

IMPORTANT: Only output the JSON object, nothing else.`;
    }

    /**
     * Parse Claude's response into AuditResult
     */
    private parseClaudeResponse(
        response: string,
        itemName: string,
        itemPath: string,
        itemType: 'skill' | 'agent' | 'command' | 'plugin'
    ): AuditResult {
        try {
            // Try to extract JSON from response
            let jsonStr = response.trim();

            // Handle Claude's output format which may have wrapper
            if (jsonStr.includes('```json')) {
                const match = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
                if (match) {
                    jsonStr = match[1];
                }
            } else if (jsonStr.includes('```')) {
                const match = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
                if (match) {
                    jsonStr = match[1];
                }
            }

            // Try to find JSON object in response
            const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonStr = jsonMatch[0];
            }

            const parsed = JSON.parse(jsonStr);

            return {
                itemName,
                itemPath,
                itemType,
                status: this.normalizeStatus(parsed.status),
                issues: (parsed.issues || []).map((issue: any) => ({
                    severity: this.normalizeSeverity(issue.severity),
                    type: issue.type || 'other',
                    description: issue.description || 'Unknown issue',
                    file: issue.file,
                    line: issue.line,
                    suggestion: issue.suggestion
                })),
                auditedAt: new Date(),
                rawResponse: response
            };
        } catch (parseError) {
            // If parsing fails, try to determine status from text
            const lowerResponse = response.toLowerCase();
            const hasDanger = lowerResponse.includes('critical') ||
                            lowerResponse.includes('danger') ||
                            lowerResponse.includes('malicious');
            const hasWarning = lowerResponse.includes('warning') ||
                             lowerResponse.includes('suspicious') ||
                             lowerResponse.includes('concern');

            return {
                itemName,
                itemPath,
                itemType,
                status: hasDanger ? 'danger' : (hasWarning ? 'warning' : 'safe'),
                issues: hasDanger || hasWarning ? [{
                    severity: hasDanger ? 'high' : 'medium',
                    type: 'parse_error',
                    description: `Could not parse audit response. Manual review recommended. Raw response available.`,
                    suggestion: 'Review the raw audit response for details.'
                }] : [],
                auditedAt: new Date(),
                rawResponse: response
            };
        }
    }

    /**
     * Normalize status value
     */
    private normalizeStatus(status: string): 'safe' | 'warning' | 'danger' | 'error' {
        const s = (status || '').toLowerCase();
        if (s === 'safe' || s === 'clean' || s === 'ok') return 'safe';
        if (s === 'warning' || s === 'warn' || s === 'caution') return 'warning';
        if (s === 'danger' || s === 'critical' || s === 'malicious' || s === 'unsafe') return 'danger';
        if (s === 'error') return 'error';
        return 'warning'; // Default to warning if unknown
    }

    /**
     * Normalize severity value
     */
    private normalizeSeverity(severity: string): 'low' | 'medium' | 'high' | 'critical' {
        const s = (severity || '').toLowerCase();
        if (s === 'low' || s === 'info') return 'low';
        if (s === 'medium' || s === 'moderate') return 'medium';
        if (s === 'high' || s === 'severe') return 'high';
        if (s === 'critical' || s === 'urgent') return 'critical';
        return 'medium'; // Default to medium if unknown
    }

    /**
     * Log audit result to output channel
     */
    private logAuditResult(result: AuditResult): void {
        const statusEmoji = {
            safe: 'SAFE',
            warning: 'WARNING',
            danger: 'DANGER',
            error: 'ERROR'
        };

        this.outputChannel.appendLine(`Status: [${statusEmoji[result.status]}]`);

        if (result.issues.length > 0) {
            this.outputChannel.appendLine(`Issues found: ${result.issues.length}`);
            for (const issue of result.issues) {
                this.outputChannel.appendLine(`  - [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}`);
                if (issue.file) {
                    this.outputChannel.appendLine(`    File: ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
                }
                if (issue.suggestion) {
                    this.outputChannel.appendLine(`    Suggestion: ${issue.suggestion}`);
                }
            }
        } else {
            this.outputChannel.appendLine(`No issues found.`);
        }
    }

    /**
     * Show the output channel
     */
    public showOutput(): void {
        this.outputChannel.show();
    }
}
