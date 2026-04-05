import { DetectedEndpoint, SourceApiType, FieldDefinition, ObjectDefinition } from '../types';

/** Generates GraphQL schemas from detected endpoints */
export class GraphQLGenerator {

    /**
     * Build the prompt for LLM-based GraphQL schema generation.
     */
    buildGenerationPrompt(
        endpoints: DetectedEndpoint[],
        sourceCode: string
    ): string {
        const endpointDetails = this.formatEndpointDetails(endpoints);

        return `You are an expert GraphQL architect. Generate a COMPLETE and ACCURATE GraphQL schema.

## Task
Convert the following legacy API endpoints into a modern GraphQL API with proper types, queries, mutations, and input types.

## Critical Requirements
1. **Accuracy is paramount**: Every request field, response field, and dependent object MUST be captured
2. **Complete types**: Include ALL nested types, collections, enums, and unions
3. **No field omission**: If a field exists in the source code, it MUST appear in the schema
4. **Proper type mapping**: Map Java/Kotlin types correctly to GraphQL types
5. **Input types**: Create separate input types for mutations (not reusing output types)
6. **Descriptions**: Add meaningful descriptions to types and fields

## Type Mapping Reference
- String → String
- Integer/int → Int
- Long/long → Int (or custom scalar Long)
- Double/double/Float/float → Float
- Boolean/boolean → Boolean
- BigDecimal → Float or custom scalar BigDecimal
- Date/LocalDate → custom scalar Date
- LocalDateTime/Instant → custom scalar DateTime
- UUID → ID or custom scalar UUID
- List<T> → [T]
- Set<T> → [T]
- Map<K,V> → custom type or JSON scalar
- Enum → enum
- byte[] → String (base64 encoded)

## GraphQL Best Practices to Apply
1. Use relay-style connections for paginated lists
2. Create proper input types for mutations
3. Use enums for fixed value sets
4. Add nullable/non-nullable annotations correctly
5. Group related queries and mutations logically
6. Add descriptions to all types and fields
7. Use interfaces for shared field patterns
8. Define custom scalars for Date, DateTime, BigDecimal, Long

## SOAP to GraphQL Conversion Rules
- SOAP operations → Queries (read) or Mutations (write)
- SOAP complex types → GraphQL object types
- SOAP enumerations → GraphQL enums
- SOAP arrays → GraphQL lists
- SOAP faults → GraphQL errors
- WSDL input messages → GraphQL input types
- WSDL output messages → GraphQL return types

## REST to GraphQL Conversion Rules
- GET endpoints → Queries
- POST/PUT/PATCH endpoints → Mutations
- DELETE endpoints → Mutations returning Boolean or DeletePayload
- Path parameters → Query/Mutation arguments
- Request body → Input type arguments
- Response body → Return type
- List endpoints → Connection types with pagination

## Source Endpoints to Convert
${endpointDetails}

## Source Code Context
\`\`\`
${sourceCode}
\`\`\`

## Output Format
Generate a COMPLETE GraphQL schema definition with:
1. Custom scalar definitions
2. All type definitions with descriptions
3. All input type definitions
4. All enum definitions
5. Query type with all queries
6. Mutation type with all mutations
7. Connection types for paginated lists
8. Error/payload types for mutations

Output ONLY the GraphQL SDL (Schema Definition Language), no explanation.`;
    }

