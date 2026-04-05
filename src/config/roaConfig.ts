import * as vscode from 'vscode';
import { RoaStandards } from '../types';

/** Default ROA standards used when no custom configuration is provided */
const DEFAULT_ROA_STANDARDS: RoaStandards = {
    naming: {
        resourceNaming: 'plural',
        caseStyle: 'camelCase',
        urlPathStyle: 'kebab-case',
        maxDepth: 3
    },
    headers: {
        standard: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Request-ID': 'Unique request identifier (UUID)',
            'X-Correlation-ID': 'Correlation ID for distributed tracing',
            'Authorization': 'Bearer token for authentication'
        },
        xApiHeaders: {
            'X-Channel': 'Consumer channel (web, mobile, partner)',
            'X-Session-ID': 'Session identifier for stateful interactions',
            'X-Client-ID': 'Client application identifier',
            'X-Client-Version': 'Client application version',
            'X-Correlation-ID': 'Request correlation ID for tracing',
            'X-Request-ID': 'Unique request identifier',
            'Accept-Language': 'Preferred response language'
        },
        sessionHeaders: {
            'X-Session-ID': 'Session identifier',
            'X-Session-Token': 'Session authentication token',
            'X-Session-Expiry': 'Session expiration timestamp'
        }
    },
    pagination: {
        style: 'cursor',
        defaultPageSize: 20,
        maxPageSize: 100,
        parameterNames: {
            cursor: 'cursor',
            limit: 'limit',
            offset: 'offset',
            page: 'page',
            size: 'size'
        }
    },
    errorHandling: {
        format: 'rfc7807',
        includeTraceId: true,
        errorCodePrefix: 'ERR'
    },
    versioning: {
        strategy: 'url',
        currentVersion: 'v1',
        headerName: 'X-API-Version'
    },
    customRules: []
};

/**
 * Manages ROA (Resource Oriented Architecture) standards configuration.
 * Standards can be configured via VS Code settings, the settings UI,
 * or through the @appmod /configure-roa command.
 */
