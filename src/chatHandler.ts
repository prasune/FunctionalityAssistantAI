import * as vscode from 'vscode';
import { LogParser } from './logParser';
import { TestGenerator } from './testGenerator';
import { GeneratedTestSuite, TestGenerationConfig, DEFAULT_CONFIG, ParsedLogResult } from './types';

/**
 * Handles chat requests for the Integration Test Generator participant.
 * 
 * Enforces that a log file is attached to the chat request before generating tests.
 * Supports slash commands: /generate, /analyze, /help
 */
export class ChatHandler {
  private logParser: LogParser;

  constructor() {
    this.logParser = new LogParser();
  }

  /**
   * Main request handler for the chat participant.
   */
  async handle(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Handle slash commands
    const command = request.command;

    if (command === 'help') {
      this.handleHelp(stream);
      return;
    }

    if (command === 'analyze') {
      await this.handleAnalyze(request, stream, token);
      return;
    }

    // Default and /generate command
    await this.handleGenerate(request, context, stream, token);
  }

  /**
   * Handle the /help command - show usage instructions.
   */
  private handleHelp(stream: vscode.ChatResponseStream): void {
    stream.markdown(`# Integration Test Generator - Help\n\n`);
    stream.markdown(`## Overview\n`);
    stream.markdown(`This extension generates **Spring Boot integration tests** with **WireMock** virtualization `);
    stream.markdown(`from Splunk/local log files.\n\n`);

    stream.markdown(`## How to Use\n\n`);
    stream.markdown(`1. **Attach a log file** using the 📎 button or drag & drop\n`);
    stream.markdown(`2. **Specify the API URL** you want to generate tests for\n`);
    stream.markdown(`3. The extension will parse the log, identify downstream calls, and generate:\n`);
    stream.markdown(`   - A single \`@SpringBootTest\` class (to avoid Jenkins memory issues)\n`);
    stream.markdown(`   - Plain Java delegation classes with WireMock stubs\n`);
    stream.markdown(`   - Comprehensive response assertions\n\n`);

    stream.markdown(`## Commands\n\n`);
    stream.markdown(`| Command | Description |\n`);
    stream.markdown(`|---------|-------------|\n`);
    stream.markdown(`| \`/generate\` | Generate integration tests from an attached log file |\n`);
    stream.markdown(`| \`/analyze\` | Analyze a log file and show extracted API calls |\n`);
    stream.markdown(`| \`/help\` | Show this help message |\n\n`);

    stream.markdown(`## Supported Log Formats\n\n`);
    stream.markdown(`- **JSON structured logs** (logback JSON, etc.)\n`);
    stream.markdown(`- **Key-value Splunk logs** (\`key=value\` format)\n`);
    stream.markdown(`- **Standard HTTP logging** (request/response patterns)\n\n`);

    stream.markdown(`## Example Usage\n\n`);
    stream.markdown('```\n');
    stream.markdown(`@integrationtest /generate Generate tests for POST /api/v1/orders\n`);
    stream.markdown('```\n\n');

    stream.markdown(`## Generated Code Structure\n\n`);
    stream.markdown('```\n');
    stream.markdown(`src/test/java/com/example/integration/\n`);
    stream.markdown(`├── IntegrationTestSuite.java          # Single @SpringBootTest\n`);
    stream.markdown(`├── config/\n`);
    stream.markdown(`│   └── WireMockConfig.java            # WireMock configuration\n`);
    stream.markdown(`├── tests/\n`);
    stream.markdown(`│   ├── GetUsersApiTest.java           # Plain Java delegation class\n`);
    stream.markdown(`│   └── PostOrdersApiTest.java         # Plain Java delegation class\n`);
    stream.markdown(`└── util/\n`);
    stream.markdown(`    └── TestHelper.java                # Shared test utilities\n`);
    stream.markdown('```\n');

    stream.markdown(`\n> **Important:** Only a single \`@SpringBootTest\` class is generated to prevent `);
    stream.markdown(`multiple Spring contexts from starting in Jenkins, which avoids memory issues and crashes.\n`);
  }

