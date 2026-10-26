const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const manifest = require('../../package.json');
const settle = () => new Promise(resolve => setImmediate(resolve));

function event() {
    const listeners = new Set();
    return {
        subscribe(callback) {
            listeners.add(callback);
            return { dispose: () => listeners.delete(callback) };
        },
        fire(value) {
            for (const listener of listeners) {
                listener(value);
            }
        },
        get size() { return listeners.size; }
    };
}

function repository(name = 'main', fsPath = '/mock/monorepo') {
    const changed = event();
    return {
        rootUri: { fsPath },
        state: { HEAD: { name, commit: 'first' }, onDidChange: changed.subscribe },
        changed
    };
}

function harness(repositories = [repository()], options = {}) {
    const opened = event();
    const closed = event();
    const editor = event();
    const folders = event();
    const configuration = event();
    const focus = event();
    const writes = [];
    const commands = new Map();
    const context = { subscriptions: [] };
    let title = '';
    let activationCount = 0;
    const git = {
        repositories,
        onDidOpenRepository: opened.subscribe,
        onDidCloseRepository: closed.subscribe
    };
    const gitExtension = {
        isActive: false,
        async activate() {
            activationCount++;
            if (options.activation) {
                await options.activation;
            }
            gitExtension.isActive = true;
            return { getAPI: version => { assert.equal(version, 1); return git; } };
        }
    };
    const vscode = {
        ConfigurationTarget: { Workspace: 2, Global: 1 },
        extensions: { getExtension: () => options.missingGit ? undefined : gitExtension },
        commands: {
            registerCommand(name, callback) {
                commands.set(name, callback);
                return { dispose: () => commands.delete(name) };
            }
        },
        window: {
            onDidChangeActiveTextEditor: editor.subscribe,
            onDidChangeWindowState: focus.subscribe,
            showInformationMessage() {}
        },
        workspace: {
            workspaceFolders: [{ name: 'monorepo', uri: { fsPath: '/mock/monorepo' } }],
            workspaceFile: options.workspaceFile,
            onDidChangeWorkspaceFolders: folders.subscribe,
            onDidChangeConfiguration: configuration.subscribe,
            getConfiguration(section) {
                if (section === 'entitled') {
                    return { get: (key, fallback) => key === 'titlePattern'
                        ? options.titlePattern ?? '{workspace} [{branch}]'
                        : fallback };
                }
                return {
                    get: () => title,
                    async update(key, value, target) {
                        assert.equal(key, 'title');
                        assert.equal(target, vscode.ConfigurationTarget.Workspace);
                        title = value;
                        writes.push(value);
                    }
                };
            }
        }
    };
    let serviceExports;
    function load(relativePath) {
        const sandbox = {
            exports: {},
            console: { log() {}, warn() {}, error() {} },
            require(name) {
                if (name === 'vscode') { return vscode; }
                if (name === './services/WindowTitleService') { return serviceExports; }
                return require(name);
            }
        };
        vm.runInNewContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), sandbox);
        return sandbox.exports;
    }
    serviceExports = load('out/services/WindowTitleService.js');
    const extension = load('out/extension.js');
    return {
        git, opened, closed, writes, context, commands, extension,
        service: () => new serviceExports.WindowTitleService(),
        get title() { return title; },
        get activationCount() { return activationCount; }
    };
}

test('manifest activates on startup with the built-in Git extension', () => {
    assert.ok(manifest.activationEvents.includes('onStartupFinished'));
    assert.ok(manifest.extensionDependencies.includes('vscode.git'));
});

test('workspaceFile expands to the saved workspace filename without its extension', async () => {
    const instance = harness(undefined, {
        workspaceFile: { scheme: 'file', fsPath: '/mock/worktree3/My Workspace.code-workspace' },
        titlePattern: '{workspaceFile} [{branch}]'
    });
    const service = instance.service();
    await service.initialize();
    assert.equal(instance.title, 'My Workspace [main]');
    service.dispose();
});

test('workspaceFile preserves dots within the workspace filename prefix', async () => {
    const instance = harness(undefined, {
        workspaceFile: { scheme: 'file', fsPath: '/mock/worktree3/workspace.dev.code-workspace' },
        titlePattern: '{workspaceFile} [{branch}]'
    });
    const service = instance.service();
    await service.initialize();
    assert.equal(instance.title, 'workspace.dev [main]');
    service.dispose();
});

test('workspaceFile is empty for a single folder and supports fallback to workspace', async () => {
    const instance = harness(undefined, { titlePattern: '{workspaceFile}|{workspaceFile || workspace} [{branch}]' });
    const service = instance.service();
    await service.initialize();
    assert.equal(instance.title, '|monorepo [main]');
    service.dispose();
});

test('workspaceFile is empty for an unsaved workspace and supports fallback', async () => {
    const instance = harness(undefined, {
        workspaceFile: { scheme: 'untitled', fsPath: '/mock/untitled.code-workspace' },
        titlePattern: '{workspaceFile}|{workspaceFile || workspace} [{branch}]'
    });
    const service = instance.service();
    await service.initialize();
    assert.equal(instance.title, '|monorepo [main]');
    service.dispose();
});

