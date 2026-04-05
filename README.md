# App Modernizer — GitHub Copilot Extension

A GitHub Copilot Chat extension that converts legacy SOAP and REST APIs into modern OpenAPI specifications, GraphQL schemas, and ROA-standard APIs.

## Features

- **Endpoint Detection**: Automatically detects SOAP, REST MVC, and plain REST endpoints using LLM analysis
- **OpenAPI Generation**: Generates OpenAPI 3.0.3 specs with company-specific ROA standards
- **GraphQL Generation**: Converts endpoints to GraphQL schemas with proper types, queries, and mutations
- **xAPI Support**: Separate experience layer API generation with session handling and consumer headers
- **Pipeline Execution**: Multi-step conversion pipeline with configurable steps
- **Accurate Capture**: Thorough request/response object analysis including nested types, inherited fields, and validations
- **Code Generation**: OpenAPI Generator integration for implementation scaffolding
- **Settings UI**: Webview panel for configuring source/target folders, conversion type, and ROA standards

## Commands

Use these in GitHub Copilot Chat:

| Command | Description |
|---------|-------------|
| `@appmod /analyze` | Scan workspace for SOAP and REST endpoints |
| `@appmod /generate-openapi` | Generate OpenAPI spec (add "xapi" for experience layer) |
| `@appmod /generate-graphql` | Generate GraphQL schema |
| `@appmod /configure-roa` | Configure company-specific ROA standards |
| `@appmod /generate-code` | Generate implementation code |
| `@appmod /convert` | Run the full conversion pipeline |

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
2. Open Copilot Chat and type `@appmod /analyze` to detect endpoints
3. Configure ROA standards with `@appmod /configure-roa`
4. Generate your target spec:
   - `@appmod /generate-openapi` for Backend API
   - `@appmod /generate-openapi xapi` for Experience Layer
   - `@appmod /generate-graphql` for GraphQL
5. Or run `@appmod /convert` for the full pipeline

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
├── chatParticipant.ts     # Copilot Chat participant (@appmod)
├── commands.ts            # VS Code commands and settings UI
├── types.ts               # TypeScript type definitions
├── analyzers/
│   └── endpointAnalyzer.ts  # SOAP/REST endpoint detection
├── generators/
│   ├── openApiGenerator.ts  # OpenAPI 3.0.3 spec generation
│   └── graphqlGenerator.ts  # GraphQL schema generation
├── pipeline/
│   ├── pipelineEngine.ts    # Multi-step pipeline orchestration
│   └── promptBuilder.ts     # Prompt engineering for each step
└── config/
    └── roaConfig.ts         # ROA standards configuration
```

## License

MIT
