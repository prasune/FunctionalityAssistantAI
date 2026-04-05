import * as vscode from 'vscode';
import { ChatHandler } from './chatHandler';

/**
 * Extension entry point.
 * 
 * Registers the @integrationtest chat participant that generates
 * Spring Boot integration tests with WireMock from Splunk/local log files.
 */
export function activate(context: vscode.ExtensionContext): void {
  const chatHandler = new ChatHandler();

  // Create the chat participant
  const participant = vscode.chat.createChatParticipant(
    'springboot-test-gen.integrationtest',
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      await chatHandler.handle(request, chatContext, stream, token);
    }
  );

  // Set the participant icon
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');

  // Register the participant for cleanup
  context.subscriptions.push(participant);
}

export function deactivate(): void {
  // Nothing to clean up
}
