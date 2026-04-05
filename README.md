# App Modernizer — GitHub Copilot Extension

A GitHub Copilot Chat extension that converts legacy SOAP and REST APIs into modern OpenAPI specifications, GraphQL schemas, and ROA-standard APIs.

## Features

- **Endpoint Detection**: Automatically detects SOAP, REST MVC, and plain REST endpoints using LLM analysis
- **OpenAPI Generation**: Generates OpenAPI 3.0.3 specs with company-specific ROA standards
- **GraphQL Generation**: Converts endpoints to GraphQL schemas with proper types, queries, and mutations
- **xAPI Support**: Dedicated experience layer API generation with session handling and consumer headers
- **Pipeline Execution**: Multi-step conversion pipeline scoped to a specific API name
- **Legacy Pattern Handling**: Detects and properly converts always-200 APIs, MVC ModelAndView errors, SOAP faults, and multi-version SOAP APIs
- **Accurate Capture**: Thorough request/response/error object analysis including nested types, inherited fields, and validations
- **Code Generation**: OpenAPI Generator integration for implementation scaffolding
- **Settings UI**: Webview panel for configuring source/target folders, conversion type, and ROA standards

## Commands

Use these in GitHub Copilot Chat:

| Command | Description |
|---------|-------------|
| `@appmod /analyze` | Scan workspace for SOAP and REST endpoints |
| `@appmod /generate-openapi` | Generate Backend API OpenAPI spec (ROA standard) |
| `@appmod /generate-openapi-xapi` | Generate Experience Layer (xAPI) OpenAPI spec with session handling |
| `@appmod /generate-graphql` | Generate GraphQL schema |
| `@appmod /configure-roa` | Configure company-specific ROA standards |
| `@appmod /generate-code` | Generate implementation code |
| `@appmod /convert <ApiName>` | Run the full conversion pipeline for a specific API |

## Target API Types

- **API** (Backend): ROA-standard REST API with OpenAPI spec
- **xAPI** (Experience Layer): Consumer-facing API with session handling, channel headers, and BFF patterns
- **GraphQL**: Full schema with types, queries, mutations, and Relay-style pagination

## Getting Started

### Prerequisites

- VS Code 1.93+
- GitHub Copilot extension installed and active

### Installation

```bash
npm install
npm run compile
```

### Development

```bash
npm run watch    # Watch mode for development
npm run lint     # Run ESLint
npm run build    # Production build
```

### Usage

1. Open a workspace containing your legacy API code
2. Open Copilot Chat and type `@appmod /analyze` to detect all endpoints
3. Configure ROA standards with `@appmod /configure-roa`
4. Generate your target spec:
   - `@appmod /generate-openapi` for Backend API OpenAPI spec
   - `@appmod /generate-openapi-xapi` for Experience Layer (xAPI) OpenAPI spec
   - `@appmod /generate-graphql` for GraphQL schema
5. Or run `@appmod /convert <ApiName>` for the full pipeline (e.g., `@appmod /convert OrderService`)

#### Convert Command Examples

```
@appmod /convert OrderService          # Convert OrderService to Backend API (default)
@appmod /convert PaymentAPI graphql     # Convert PaymentAPI to GraphQL
@appmod /convert CustomerService xapi   # Convert CustomerService to xAPI
```

The API name is used to filter and focus analysis on endpoints belonging to that API, handle multiple SOAP API versions in the same project, and name the generated specification file.

## Legacy API Pattern Handling

App Modernizer detects and properly converts these common legacy patterns:

### Always-200 APIs with Embedded Errors
REST APIs that always return HTTP 200, even for errors, with error details embedded in the response body (e.g., `{"success": false, "errorCode": "E001", "errorMessage": "..."}`).
- Error fields are extracted into separate exception response schemas
- Mapped to proper HTTP status codes (400, 404, 500, etc.)
- Success response contains only the actual data fields

### MVC ModelAndView with Error Attributes
Spring MVC controllers using `ModelAndView` that mix success data and error attributes in the same view model.
- Error-related model attributes are separated into error response schemas
- Success view attributes become the 200 response schema

### SOAP Fault Responses
SOAP endpoints with fault definitions in WSDL or custom fault classes.
- Each SOAP fault type is mapped to an appropriate HTTP error response
- Fault code, fault string, and fault detail are preserved in error schemas

### Multiple SOAP API Versions
Projects with multiple versions (v1, v2, etc.) of the same SOAP API.
- Versions are detected from package names, WSDL namespaces, and class naming conventions
- Each version is reported and converted separately

### Settings UI

Run `App Modernizer: Open Settings` from the Command Palette to access:
- Source/target folder selection
- Conversion type (API / xAPI / GraphQL)
- ROA standards configuration

## ROA Standards

Default ROA standards include:
- Plural resource naming with kebab-case URLs
- Cursor-based pagination (default 20, max 100)
- RFC 7807 error responses with trace IDs
- URL-based versioning (v1)
- Standard and xAPI-specific headers

Customize via `@appmod /configure-roa` or the Settings UI.

## Recommended Models

- **gpt-4o**: Best for complex SOAP analysis and accurate type mapping
- **claude-3.5-sonnet**: Strong at code understanding and schema generation
- **o1-preview**: Best reasoning for large, complex codebases

## Architecture

```
src/
├── extension.ts           # Extension entry point
├── chatParticipant.ts     # Copilot Chat participant (@appmod) — 7 commands
├── commands.ts            # VS Code commands and settings UI
├── types.ts               # TypeScript type definitions (DetectedEndpoint, LegacyResponsePattern, etc.)
├── analyzers/
│   └── endpointAnalyzer.ts  # SOAP/REST endpoint detection with legacy pattern identification
├── generators/
│   ├── openApiGenerator.ts  # OpenAPI 3.0.3 spec generation with error schema separation
│   └── graphqlGenerator.ts  # GraphQL schema generation with legacy pattern handling
├── pipeline/
│   ├── pipelineEngine.ts    # Multi-step pipeline orchestration (API name scoped)
│   └── promptBuilder.ts     # Prompt engineering for each step (legacy-aware)
└── config/
    └── roaConfig.ts         # ROA standards configuration
```

## License

MIT
