import * as vscode from 'vscode';
import { EndpointAnalyzer } from '../analyzers/endpointAnalyzer';
import { OpenApiGenerator } from '../generators/openApiGenerator';
import { GraphQLGenerator } from '../generators/graphqlGenerator';
import { PromptBuilder } from './promptBuilder';
import { RoaConfigManager } from '../config/roaConfig';
import { TargetApiType, PipelineStep, DetectedEndpoint } from '../types';

/**
 * Orchestrates the multi-step conversion pipeline.
 * Each step generates a prompt that is sent to Copilot Chat for execution.
 */
export class PipelineEngine {
    private readonly steps: PipelineStep[];

    constructor(
        private readonly analyzer: EndpointAnalyzer,
        private readonly openApiGenerator: OpenApiGenerator,
        private readonly graphqlGenerator: GraphQLGenerator,
        private readonly promptBuilder: PromptBuilder,
        private readonly roaConfig: RoaConfigManager
    ) {
        this.steps = this.initializeSteps();
    }

    private initializeSteps(): PipelineStep[] {
        return [
            {
                id: 'analyze',
                name: 'Endpoint Analysis',
                description: 'Scan workspace to detect all SOAP and REST endpoints',
                promptTemplate: 'analyze',
                order: 1,
                isEnabled: true,
                requiresUserInput: false
            },
            {
                id: 'configure-roa',
                name: 'ROA Standards Configuration',
                description: 'Apply company-specific ROA standards',
                promptTemplate: 'configure-roa',
                order: 2,
                isEnabled: true,
                requiresUserInput: true
            },
            {
                id: 'generate-spec',
                name: 'Specification Generation',
                description: 'Generate OpenAPI spec or GraphQL schema',
                promptTemplate: 'generate-spec',
                order: 3,
                isEnabled: true,
                requiresUserInput: false
            },
            {
                id: 'generate-code',
                name: 'Code Generation',
                description: 'Generate implementation code from specification',
                promptTemplate: 'generate-code',
                order: 4,
                isEnabled: true,
                requiresUserInput: false
            }
        ];
    }

    /**
     * Execute the full conversion pipeline, streaming results to Copilot Chat.
     */
    async executePipeline(
        sourceFolder: string,
        targetType: TargetApiType,
        request: vscode.ChatRequest,
        _context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const totalSteps = this.steps.filter(s => s.isEnabled).length;
        let currentStep = 0;

        stream.markdown('## App Modernizer — Conversion Pipeline\n\n');
        stream.markdown(`**Target:** ${this.getTargetLabel(targetType)}\n`);
        stream.markdown(`**Source:** ${sourceFolder}\n\n`);
        stream.markdown('---\n\n');

        // Step 1: Analyze endpoints
        currentStep++;
        stream.progress(`Step ${currentStep}/${totalSteps}: Analyzing endpoints...`);
        stream.markdown(`### Step ${currentStep}: Endpoint Analysis\n\n`);

        const analysisResult = await this.executeAnalysisStep(sourceFolder, stream, token);
        if (token.isCancellationRequested) {
            return;
        }

        stream.markdown('\n---\n\n');

        // Step 2: Show ROA config
        currentStep++;
        stream.progress(`Step ${currentStep}/${totalSteps}: Applying ROA standards...`);
        stream.markdown(`### Step ${currentStep}: ROA Standards\n\n`);

        const roaStandards = this.roaConfig.getStandards();
        stream.markdown('Current ROA standards applied:\n');
        stream.markdown(`- Resource naming: **${roaStandards.naming.resourceNaming}**\n`);
        stream.markdown(`- URL style: **${roaStandards.naming.urlPathStyle}**\n`);
        stream.markdown(`- Pagination: **${roaStandards.pagination.style}**\n`);
        stream.markdown(`- Error format: **${roaStandards.errorHandling.format}**\n`);
        stream.markdown(`- Versioning: **${roaStandards.versioning.strategy} (${roaStandards.versioning.currentVersion})**\n`);

        if (roaStandards.customRules.length > 0) {
            stream.markdown('\nCustom rules:\n');
            for (const rule of roaStandards.customRules) {
                stream.markdown(`- ${rule}\n`);
            }
        }

        stream.markdown('\n> **Tip:** Use `@appmod /configure-roa` to update these standards.\n');
        stream.markdown('\n---\n\n');

        // Step 3: Generate specification
        currentStep++;
        stream.progress(`Step ${currentStep}/${totalSteps}: Generating specification...`);

        if (targetType === TargetApiType.GRAPHQL) {
            stream.markdown(`### Step ${currentStep}: GraphQL Schema Generation\n\n`);
            await this.executeGraphQLGenerationStep(sourceFolder, analysisResult, stream, token);
        } else {
            const typeLabel = targetType === TargetApiType.ROA_REST_XAPI ? 'xAPI' : 'API';
            stream.markdown(`### Step ${currentStep}: OpenAPI Specification Generation (${typeLabel})\n\n`);
            await this.executeOpenApiGenerationStep(
                sourceFolder, targetType, analysisResult, stream, token
            );
        }

        if (token.isCancellationRequested) {
            return;
        }

        stream.markdown('\n---\n\n');

        // Step 4: Code generation guidance
        currentStep++;
        stream.progress(`Step ${currentStep}/${totalSteps}: Code generation setup...`);
        stream.markdown(`### Step ${currentStep}: Code Generation\n\n`);

        await this.executeCodeGenerationStep(stream, token);

        stream.markdown('\n---\n\n');
        stream.markdown('## Pipeline Complete\n\n');
        stream.markdown('**Recommended model for best accuracy:** `gpt-4o` or `claude-3.5-sonnet`\n\n');
        stream.markdown('Use `gpt-4o` for complex SOAP analysis and accurate type mapping. ');
        stream.markdown('For large codebases, `o1-preview` provides stronger reasoning capabilities.\n\n');
        stream.markdown('**Next steps:**\n');
        stream.markdown('- Review the generated specification for accuracy\n');
        stream.markdown('- Run `@appmod /generate-code` to generate implementation\n');
        stream.markdown('- Use `@appmod /configure-roa` to adjust standards and regenerate\n');
    }

