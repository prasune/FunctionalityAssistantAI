/**
 * Represents an HTTP header key-value pair.
 */
export interface HttpHeader {
  name: string;
  value: string;
}

/**
 * Represents a parsed HTTP call extracted from a log file.
 * This can be either the main API call or a downstream service call.
 */
export interface HttpCall {
  /** HTTP method (GET, POST, PUT, DELETE, PATCH, etc.) */
  method: string;
  /** Full URL of the HTTP call */
  url: string;
  /** URL path component */
  path: string;
  /** Request headers */
  requestHeaders: HttpHeader[];
  /** Request body (typically JSON) */
  requestBody: string | null;
  /** Response status code */
  responseStatusCode: number;
  /** Response headers */
  responseHeaders: HttpHeader[];
  /** Response body (typically JSON) */
  responseBody: string | null;
  /** Correlation/trace ID linking this call to others */
  traceId: string | null;
  /** Timestamp of the call */
  timestamp: string | null;
  /** Duration in milliseconds */
  durationMs: number | null;
}

/**
 * Represents the main API call with its downstream dependencies.
 */
export interface ApiCallChain {
  /** The main API endpoint that was called */
  mainCall: HttpCall;
  /** All downstream calls made during processing of the main API call */
  downstreamCalls: HttpCall[];
  /** A descriptive name derived from the API URL */
  testName: string;
}

/**
 * Result of parsing a log file.
 */
export interface ParsedLogResult {
  /** All API call chains found in the log file */
  apiCallChains: ApiCallChain[];
  /** Any warnings or notes from parsing */
  warnings: string[];
  /** The raw log content that was parsed */
  rawLogContent: string;
}

/**
 * Represents a WireMock stub mapping.
 */
export interface WireMockStub {
  /** Name/description of the stub */
  name: string;
  /** The downstream call this stub mocks */
  downstreamCall: HttpCall;
  /** Generated Java code for the stub setup */
  javaCode: string;
}

/**
 * Represents a generated delegation test class.
 */
export interface GeneratedDelegationClass {
  /** Class name (e.g., GetUsersApiTest) */
  className: string;
  /** Package name */
  packageName: string;
  /** Full Java source code */
  sourceCode: string;
  /** The API call chain this class tests */
  apiCallChain: ApiCallChain;
}

/**
 * Represents the complete set of generated test files.
 */
export interface GeneratedTestSuite {
  /** The single SpringBoot integration test class */
  suiteClass: {
    className: string;
    packageName: string;
    sourceCode: string;
  };
  /** WireMock configuration class */
  wireMockConfig: {
    className: string;
    packageName: string;
    sourceCode: string;
  };
  /** Test helper utility class */
  testHelper: {
    className: string;
    packageName: string;
    sourceCode: string;
  };
  /** Individual delegation test classes */
  delegationClasses: GeneratedDelegationClass[];
}

/**
 * Configuration for test generation.
 */
export interface TestGenerationConfig {
  /** Base package name for generated tests */
  basePackage: string;
  /** Spring Boot application class name */
  applicationClass: string;
  /** WireMock server port */
  wireMockPort: number;
  /** Application server port for tests */
  serverPort: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: TestGenerationConfig = {
  basePackage: 'com.example.integration',
  applicationClass: 'Application',
  wireMockPort: 8089,
  serverPort: 8080
};