  /**
   * Handle the /analyze command - show extracted API calls without generating tests.
   */
  private async handleAnalyze(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    const logContent = await this.extractLogContent(request);

    if (!logContent) {
      this.showAttachmentRequired(stream);
      return;
    }

    stream.progress('Analyzing log file...');

    const result = this.logParser.parse(logContent);

    if (result.apiCallChains.length === 0) {
      stream.markdown(`## ⚠️ No API calls found\n\n`);
      if (result.warnings.length > 0) {
        stream.markdown(`**Warnings:**\n`);
        for (const warning of result.warnings) {
          stream.markdown(`- ${warning}\n`);
        }
      }
      stream.markdown(`\nPlease ensure your log file contains HTTP request/response data.\n`);
      return;
    }

    this.renderAnalysisResult(result, stream);
  }

  /**
   * Handle the /generate command (and default) - generate integration tests.
   */
  private async handleGenerate(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    const logContent = await this.extractLogContent(request);

    if (!logContent) {
      this.showAttachmentRequired(stream);
      return;
    }

    stream.progress('Parsing log file...');

    // Parse the log file
    const result = this.logParser.parse(logContent);

    if (result.apiCallChains.length === 0) {
      stream.markdown(`## ⚠️ No API calls found in the log file\n\n`);
      if (result.warnings.length > 0) {
        stream.markdown(`**Warnings:**\n`);
        for (const warning of result.warnings) {
          stream.markdown(`- ${warning}\n`);
        }
      }
      stream.markdown(`\nPlease ensure your log file contains HTTP request/response data with downstream calls.\n`);
      stream.markdown(`\nUse \`@integrationtest /help\` for supported log formats.\n`);
      return;
    }

    // Extract configuration from user prompt if provided
    const config = this.extractConfigFromPrompt(request.prompt);

    stream.progress('Generating integration tests...');

    // Generate the test suite
    const testGenerator = new TestGenerator(config);
    const testSuite = testGenerator.generate(result.apiCallChains);

    // Use LLM to enhance the generated tests if possible
    const enhancedSuite = await this.enhanceWithLLM(request, context, testSuite, result, stream, token);

    // Render the generated code
    this.renderGeneratedTests(enhancedSuite, result, stream);
  }

  /**
   * Extract log content from the chat request references (file attachments).
   */
  private async extractLogContent(request: vscode.ChatRequest): Promise<string | null> {
    // Check for file references in the request
    if (request.references && request.references.length > 0) {
      for (const ref of request.references) {
        const value = ref.value;

        // Handle URI references (file attachments)
        if (value instanceof vscode.Uri) {
          try {
            const fileContent = await vscode.workspace.fs.readFile(value);
            return Buffer.from(fileContent).toString('utf-8');
          } catch (err) {
            // File read failed, continue checking other refs
          }
        }

        // Handle Location references
        if (value && typeof value === 'object' && 'uri' in value) {
          const loc = value as vscode.Location;
          try {
            const fileContent = await vscode.workspace.fs.readFile(loc.uri);
            return Buffer.from(fileContent).toString('utf-8');
          } catch (err) {
            // Continue checking other refs
          }
        }

        // Handle string references (inline log content)
        if (typeof value === 'string') {
          return value;
        }
      }
    }

    // Check if the prompt itself contains log-like content (fallback)
    if (request.prompt && request.prompt.length > 200 && this.looksLikeLogContent(request.prompt)) {
      return request.prompt;
    }

    return null;
  }

  /**
   * Check if a string looks like log content.
   */
  private looksLikeLogContent(text: string): boolean {
    const logIndicators = [
      /\d{4}-\d{2}-\d{2}/,
      /(?:GET|POST|PUT|DELETE|PATCH)\s+(?:https?:\/\/|\/)/i,
      /(?:request|response)/i,
      /(?:status|statusCode)\s*[=:]\s*\d{3}/i
    ];

    let matchCount = 0;
    for (const pattern of logIndicators) {
      if (pattern.test(text)) {matchCount++;}
    }

    return matchCount >= 2;
  }

