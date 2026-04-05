import { ApiCallChain, GeneratedTestSuite, GeneratedDelegationClass, TestGenerationConfig, DEFAULT_CONFIG } from './types';
import { WireMockGenerator } from './wiremockGenerator';

/**
 * Generates Spring Boot integration test code with a single @SpringBootTest class
 * that delegates to plain Java test classes. This avoids starting multiple Spring
 * contexts in Jenkins pipeline, preventing memory issues and crashes.
 */
export class TestGenerator {
  private wireMockGenerator: WireMockGenerator;
  private config: TestGenerationConfig;

  constructor(config: Partial<TestGenerationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.wireMockGenerator = new WireMockGenerator();
  }

  /**
   * Generate the complete test suite from parsed API call chains.
   */
  generate(apiCallChains: ApiCallChain[]): GeneratedTestSuite {
    const delegationClasses = apiCallChains.map(chain =>
      this.generateDelegationClass(chain)
    );

    return {
      suiteClass: this.generateSuiteClass(delegationClasses),
      wireMockConfig: this.generateWireMockConfig(),
      testHelper: this.generateTestHelper(),
      delegationClasses
    };
  }

  /**
   * Generate the single @SpringBootTest integration test suite class.
   * This class starts the Spring context once and delegates to plain Java classes.
   */
  private generateSuiteClass(delegationClasses: GeneratedDelegationClass[]): { className: string; packageName: string; sourceCode: string } {
    const className = 'IntegrationTestSuite';
    const packageName = this.config.basePackage;
    const testPkg = `${packageName}.tests`;

    const delegateFields: string[] = [];
    const delegateInits: string[] = [];
    const testMethods: string[] = [];

    for (const dc of delegationClasses) {
      const fieldName = dc.className.charAt(0).toLowerCase() + dc.className.slice(1);
      delegateFields.push(`    private ${dc.className} ${fieldName};`);
      delegateInits.push(`        ${fieldName} = new ${dc.className}(restTemplate, port);`);

      // Generate a test method for each API call chain
      const testMethodName = dc.apiCallChain.testName;
      testMethods.push(`
    @Test
    @DisplayName("${dc.apiCallChain.mainCall.method} ${dc.apiCallChain.mainCall.path}")
    void ${testMethodName}() {
        ${fieldName}.execute();
    }`);
    }

    const sourceCode = `package ${packageName};

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.cloud.contract.wiremock.AutoConfigureWireMock;
import org.springframework.test.context.ActiveProfiles;

${delegationClasses.map(dc => `import ${testPkg}.${dc.className};`).join('\n')}

/**
 * Single Spring Boot integration test suite.
 * 
 * IMPORTANT: This is the ONLY @SpringBootTest class in the project.
 * All test logic is delegated to plain Java classes to avoid starting
 * multiple Spring contexts in the CI/CD pipeline, which would cause
 * memory issues and crashes.
 * 
 * Each delegate class handles its own WireMock stub setup, API invocation,
 * and response assertions.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWireMock(port = ${this.config.wireMockPort})
@ActiveProfiles("test")
class ${className} {

    @Autowired
    private TestRestTemplate restTemplate;

    @LocalServerPort
    private int port;

${delegateFields.join('\n')}

    @BeforeEach
    void setUp() {
${delegateInits.join('\n')}
    }
${testMethods.join('\n')}
}
`;

    return { className, packageName, sourceCode };
  }

