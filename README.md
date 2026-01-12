# Claude Code Assist

A VS Code extension for managing Claude Code skills, agents, and plugins.

## Features

- **Skills Management**: View and manage global and project-level skills
- **Marketplace Integration**: Browse and install skills from GitHub marketplace
- **Plugin Management**: View and delete installed Claude Code plugins
- **Conflict Detection**: Check for skill naming conflicts

## Usage

1. Open the Claude Assist panel from the Activity Bar
2. Browse your installed skills and agents organized by scope (Global/Project)
3. Click the cloud icon to open the marketplace and install new skills
4. Right-click on items to move, delete, or manage them

## Requirements

- Claude Code CLI installed
- VS Code 1.80.0 or higher

## Extension Settings

- `claudeCodeAssist.globalSkillsPath`: Path to global Claude Code directory (default: `~/.claude`)
- `claudeCodeAssist.projectSkillsPath`: Path to project Claude Code directory (default: `./.claude`)

## License

MIT
