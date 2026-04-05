import { TargetApiType, RoaStandards } from '../types';

/**
 * Builds specialized prompts for each stage of the conversion pipeline.
 * All prompts are designed to be passed to Copilot Chat for execution.
 */
export class PromptBuilder {

    /**
     * Build the initial analysis prompt that scans workspace for endpoints.
     */
    buildAnalysisPrompt(sourceFolder: string): string {
        return `You are an expert Java/Kotlin API analyst. Analyze the source code in the workspace folder "${sourceFolder}" to identify ALL API endpoints.

## Your Task
Scan every class in the codebase and identify whether it is a SOAP endpoint, REST MVC endpoint, plain REST endpoint, or not an endpoint.

## IMPORTANT Detection Rules

### SOAP Endpoint Detection
SOAP endpoints may NOT have obvious annotations. Look for:
1. Classes that extend abstract classes with @WebService, @WebServiceProvider annotations
2. Classes implementing interfaces from javax.jws or javax.xml.ws packages
3. Classes with associated .wsdl files in the project
4. Classes using SOAPMessage, SOAPEnvelope, SOAPBody types
5. Classes extending SpringBeanAutowiringSupport or similar WS base classes
6. Custom framework annotations that wrap SOAP functionality
7. Any class that processes XML-based request/response through SOAP protocol

### REST MVC Endpoint Detection
Look for:
1. Controllers returning ModelAndView or ModelMap
2. Classes with @Controller (without @ResponseBody at class level)
3. Classes extending Spring MVC base controllers (MultiActionController, AbstractController, SimpleFormController)
4. Methods that populate Model objects and return view names

### Plain REST Endpoint Detection
Look for:
1. @RestController annotated classes
2. @Controller + @ResponseBody classes
3. JAX-RS annotations (@Path, @GET, @POST, etc.)
4. Methods returning ResponseEntity, @ResponseBody annotated methods

## For Each Endpoint Found, Report:

### Endpoint Details
- **File path** (relative to workspace)
- **Class name** and **method name**
- **Type**: SOAP / REST_MVC / REST_PLAIN
- **HTTP method** and **URL path** (if REST)
- **Associated WSDL/XSD** (if SOAP)
- **All annotations** on the class and method
- **Parent classes and interfaces** (full hierarchy)

### Request Objects (CRITICAL - be thorough)
For EVERY request parameter, request body, and SOAP input:
- Object class name and file path
- EVERY field with:
  - Field name
  - Java type (including generics like List<String>)
  - Validation annotations (@NotNull, @Size, @Pattern, etc.)
  - Whether it's required or optional
  - Default value if any
- Nested object types — recursively list their fields too
- Inherited fields from parent classes
- Fields from implemented interfaces

### Response Objects (CRITICAL - be thorough)
Same level of detail as request objects for:
- Return type of the method
- ModelAndView attributes (if MVC)
- SOAP output message types
- Response wrapper types

### Dependent Objects
Any related types referenced by request/response objects:
- Enums with all values
- Nested DTOs/models
- Shared base classes
- Utility types

## Output Format
Use a clear markdown structure with headers for each endpoint.
List ALL fields — do not summarize or abbreviate.

START ANALYSIS NOW by reading the workspace files.`;
    }

