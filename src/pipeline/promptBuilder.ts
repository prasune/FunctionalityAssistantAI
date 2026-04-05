import { TargetApiType, RoaStandards } from '../types';

/**
 * Builds specialized prompts for each stage of the conversion pipeline.
 * All prompts are designed to be passed to Copilot Chat for execution.
 */
export class PromptBuilder {

    /**
     * Build the initial analysis prompt that scans workspace for endpoints.
     */
    buildAnalysisPrompt(sourceFolder: string, apiName?: string): string {
        const apiFilter = apiName
            ? `\n\n## IMPORTANT: Focus on API "${apiName}"
Filter the analysis to focus on endpoints belonging to the "${apiName}" API. This includes:
- Classes with "${apiName}" in the name or package path
- Endpoints in the same module/package as ${apiName}
- Related services, controllers, and endpoints for this API
- If multiple versions exist (e.g., v1, v2), identify ALL versions and note the version for each endpoint\n`
            : '';

        return `You are an expert Java/Kotlin API analyst. Analyze the source code in the workspace folder "${sourceFolder}" to identify ALL API endpoints.
${apiFilter}
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
8. **IMPORTANT: Multiple SOAP API versions** — the same project may have v1, v2, etc. of the same SOAP API. Identify the version from package names, WSDL namespaces, or class naming conventions. Report each version separately.

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

## CRITICAL: Legacy Response Pattern Detection
Many legacy APIs have non-standard error handling. You MUST identify these patterns:

### Pattern 1: Always HTTP 200 with Embedded Errors
Legacy REST APIs that ALWAYS return HTTP 200, even for errors. The error information is embedded in the response body:
- Look for response wrapper classes with fields like: \`status\`, \`errorCode\`, \`errorMessage\`, \`success\`, \`errors\`, \`resultCode\`
- Look for logic like: \`if (error) { response.setStatus("FAILURE"); response.setErrorCode(...) }\` but still returning 200
- These need to be converted to proper HTTP error responses (400, 404, 500, etc.) with the error fields mapped to a separate error response schema

### Pattern 2: MVC ModelAndView with Embedded Errors
Similar to Pattern 1 but in MVC controllers:
- ModelAndView that adds error attributes: \`modelAndView.addObject("error", ...)\`, \`modelAndView.addObject("errorMessage", ...)\`
- The "success" data and "error" data are mixed in the same ModelAndView
- Error attributes need to be extracted and mapped to proper exception responses

### Pattern 3: SOAP Fault Responses
SOAP endpoints with fault definitions:
- WSDL fault elements
- Custom SOAP fault classes
- SOAPFaultException handling
- These MUST be mapped to proper HTTP exception responses (not embedded in the success response)

For each endpoint, identify which legacy pattern it uses:
- **ALWAYS_200_EMBEDDED_ERROR**: REST API returns 200 with error in body
- **MVC_MODEL_ERROR**: ModelAndView mixes success/error data
- **SOAP_FAULT**: SOAP fault definitions
- **STANDARD**: Normal HTTP error handling

## For Each Endpoint Found, Report:

### Endpoint Details
- **File path** (relative to workspace)
- **Class name** and **method name**
- **API name** (logical API group this endpoint belongs to)
- **API version** (v1, v2, etc. if applicable)
- **Type**: SOAP / REST_MVC / REST_PLAIN
- **Legacy pattern**: ALWAYS_200_EMBEDDED_ERROR / MVC_MODEL_ERROR / SOAP_FAULT / STANDARD
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
- ModelAndView attributes (if MVC) — **list ALL model attributes separately**
- SOAP output message types
- Response wrapper types
- **Separate success fields from error fields** — clearly indicate which fields are part of the success response and which are error indicators

### Error/Fault Objects (CRITICAL for legacy pattern conversion)
- For ALWAYS_200_EMBEDDED_ERROR: List the error fields from the response wrapper (errorCode, errorMessage, status, etc.)
- For MVC_MODEL_ERROR: List the error-related ModelAndView attributes
- For SOAP_FAULT: List the fault elements, fault codes, and fault detail types
- These will be converted to separate exception response schemas in the modern API

### Dependent Objects
Any related types referenced by request/response objects:
- Enums with all values
- Nested DTOs/models
- Shared base classes
- Utility types

## Output Format
Use a clear markdown structure with headers for each endpoint.
List ALL fields — do not summarize or abbreviate.
Group endpoints by API name and version.

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
        userPrompt: string,
        apiName?: string
    ): string {
        const isXApi = targetType === TargetApiType.ROA_REST_XAPI;
        const apiTypeLabel = isXApi ? 'Experience Layer API (xAPI)' : 'Backend API';
        const apiScope = apiName ? ` for the "${apiName}" API` : '';

        return `You are an expert API architect specializing in OpenAPI specifications and ROA (Resource Oriented Architecture) standards.

## Task
Generate a COMPLETE OpenAPI 3.0.3 specification for a ${apiTypeLabel}${apiScope} by converting legacy endpoints found in "${sourceFolder}".

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

## CRITICAL: Legacy Response Pattern Handling
Many legacy APIs have non-standard error handling that MUST be converted properly:

### Always-200 APIs (ALWAYS_200_EMBEDDED_ERROR)
Legacy APIs that always return HTTP 200 with errors embedded in the response body:
- **Split the response**: Extract error fields (errorCode, errorMessage, status, etc.) into SEPARATE error response schemas
- **Map to proper HTTP status codes**: Create 400, 404, 409, 422, 500 responses with the error schema
- **Clean the success response**: The 200 response should ONLY contain the actual success data fields
- Example: If legacy response has {data: {...}, errorCode: "...", errorMessage: "..."}, create:
  - 200 response with just the data fields
  - 400/500 responses with ProblemDetail + errorCode and errorMessage

### MVC ModelAndView Errors (MVC_MODEL_ERROR)
MVC endpoints that mix success and error data in ModelAndView:
- **Separate model attributes**: Extract error-related attributes into error response schemas
- **Map view names to responses**: Success view → 200 response, error view → appropriate error response
- **Extract all attributes**: Every addObject() call in the controller is a field in the response

### SOAP Fault Responses (SOAP_FAULT)
SOAP endpoints with fault definitions:
- **Map SOAP faults to HTTP errors**: Each fault type → appropriate HTTP error response
- **Preserve fault detail**: Fault code, fault string, fault detail → error response schema fields
- **Create exception schemas**: Each distinct SOAP fault type → separate error response schema

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
9. **Separate success response fields from error/fault fields** — they must be in different schemas

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

7. For ALWAYS_200_EMBEDDED_ERROR endpoints: Split the response into success (200) and error schemas
8. For SOAP_FAULT endpoints: Map each fault type to a specific HTTP error response
9. For MVC_MODEL_ERROR endpoints: Separate model attributes into success response and error response schemas

Read the workspace source files to ensure accuracy. Output ONLY valid YAML.`;
    }

    /**
     * Build prompt for GraphQL schema generation.
     */
    buildGraphQLGenerationPrompt(
        sourceFolder: string,
        previousAnalysis: string,
        userPrompt: string,
        apiName?: string
    ): string {
        const apiScope = apiName ? ` for the "${apiName}" API` : '';

        return `You are an expert GraphQL architect.

## Task
Generate a COMPLETE GraphQL schema${apiScope} by converting legacy endpoints found in "${sourceFolder}".

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

## Legacy Pattern Handling in GraphQL

### Always-200 APIs → GraphQL
- Do NOT replicate the embedded error pattern
- Success fields → return type
- Error fields → GraphQL errors with extensions containing errorCode, errorMessage
- Use union types if the response has distinct success/error shapes

### MVC ModelAndView → GraphQL
- Model success attributes → return type fields
- Model error attributes → GraphQL errors
- Each distinct ModelAndView composition → separate return type

### SOAP Faults → GraphQL
- Fault types → GraphQL error extensions
- Fault codes → error extension codes
- Do NOT include fault fields in the return type

## Conversion Rules
### SOAP → GraphQL
- Read operations → Queries
- Write operations → Mutations
- Complex types → Object types
- WSDL input messages → Input types
- WSDL output messages → Return types
- SOAP faults → GraphQL errors (NOT in return types)

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
- /generate-openapi — Generate Backend API OpenAPI spec
- /generate-openapi-xapi — Generate Experience Layer (xAPI) OpenAPI spec
- /generate-graphql — Generate GraphQL schema
- /configure-roa — Set company ROA standards
- /generate-code — Generate implementation code
- /convert <ApiName> — Full conversion pipeline for a specific API

## Previous Context
${previousContext || 'No previous context.'}

## User Query
${userQuery}

Respond helpfully based on your capabilities. If the user is asking something you can help with, provide specific guidance and suggest relevant commands.`;
    }
}