test('activation waits for Git before the first title update', async () => {
    let release;
    const instance = harness(undefined, { activation: new Promise(resolve => { release = resolve; }) });
    const activation = instance.extension.activate(instance.context);
    assert.equal(instance.writes.length, 0);
    assert.equal(instance.activationCount, 1);
    release();
    await activation;
    assert.equal(instance.title, 'monorepo [main]');
    assert.equal(instance.commands.has('entitled.refreshTitle'), true);
    instance.extension.deactivate();
});

test('an existing repository branch change updates without editor or command events', async () => {
    const repo = repository();
    const instance = harness([repo]);
    const service = instance.service();
    await service.initialize();
    assert.equal(repo.changed.size, 1);
    repo.state.HEAD = { name: 'feature/title', commit: 'second' };
    repo.changed.fire();
    await settle();
    assert.equal(instance.title, 'monorepo [feature/title]');
    service.dispose();
});

test('status-only events and unchanged titles do not rewrite settings', async () => {
    const repo = repository();
    const instance = harness([repo]);
    const service = instance.service();
    await service.initialize();
    repo.changed.fire();
    await settle();
    repo.state.HEAD.commit = 'new-commit-on-same-branch';
    repo.changed.fire();
    await settle();
    assert.equal(instance.writes.length, 1);
    service.dispose();
});

test('repositories discovered after startup are watched without duplicate listeners', async () => {
    const instance = harness([]);
    const service = instance.service();
    await service.initialize();
    const repo = repository();
    instance.git.repositories.push(repo);
    instance.opened.fire(repo);
    instance.opened.fire(repo);
    await settle();
    assert.equal(repo.changed.size, 1);
    assert.equal(instance.title, 'monorepo [main]');
    repo.state.HEAD.name = 'later-branch';
    repo.changed.fire();
    await settle();
    assert.equal(instance.title, 'monorepo [later-branch]');
    service.dispose();
});

test('another workspace repository cannot replace the first workspace branch', async () => {
    const primary = repository();
    const other = repository('other-main', '/mock/ai-instructions');
    const instance = harness([primary, other]);
    const service = instance.service();
    await service.initialize();
    other.state.HEAD.name = 'other-feature';
    other.changed.fire();
    await settle();
    assert.equal(instance.title, 'monorepo [main]');
    assert.equal(instance.writes.length, 1);
    service.dispose();
});

test('detaching HEAD clears the previous branch and reattaching restores it', async () => {
    const repo = repository();
    const instance = harness([repo]);
    const service = instance.service();
    await service.initialize();
    repo.state.HEAD = { commit: 'detached' };
    repo.changed.fire();
    await settle();
    assert.equal(instance.title, 'monorepo []');
    repo.state.HEAD = { name: 'reattached', commit: 'detached' };
    repo.changed.fire();
    await settle();
    assert.equal(instance.title, 'monorepo [reattached]');
    service.dispose();
});

test('closing a repository disposes its listener and refreshes the title', async () => {
    const repo = repository();
    const instance = harness([repo]);
    const service = instance.service();
    await service.initialize();
    instance.git.repositories.splice(0);
    instance.closed.fire(repo);
    await settle();
    assert.equal(repo.changed.size, 0);
    assert.equal(instance.title, 'monorepo []');
    service.dispose();
});

test('disposal removes Git listeners and prevents pending updates from restoring the title', async () => {
    const repo = repository();
    const instance = harness([repo]);
    const service = instance.service();
    await service.initialize();
    repo.state.HEAD.name = 'pending';
    repo.changed.fire();
    service.dispose();
    await settle();
    assert.equal(repo.changed.size, 0);
    assert.equal(instance.opened.size, 0);
    assert.equal(instance.closed.size, 0);
    assert.equal(instance.title, '${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}');
});

test('disposal during Git activation does not register late listeners', async () => {
    let release;
    const repo = repository();
    const instance = harness([repo], { activation: new Promise(resolve => { release = resolve; }) });
    const service = instance.service();
    const initialization = service.initialize();
    service.dispose();
    release();
    await initialization;
    assert.equal(repo.changed.size, 0);
    assert.equal(instance.opened.size, 0);
    assert.equal(instance.closed.size, 0);
    assert.equal(instance.writes.length, 1);
});

test('a missing Git extension still allows a title without a branch', async () => {
    const instance = harness([], { missingGit: true });
    const service = instance.service();
    await service.initialize();
    assert.equal(instance.title, 'monorepo []');
    service.dispose();
});

test('Git activation failure still allows the initial title update', async () => {
    const instance = harness([], { activation: Promise.reject(new Error('Git unavailable')) });
    const service = instance.service();
    await service.initialize();
    assert.equal(instance.title, 'monorepo []');
    service.dispose();
});
