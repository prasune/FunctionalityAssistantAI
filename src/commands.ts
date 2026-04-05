import * as vscode from 'vscode';

export function registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('appmod.openSettings', openSettingsPanel(context)),
        vscode.commands.registerCommand('appmod.selectSourceFolder', selectSourceFolder),
        vscode.commands.registerCommand('appmod.selectTargetFolder', selectTargetFolder)
    );
}

function openSettingsPanel(context: vscode.ExtensionContext): () => void {
    return () => {
        const panel = vscode.window.createWebviewPanel(
            'appmodSettings',
            'App Modernizer Settings',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
            }
        );

        panel.webview.html = getSettingsWebviewContent();

        panel.webview.onDidReceiveMessage(
            async (message: { command: string; value?: string; type?: string }) => {
                switch (message.command) {
                    case 'selectSourceFolder': {
                        const folderUri = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: 'Select Source Folder'
                        });
                        if (folderUri && folderUri[0]) {
                            const config = vscode.workspace.getConfiguration('appmod');
                            await config.update('sourceFolder', folderUri[0].fsPath, vscode.ConfigurationTarget.Workspace);
                            panel.webview.postMessage({
                                command: 'updateSourceFolder',
                                value: folderUri[0].fsPath
                            });
                        }
                        break;
                    }
                    case 'selectTargetFolder': {
                        const folderUri = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: 'Select Target Folder'
                        });
                        if (folderUri && folderUri[0]) {
                            const config = vscode.workspace.getConfiguration('appmod');
                            await config.update('targetFolder', folderUri[0].fsPath, vscode.ConfigurationTarget.Workspace);
                            panel.webview.postMessage({
                                command: 'updateTargetFolder',
                                value: folderUri[0].fsPath
                            });
                        }
                        break;
                    }
                    case 'setConversionType': {
                        if (message.value) {
                            vscode.window.showInformationMessage(`Conversion type set to: ${message.value}`);
                        }
                        break;
                    }
                    case 'saveRoaStandards': {
                        if (message.value) {
                            const config = vscode.workspace.getConfiguration('appmod');
                            await config.update('roaStandards', JSON.parse(message.value), vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage('ROA standards saved successfully.');
                        }
                        break;
                    }
                    case 'startConversion': {
                        if (message.type) {
                            await vscode.commands.executeCommand('workbench.action.chat.open');
                            const command = message.type === 'graphql'
                                ? '@appmod /convert graphql'
                                : message.type === 'xapi'
                                    ? '@appmod /convert xapi'
                                    : '@appmod /convert api';
                            vscode.window.showInformationMessage(`Starting conversion: ${command}`);
                        }
                        break;
                    }
                }
            },
            undefined,
            context.subscriptions
        );
    };
}

async function selectSourceFolder(): Promise<void> {
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Source Folder (Legacy APIs)'
    });

    if (folderUri && folderUri[0]) {
        const config = vscode.workspace.getConfiguration('appmod');
        await config.update('sourceFolder', folderUri[0].fsPath, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Source folder set to: ${folderUri[0].fsPath}`);
    }
}

async function selectTargetFolder(): Promise<void> {
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Target Folder (Generated Output)'
    });

    if (folderUri && folderUri[0]) {
        const config = vscode.workspace.getConfiguration('appmod');
        await config.update('targetFolder', folderUri[0].fsPath, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Target folder set to: ${folderUri[0].fsPath}`);
    }
}

function getSettingsWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>App Modernizer Settings</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        h1 {
            color: var(--vscode-editor-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        h2 {
            color: var(--vscode-editor-foreground);
            margin-top: 24px;
        }
        .section {
            margin: 20px 0;
            padding: 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
        }
        .folder-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 10px 0;
        }
        .folder-path {
            flex: 1;
            padding: 6px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
        }
        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-primary {
            background: var(--vscode-button-background);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 10px 0;
        }
        .radio-option {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            cursor: pointer;
        }
        .radio-option:hover {
            border-color: var(--vscode-focusBorder);
        }
        .radio-option input[type="radio"] {
            margin: 0;
        }
        .radio-label {
            display: flex;
            flex-direction: column;
        }
        .radio-title {
            font-weight: bold;
        }
        .radio-desc {
            font-size: 12px;
            opacity: 0.8;
        }
        textarea {
            width: 100%;
            min-height: 120px;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            resize: vertical;
            box-sizing: border-box;
        }
        .action-bar {
            margin-top: 20px;
            display: flex;
            gap: 10px;
        }
    </style>
</head>
<body>
    <h1>App Modernizer</h1>
    <p>Convert legacy SOAP and REST APIs to modern API standards.</p>

    <div class="section">
        <h2>Workspace Folders</h2>
        <div class="folder-row">
            <label>Source:</label>
            <span class="folder-path" id="sourceFolder">Not configured</span>
            <button onclick="selectSource()">Browse...</button>
        </div>
        <div class="folder-row">
            <label>Target:</label>
            <span class="folder-path" id="targetFolder">Not configured</span>
            <button onclick="selectTarget()">Browse...</button>
        </div>
    </div>

    <div class="section">
        <h2>Conversion Type</h2>
        <div class="radio-group">
            <label class="radio-option">
                <input type="radio" name="conversionType" value="api" checked>
                <span class="radio-label">
                    <span class="radio-title">API (Backend)</span>
                    <span class="radio-desc">ROA-standard REST API with OpenAPI spec</span>
                </span>
            </label>
            <label class="radio-option">
                <input type="radio" name="conversionType" value="xapi">
                <span class="radio-label">
                    <span class="radio-title">xAPI (Experience Layer)</span>
                    <span class="radio-desc">Experience layer API with session handling and consumer headers</span>
                </span>
            </label>
            <label class="radio-option">
                <input type="radio" name="conversionType" value="graphql">
                <span class="radio-label">
                    <span class="radio-title">GraphQL</span>
                    <span class="radio-desc">GraphQL schema with types, queries, and mutations</span>
                </span>
            </label>
        </div>
    </div>

    <div class="section">
        <h2>ROA Standards (Optional)</h2>
        <p>Paste your company-specific ROA standards below. These will be applied during conversion.</p>
        <textarea id="roaStandards" placeholder="Enter company-specific ROA standards...&#10;Example:&#10;- Use plural resource names&#10;- kebab-case URL paths&#10;- Cursor-based pagination&#10;- RFC 7807 error responses"></textarea>
        <div style="margin-top: 8px;">
            <button class="btn-secondary" onclick="saveRoaStandards()">Save Standards</button>
        </div>
    </div>

    <div class="action-bar">
        <button class="btn-primary" onclick="startConversion()">Start Conversion</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function selectSource() {
            vscode.postMessage({ command: 'selectSourceFolder' });
        }

        function selectTarget() {
            vscode.postMessage({ command: 'selectTargetFolder' });
        }

        function saveRoaStandards() {
            const standards = document.getElementById('roaStandards').value;
            vscode.postMessage({ command: 'saveRoaStandards', value: JSON.stringify({ customRules: standards.split('\\n').filter(Boolean) }) });
        }

        function startConversion() {
            const type = document.querySelector('input[name="conversionType"]:checked').value;
            vscode.postMessage({ command: 'startConversion', type: type });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateSourceFolder':
                    document.getElementById('sourceFolder').textContent = message.value;
                    break;
                case 'updateTargetFolder':
                    document.getElementById('targetFolder').textContent = message.value;
                    break;
            }
        });
    </script>
</body>
</html>`;
}