  /**
   * Generate a delegation test class (plain Java, no Spring annotations).
   */
  private generateDelegationClass(chain: ApiCallChain): GeneratedDelegationClass {
    const className = this.deriveClassName(chain);
    const packageName = `${this.config.basePackage}.tests`;

    const stubs = this.wireMockGenerator.generateStubs(chain.downstreamCalls);
    const wireMockImports = this.wireMockGenerator.generateImports();
    const stubMethods = stubs.map(s => s.javaCode).join('\n\n');
    const setupMethod = this.wireMockGenerator.generateCombinedSetupMethod(stubs);

    const executeMethod = this.generateExecuteMethod(chain);
    const assertionMethods = this.generateAssertionMethods(chain);

    const sourceCode = `package ${packageName};

import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

${wireMockImports.join('\n')}

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Delegation test class for: ${chain.mainCall.method} ${chain.mainCall.path}
 * 
 * This is a plain Java class (not a Spring test) that handles:
 * 1. Setting up WireMock stubs for ${chain.downstreamCalls.length} downstream call(s)
 * 2. Making the API call to the main endpoint
 * 3. Comprehensive response assertions
 */
public class ${className} {

    private final TestRestTemplate restTemplate;
    private final int port;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ${className}(TestRestTemplate restTemplate, int port) {
        this.restTemplate = restTemplate;
        this.port = port;
    }

    /**
     * Execute the integration test:
     * 1. Reset WireMock state
     * 2. Set up downstream mocks
     * 3. Call the API endpoint
     * 4. Assert the response
     */
    public void execute() {
        // Reset any previous WireMock state
        resetAllRequests();

        // Set up WireMock stubs for downstream calls
        setupWireMockStubs();

        // Execute the API call and assert the response
        executeAndAssert();
    }

${setupMethod}

${stubMethods}

${executeMethod}

${assertionMethods}
}
`;

    return { className, packageName, sourceCode, apiCallChain: chain };
  }

  /**
   * Generate the execute method that calls the main API endpoint and asserts the response.
   */
  private generateExecuteMethod(chain: ApiCallChain): string {
    const call = chain.mainCall;
    const lines: string[] = [];

    lines.push(`    private void executeAndAssert() {`);

    // Build request headers
    lines.push(`        HttpHeaders headers = new HttpHeaders();`);

    const relevantHeaders = call.requestHeaders.filter(h =>
      !['host', 'connection', 'content-length', 'user-agent', 'accept-encoding']
        .includes(h.name.toLowerCase())
    );

    if (relevantHeaders.length > 0) {
      for (const header of relevantHeaders) {
        lines.push(`        headers.set("${this.escapeJava(header.name)}", "${this.escapeJava(header.value)}");`);
      }
    }

    // Set content type for request body methods
    if (call.requestBody && ['POST', 'PUT', 'PATCH'].includes(call.method)) {
      const hasContentType = relevantHeaders.some(h => h.name.toLowerCase() === 'content-type');
      if (!hasContentType) {
        lines.push(`        headers.setContentType(MediaType.APPLICATION_JSON);`);
      }
    }

    // Build request entity
    if (call.requestBody) {
      lines.push('');
      lines.push(`        String requestBody = ${this.formatJavaString(call.requestBody)};`);
      lines.push(`        HttpEntity<String> requestEntity = new HttpEntity<>(requestBody, headers);`);
    } else {
      lines.push(`        HttpEntity<String> requestEntity = new HttpEntity<>(headers);`);
    }

    // Make the API call
    lines.push('');
    lines.push(`        ResponseEntity<String> response = restTemplate.exchange(`);
    lines.push(`            "${this.escapeJava(call.path)}",`);
    lines.push(`            HttpMethod.${call.method},`);
    lines.push(`            requestEntity,`);
    lines.push(`            String.class`);
    lines.push(`        );`);
    lines.push('');

    // Assert status code
    lines.push(`        // Assert HTTP status code`);
    lines.push(`        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.valueOf(${call.responseStatusCode}));`);

    // Assert response body
    if (call.responseBody) {
      lines.push('');
      lines.push(`        // Assert response body is not empty`);
      lines.push(`        assertThat(response.getBody()).isNotNull();`);
      lines.push(`        assertThat(response.getBody()).isNotEmpty();`);
      lines.push('');
      lines.push(`        // Comprehensive response body assertions`);
      lines.push(`        assertResponseBody(response.getBody());`);
    }

    lines.push(`    }`);
    return lines.join('\n');
  }

