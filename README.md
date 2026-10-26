# Entitled - Custom Window Titles for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/your-publisher-name.entitled)](https://marketplace.visualstudio.com/items?itemName=your-publisher-name.entitled)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/your-publisher-name.entitled)](https://marketplace.visualstudio.com/items?itemName=your-publisher-name.entitled)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A VS Code extension that customizes window titles to show the information you actually need: **workspace name**, **git repository**, **branch**, **filename**, and **timestamps** with smart fallback patterns.

## ✨ Features

- 🏷️ **Smart Window Titles**: Display workspace, repository, branch, filename, and timestamps
- 🌳 **Git Integration**: Automatically detects repository name and branch using VS Code's Git API
- ⚙️ **Fully Customizable**: Create your own title patterns with template variables
- 🔄 **Real-time Updates**: Titles update automatically when you switch files, lose focus, or change branches
- 🎯 **Smart Fallbacks**: Use `||` syntax for graceful degradation when variables are empty
- ⏰ **Timestamp Tracking**: Shows last modification time in 24-hour format (updates on window focus loss)
- 🚀 **Lightweight**: Minimal performance impact with comprehensive test coverage

## 🚀 Quick Start

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=your-publisher-name.entitled)
2. Open any workspace with a Git repository
3. Your window title will automatically show: `workspace-name [branch-name] filename.ext - VSCode`

To enable smart fallbacks, try: `{workspace || repo || filename} [{branch}] (last: {timestamp})`

## Local Build

This local build activates after startup and listens for Git HEAD changes,
including repositories discovered after activation. In a multi-root workspace,
the branch comes from the first workspace folder.

```sh
npm ci --ignore-scripts
npm run test:git
npm run lint
npm run package -- --out entitled-0.1.13-local.vsix
code --install-extension ./entitled-0.1.13-local.vsix --force
```

Reload the VS Code window after installation. Disable auto-updates for Entitled
to keep Marketplace releases from replacing this local build. Publishing is not
required. Dependency install scripts are unnecessary for compilation and packaging;
the existing icon is included.

## 📋 Default Format

```
my-project [feature/new-feature] index.ts - VSCode
```

**Components:**
- `my-project` - Workspace or folder name
- `[feature/new-feature]` - Current git branch (if available)
- `index.ts` - Active filename (if any)
- `VSCode` - Always included

## ⚙️ Configuration

### Enable/Disable Custom Titles
```json
{
  "entitled.enableCustomTitle": true
}
```

### Custom Title Patterns
```json
{
  "entitled.titlePattern": "{workspaceFile || workspace} [{branch}] - VSCode"
}
```

Set `entitled.titlePattern` in User Settings or Workspace Settings. Do not edit
`window.title` directly; the extension writes that setting automatically.

**Available Variables:**

- `{workspace}` - Workspace or folder name
- `{workspaceFile}` - Saved workspace filename without the `.code-workspace` suffix; empty for single-folder and unsaved workspaces
- `{repo}` - Git repository name (extracted from git config)
- `{branch}` - Current git branch
- `{filename}` - Active file name
- `{timestamp}` - Last modification time in 24-hour format (HH:MM, updates on window focus loss)

**Fallback Patterns:**

Use the `||` operator to create smart fallbacks that gracefully handle missing information:

```json
// Use workspace name, fall back to repo name, then filename
"{workspace || repo || filename} [{branch}] (last: {timestamp})"

// Multiple fallback chains in one pattern
"{workspace || repo} - {branch || filename} - VSCode"

// Simple fallback
"{timestamp} | {workspace || repo}"
```

**How Fallbacks Work:**

- Evaluates variables **left-to-right**
- Uses the **first non-empty** value found
- Supports **multiple fallback patterns** in one title
- Handles **whitespace** gracefully around `||`
- **Backwards compatible** with single-variable patterns

**Example Patterns:**
```json
// Default format with fallback
"{workspace || repo} [{branch}] {filename} - VSCode"

// Timestamp with project fallback
"{timestamp} | {workspace || repo || filename}"

// Pipe separated with fallbacks
"{workspace || repo} | {branch || filename} | {timestamp}"

// Minimal format with smart fallback
"{workspace || repo} - {filename}"

// Branch focused with fallback
"[{branch || timestamp}] {workspace || repo}/{filename}"

// Complex pattern with multiple fallbacks
"{workspace || repo || filename} [{branch}] (last: {timestamp}) - VSCode"
```

## 🛠️ Development

Built with Test-Driven Development and comprehensive testing.

### Setup
```bash
# Clone the repository
git clone https://github.com/your-username/entitled.git
cd entitled

# Install dependencies
npm install

# Start development
npm run watch
```

### Testing
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Lint code
npm run lint
```

### Building
```bash
# Compile TypeScript
npm run compile

# Clean build
npm run clean && npm run compile

# Package extension
npm run package
```

## 🧪 Test Coverage

- ✅ 31 comprehensive tests covering all functionality
- ✅ Title component extraction and composition
- ✅ Git branch detection and repository name extraction with fallbacks
- ✅ Fallback pattern parsing and evaluation
- ✅ Timestamp functionality and focus loss detection
- ✅ Configuration handling and edge cases
- ✅ Real-time update mechanisms

## 🏗️ Architecture

- **WindowTitleService**: Core service handling title composition and updates
- **Git Integration**: Uses VS Code's Git API with `.git/HEAD` fallback
- **Event-Driven**: Listens to workspace and editor changes
- **Configuration-Aware**: Respects most user preferences and custom patterns

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Run tests: `npm test`
4. Commit changes: `git commit -m 'Add amazing feature'`
5. Push to branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=your-publisher-name.entitled)
- [GitHub Repository](https://github.com/your-username/entitled)
- [Issue Tracker](https://github.com/your-username/entitled/issues)
- [Changelog](CHANGELOG.md)

## 🙋‍♂️ Support

If you encounter any issues or have feature requests, please [open an issue](https://github.com/your-username/entitled/issues) on GitHub.

---

**Made with ❤️ using Test-Driven Development**