    /**
     * Build prompt for OpenAPI spec generation with ROA standards.
     */
    buildOpenApiGenerationPrompt(
        sourceFolder: string,
        targetType: TargetApiType,
        roaStandards: RoaStandards,
        previousAnalysis: string,
        userPrompt: string
    ): string {
        const isXApi = targetType === TargetApiType.ROA_REST_XAPI;
        const apiTypeLabel = isXApi ? 'Experience Layer API (xAPI)' : 'Backend API';

        return `You are an expert API architect specializing in OpenAPI specifications and ROA (Resource Oriented Architecture) standards.

## Task
Generate a COMPLETE OpenAPI 3.0.3 specification for a ${apiTypeLabel} by converting legacy endpoints found in "${sourceFolder}".

## Previous Analysis Results
${previousAnalysis || 'No previous analysis available. You must analyze the source code directly.'}

## User Instructions
${userPrompt || 'Generate the spec based on all detected endpoints.'}

## ROA Standards Configuration
### Naming Conventions
- Resource naming: ${roaStandards.naming.resourceNaming}
- URL path style: ${roaStandards.naming.urlPathStyle}
- Field case style: ${roaStandards.naming.caseStyle}
- Max URL depth: ${roaStandards.naming.maxDepth}

### Pagination
- Style: ${roaStandards.pagination.style}
- Default page size: ${roaStandards.pagination.defaultPageSize}
- Max page size: ${roaStandards.pagination.maxPageSize}

### Error Handling
- Format: ${roaStandards.errorHandling.format}
- Include trace ID: ${roaStandards.errorHandling.includeTraceId}

### Versioning
- Strategy: ${roaStandards.versioning.strategy}
- Current version: ${roaStandards.versioning.currentVersion}

${roaStandards.customRules.length > 0 ? '### Custom Company Rules\n' + roaStandards.customRules.map(r => `- ${r}`).join('\n') : ''}

${isXApi ? `## xAPI (Experience Layer) Requirements
### Required xAPI Headers
${Object.entries(roaStandards.headers.xApiHeaders).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

### Session Handling Headers
${roaStandards.headers.sessionHeaders ? Object.entries(roaStandards.headers.sessionHeaders).map(([k, v]) => `- ${k}: ${v}`).join('\n') : '- X-Session-ID: Session identifier\n- X-Correlation-ID: Request correlation ID'}

### xAPI Design Principles
1. Responses optimized for consumer applications
2. May aggregate multiple backend API calls
3. BFF (Backend for Frontend) patterns where beneficial
4. Include rate limiting response headers
5. CORS configuration included
6. Session state management support` : `## Backend API Requirements
### Required Headers
${Object.entries(roaStandards.headers.standard).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

### API Design Principles
1. Strict RESTful resource modeling
2. Proper HTTP status codes (201 created, 204 no content, etc.)
3. HATEOAS links where appropriate
4. ETag support for caching
5. Content negotiation via Accept header`}

## CRITICAL: Request/Response Accuracy
The #1 requirement is ACCURACY of all request and response objects:
1. Include EVERY field from every request/response object
2. Map Java types precisely to OpenAPI types
3. Preserve all validation constraints
4. Include nested objects as separate component schemas
5. Include inherited fields from parent classes
6. Capture collection types with correct item schemas
7. Include all enums with their values
8. Do NOT skip or summarize any fields

## Type Mapping (Java → OpenAPI)
- String → string
- Integer/int → integer (int32)
- Long/long → integer (int64)
- Double/double → number (double)
- Float/float → number (float)
- Boolean/boolean → boolean
- BigDecimal → string (decimal) or number
- Date/LocalDate → string (date)
- LocalDateTime/Instant → string (date-time)
- UUID → string (uuid)
- List<T>/Set<T> → array
- Map<K,V> → object with additionalProperties
- Enum → string with enum values

## Output
Generate a COMPLETE OpenAPI 3.0.3 YAML spec. Include:
1. info section
2. servers
3. ALL paths with full operation details
4. ALL component schemas (every request, response, dependent object)
5. Security schemes
6. Common error responses (400, 401, 403, 404, 500) using ${roaStandards.errorHandling.format} format

Read the workspace source files to ensure accuracy. Output ONLY valid YAML.`;
    }

    /**
     * Build prompt for GraphQL schema generation.
     */
    buildGraphQLGenerationPrompt(
        sourceFolder: string,
        previousAnalysis: string,
        userPrompt: string
    ): string {
        return `You are an expert GraphQL architect.

## Task
Generate a COMPLETE GraphQL schema by converting legacy endpoints found in "${sourceFolder}".

## Previous Analysis Results
${previousAnalysis || 'No previous analysis available. Analyze the source code directly.'}

## User Instructions
${userPrompt || 'Generate the schema based on all detected endpoints.'}

## CRITICAL: Request/Response Accuracy
1. Include EVERY field from source objects
2. Create proper GraphQL types for all response objects
3. Create separate input types for all request objects
4. Include all nested types recursively
5. Map enums correctly
6. Include field descriptions
7. Use proper nullability (! for required fields)

## Type Mapping (Java → GraphQL)
- String → String
- Integer/int → Int
- Long/long → Int or custom Long scalar
- Double/Float → Float
- Boolean → Boolean
- BigDecimal → Float or custom BigDecimal scalar
- Date/LocalDate → custom Date scalar
- DateTime/Instant → custom DateTime scalar
- UUID → ID
- List<T> → [T]
- Set<T> → [T]
- Map → JSON scalar or custom type
- Enum → GraphQL enum

## Conversion Rules
### SOAP → GraphQL
- Read operations → Queries
- Write operations → Mutations
- Complex types → Object types
- WSDL input messages → Input types
- WSDL output messages → Return types
- SOAP faults → GraphQL errors

### REST → GraphQL
- GET → Queries
- POST/PUT/PATCH → Mutations
- DELETE → Mutations (return Boolean or payload)
- Path params → Arguments
- Request body → Input type
- List endpoints → Connection types (Relay spec)

## Best Practices
1. Relay-style pagination (Connection, Edge, PageInfo)
2. Separate input types for mutations
3. Meaningful descriptions on all types/fields
4. Custom scalars for Date, DateTime, BigDecimal, Long
5. Union types for polymorphic responses
6. Interfaces for shared field patterns

## Output
Generate COMPLETE GraphQL SDL. Read workspace files for accuracy. Output ONLY valid GraphQL SDL.`;
    }

    /**
     * Build prompt for code generation from OpenAPI spec.
     */
    buildCodeGenerationPrompt(
        previousContext: string,
        userPrompt: string
    ): string {
        return `You are an expert code generator. Generate implementation code from the OpenAPI specification or GraphQL schema created in the previous steps.

## Previous Context (contains the generated spec/schema)
${previousContext}

## User Instructions
${userPrompt || 'Generate Spring Boot implementation code.'}

## Code Generation Requirements
1. Generate Spring Boot controller/service/repository layers
2. Use proper annotations (@RestController, @Service, @Repository)
3. Include DTO classes matching the OpenAPI schemas exactly
4. Include mapper classes for DTO conversions
5. Include exception handling with proper error responses
6. Include validation annotations on DTOs
7. Generate OpenAPI Generator configuration (openapi-generator-cli)

## OpenAPI Generator Setup
Include instructions for using OpenAPI Generator CLI:
\`\`\`bash
# Install OpenAPI Generator
npm install @openapitools/openapi-generator-cli -g

# Generate Spring Boot server stub
openapi-generator-cli generate \\
  -i openapi-spec.yaml \\
  -g spring \\
  -o ./generated \\
  --additional-properties=useSpringBoot3=true,useTags=true,interfaceOnly=false

# Generate client SDK
openapi-generator-cli generate \\
  -i openapi-spec.yaml \\
  -g java \\
  -o ./generated-client \\
  --additional-properties=library=webclient,useJakartaEe=true
\`\`\`

## Output
Generate the implementation code with clear file structure indicators.
Include the OpenAPI Generator commands and configuration.`;
    }

    /**
     * Build a freeform query prompt with App Modernizer context.
     */
    buildFreeformPrompt(userQuery: string, previousContext: string): string {
        return `You are App Modernizer, a GitHub Copilot extension that helps convert legacy SOAP and REST APIs to modern API standards.

## Your Capabilities
- Analyze Java/Kotlin codebases to detect SOAP and REST endpoints
- Generate OpenAPI 3.0 specs with ROA (Resource Oriented Architecture) standards
- Generate GraphQL schemas
- Support both Backend API and xAPI (Experience Layer) patterns
- Capture all request/response objects with complete field details
- Apply company-specific ROA standards
- Generate implementation code using OpenAPI Generator

## Available Commands
- /analyze — Detect endpoints in workspace
- /generate-openapi — Generate OpenAPI spec (add "xapi" for experience layer)
- /generate-graphql — Generate GraphQL schema
- /configure-roa — Set company ROA standards
- /generate-code — Generate implementation code
- /convert — Full conversion pipeline

## Previous Context
${previousContext || 'No previous context.'}

## User Query
${userQuery}

Respond helpfully based on your capabilities. If the user is asking something you can help with, provide specific guidance and suggest relevant commands.`;
    }
}
