# Spring Boot Integration Test Generator

A **GitHub Copilot Chat extension** that generates Spring Boot integration tests with **WireMock** virtualization from Splunk/local log files.

## Features

- **Log File Parsing**: Parses Splunk or local log files to extract API calls and their downstream dependencies
- **WireMock Stub Generation**: Automatically generates WireMock stubs for all downstream service calls
- **Single SpringBoot Test Class**: Generates only ONE `@SpringBootTest` class to avoid Jenkins memory issues and crashes
- **Delegation Pattern**: Test logic is delegated to plain Java classes, keeping the Spring context startup to a single instance
- **Comprehensive Assertions**: Generates detailed response assertions including status codes, headers, and JSON body field-level checks
- **Multiple Log Formats**: Supports JSON structured logs, key-value Splunk logs, and standard HTTP request/response logging

## How It Works

1. **Attach a log file** to the Copilot Chat using the attach button or `#file:` reference
2. **Invoke the participant** with `@integrationtest /generate`
3. The extension parses the log file to extract:
   - The main API endpoint call (URL, method, request/response)
   - All downstream service calls with their request/response data
4. **Generates integration test code** including:
   - `IntegrationTestSuite.java` - Single `@SpringBootTest` class
   - Delegation test classes - Plain Java classes with WireMock stubs and assertions
   - `WireMockConfig.java` - WireMock server configuration
   - `TestHelper.java` - Shared test utilities

## Commands

| Command | Description |
|---------|-------------|
| `@integrationtest /generate` | Generate integration tests from an attached log file |
| `@integrationtest /analyze` | Analyze a log file and show extracted API calls |
| `@integrationtest /help` | Show usage instructions and supported log formats |

## Generated Code Architecture

```
src/test/java/com/example/integration/
├── IntegrationTestSuite.java          # Single @SpringBootTest class
├── config/
│   └── WireMockConfig.java            # WireMock configuration
├── tests/
│   ├── GetUsersApiTest.java           # Plain Java delegation class
│   └── PostOrdersApiTest.java         # Plain Java delegation class
└── util/
    └── TestHelper.java                # Shared test utilities
```

### Why a Single @SpringBootTest Class?

Running multiple `@SpringBootTest` classes in a Jenkins CI/CD pipeline causes each test class to start a separate Spring application context. This leads to:
- **Memory exhaustion** as multiple JVMs/contexts consume heap space
- **Pipeline crashes** due to out-of-memory errors
- **Slow test execution** from redundant context startups

This extension solves this by generating a single `@SpringBootTest` class (`IntegrationTestSuite`) that delegates all test execution to plain Java classes. The plain Java classes handle WireMock setup, API invocation, and assertions without requiring their own Spring context.

## Supported Log Formats

### JSON Structured Logs
```json
{"timestamp":"2024-01-15T10:30:00Z","method":"POST","url":"http://api.example.com/orders","statusCode":200,"requestBody":{"item":"widget"},"responseBody":{"orderId":"123"}}
```

### Key-Value Splunk Logs
```
timestamp=2024-01-15T10:30:00Z method=POST url=http://api.example.com/orders status=200 direction=request body={"item":"widget"}
```

### Standard HTTP Logging
```
Sending request: POST http://api.example.com/orders
Request Body: {"item":"widget"}
Response: 200 OK
Response Body: {"orderId":"123"}
```

## Requirements

- Visual Studio Code 1.93+
- GitHub Copilot Chat extension

## Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 in VS Code to launch the extension in debug mode

## Development

```bash
# Install dependencies
npm install

# Build the extension
npm run compile

# Watch for changes
npm run watch

# Run lint
npm run lint
```

## Required Test Dependencies

Add these dependencies to your Spring Boot project:

### Maven
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-contract-wiremock</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.assertj</groupId>
    <artifactId>assertj-core</artifactId>
    <scope>test</scope>
</dependency>
```

### Gradle
```groovy
testImplementation 'org.springframework.boot:spring-boot-starter-test'
testImplementation 'org.springframework.cloud:spring-cloud-contract-wiremock'
testImplementation 'org.assertj:assertj-core'
```
