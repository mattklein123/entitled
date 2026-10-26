import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface GitRepository {
    readonly rootUri: vscode.Uri;
    readonly state: {
        readonly HEAD?: { readonly name?: string; readonly commit?: string };
        readonly onDidChange: vscode.Event<void>;
    };
}

interface GitAPI {
    readonly repositories: GitRepository[];
    readonly onDidOpenRepository: vscode.Event<GitRepository>;
    readonly onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
    getAPI(version: 1): GitAPI;
}

export interface TitleComponents {
    workspace: string;
    workspaceFile?: string;
    repo: string;
    branch: string;
    filename: string;
    timestamp: string;
}

export class WindowTitleService {
    private disposables: vscode.Disposable[] = [];
    private titleUpdateCallbacks: ((title: string) => void)[] = [];    private lastModified: Date = new Date();
    private repositorySubscriptions = new Map<GitRepository, vscode.Disposable>();
    private gitApi: GitAPI | undefined;
    private disposed = false;

    constructor() {
        this.setupEventListeners();
    }

    public async initialize(): Promise<void> {
        try {
            const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (gitExtension) {
                const exports = await gitExtension.activate();
                if (this.disposed) {
                    return;
                }
                const git = exports.getAPI(1);
                this.gitApi = git;
                this.disposables.push(
                    git.onDidOpenRepository(repository => {
                        this.watchRepository(repository);
                        void this.updateTitle();
                    }),
                    git.onDidCloseRepository(repository => {
                        this.repositorySubscriptions.get(repository)?.dispose();
                        this.repositorySubscriptions.delete(repository);
                        void this.updateTitle();
                    })
                );
                git.repositories.forEach(repository => this.watchRepository(repository));
                console.log('Entitled: Listening for Git HEAD changes in', git.repositories.length, 'repositories');
            }
        } catch (error) {
            console.warn('Entitled: Could not initialize Git title updates:', error);
        }
        await this.updateTitle();
    }

    private watchRepository(repository: GitRepository): void {
        if (this.repositorySubscriptions.has(repository)) {
            return;
        }
        let headName = repository.state.HEAD?.name;
        let headCommit = repository.state.HEAD?.commit;
        this.repositorySubscriptions.set(repository, repository.state.onDidChange(() => {
            const head = repository.state.HEAD;
            if (head?.name !== headName || head?.commit !== headCommit) {
                headName = head?.name;
                headCommit = head?.commit;
                console.log('Entitled: Git HEAD changed for', repository.rootUri.fsPath);
                void this.updateTitle();
            }
        }));
    }

    private getRepository(workspacePath: string): GitRepository | undefined {
        return this.gitApi?.repositories.find(repository =>
            workspacePath === repository.rootUri.fsPath ||
            workspacePath.startsWith(repository.rootUri.fsPath + path.sep)
        );
    }