    /**
     * Generate a scaffold GraphQL schema from detected endpoints.
     */
    generateScaffold(endpoints: DetectedEndpoint[]): string {
        const customScalars = this.generateCustomScalars();
        const types = this.generateTypes(endpoints);
        const inputTypes = this.generateInputTypes(endpoints);
        const enums = this.generateEnums(endpoints);
        const queries = this.generateQueries(endpoints);
        const mutations = this.generateMutations(endpoints);
        const connectionTypes = this.generateConnectionTypes(endpoints);

        return `${customScalars}

${enums}

${types}

${inputTypes}

${connectionTypes}

${queries}

${mutations}`;
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
                .map(obj => `    - ${obj.name}: ${obj.fields.map(f => `${f.name}:${f.type}`).join(', ')}`)
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
- Request Objects:
${requestFields || '    (none)'}
- Response Objects:
${responseFields || '    (none)'}
- Error/Fault Objects:
${errorFields || '    (none)'}
- Dependent Types:
${dependentTypes || '    (none)'}`;
        }).join('\n\n');
    }

    private generateCustomScalars(): string {
        return `"""Custom scalar for date values (YYYY-MM-DD)"""
scalar Date

"""Custom scalar for date-time values (ISO 8601)"""
scalar DateTime

"""Custom scalar for precise decimal numbers"""
scalar BigDecimal

"""Custom scalar for 64-bit integers"""
scalar Long

"""Custom scalar for JSON objects"""
scalar JSON`;
    }

    private generateTypes(endpoints: DetectedEndpoint[]): string {
        const types: string[] = [];
        const processedNames = new Set<string>();

        for (const ep of endpoints) {
            for (const obj of [...ep.responseObjects, ...ep.dependentObjects]) {
                if (processedNames.has(obj.name)) {
                    continue;
                }
                processedNames.add(obj.name);
                types.push(this.objectToGraphQLType(obj));
            }
        }

        types.push(this.generatePaginationTypes());

        return types.join('\n\n');
    }

    private generateInputTypes(endpoints: DetectedEndpoint[]): string {
        const inputTypes: string[] = [];
        const processedNames = new Set<string>();

        for (const ep of endpoints) {
            for (const obj of ep.requestObjects) {
                const inputName = obj.name.replace(/Request$/, 'Input').replace(/DTO$/, 'Input');
                if (processedNames.has(inputName)) {
                    continue;
                }
                processedNames.add(inputName);
                inputTypes.push(this.objectToGraphQLInputType(obj, inputName));
            }
        }

        return inputTypes.join('\n\n');
    }

    private generateEnums(_endpoints: DetectedEndpoint[]): string {
        return `"""Standard sort direction"""
enum SortDirection {
  ASC
  DESC
}`;
    }

    private generateQueries(endpoints: DetectedEndpoint[]): string {
        const queryFields: string[] = [];

        for (const ep of endpoints) {
            if (this.isReadOperation(ep)) {
                const fieldName = this.toQueryFieldName(ep);
                const returnType = this.getReturnType(ep);
                const args = this.getQueryArguments(ep);

                queryFields.push(`  """${ep.className}.${ep.methodName}"""
  ${fieldName}${args}: ${returnType}`);
            }
        }

        if (queryFields.length === 0) {
            queryFields.push('  """Placeholder query — will be populated from analysis"""');
            queryFields.push('  _empty: String');
        }

        return `type Query {
${queryFields.join('\n\n')}
}`;
    }

    private generateMutations(endpoints: DetectedEndpoint[]): string {
        const mutationFields: string[] = [];

        for (const ep of endpoints) {
            if (this.isWriteOperation(ep)) {
                const fieldName = this.toMutationFieldName(ep);
                const returnType = this.getMutationReturnType(ep);
                const args = this.getMutationArguments(ep);

                mutationFields.push(`  """${ep.className}.${ep.methodName}"""
  ${fieldName}${args}: ${returnType}`);
            }
        }

        if (mutationFields.length === 0) {
            mutationFields.push('  """Placeholder mutation — will be populated from analysis"""');
            mutationFields.push('  _empty: String');
        }

        return `type Mutation {
${mutationFields.join('\n\n')}
}`;
    }

    private generateConnectionTypes(endpoints: DetectedEndpoint[]): string {
        const connectionTypes: string[] = [];
        const processedNames = new Set<string>();

        for (const ep of endpoints) {
            if (this.isListOperation(ep) && ep.responseObjects.length > 0) {
                const typeName = ep.responseObjects[0].name;
                if (processedNames.has(typeName)) {
                    continue;
                }
                processedNames.add(typeName);

                connectionTypes.push(`"""Connection type for paginated ${typeName} results"""
type ${typeName}Connection {
  edges: [${typeName}Edge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type ${typeName}Edge {
  node: ${typeName}!
  cursor: String!
}`);
            }
        }

        return connectionTypes.join('\n\n');
    }

    private objectToGraphQLType(obj: ObjectDefinition): string {
        const fields = obj.fields.map(f => {
            const gqlType = this.javaTypeToGraphQL(f);
            const nullability = f.isRequired ? '!' : '';
            return `  """${f.description || f.name}"""
  ${f.name}: ${gqlType}${nullability}`;
        }).join('\n\n');

        return `"""${obj.name} type"""
type ${obj.name} {
${fields || '  _placeholder: String'}
}`;
    }

    private objectToGraphQLInputType(obj: ObjectDefinition, inputName: string): string {
        const fields = obj.fields.map(f => {
            const gqlType = this.javaTypeToGraphQLInput(f);
            const nullability = f.isRequired ? '!' : '';
            return `  ${f.name}: ${gqlType}${nullability}`;
        }).join('\n');

        return `"""Input type for ${obj.name}"""
input ${inputName} {
${fields || '  _placeholder: String'}
}`;
    }

    private generatePaginationTypes(): string {
        return `"""Pagination information for relay-style connections"""
type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}`;
    }

    private javaTypeToGraphQL(field: FieldDefinition): string {
        if (field.isCollection) {
            const itemType = this.mapScalarType(field.collectionType || 'String');
            return `[${itemType}]`;
        }
        return this.mapScalarType(field.type);
    }

    private javaTypeToGraphQLInput(field: FieldDefinition): string {
        if (field.isCollection) {
            const itemType = this.mapScalarType(field.collectionType || 'String');
            return `[${itemType}]`;
        }
        return this.mapScalarType(field.type);
    }

    private mapScalarType(javaType: string): string {
        const typeMap: Record<string, string> = {
            'String': 'String',
            'Integer': 'Int',
            'int': 'Int',
            'Long': 'Long',
            'long': 'Long',
            'Double': 'Float',
            'double': 'Float',
            'Float': 'Float',
            'float': 'Float',
            'Boolean': 'Boolean',
            'boolean': 'Boolean',
            'BigDecimal': 'BigDecimal',
            'Date': 'Date',
            'LocalDate': 'Date',
            'LocalDateTime': 'DateTime',
            'Instant': 'DateTime',
            'UUID': 'ID',
            'byte[]': 'String',
        };
        return typeMap[javaType] || javaType;
    }

    private isReadOperation(ep: DetectedEndpoint): boolean {
        if (ep.sourceType === SourceApiType.SOAP) {
            const name = (ep.methodName || '').toLowerCase();
            return name.startsWith('get') || name.startsWith('find') ||
                   name.startsWith('list') || name.startsWith('search') ||
                   name.startsWith('fetch') || name.startsWith('retrieve');
        }
        return !ep.httpMethod || ep.httpMethod === 'GET';
    }

    private isWriteOperation(ep: DetectedEndpoint): boolean {
        if (ep.sourceType === SourceApiType.SOAP) {
            return !this.isReadOperation(ep);
        }
        return !!ep.httpMethod && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(ep.httpMethod);
    }

    private isListOperation(ep: DetectedEndpoint): boolean {
        const name = (ep.methodName || '').toLowerCase();
        return name.startsWith('list') || name.startsWith('getall') ||
               name.startsWith('findall') || name.startsWith('search') ||
               (ep.path?.endsWith('s') === true && ep.httpMethod === 'GET');
    }

    private toQueryFieldName(ep: DetectedEndpoint): string {
        const name = ep.methodName || ep.className.replace(/Controller|Endpoint|Service/g, '');
        return name.charAt(0).toLowerCase() + name.slice(1);
    }

    private toMutationFieldName(ep: DetectedEndpoint): string {
        const name = ep.methodName || '';
        if (name) {
            return name.charAt(0).toLowerCase() + name.slice(1);
        }
        const method = (ep.httpMethod || 'post').toLowerCase();
        const resource = ep.className.replace(/Controller|Endpoint|Service/g, '');
        return `${method}${resource}`;
    }

    private getReturnType(ep: DetectedEndpoint): string {
        if (ep.responseObjects.length > 0) {
            const typeName = ep.responseObjects[0].name;
            if (this.isListOperation(ep)) {
                return `${typeName}Connection!`;
            }
            return typeName;
        }
        return 'String';
    }

    private getMutationReturnType(ep: DetectedEndpoint): string {
        if (ep.httpMethod === 'DELETE') {
            return 'Boolean!';
        }
        if (ep.responseObjects.length > 0) {
            return `${ep.responseObjects[0].name}!`;
        }
        return 'Boolean!';
    }

    private getQueryArguments(ep: DetectedEndpoint): string {
        const args: string[] = [];

        if (ep.requestObjects.length > 0) {
            for (const obj of ep.requestObjects) {
                for (const field of obj.fields) {
                    const gqlType = this.javaTypeToGraphQL(field);
                    args.push(`${field.name}: ${gqlType}${field.isRequired ? '!' : ''}`);
                }
            }
        }

        if (this.isListOperation(ep)) {
            args.push('first: Int', 'after: String', 'last: Int', 'before: String');
        }

        return args.length > 0 ? `(${args.join(', ')})` : '';
    }

    private getMutationArguments(ep: DetectedEndpoint): string {
        if (ep.requestObjects.length > 0) {
            const inputName = ep.requestObjects[0].name
                .replace(/Request$/, 'Input')
                .replace(/DTO$/, 'Input');
            return `(input: ${inputName}!)`;
        }
        return '';
    }
}
