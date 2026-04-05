import * as vscode from 'vscode';
import { EndpointAnalyzer } from './analyzers/endpointAnalyzer';
import { OpenApiGenerator } from './generators/openApiGenerator';
import { GraphQLGenerator } from './generators/graphqlGenerator';
import { PipelineEngine } from './pipeline/pipelineEngine';
import { PromptBuilder } from './pipeline/promptBuilder';
import { RoaConfigManager } from './config/roaConfig';
import { TargetApiType } from './types';

export class AppModChatParticipant {
    private participant: vscode.ChatParticipant | undefined;
    private readonly analyzer: EndpointAnalyzer;
    private readonly openApiGenerator: OpenApiGenerator;
    private readonly graphqlGenerator: GraphQLGenerator;
    private readonly pipelineEngine: PipelineEngine;
    private readonly promptBuilder: PromptBuilder;
    private readonly roaConfig: RoaConfigManager;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.analyzer = new EndpointAnalyzer();
        this.openApiGenerator = new OpenApiGenerator();
        this.graphqlGenerator = new GraphQLGenerator();
        this.promptBuilder = new PromptBuilder();
        this.roaConfig = new RoaConfigManager(context);
        this.pipelineEngine = new PipelineEngine(
            this.analyzer,
            this.openApiGenerator,
            this.graphqlGenerator,
            this.promptBuilder,
            this.roaConfig
        );
    }

    register(): void {
        this.participant = vscode.chat.createChatParticipant('appmod', this.handleRequest.bind(this));
        this.participant.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.png');
        this.context.subscriptions.push(this.participant);
    }

    private async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const command = request.command;

        switch (command) {
            case 'analyze':
                await this.handleAnalyze(request, stream, token);
                break;
            case 'generate-openapi':
                await this.handleGenerateOpenApi(request, context, stream, token);
                break;
            case 'generate-graphql':
                await this.handleGenerateGraphQL(request, context, stream, token);
                break;
            case 'configure-roa':
                await this.handleConfigureRoa(request, stream, token);
                break;
            case 'generate-code':
                await this.handleGenerateCode(request, context, stream, token);
                break;
            case 'convert':
                await this.handleConvert(request, context, stream, token);
                break;
            default:
                await this.handleFreeformQuery(request, context, stream, token);
                break;
        }
    }

    private async handleAnalyze(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.progress('Scanning workspace for API endpoints...');

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            stream.markdown('⚠️ No workspace folder is open. Please open a workspace containing your legacy API code.');
            return;
        }

        const sourceFolder = this.getConfiguredSourceFolder() || workspaceFolders[0].uri.fsPath;

        const analysisPrompt = this.promptBuilder.buildAnalysisPrompt(sourceFolder);

        const messages = [
            vscode.LanguageModelChatMessage.User(analysisPrompt)
        ];

        stream.progress('Using LLM to analyze endpoint classes...');

        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                stream.markdown('⚠️ No suitable language model available. Please ensure GitHub Copilot is active.');
                return;
            }

            const model = models[0];
            const response = await model.sendRequest(messages, {}, token);

            let fullResponse = '';
            for await (const chunk of response.text) {
                fullResponse += chunk;
            }

            stream.markdown('## 🔍 Endpoint Analysis Results\n\n');
            stream.markdown(fullResponse);
            stream.markdown('\n\n---\n');
            stream.markdown('**Next steps:**\n');
            stream.markdown('- Use `@appmod /generate-openapi` to generate an OpenAPI spec (API or xAPI)\n');
            stream.markdown('- Use `@appmod /generate-graphql` to generate a GraphQL schema\n');
            stream.markdown('- Use `@appmod /configure-roa` to set company-specific ROA standards\n');
            stream.markdown('- Use `@appmod /convert` to run the full conversion pipeline\n');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`❌ Error during analysis: ${errorMessage}`);
        }
    }

    private async handleGenerateOpenApi(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.progress('Preparing OpenAPI specification generation...');

        const userPrompt = request.prompt.trim().toLowerCase();
        const isXApi = userPrompt.includes('xapi') || userPrompt.includes('experience');
        const targetType = isXApi ? TargetApiType.ROA_REST_XAPI : TargetApiType.ROA_REST_API;

        const roaStandards = this.roaConfig.getStandards();
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders || workspaceFolders.length === 0) {
            stream.markdown('⚠️ No workspace folder is open. Please open your legacy API workspace.');
            return;
        }

        const sourceFolder = this.getConfiguredSourceFolder() || workspaceFolders[0].uri.fsPath;

        const previousAnalysis = this.extractPreviousAnalysis(context);

        const generatePrompt = this.promptBuilder.buildOpenApiGenerationPrompt(
            sourceFolder,
            targetType,
            roaStandards,
            previousAnalysis,
            request.prompt
        );

        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                stream.markdown('⚠️ No suitable language model available.');
                return;
            }

            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(generatePrompt)
            ];

            stream.progress('Generating OpenAPI specification with ROA standards...');

            const response = await model.sendRequest(messages, {}, token);

            const apiTypeLabel = isXApi ? 'xAPI (Experience Layer)' : 'Backend API';
            stream.markdown(`## 📋 OpenAPI Specification - ${apiTypeLabel}\n\n`);

            let fullSpec = '';
            for await (const chunk of response.text) {
                fullSpec += chunk;
                stream.markdown(chunk);
            }

            stream.markdown('\n\n---\n');

            if (isXApi) {
                stream.markdown('**xAPI-specific features included:**\n');
                stream.markdown('- Experience layer headers (X-Session-ID, X-Channel, etc.)\n');
                stream.markdown('- Session handling configuration\n');
                stream.markdown('- Consumer-facing response models\n');
            }

            stream.markdown('\n**Next steps:**\n');
            stream.markdown('- Use `@appmod /generate-code` to generate implementation code\n');
            stream.markdown('- Use `@appmod /configure-roa` to adjust ROA standards and regenerate\n');

            await this.saveGeneratedSpec(fullSpec, targetType);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`❌ Error generating OpenAPI spec: ${errorMessage}`);
        }
    }

    private async handleGenerateGraphQL(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.progress('Preparing GraphQL schema generation...');

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            stream.markdown('⚠️ No workspace folder is open.');
            return;
        }

        const sourceFolder = this.getConfiguredSourceFolder() || workspaceFolders[0].uri.fsPath;
        const previousAnalysis = this.extractPreviousAnalysis(context);

        const generatePrompt = this.promptBuilder.buildGraphQLGenerationPrompt(
            sourceFolder,
            previousAnalysis,
            request.prompt
        );

        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                stream.markdown('⚠️ No suitable language model available.');
                return;
            }

            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(generatePrompt)
            ];

            stream.progress('Generating GraphQL schema...');

            const response = await model.sendRequest(messages, {}, token);

            stream.markdown('## 📊 GraphQL Schema\n\n');

            let fullSchema = '';
            for await (const chunk of response.text) {
                fullSchema += chunk;
                stream.markdown(chunk);
            }

            stream.markdown('\n\n---\n');
            stream.markdown('**Next steps:**\n');
            stream.markdown('- Use `@appmod /generate-code` to generate resolver implementations\n');

            await this.saveGeneratedSchema(fullSchema);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`❌ Error generating GraphQL schema: ${errorMessage}`);
        }
    }

    private async handleConfigureRoa(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const userInput = request.prompt.trim();

        if (userInput.length === 0) {
            const currentStandards = this.roaConfig.getStandards();
            stream.markdown('## ⚙️ Current ROA Standards Configuration\n\n');
            stream.markdown('```json\n' + JSON.stringify(currentStandards, null, 2) + '\n```\n\n');
            stream.markdown('**To update ROA standards**, provide your company-specific standards as part of your message.\n');
            stream.markdown('Example: `@appmod /configure-roa Use plural resource names, kebab-case URLs, cursor-based pagination`\n');
            return;
        }

        stream.progress('Updating ROA standards configuration...');

        this.roaConfig.updateFromUserInput(userInput);
        const updatedStandards = this.roaConfig.getStandards();

        stream.markdown('## ✅ ROA Standards Updated\n\n');
        stream.markdown('```json\n' + JSON.stringify(updatedStandards, null, 2) + '\n```\n\n');
        stream.markdown('These standards will be applied when generating OpenAPI specs.\n');
    }

    private async handleGenerateCode(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.progress('Preparing code generation from OpenAPI spec...');

        const previousMessages = this.extractPreviousAnalysis(context);

        const codeGenPrompt = this.promptBuilder.buildCodeGenerationPrompt(
            previousMessages,
            request.prompt
        );

        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                stream.markdown('⚠️ No suitable language model available.');
                return;
            }

            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(codeGenPrompt)
            ];

            stream.progress('Generating implementation code...');

            const response = await model.sendRequest(messages, {}, token);

            stream.markdown('## 🛠️ Generated Code Implementation\n\n');

            for await (const chunk of response.text) {
                stream.markdown(chunk);
            }

            stream.markdown('\n\n---\n');
            stream.markdown('**OpenAPI Generator command:**\n');
            stream.markdown('```bash\nopenapi-generator-cli generate -i openapi-spec.yaml -g spring -o ./generated\n```\n');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`❌ Error generating code: ${errorMessage}`);
        }
    }

    private async handleConvert(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.progress('Starting full conversion pipeline...');

        const userPrompt = request.prompt.trim().toLowerCase();

        let targetType = TargetApiType.ROA_REST_API;
        if (userPrompt.includes('graphql')) {
            targetType = TargetApiType.GRAPHQL;
        } else if (userPrompt.includes('xapi') || userPrompt.includes('experience')) {
            targetType = TargetApiType.ROA_REST_XAPI;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            stream.markdown('⚠️ No workspace folder is open.');
            return;
        }

        const sourceFolder = this.getConfiguredSourceFolder() || workspaceFolders[0].uri.fsPath;

        try {
            await this.pipelineEngine.executePipeline(
                sourceFolder,
                targetType,
                request,
                context,
                stream,
                token
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`❌ Pipeline error: ${errorMessage}`);
        }
    }

    private async handleFreeformQuery(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const freeformPrompt = this.promptBuilder.buildFreeformPrompt(
            request.prompt,
            this.extractPreviousAnalysis(context)
        );

        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                stream.markdown(this.getWelcomeMessage());
                return;
            }

            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(freeformPrompt)
            ];

            const response = await model.sendRequest(messages, {}, token);

            for await (const chunk of response.text) {
                stream.markdown(chunk);
            }
        } catch (error) {
            stream.markdown(this.getWelcomeMessage());
        }
    }

    private getWelcomeMessage(): string {
        return `## 🚀 Welcome to App Modernizer!

I can help you convert legacy SOAP and REST APIs to modern API standards.

**Available commands:**
- \`@appmod /analyze\` — Scan your workspace for SOAP and REST endpoints
- \`@appmod /generate-openapi\` — Generate OpenAPI spec (add "xapi" for experience layer)
- \`@appmod /generate-graphql\` — Generate GraphQL schema
- \`@appmod /configure-roa\` — Configure company-specific ROA standards
- \`@appmod /generate-code\` — Generate implementation code using OpenAPI Generator
- \`@appmod /convert\` — Run the full conversion pipeline

**Target API types:**
- **API** — Backend ROA-standard REST API with OpenAPI spec
- **xAPI** — Experience layer API with session handling and consumer headers
- **GraphQL** — GraphQL schema with types, queries, and mutations

**Tip:** Start by running \`@appmod /analyze\` to detect your legacy endpoints, then choose your target format.`;
    }

    private extractPreviousAnalysis(context: vscode.ChatContext): string {
        const previousTurns = context.history;
        const relevantContent: string[] = [];

        for (const turn of previousTurns) {
            if (turn instanceof vscode.ChatResponseTurn) {
                for (const part of turn.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        relevantContent.push(part.value.value);
                    }
                }
            }
        }

        return relevantContent.join('\n');
    }

    private getConfiguredSourceFolder(): string | undefined {
        const config = vscode.workspace.getConfiguration('appmod');
        const sourceFolder = config.get<string>('sourceFolder');
        return sourceFolder && sourceFolder.length > 0 ? sourceFolder : undefined;
    }

    private async saveGeneratedSpec(spec: string, targetType: TargetApiType): Promise<void> {
        const targetFolder = this.getConfiguredTargetFolder();
        if (!targetFolder) {
            return;
        }

        const fileName = targetType === TargetApiType.ROA_REST_XAPI
            ? 'openapi-xapi-spec.yaml'
            : 'openapi-spec.yaml';

        const fileUri = vscode.Uri.file(`${targetFolder}/${fileName}`);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(spec, 'utf-8'));
    }

    private async saveGeneratedSchema(schema: string): Promise<void> {
        const targetFolder = this.getConfiguredTargetFolder();
        if (!targetFolder) {
            return;
        }

        const fileUri = vscode.Uri.file(`${targetFolder}/schema.graphql`);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(schema, 'utf-8'));
    }

    private getConfiguredTargetFolder(): string | undefined {
        const config = vscode.workspace.getConfiguration('appmod');
        const targetFolder = config.get<string>('targetFolder');
        return targetFolder && targetFolder.length > 0 ? targetFolder : undefined;
    }
}