    private formatTimestamp(date: Date): string {
        // Format as 24-hour time (HH:MM)
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    private setupEventListeners(): void {
        // Listen for active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.handleActiveEditorChange();
            })
        );        // Listen for workspace changes
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.updateTitle();
            })
        );

        // Listen for window state changes (focus loss)
        this.disposables.push(
            vscode.window.onDidChangeWindowState((windowState) => {
                if (!windowState.focused) {
                    // Window lost focus - update timestamp
                    this.lastModified = new Date();
                    this.updateTitle();
                }
            })
        );

        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('entitled')) {
                    this.updateTitle();
                }
            })
        );
    }public extractWorkspaceName(workspace: vscode.WorkspaceFolder | undefined): string {
        if (!workspace) {
            return '';
        }

        if (workspace.name && workspace.name.trim() !== '') {
            return workspace.name;
        }

        // Extract folder name from URI
        return path.basename(workspace.uri.fsPath);
    }    public async extractBranchName(workspacePath: string): Promise<string> {
        try {
            // Try to get branch name from VS Code's built-in git API
            const repository = this.getRepository(workspacePath);
            if (repository?.state.HEAD) {
                return repository.state.HEAD.name ?? '';
            }

            // Fallback: Try to read .git/HEAD file directly
            const gitHeadPath = path.join(workspacePath, '.git', 'HEAD');
            if (fs.existsSync(gitHeadPath)) {
                const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
                if (headContent.startsWith('ref: refs/heads/')) {
                    return headContent.replace('ref: refs/heads/', '');
                }
            }

            return '';
        } catch (error) {
            console.warn('Failed to extract git branch name:', error);
            return '';
        }
    }

    public extractFileName(editor: vscode.TextEditor | undefined): string {
        if (!editor) {
            return '';
        }

        return path.basename(editor.document.fileName);
    }    public composeTitle(components: TitleComponents): string {
        // Check if custom title is enabled
        const config = vscode.workspace.getConfiguration('entitled');
        const isCustomTitleEnabled = config.get<boolean>('enableCustomTitle', true);

        if (!isCustomTitleEnabled) {
            // Return default VS Code title behavior
            return '';
        }

        // Get custom pattern from configuration
        const customPattern = config.get<string>('titlePattern');
        if (customPattern && customPattern !== '{workspace} {branch} {filename} - VSCode') {
            return this.composeCustomTitle(customPattern, components);
        }

        return this.composeDefaultTitle(components);
    }

    public composeDefaultTitle(components: TitleComponents): string {
        // Default pattern: workspace [branch] filename - VSCode
        const parts: string[] = [];

        // Add workspace name if available
        if (components.workspace) {
            parts.push(components.workspace);
        }

        // Add branch name in brackets if available
        if (components.branch) {
            parts.push(`[${components.branch}]`);
        }

        // Add filename if available
        if (components.filename) {
            parts.push(components.filename);
        }

        // Add VSCode at the end
        const title = parts.length > 0 ? `${parts.join(' ')} - VSCode` : 'VSCode';

        return title;
    }    public composeCustomTitle(pattern: string, components: TitleComponents): string {
        let result = pattern;

        // Handle fallback patterns with || syntax
        // Example: {workspace || repo || filename} -> use first non-empty value
        const fallbackPattern = /\{([^}]+)\}/g;

        result = result.replace(fallbackPattern, (match, variableList) => {
            // Split by || and trim whitespace
            const variables = variableList.split('||').map((v: string) => v.trim());

            // Try each variable in order until we find a non-empty value
            for (const variable of variables) {
                const value = this.getVariableValue(variable, components);
                if (value && value.trim() !== '') {
                    return value;
                }
            }

            // If all variables are empty, return empty string
            return '';
        });

        return result;
    }

    private getVariableValue(variable: string, components: TitleComponents): string {
        switch (variable) {
            case 'workspace':
                return components.workspace;
            case 'workspaceFile':
                return components.workspaceFile ?? '';
            case 'repo':
                return components.repo;
            case 'branch':
                return components.branch;
            case 'filename':
                return components.filename;
            case 'timestamp':
                return components.timestamp;
            default:
                return '';
        }    }    public async updateTitle(): Promise<void> {
        const components = await this.gatherTitleComponents();
        if (this.disposed) {
            return;
        }
        const config = vscode.workspace.getConfiguration('entitled');
        const pattern = config.get<string>('titlePattern', '{workspace} - {branch}');

        // Use custom title pattern if configured, otherwise use default title
        const title = pattern ? this.composeCustomTitle(pattern, components) : this.composeTitle(components);

        console.log('Entitled: Updating window title:', title);
        console.log('Entitled: Components:', components);
        console.log('Entitled: Pattern used:', pattern);

        // Notify callbacks
        this.titleUpdateCallbacks.forEach(callback => callback(title));

        // Update the window title using VS Code's window.title setting
        try {
            const windowConfig = vscode.workspace.getConfiguration('window');
            const currentTitle = windowConfig.get<string>('title');
            console.log('Entitled: Current window.title setting:', currentTitle);
            if (currentTitle === title) {
                return;
            }

            // Check if we have an open workspace/folder to determine the appropriate config target
            const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;

            if (hasWorkspace) {
                // Use Workspace configuration target so it only affects this workspace
                await windowConfig.update('title', title, vscode.ConfigurationTarget.Workspace);
                console.log('Entitled: Window title updated to workspace config');
            } else {
                // No workspace open, use Global configuration (affects all VS Code windows)
                await windowConfig.update('title', title, vscode.ConfigurationTarget.Global);
                console.log('Entitled: Window title updated to global config (no workspace open)');
            }

            // Verify the update
            const updatedTitle = windowConfig.get<string>('title');
            console.log('Entitled: Verified updated title:', updatedTitle);

        } catch (error) {
            console.error('Entitled: Failed to update window title:', error);

            // If workspace update fails, try global as fallback
            if (error instanceof Error && error.message.includes('Workspace Settings')) {
                try {
                    console.log('Entitled: Retrying with global config...');
                    const windowConfig = vscode.workspace.getConfiguration('window');
                    await windowConfig.update('title', title, vscode.ConfigurationTarget.Global);
                    console.log('Entitled: Successfully updated window title using global config');
                } catch (globalError) {
                    console.error('Entitled: Failed to update window title with global config:', globalError);
                }
            }
        }
    }

    public async handleActiveEditorChange(): Promise<void> {
        await this.updateTitle();
    }

    public onTitleUpdate(callback: (title: string) => void): void {
        this.titleUpdateCallbacks.push(callback);
    }    private async gatherTitleComponents(): Promise<TitleComponents> {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        const workspaceName = this.extractWorkspaceName(workspace);
        const workspaceFile = vscode.workspace.workspaceFile;

        const branchName = workspace
            ? await this.extractBranchName(workspace.uri.fsPath)
            : '';

        const repoName = workspace
            ? await this.extractRepoName(workspace.uri.fsPath)
            : '';
              const filename = this.extractFileName(vscode.window.activeTextEditor);
        const timestamp = this.formatTimestamp(this.lastModified);

        return {
            workspace: workspaceName,
            workspaceFile: workspaceFile && workspaceFile.scheme !== 'untitled'
                ? path.basename(workspaceFile.fsPath, '.code-workspace')
                : '',
            repo: repoName,
            branch: branchName,
            filename: filename,
            timestamp: timestamp
        };
    }    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.repositorySubscriptions.forEach(subscription => subscription.dispose());
        this.repositorySubscriptions.clear();
        // Reset window title to default before disposing
        this.resetWindowTitle();

        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
        this.titleUpdateCallbacks = [];
    }    public async resetWindowTitle(): Promise<void> {
        try {
            console.log('Entitled: Resetting window title to default');
            const windowConfig = vscode.workspace.getConfiguration('window');

            // Check if we have an open workspace/folder
            const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
            const defaultTitle = '${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}';

            if (hasWorkspace) {
                // Reset the workspace setting
                await windowConfig.update('title', defaultTitle, vscode.ConfigurationTarget.Workspace);
                console.log('Entitled: Window title reset to default (workspace)');
            } else {
                // No workspace, use global setting
                await windowConfig.update('title', defaultTitle, vscode.ConfigurationTarget.Global);
                console.log('Entitled: Window title reset to default (global)');
            }
        } catch (error) {
            // If workspace update fails, try global as fallback
            if (error instanceof Error && error.message.includes('Workspace Settings')) {
                try {
                    console.log('Entitled: Retrying reset with global config...');
                    const windowConfig = vscode.workspace.getConfiguration('window');
                    const defaultTitle = '${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}';
                    await windowConfig.update('title', defaultTitle, vscode.ConfigurationTarget.Global);
                    console.log('Entitled: Window title reset to default (global fallback)');
                } catch (globalError) {
                    console.error('Entitled: Failed to reset window title with global config:', globalError);
                }
            } else {
                console.error('Entitled: Failed to reset window title:', error);
            }
        }
    }

    // For testing purposes
    public setLastModified(date: Date): void {
        this.lastModified = date;
    }

    public getFormattedTimestamp(): string {
        return this.formatTimestamp(this.lastModified);
    }

    public async extractRepoName(workspacePath: string): Promise<string> {
        try {
            // Try to get repository name from VS Code's built-in git API
            const repository = this.getRepository(workspacePath);
            if (repository?.rootUri) {
                return path.basename(repository.rootUri.fsPath);
            }

            // Fallback: Try to find .git folder and use parent directory name
            const gitDir = path.join(workspacePath, '.git');
            if (fs.existsSync(gitDir)) {
                return path.basename(workspacePath);
            }
              // If not a git repository, try to get remote origin URL
            const gitConfigPath = path.join(workspacePath, '.git', 'config');
            if (fs.existsSync(gitConfigPath)) {
                const configContent = fs.readFileSync(gitConfigPath, 'utf8');
                const originRegex = /\[remote "origin"\][\s\S]*?url = (.+)/;
                const originMatch = originRegex.exec(configContent);
                if (originMatch?.[1]) {
                    const originUrl = originMatch[1].trim();
                    // Extract repo name from various URL formats
                    // github.com/user/repo.git -> repo
                    // github.com/user/repo -> repo
                    const repoRegex = /\/([^/]+?)(?:\.git)?$/;
                    const repoMatch = repoRegex.exec(originUrl);
                    if (repoMatch) {
                        return repoMatch[1];
                    }
                }
            }

            return '';
        } catch (error) {
            console.warn('Failed to extract git repository name:', error);
            return '';
        }
    }
}
