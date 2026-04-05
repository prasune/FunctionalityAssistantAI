import { DetectedEndpoint, TargetApiType, RoaStandards, FieldDefinition } from '../types';

/** Generates OpenAPI 3.0 specifications from detected endpoints */
export class OpenApiGenerator {

    /**
     * Build the prompt for LLM-based OpenAPI spec generation.
     * This is the primary generation method — it creates a detailed prompt
     * that instructs the LLM to produce an accurate OpenAPI spec.
     */
    buildGenerationPrompt(
        endpoints: DetectedEndpoint[],
        targetType: TargetApiType,
        roaStandards: RoaStandards,
        sourceCode: string
    ): string {
        const isXApi = targetType === TargetApiType.ROA_REST_XAPI;
        const endpointDetails = this.formatEndpointDetails(endpoints);
        const roaRules = this.formatRoaRules(roaStandards, isXApi);

        return `You are an expert API architect. Generate a COMPLETE and ACCURATE OpenAPI 3.0.3 specification.

## Task
Convert the following legacy API endpoints into a modern ${isXApi ? 'Experience Layer (xAPI)' : 'Backend'} REST API following ROA (Resource Oriented Architecture) standards.

## Critical Requirements
1. **Accuracy is paramount**: Every request field, response field, and dependent object MUST be captured
2. **Complete schemas**: Include ALL nested objects, collections, enums, and inherited fields
3. **No field omission**: If a field exists in the source code, it MUST appear in the OpenAPI spec
4. **Proper types**: Map Java/Kotlin types correctly to OpenAPI types
5. **Validation rules**: Preserve all validation annotations as OpenAPI constraints

## Type Mapping Reference
- String → string
- Integer/int → integer (format: int32)
- Long/long → integer (format: int64)
- Double/double → number (format: double)
- Float/float → number (format: float)
- Boolean/boolean → boolean
- BigDecimal → string (format: decimal) or number
- Date → string (format: date)
- LocalDate → string (format: date)
- LocalDateTime → string (format: date-time)
- Instant → string (format: date-time)
- UUID → string (format: uuid)
- List<T> → array (items: T schema)
- Set<T> → array (items: T schema, uniqueItems: true)
- Map<K,V> → object (additionalProperties: V schema)
- byte[] → string (format: byte)
- Enum → string (enum: [values])

## ROA Standards to Apply
${roaRules}

${isXApi ? this.getXApiSpecificRules(roaStandards) : this.getApiSpecificRules(roaStandards)}

## Source Endpoints to Convert
${endpointDetails}

## Source Code Context
\`\`\`
${sourceCode}
\`\`\`

## Output Format
Generate a COMPLETE OpenAPI 3.0.3 YAML specification with:
1. Info section with title, description, version
2. Server URLs
3. All paths with operations, parameters, request bodies, and responses
4. ALL component schemas — every single request, response, and dependent object
5. Security schemes
6. Common response codes (400, 401, 403, 404, 500)

Output ONLY the YAML content, no explanation.`;
    }

    /**
     * Generate a scaffold OpenAPI spec structure from detected endpoints.
     * Used as a starting point that gets refined by the LLM.
     */
    generateScaffold(
        endpoints: DetectedEndpoint[],
        targetType: TargetApiType,
        roaStandards: RoaStandards
    ): string {
        const isXApi = targetType === TargetApiType.ROA_REST_XAPI;
        const title = isXApi ? 'Experience Layer API (xAPI)' : 'Backend API';

        const paths = this.generatePaths(endpoints, roaStandards, isXApi);
        const schemas = this.generateSchemas(endpoints);
        const headers = isXApi
            ? this.generateXApiHeaders(roaStandards)
            : this.generateApiHeaders(roaStandards);

        return `openapi: 3.0.3
info:
  title: ${title}
  description: Auto-generated from legacy API endpoints by App Modernizer
  version: ${roaStandards.versioning.currentVersion}
servers:
  - url: /api/${roaStandards.versioning.currentVersion}
    description: Default server
${headers}
paths:
${paths}
components:
  schemas:
${schemas}
  responses:
    BadRequest:
      description: Bad Request
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/ProblemDetail'
    NotFound:
      description: Resource not found
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/ProblemDetail'
    InternalServerError:
      description: Internal server error
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/ProblemDetail'
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
security:
  - bearerAuth: []`;
    }