  /**
   * Show the attachment required message.
   */
  private showAttachmentRequired(stream: vscode.ChatResponseStream): void {
    stream.markdown(`## 📎 Log File Required\n\n`);
    stream.markdown(`To generate integration tests, you must **attach a Splunk or local log file** to this chat.\n\n`);
    stream.markdown(`### How to attach a file:\n\n`);
    stream.markdown(`1. Click the **📎 (Attach)** button in the chat input area\n`);
    stream.markdown(`2. Select your Splunk/local log file\n`);
    stream.markdown(`3. Add your message (e.g., "Generate tests for POST /api/v1/orders")\n`);
    stream.markdown(`4. Press Enter to send\n\n`);
    stream.markdown(`Alternatively, you can use the **#file:** reference to attach a file from your workspace:\n\n`);
    stream.markdown('```\n');
    stream.markdown(`@integrationtest /generate #file:logs/splunk-export.log Generate tests for the orders API\n`);
    stream.markdown('```\n\n');
    stream.markdown(`### Supported Log Formats:\n`);
    stream.markdown(`- JSON structured logs\n`);
    stream.markdown(`- Key-value Splunk logs\n`);
    stream.markdown(`- Standard HTTP request/response logging\n\n`);
    stream.markdown(`Use \`@integrationtest /help\` for more information.\n`);
  }

  /**
   * Extract test generation configuration from the user's prompt.
   */
  private extractConfigFromPrompt(prompt: string): Partial<TestGenerationConfig> {
    const config: Partial<TestGenerationConfig> = {};

    // Extract package name
    const packageMatch = prompt.match(/package\s*[=:]\s*([\w.]+)/i);
    if (packageMatch) {
      config.basePackage = packageMatch[1];
    }

    // Extract WireMock port
    const portMatch = prompt.match(/(?:wiremock|mock)\s*port\s*[=:]\s*(\d+)/i);
    if (portMatch) {
      config.wireMockPort = parseInt(portMatch[1], 10);
    }

    // Extract application class
    const appClassMatch = prompt.match(/(?:application|app)\s*class\s*[=:]\s*(\w+)/i);
    if (appClassMatch) {
      config.applicationClass = appClassMatch[1];
    }

    return config;
  }