  /**
   * Generate comprehensive assertion methods for the response body.
   */
  private generateAssertionMethods(chain: ApiCallChain): string {
    const call = chain.mainCall;
    const lines: string[] = [];

    if (!call.responseBody) {
      return '';
    }

    lines.push(`    private void assertResponseBody(String responseBody) {`);
    lines.push(`        try {`);
    lines.push(`            JsonNode responseJson = objectMapper.readTree(responseBody);`);

    // Parse the expected response to generate field-level assertions
    try {
      const expectedResponse = JSON.parse(call.responseBody);
      this.generateJsonAssertions(expectedResponse, 'responseJson', '            ', lines);
    } catch {
      // If not valid JSON, do a string comparison
      lines.push(`            // Full response body assertion`);
      lines.push(`            String expectedBody = ${this.formatJavaString(call.responseBody)};`);
      lines.push(`            assertThat(responseBody).isEqualTo(expectedBody);`);
    }

    lines.push(`        } catch (Exception e) {`);
    lines.push(`            throw new RuntimeException("Failed to parse response body as JSON", e);`);
    lines.push(`        }`);
    lines.push(`    }`);

    return lines.join('\n');
  }

  /**
   * Recursively generate assertions for JSON fields.
   */
  private generateJsonAssertions(obj: unknown, accessor: string, indent: string, lines: string[]): void {
    if (obj === null || obj === undefined) {
      lines.push(`${indent}assertThat(${accessor}.isNull()).isTrue();`);
      return;
    }

    if (typeof obj === 'string') {
      lines.push(`${indent}assertThat(${accessor}.asText()).isEqualTo("${this.escapeJava(obj)}");`);
      return;
    }

    if (typeof obj === 'number') {
      if (Number.isInteger(obj)) {
        lines.push(`${indent}assertThat(${accessor}.asInt()).isEqualTo(${obj});`);
      } else {
        lines.push(`${indent}assertThat(${accessor}.asDouble()).isEqualTo(${obj});`);
      }
      return;
    }

    if (typeof obj === 'boolean') {
      lines.push(`${indent}assertThat(${accessor}.asBoolean()).isEqualTo(${obj});`);
      return;
    }

    if (Array.isArray(obj)) {
      lines.push(`${indent}assertThat(${accessor}.isArray()).isTrue();`);
      lines.push(`${indent}assertThat(${accessor}.size()).isEqualTo(${obj.length});`);

      // Assert first few elements for arrays
      const maxElements = Math.min(obj.length, 3);
      for (let i = 0; i < maxElements; i++) {
        this.generateJsonAssertions(obj[i], `${accessor}.get(${i})`, indent, lines);
      }
      return;
    }

    if (typeof obj === 'object') {
      const entries = Object.entries(obj as Record<string, unknown>);
      lines.push(`${indent}assertThat(${accessor}.isObject()).isTrue();`);

      for (const [key, value] of entries) {
        const fieldAccessor = `${accessor}.get("${this.escapeJava(key)}")`;
        lines.push(`${indent}// Assert field: ${key}`);
        lines.push(`${indent}assertThat(${fieldAccessor}).isNotNull();`);
        this.generateJsonAssertions(value, fieldAccessor, indent, lines);
      }
    }
  }

  /**
   * Generate the WireMock configuration class.
   * 
   * Note: The actual WireMock server lifecycle is managed by @AutoConfigureWireMock
   * on the IntegrationTestSuite class. This config class provides additional
   * test properties for redirecting downstream URLs to the WireMock server.
   */
  private generateWireMockConfig(): { className: string; packageName: string; sourceCode: string } {
    const className = 'WireMockConfig';
    const packageName = `${this.config.basePackage}.config`;

    const sourceCode = `package ${packageName};

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.web.client.RestTemplate;

/**
 * WireMock test configuration for integration tests.
 * 
 * The WireMock server lifecycle is managed automatically by
 * {@code @AutoConfigureWireMock} on the IntegrationTestSuite class.
 * This configuration provides helper beans for tests that need
 * programmatic access to the WireMock port or downstream base URL.
 */
@TestConfiguration
public class ${className} {

    @Value("\${wiremock.server.port}")
    private int wireMockPort;

    /**
     * Returns the base URL of the WireMock server.
     * Useful for delegation classes that need to construct full downstream URLs.
     */
    public String getWireMockBaseUrl() {
        return "http://localhost:" + wireMockPort;
    }
}
`;

    return { className, packageName, sourceCode };
  }