    private formatEndpointDetails(endpoints: DetectedEndpoint[]): string {
        if (endpoints.length === 0) {
            return 'No pre-analyzed endpoints available. Analyze from the source code context below.';
        }

        return endpoints.map((ep, i) => {
            const requestFields = ep.requestObjects
                .flatMap(obj => obj.fields.map(f => `    - ${f.name}: ${f.type}${f.isRequired ? ' (required)' : ''}`))
                .join('\n');

            const responseFields = ep.responseObjects
                .flatMap(obj => obj.fields.map(f => `    - ${f.name}: ${f.type}`))
                .join('\n');

            const dependentTypes = ep.dependentObjects
                .map(obj => `    - ${obj.name}: ${obj.fields.map(f => f.name + ':' + f.type).join(', ')}`)
                .join('\n');

            const errorFields = ep.errorObjects
                .flatMap(obj => obj.fields.map(f => `    - ${f.name}: ${f.type}`))
                .join('\n');

            return `### Endpoint ${i + 1}: ${ep.className}.${ep.methodName}
- Source Type: ${ep.sourceType}
- Legacy Pattern: ${ep.legacyPattern}
- API Name: ${ep.apiName || 'N/A'}
- API Version: ${ep.apiVersion || 'N/A'}
- HTTP Method: ${ep.httpMethod || 'N/A'}
- Path: ${ep.path || 'N/A'}
- WSDL: ${ep.wsdlPath || 'N/A'}
- Annotations: ${ep.annotations.join(', ') || 'None'}
- Parent Classes: ${ep.parentClasses.join(', ') || 'None'}
- Request Objects:
${requestFields || '    (none detected)'}
- Response Objects:
${responseFields || '    (none detected)'}
- Error/Fault Objects:
${errorFields || '    (none detected)'}
- Dependent Objects:
${dependentTypes || '    (none detected)'}`;
        }).join('\n\n');
    }

    private formatRoaRules(standards: RoaStandards, isXApi: boolean): string {
        const rules = [
            `- Resource naming: ${standards.naming.resourceNaming}`,
            `- URL case style: ${standards.naming.urlPathStyle}`,
            `- Field case style: ${standards.naming.caseStyle}`,
            `- Max URL depth: ${standards.naming.maxDepth}`,
            `- Pagination: ${standards.pagination.style} (default size: ${standards.pagination.defaultPageSize}, max: ${standards.pagination.maxPageSize})`,
            `- Error format: ${standards.errorHandling.format}${standards.errorHandling.includeTraceId ? ' with trace ID' : ''}`,
            `- Versioning: ${standards.versioning.strategy} (version: ${standards.versioning.currentVersion})`,
        ];

        if (standards.customRules.length > 0) {
            rules.push('', '### Custom Rules:');
            rules.push(...standards.customRules.map(rule => `- ${rule}`));
        }

        if (isXApi) {
            rules.push('', '### xAPI Headers:');
            for (const [key, value] of Object.entries(standards.headers.xApiHeaders)) {
                rules.push(`- ${key}: ${value}`);
            }
            if (standards.headers.sessionHeaders) {
                rules.push('', '### Session Headers:');
                for (const [key, value] of Object.entries(standards.headers.sessionHeaders)) {
                    rules.push(`- ${key}: ${value}`);
                }
            }
        }

        return rules.join('\n');
    }

    private getXApiSpecificRules(standards: RoaStandards): string {
        return `## xAPI (Experience Layer) Specific Requirements
1. Include experience-layer specific headers in all operations:
${Object.entries(standards.headers.xApiHeaders).map(([k, v]) => `   - ${k}: ${v}`).join('\n')}
2. Include session handling headers:
${standards.headers.sessionHeaders ? Object.entries(standards.headers.sessionHeaders).map(([k, v]) => `   - ${k}: ${v}`).join('\n') : '   - X-Session-ID: Session identifier\n   - X-Correlation-ID: Request correlation'}
3. Response models should be consumer-facing (simplified, aggregated)
4. Include BFF (Backend for Frontend) patterns where applicable
5. Add rate limiting headers in responses (X-RateLimit-Limit, X-RateLimit-Remaining)
6. Include CORS configuration
7. Responses should be optimized for the consumer (may aggregate multiple backend calls)`;
    }

    private getApiSpecificRules(standards: RoaStandards): string {
        return `## Backend API Specific Requirements
1. Include standard headers in all operations:
${Object.entries(standards.headers.standard).map(([k, v]) => `   - ${k}: ${v}`).join('\n')}
2. Follow strict RESTful resource modeling
3. Use proper HTTP status codes (201 for creation, 204 for deletion, etc.)
4. Include HATEOAS links where appropriate
5. Support content negotiation (Accept header)
6. Include ETag for caching support`;
    }

    private generatePaths(
        endpoints: DetectedEndpoint[],
        standards: RoaStandards,
        _isXApi: boolean
    ): string {
        if (endpoints.length === 0) {
            return '  # Paths will be generated from source code analysis';
        }

        const pathEntries: string[] = [];
        for (const ep of endpoints) {
            const resourcePath = this.toRoaPath(ep, standards);
            const method = (ep.httpMethod || 'get').toLowerCase();

            pathEntries.push(`  ${resourcePath}:
    ${method}:
      summary: ${ep.className}.${ep.methodName}
      operationId: ${ep.methodName}
      tags:
        - ${ep.className}
      responses:
        '200':
          description: Successful response`);
        }

        return pathEntries.join('\n');
    }