export class RoaConfigManager {
    private standards: RoaStandards;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.standards = this.loadStandards();
    }

    /** Get the current ROA standards configuration */
    getStandards(): RoaStandards {
        return { ...this.standards };
    }

    /** Update standards from user input (natural language or structured) */
    updateFromUserInput(input: string): void {
        const lower = input.toLowerCase();

        // Parse naming conventions
        if (lower.includes('singular')) {
            this.standards.naming.resourceNaming = 'singular';
        } else if (lower.includes('plural')) {
            this.standards.naming.resourceNaming = 'plural';
        }

        if (lower.includes('camelcase') || lower.includes('camel case') || lower.includes('camel-case')) {
            this.standards.naming.caseStyle = 'camelCase';
        } else if (lower.includes('snake_case') || lower.includes('snake case')) {
            this.standards.naming.caseStyle = 'snake_case';
        } else if (lower.includes('kebab-case') || lower.includes('kebab case')) {
            this.standards.naming.caseStyle = 'kebab-case';
        }

        // Parse pagination style
        if (lower.includes('cursor')) {
            this.standards.pagination.style = 'cursor';
        } else if (lower.includes('offset')) {
            this.standards.pagination.style = 'offset';
        } else if (lower.includes('page-based') || lower.includes('page based')) {
            this.standards.pagination.style = 'page';
        }

        // Parse page size
        const pageSizeMatch = lower.match(/page\s*size\s*[:\s]*(\d+)/);
        if (pageSizeMatch) {
            this.standards.pagination.defaultPageSize = parseInt(pageSizeMatch[1], 10);
        }

        const maxPageSizeMatch = lower.match(/max\s*page\s*size\s*[:\s]*(\d+)/);
        if (maxPageSizeMatch) {
            this.standards.pagination.maxPageSize = parseInt(maxPageSizeMatch[1], 10);
        }

        // Parse error format
        if (lower.includes('rfc7807') || lower.includes('rfc 7807') || lower.includes('problem+json')) {
            this.standards.errorHandling.format = 'rfc7807';
        } else if (lower.includes('custom error')) {
            this.standards.errorHandling.format = 'custom';
        }

        // Parse versioning
        if (lower.includes('url version') || lower.includes('version in url') || lower.includes('url-based version')) {
            this.standards.versioning.strategy = 'url';
        } else if (lower.includes('header version') || lower.includes('version in header')) {
            this.standards.versioning.strategy = 'header';
        } else if (lower.includes('query version') || lower.includes('version in query')) {
            this.standards.versioning.strategy = 'query';
        }

        const versionMatch = lower.match(/version\s*[:\s]*(v\d+)/);
        if (versionMatch) {
            this.standards.versioning.currentVersion = versionMatch[1];
        }

        // Parse max depth
        const depthMatch = lower.match(/(?:max\s*)?depth\s*[:\s]*(\d+)/);
        if (depthMatch) {
            this.standards.naming.maxDepth = parseInt(depthMatch[1], 10);
        }

        // Parse custom headers
        const headerMatches = input.match(/header[s]?\s*[:\s]*([^\n]+)/gi);
        if (headerMatches) {
            for (const headerLine of headerMatches) {
                const headerParts = headerLine.replace(/headers?\s*[:\s]*/i, '').split(',');
                for (const part of headerParts) {
                    const trimmed = part.trim();
                    if (trimmed.includes(':')) {
                        const [name, ...descParts] = trimmed.split(':');
                        this.standards.headers.standard[name.trim()] = descParts.join(':').trim();
                    }
                }
            }
        }

        // Store any remaining text as custom rules
        const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const customRules = lines.filter(line => {
            const lineLower = line.toLowerCase();
            return !lineLower.startsWith('header') &&
                   !lineLower.match(/^(plural|singular|camel|snake|kebab|cursor|offset|page|rfc|version|depth)/);
        });

        if (customRules.length > 0) {
            this.standards.customRules = [
                ...this.standards.customRules,
                ...customRules
            ];
        }

        this.saveStandards();
    }

    /** Update standards from structured JSON configuration */
    updateFromConfig(config: Partial<RoaStandards>): void {
        this.standards = this.mergeStandards(this.standards, config);
        this.saveStandards();
    }

    /** Reset to default standards */
    resetToDefaults(): void {
        this.standards = { ...DEFAULT_ROA_STANDARDS };
        this.saveStandards();
    }

    private loadStandards(): RoaStandards {
        const storedStandards = this.context.globalState.get<Partial<RoaStandards>>('roaStandards');
        const workspaceConfig = vscode.workspace.getConfiguration('appmod').get<Partial<RoaStandards>>('roaStandards');

        let standards = { ...DEFAULT_ROA_STANDARDS };

        if (storedStandards) {
            standards = this.mergeStandards(standards, storedStandards);
        }

        if (workspaceConfig && Object.keys(workspaceConfig).length > 0) {
            standards = this.mergeStandards(standards, workspaceConfig);
        }

        return standards;
    }

    private saveStandards(): void {
        this.context.globalState.update('roaStandards', this.standards);
    }

    private mergeStandards(base: RoaStandards, override: Partial<RoaStandards>): RoaStandards {
        return {
            naming: override.naming ? { ...base.naming, ...override.naming } : base.naming,
            headers: override.headers ? {
                standard: { ...base.headers.standard, ...override.headers.standard },
                xApiHeaders: { ...base.headers.xApiHeaders, ...override.headers.xApiHeaders },
                sessionHeaders: override.headers.sessionHeaders
                    ? { ...base.headers.sessionHeaders, ...override.headers.sessionHeaders }
                    : base.headers.sessionHeaders,
                customHeaders: override.headers.customHeaders
                    ? { ...base.headers.customHeaders, ...override.headers.customHeaders }
                    : base.headers.customHeaders,
            } : base.headers,
            pagination: override.pagination
                ? { ...base.pagination, ...override.pagination }
                : base.pagination,
            errorHandling: override.errorHandling
                ? { ...base.errorHandling, ...override.errorHandling }
                : base.errorHandling,
            versioning: override.versioning
                ? { ...base.versioning, ...override.versioning }
                : base.versioning,
            customRules: override.customRules
                ? [...base.customRules, ...override.customRules]
                : base.customRules
        };
    }
}