  /**
   * Generate the test helper utility class.
   */
  private generateTestHelper(): { className: string; packageName: string; sourceCode: string } {
    const className = 'TestHelper';
    const packageName = `${this.config.basePackage}.util`;

    const sourceCode = `package ${packageName};

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Shared test utilities for integration tests.
 */
public class ${className} {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    /**
     * Create default JSON request headers.
     */
    public static HttpHeaders createJsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Accept", MediaType.APPLICATION_JSON_VALUE);
        return headers;
    }

    /**
     * Parse a JSON string into a JsonNode.
     */
    public static JsonNode parseJson(String json) {
        try {
            return OBJECT_MAPPER.readTree(json);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to parse JSON: " + json, e);
        }
    }

    /**
     * Pretty print a JSON string for debugging.
     */
    public static String prettyPrint(String json) {
        try {
            Object parsed = OBJECT_MAPPER.readValue(json, Object.class);
            return OBJECT_MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(parsed);
        } catch (JsonProcessingException e) {
            return json;
        }
    }

    /**
     * Compare two JSON strings for equality (ignoring formatting).
     */
    public static boolean jsonEquals(String json1, String json2) {
        try {
            JsonNode node1 = OBJECT_MAPPER.readTree(json1);
            JsonNode node2 = OBJECT_MAPPER.readTree(json2);
            return node1.equals(node2);
        } catch (JsonProcessingException e) {
            return false;
        }
    }

    /**
     * Extract a field value from a JSON string.
     */
    public static String extractField(String json, String fieldPath) {
        try {
            JsonNode node = OBJECT_MAPPER.readTree(json);
            String[] parts = fieldPath.split("\\\\.");
            for (String part : parts) {
                if (node == null) {
                    return null;
                }
                node = node.get(part);
            }
            return node != null ? node.asText() : null;
        } catch (JsonProcessingException e) {
            return null;
        }
    }
}
`;

    return { className, packageName, sourceCode };
  }

  /**
   * Derive a class name from the API call chain.
   */
  private deriveClassName(chain: ApiCallChain): string {
    const path = chain.mainCall.path || chain.mainCall.url;
    const segments = path.split('/').filter(s =>
      s.length > 0 &&
      !s.startsWith('{') &&
      !s.startsWith(':') &&
      !s.match(/^\d+$/) &&
      !['api', 'v1', 'v2', 'v3'].includes(s.toLowerCase())
    );

    const nameParts = segments.map(s => {
      const clean = s.replace(/[-_]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '');
      return clean.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
    });

    const method = chain.mainCall.method.charAt(0).toUpperCase() +
                   chain.mainCall.method.slice(1).toLowerCase();

    const name = nameParts.length > 0
      ? `${method}${nameParts.join('')}Test`
      : `${method}EndpointTest`;

    return name;
  }

  /**
   * Escape a string for use in a Java string literal.
   */
  private escapeJava(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Format a string for use as a Java string literal, handling multi-line strings.
   */
  private formatJavaString(str: string): string {
    try {
      const parsed = JSON.parse(str);
      const pretty = JSON.stringify(parsed, null, 2);
      const lines = pretty.split('\n');

      if (lines.length <= 1) {
        return `"${this.escapeJava(pretty)}"`;
      }

      const javaLines = lines.map((line, i) => {
        const escaped = this.escapeJava(line);
        if (i === 0) {
          return `"${escaped}\\n"`;
        } else if (i === lines.length - 1) {
          return `            + "${escaped}"`;
        } else {
          return `            + "${escaped}\\n"`;
        }
      });

      return javaLines.join('\n');
    } catch {
      return `"${this.escapeJava(str)}"`;
    }
  }
}