    private toRoaPath(endpoint: DetectedEndpoint, standards: RoaStandards): string {
        if (endpoint.path) {
            return this.convertPathStyle(endpoint.path, standards.naming.urlPathStyle);
        }

        const resourceName = this.classNameToResource(endpoint.className, standards.naming.resourceNaming);
        return `/${resourceName}`;
    }

    private convertPathStyle(path: string, style: string): string {
        const segments = path.split('/').filter(Boolean);
        const converted = segments.map(seg => {
            if (seg.startsWith('{')) {
                return seg;
            }
            switch (style) {
                case 'kebab-case':
                    return seg.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
                case 'snake_case':
                    return seg.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
                default:
                    return seg;
            }
        });
        return '/' + converted.join('/');
    }

    private classNameToResource(className: string, naming: 'plural' | 'singular'): string {
        let resource = className
            .replace(/Controller$/i, '')
            .replace(/Endpoint$/i, '')
            .replace(/Service$/i, '')
            .replace(/Resource$/i, '');

        resource = resource.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

        if (naming === 'plural' && !resource.endsWith('s')) {
            resource += 's';
        }

        return resource;
    }

    private generateSchemas(endpoints: DetectedEndpoint[]): string {
        if (endpoints.length === 0) {
            return '    # Schemas will be generated from source code analysis';
        }

        const schemas: string[] = [];
        const processedNames = new Set<string>();

        for (const ep of endpoints) {
            const allObjects = [
                ...ep.requestObjects,
                ...ep.responseObjects,
                ...ep.errorObjects,
                ...ep.dependentObjects
            ];

            for (const obj of allObjects) {
                if (processedNames.has(obj.name)) {
                    continue;
                }
                processedNames.add(obj.name);

                const properties = obj.fields.map(f => this.fieldToYaml(f)).join('\n');
                const required = obj.fields.filter(f => f.isRequired).map(f => `        - ${f.name}`).join('\n');

                schemas.push(`    ${obj.name}:
      type: object
${required ? `      required:\n${required}\n` : ''}      properties:
${properties || '        # Properties will be populated from analysis'}`);
            }
        }

        schemas.push(`    ProblemDetail:
      type: object
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        instance:
          type: string
          format: uri
        traceId:
          type: string`);

        return schemas.join('\n');
    }

    private fieldToYaml(field: FieldDefinition): string {
        const typeMapping: Record<string, { type: string; format?: string }> = {
            'String': { type: 'string' },
            'Integer': { type: 'integer', format: 'int32' },
            'int': { type: 'integer', format: 'int32' },
            'Long': { type: 'integer', format: 'int64' },
            'long': { type: 'integer', format: 'int64' },
            'Double': { type: 'number', format: 'double' },
            'double': { type: 'number', format: 'double' },
            'Float': { type: 'number', format: 'float' },
            'float': { type: 'number', format: 'float' },
            'Boolean': { type: 'boolean' },
            'boolean': { type: 'boolean' },
            'BigDecimal': { type: 'string', format: 'decimal' },
            'Date': { type: 'string', format: 'date' },
            'LocalDate': { type: 'string', format: 'date' },
            'LocalDateTime': { type: 'string', format: 'date-time' },
            'Instant': { type: 'string', format: 'date-time' },
            'UUID': { type: 'string', format: 'uuid' },
        };

        if (field.isCollection) {
            const itemType = field.collectionType || 'string';
            const mapped = typeMapping[itemType];
            const itemSchema = mapped
                ? `type: ${mapped.type}${mapped.format ? `\n              format: ${mapped.format}` : ''}`
                : `$ref: '#/components/schemas/${itemType}'`;

            return `        ${field.name}:
          type: array
          items:
            ${itemSchema}`;
        }

        const mapped = typeMapping[field.type];
        if (mapped) {
            let yaml = `        ${field.name}:\n          type: ${mapped.type}`;
            if (mapped.format) {
                yaml += `\n          format: ${mapped.format}`;
            }
            return yaml;
        }

        return `        ${field.name}:
          $ref: '#/components/schemas/${field.type}'`;
    }

    private generateXApiHeaders(standards: RoaStandards): string {
        const headers = Object.entries(standards.headers.xApiHeaders)
            .map(([name, desc]) => `      ${name}:
        description: ${desc}
        required: true
        schema:
          type: string`)
            .join('\n');

        const sessionHeaders = standards.headers.sessionHeaders
            ? Object.entries(standards.headers.sessionHeaders)
                .map(([name, desc]) => `      ${name}:
        description: ${desc}
        required: false
        schema:
          type: string`)
                .join('\n')
            : '';

        return `  x-xapi-headers:
    parameters:
${headers}
${sessionHeaders}`;
    }

    private generateApiHeaders(standards: RoaStandards): string {
        const headers = Object.entries(standards.headers.standard)
            .map(([name, desc]) => `      ${name}:
        description: ${desc}
        required: true
        schema:
          type: string`)
            .join('\n');

        return `  x-api-headers:
    parameters:
${headers}`;
    }
}