    private async executeAnalysisStep(
        sourceFolder: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<string> {
        const analysisPrompt = this.promptBuilder.buildAnalysisPrompt(sourceFolder);

        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                stream.markdown('⚠️ No language model available. Providing structural analysis only.\n\n');
                return this.fallbackAnalysis(sourceFolder, stream);
            }

            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(analysisPrompt)
            ];

            const response = await model.sendRequest(messages, {}, token);

            let fullResponse = '';
            for await (const chunk of response.text) {
                fullResponse += chunk;
                stream.markdown(chunk);
            }

            return fullResponse;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`⚠️ LLM analysis error: ${errorMessage}\n\n`);
            return this.fallbackAnalysis(sourceFolder, stream);
        }
    }

    private async fallbackAnalysis(
        sourceFolder: string,
        stream: vscode.ChatResponseStream
    ): Promise<string> {
        stream.markdown('Performing heuristic endpoint scan...\n\n');

        try {
            const files = await this.analyzer.findEndpointFiles(sourceFolder);
            const endpointFiles = await this.analyzer.readAndFilterEndpoints(files);

            let result = `Found ${endpointFiles.size} potential endpoint files:\n\n`;
            for (const [filePath, content] of endpointFiles) {
                const classification = this.analyzer.quickClassify(content);
                result += `- **${filePath}** → ${classification}\n`;
            }

            stream.markdown(result);
            return result;
        } catch (error) {
            const msg = 'Could not scan workspace files. Please ensure the source folder is accessible.';
            stream.markdown(msg);
            return msg;
        }
    }

    private async executeOpenApiGenerationStep(
        sourceFolder: string,
        targetType: TargetApiType,
        previousAnalysis: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const roaStandards = this.roaConfig.getStandards();
        const generatePrompt = this.promptBuilder.buildOpenApiGenerationPrompt(
            sourceFolder,
            targetType,
            roaStandards,
            previousAnalysis,
            ''
        );

        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                const endpoints: DetectedEndpoint[] = this.analyzer.parseAnalysisResult(previousAnalysis);
                const scaffold = this.openApiGenerator.generateScaffold(endpoints, targetType, roaStandards);
                stream.markdown('```yaml\n' + scaffold + '\n```\n');
                return;
            }

            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(generatePrompt)
            ];

            const response = await model.sendRequest(messages, {}, token);

            for await (const chunk of response.text) {
                stream.markdown(chunk);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`⚠️ Error generating OpenAPI spec: ${errorMessage}\n`);
        }
    }

    private async executeGraphQLGenerationStep(
        sourceFolder: string,
        previousAnalysis: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const generatePrompt = this.promptBuilder.buildGraphQLGenerationPrompt(
            sourceFolder,
            previousAnalysis,
            ''
        );

        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                const endpoints: DetectedEndpoint[] = this.analyzer.parseAnalysisResult(previousAnalysis);
                const scaffold = this.graphqlGenerator.generateScaffold(endpoints);
                stream.markdown('```graphql\n' + scaffold + '\n```\n');
                return;
            }

            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(generatePrompt)
            ];

            const response = await model.sendRequest(messages, {}, token);

            for await (const chunk of response.text) {
                stream.markdown(chunk);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`⚠️ Error generating GraphQL schema: ${errorMessage}\n`);
        }
    }

    private async executeCodeGenerationStep(
        stream: vscode.ChatResponseStream,
        _token: vscode.CancellationToken
    ): Promise<void> {
        stream.markdown('To generate implementation code from the specification:\n\n');
        stream.markdown('**Using OpenAPI Generator CLI:**\n');
        stream.markdown('```bash\n');
        stream.markdown('# Install OpenAPI Generator\n');
        stream.markdown('npm install @openapitools/openapi-generator-cli -g\n\n');
        stream.markdown('# Generate Spring Boot server\n');
        stream.markdown('openapi-generator-cli generate \\\n');
        stream.markdown('  -i openapi-spec.yaml \\\n');
        stream.markdown('  -g spring \\\n');
        stream.markdown('  -o ./generated \\\n');
        stream.markdown('  --additional-properties=useSpringBoot3=true,useTags=true\n\n');
        stream.markdown('# Generate client SDK\n');
        stream.markdown('openapi-generator-cli generate \\\n');
        stream.markdown('  -i openapi-spec.yaml \\\n');
        stream.markdown('  -g java \\\n');
        stream.markdown('  -o ./generated-client \\\n');
        stream.markdown('  --additional-properties=library=webclient,useJakartaEe=true\n');
        stream.markdown('```\n\n');
        stream.markdown('Or use `@appmod /generate-code` for LLM-assisted code generation with custom logic.\n');
    }

    private getTargetLabel(targetType: TargetApiType): string {
        switch (targetType) {
            case TargetApiType.ROA_REST_API:
                return 'Backend API (ROA Standard REST)';
            case TargetApiType.ROA_REST_XAPI:
                return 'xAPI (Experience Layer)';
            case TargetApiType.GRAPHQL:
                return 'GraphQL';
        }
    }
}
