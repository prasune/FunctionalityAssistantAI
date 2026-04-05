/** Supported source API types that can be detected and converted */
export enum SourceApiType {
    SOAP = 'soap',
    REST_MVC = 'rest_mvc',
    REST_PLAIN = 'rest_plain',
    UNKNOWN = 'unknown'
}

/** Target API output formats */
export enum TargetApiType {
    ROA_REST_API = 'roa_rest_api',
    ROA_REST_XAPI = 'roa_rest_xapi',
    GRAPHQL = 'graphql'
}

/** Represents a detected endpoint in the source code */
export interface DetectedEndpoint {
    filePath: string;
    className: string;
    methodName: string;
    sourceType: SourceApiType;
    httpMethod?: string;
    path?: string;
    wsdlPath?: string;
    schemaPath?: string;
    requestObjects: ObjectDefinition[];
    responseObjects: ObjectDefinition[];
    dependentObjects: ObjectDefinition[];
    annotations: string[];
    parentClasses: string[];
    rawContent: string;
}

/** Represents a data object (request/response/dependent) */
export interface ObjectDefinition {
    name: string;
    filePath: string;
    fields: FieldDefinition[];
    parentClass?: string;
    interfaces?: string[];
    annotations?: string[];
    rawContent: string;
}

/** Represents a field within an object definition */
export interface FieldDefinition {
    name: string;
    type: string;
    isRequired: boolean;
    isCollection: boolean;
    collectionType?: string;
    annotations?: string[];
    description?: string;
    validations?: string[];
}

/** ROA Standards configuration */
export interface RoaStandards {
    naming: RoaNamingConventions;
    headers: RoaHeaderConfig;
    pagination: RoaPaginationConfig;
    errorHandling: RoaErrorConfig;
    versioning: RoaVersioningConfig;
    customRules: string[];
}

export interface RoaNamingConventions {
    resourceNaming: 'plural' | 'singular';
    caseStyle: 'camelCase' | 'snake_case' | 'kebab-case';
    urlPathStyle: 'kebab-case' | 'camelCase' | 'snake_case';
    maxDepth: number;
}

export interface RoaHeaderConfig {
    standard: Record<string, string>;
    xApiHeaders: Record<string, string>;
    sessionHeaders?: Record<string, string>;
    customHeaders?: Record<string, string>;
}

export interface RoaPaginationConfig {
    style: 'offset' | 'cursor' | 'page';
    defaultPageSize: number;
    maxPageSize: number;
    parameterNames: {
        offset?: string;
        limit?: string;
        cursor?: string;
        page?: string;
        size?: string;
    };
}

export interface RoaErrorConfig {
    format: 'rfc7807' | 'custom';
    includeTraceId: boolean;
    errorCodePrefix?: string;
}

export interface RoaVersioningConfig {
    strategy: 'url' | 'header' | 'query';
    currentVersion: string;
    headerName?: string;
}

/** Pipeline step definition */
export interface PipelineStep {
    id: string;
    name: string;
    description: string;
    promptTemplate: string;
    order: number;
    isEnabled: boolean;
    requiresUserInput: boolean;
}

/** Pipeline execution context */
export interface PipelineContext {
    sourceFolder: string;
    targetFolder: string;
    targetApiType: TargetApiType;
    detectedEndpoints: DetectedEndpoint[];
    roaStandards: RoaStandards;
    generatedSpec?: string;
    generatedCode?: string;
    currentStepIndex: number;
    stepResults: Map<string, string>;
}

/** Conversion options provided by the user */
export interface ConversionOptions {
    sourceFolder: string;
    targetFolder: string;
    targetType: TargetApiType;
    roaStandards?: Partial<RoaStandards>;
    includeCodeGeneration: boolean;
    selectedEndpoints?: string[];
}