  /**
   * Attempt to enhance the generated test suite using the LLM.
   */
  private async enhanceWithLLM(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    testSuite: GeneratedTestSuite,
    parseResult: ParsedLogResult,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<GeneratedTestSuite> {
    try {
      const messages: vscode.LanguageModelChatMessage[] = [];

      // System prompt for enhancement
      messages.push(vscode.LanguageModelChatMessage.User(
        `You are a Spring Boot integration test expert. You have been given auto-generated integration test code ` +
        `based on log file analysis. Your task is to review and suggest improvements to make the tests more robust. ` +
        `Focus on: better assertion strategies, edge case handling, and proper test naming. ` +
        `However, do NOT change the fundamental architecture: there must be exactly ONE @SpringBootTest class ` +
        `that delegates to plain Java classes. This is critical to avoid Jenkins memory issues.`
      ));

      // Provide the generated code context
      const codeContext = `Here is the generated integration test suite:\n\n` +
        `Main test class:\n\`\`\`java\n${testSuite.suiteClass.sourceCode}\n\`\`\`\n\n` +
        `Number of delegation classes: ${testSuite.delegationClasses.length}\n` +
        `API endpoints tested: ${parseResult.apiCallChains.map(c => `${c.mainCall.method} ${c.mainCall.path}`).join(', ')}\n\n` +
        `User request: ${request.prompt}`;

      messages.push(vscode.LanguageModelChatMessage.User(codeContext));

      // Send to LLM for review (non-blocking, best-effort)
      const chatResponse = await request.model.sendRequest(messages, {}, token);

      // Collect LLM suggestions (we don't modify the code, just add comments)
      let suggestions = '';
      for await (const fragment of chatResponse.text) {
        if (token.isCancellationRequested) {break;}
        suggestions += fragment;
      }

      // Store suggestions for rendering later
      if (suggestions.trim().length > 0) {
        (testSuite as GeneratedTestSuite & { llmSuggestions?: string }).llmSuggestions = suggestions;
      }

    } catch {
      // LLM enhancement is optional, don't fail the generation
    }

    return testSuite;
  }

  /**
   * Render the analysis result to the chat stream.
   */
  private renderAnalysisResult(result: ParsedLogResult, stream: vscode.ChatResponseStream): void {
    stream.markdown(`# Log Analysis Results\n\n`);
    stream.markdown(`Found **${result.apiCallChains.length}** API call chain(s)\n\n`);

    for (let i = 0; i < result.apiCallChains.length; i++) {
      const chain = result.apiCallChains[i];
      stream.markdown(`## Chain ${i + 1}: ${chain.mainCall.method} ${chain.mainCall.path}\n\n`);

      stream.markdown(`### Main API Call\n`);
      stream.markdown(`- **Method:** ${chain.mainCall.method}\n`);
      stream.markdown(`- **URL:** ${chain.mainCall.url}\n`);
      stream.markdown(`- **Status:** ${chain.mainCall.responseStatusCode}\n`);

      if (chain.mainCall.requestBody) {
        stream.markdown(`- **Request Body:** \n\`\`\`json\n${this.formatJson(chain.mainCall.requestBody)}\n\`\`\`\n`);
      }
      if (chain.mainCall.responseBody) {
        stream.markdown(`- **Response Body:** \n\`\`\`json\n${this.formatJson(chain.mainCall.responseBody)}\n\`\`\`\n`);
      }

      if (chain.downstreamCalls.length > 0) {
        stream.markdown(`\n### Downstream Calls (${chain.downstreamCalls.length})\n\n`);

        for (let j = 0; j < chain.downstreamCalls.length; j++) {
          const dc = chain.downstreamCalls[j];
          stream.markdown(`#### ${j + 1}. ${dc.method} ${dc.path}\n`);
          stream.markdown(`- **URL:** ${dc.url}\n`);
          stream.markdown(`- **Status:** ${dc.responseStatusCode}\n`);

          if (dc.requestBody) {
            stream.markdown(`- **Request Body:** \n\`\`\`json\n${this.formatJson(dc.requestBody)}\n\`\`\`\n`);
          }
          if (dc.responseBody) {
            stream.markdown(`- **Response Body:** \n\`\`\`json\n${this.formatJson(dc.responseBody)}\n\`\`\`\n`);
          }
        }
      } else {
        stream.markdown(`\n*No downstream calls found for this API.*\n`);
      }
    }

    if (result.warnings.length > 0) {
      stream.markdown(`\n## ⚠️ Warnings\n`);
      for (const warning of result.warnings) {
        stream.markdown(`- ${warning}\n`);
      }
    }

    stream.markdown(`\n---\n`);
    stream.markdown(`\nUse \`@integrationtest /generate\` with the same log file to generate integration tests.\n`);
  }

  /**
   * Render the generated test suite to the chat stream.
   */
  private renderGeneratedTests(
    testSuite: GeneratedTestSuite & { llmSuggestions?: string },
    parseResult: ParsedLogResult,
    stream: vscode.ChatResponseStream
  ): void {
    stream.markdown(`# Generated Integration Tests\n\n`);
    stream.markdown(`Generated **${testSuite.delegationClasses.length + 3}** Java files from `);
    stream.markdown(`**${parseResult.apiCallChains.length}** API call chain(s)\n\n`);

    // Warnings
    if (parseResult.warnings.length > 0) {
      stream.markdown(`## ⚠️ Parsing Warnings\n`);
      for (const warning of parseResult.warnings) {
        stream.markdown(`- ${warning}\n`);
      }
      stream.markdown(`\n`);
    }

    // Architecture explanation
    stream.markdown(`## Architecture\n\n`);
    stream.markdown(`> **Single Spring Boot Test Class Pattern**: Only \`IntegrationTestSuite.java\` has the `);
    stream.markdown(`\`@SpringBootTest\` annotation. All test logic is delegated to plain Java classes to `);
    stream.markdown(`prevent multiple Spring contexts from starting in Jenkins, avoiding memory issues and crashes.\n\n`);

    // Main test suite class
    stream.markdown(`## 1. IntegrationTestSuite.java\n\n`);
    stream.markdown(`*The single @SpringBootTest class that delegates to all test implementations:*\n\n`);
    stream.markdown('```java\n');
    stream.markdown(testSuite.suiteClass.sourceCode);
    stream.markdown('\n```\n\n');

    // WireMock config
    stream.markdown(`## 2. WireMockConfig.java\n\n`);
    stream.markdown('```java\n');
    stream.markdown(testSuite.wireMockConfig.sourceCode);
    stream.markdown('\n```\n\n');

    // Test helper
    stream.markdown(`## 3. TestHelper.java\n\n`);
    stream.markdown('```java\n');
    stream.markdown(testSuite.testHelper.sourceCode);
    stream.markdown('\n```\n\n');

    // Delegation classes
    for (let i = 0; i < testSuite.delegationClasses.length; i++) {
      const dc = testSuite.delegationClasses[i];
      stream.markdown(`## ${i + 4}. ${dc.className}.java\n\n`);
      stream.markdown(`*Tests: ${dc.apiCallChain.mainCall.method} ${dc.apiCallChain.mainCall.path} `);
      stream.markdown(`(${dc.apiCallChain.downstreamCalls.length} downstream mock(s))*\n\n`);
      stream.markdown('```java\n');
      stream.markdown(dc.sourceCode);
      stream.markdown('\n```\n\n');
    }

    // File structure
    stream.markdown(`## Recommended File Structure\n\n`);
    stream.markdown('```\n');
    stream.markdown(`src/test/java/${testSuite.suiteClass.packageName.replace(/\./g, '/')}/\n`);
    stream.markdown(`├── IntegrationTestSuite.java\n`);
    stream.markdown(`├── config/\n`);
    stream.markdown(`│   └── WireMockConfig.java\n`);
    stream.markdown(`├── tests/\n`);
    for (const dc of testSuite.delegationClasses) {
      stream.markdown(`│   ├── ${dc.className}.java\n`);
    }
    stream.markdown(`└── util/\n`);
    stream.markdown(`    └── TestHelper.java\n`);
    stream.markdown('```\n\n');

    // Maven/Gradle dependencies
    stream.markdown(`## Required Dependencies\n\n`);
    stream.markdown(`### Maven\n`);
    stream.markdown('```xml\n');
    stream.markdown(`<dependency>\n`);
    stream.markdown(`    <groupId>org.springframework.boot</groupId>\n`);
    stream.markdown(`    <artifactId>spring-boot-starter-test</artifactId>\n`);
    stream.markdown(`    <scope>test</scope>\n`);
    stream.markdown(`</dependency>\n`);
    stream.markdown(`<dependency>\n`);
    stream.markdown(`    <groupId>org.springframework.cloud</groupId>\n`);
    stream.markdown(`    <artifactId>spring-cloud-contract-wiremock</artifactId>\n`);
    stream.markdown(`    <scope>test</scope>\n`);
    stream.markdown(`</dependency>\n`);
    stream.markdown(`<dependency>\n`);
    stream.markdown(`    <groupId>org.assertj</groupId>\n`);
    stream.markdown(`    <artifactId>assertj-core</artifactId>\n`);
    stream.markdown(`    <scope>test</scope>\n`);
    stream.markdown(`</dependency>\n`);
    stream.markdown('```\n\n');

    stream.markdown(`### Gradle\n`);
    stream.markdown('```groovy\n');
    stream.markdown(`testImplementation 'org.springframework.boot:spring-boot-starter-test'\n`);
    stream.markdown(`testImplementation 'org.springframework.cloud:spring-cloud-contract-wiremock'\n`);
    stream.markdown(`testImplementation 'org.assertj:assertj-core'\n`);
    stream.markdown('```\n\n');

    // LLM suggestions if available
    if (testSuite.llmSuggestions) {
      stream.markdown(`## AI Review Suggestions\n\n`);
      stream.markdown(testSuite.llmSuggestions);
      stream.markdown(`\n\n`);
    }

    // application-test.yml
    stream.markdown(`## Application Test Profile\n\n`);
    stream.markdown(`Create \`src/test/resources/application-test.yml\`:\n\n`);
    stream.markdown('```yaml\n');
    stream.markdown(`# Redirect downstream service calls to WireMock\n`);
    stream.markdown(`downstream:\n`);
    stream.markdown(`  base-url: http://localhost:\${wiremock.server.port}\n`);
    stream.markdown('```\n');
  }

  /**
   * Format a string as pretty JSON if possible.
   */
  private formatJson(str: string): string {
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  }
}
