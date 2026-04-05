import * as vscode from 'vscode';
import { AppModChatParticipant } from './chatParticipant';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
    const chatParticipant = new AppModChatParticipant(context);
    chatParticipant.register();

    registerCommands(context);

    const outputChannel = vscode.window.createOutputChannel('App Modernizer');
    outputChannel.appendLine('App Modernizer extension activated');
    context.subscriptions.push(outputChannel);
}

export function deactivate(): void {
    // cleanup handled by disposables
}
