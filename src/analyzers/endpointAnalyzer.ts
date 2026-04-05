import * as vscode from 'vscode';
import { DetectedEndpoint, SourceApiType, ObjectDefinition, FieldDefinition } from '../types';

/** Patterns used to identify SOAP endpoints in source code */
const SOAP_INDICATORS = [
    '@WebService',
    '@WebMethod',
    '@SOAPBinding',
    '@WebServiceProvider',
    'javax.jws.WebService',
    'javax.xml.ws',
    'javax.jws',
    'org.springframework.ws',
    '@Endpoint',
    '@PayloadRoot',
    'extends SpringBeanAutowiringSupport',
    'implements Provider<SOAPMessage>',
    'SOAPMessage',
    'SOAPEnvelope',
    'SOAPBody',
    'wsdl'
];

/** Patterns used to identify REST MVC endpoints */
const REST_MVC_INDICATORS = [
    'ModelAndView',
    'ModelMap',
    '@Controller',
    'extends MultiActionController',
    'extends AbstractController',
    'extends SimpleFormController',
    'org.springframework.web.servlet.mvc',
    'org.springframework.web.servlet.ModelAndView'
];

/** Patterns used to identify plain REST endpoints */
const REST_PLAIN_INDICATORS = [
    '@RestController',
    '@RequestMapping',
    '@GetMapping',
    '@PostMapping',
    '@PutMapping',
    '@DeleteMapping',
    '@PatchMapping',
    '@ResponseBody',
    '@PathVariable',
    '@RequestBody',
    '@RequestParam',
    'javax.ws.rs',
    '@Path',
    '@GET',
    '@POST',
    '@PUT',
    '@DELETE',
    '@Produces',
    '@Consumes'
];

export class EndpointAnalyzer {

    /**
     * Build a comprehensive prompt for LLM-based endpoint analysis.
     * The LLM handles the actual detection since annotations may be
     * abstracted through parent classes or custom frameworks.
     */
    buildAnalysisPromptForFiles(fileContents: Map<string, string>): string {
        const filesSection = Array.from(fileContents.entries())
            .map(([path, content]) => `### File: ${path}\n\`\`\`java\n${content}\n\`\`\``)
            .join('\n\n');

        return `You are analyzing a Java codebase to detect all API endpoints.
Your task is to identify EVERY endpoint class and categorize each as SOAP, REST MVC, or plain REST.

IMPORTANT DETECTION RULES:
1. SOAP endpoints may NOT have direct @WebService annotations - they might:
   - Extend abstract classes that have SOAP annotations
   - Implement interfaces that define web service contracts
   - Use custom framework annotations that wrap SOAP
   - Have associated WSDL files

2. REST MVC endpoints might:
   - Return ModelAndView or ModelMap objects
   - Extend Spring MVC controller base classes
   - Use @Controller (without @ResponseBody)

3. Plain REST endpoints might:
   - Use @RestController or @Controller + @ResponseBody
   - Use JAX-RS annotations (@Path, @GET, @POST, etc.)
   - Return ResponseEntity or direct objects

4. Look at the FULL class hierarchy - parent classes and interfaces may contain the API annotations.

For EACH endpoint found, provide:
- File path
- Class name
- Whether it's SOAP, REST_MVC, or REST_PLAIN
- HTTP method and path (if REST)
- WSDL/schema path (if SOAP)
- All request parameter types and their field structures
- All response types and their field structures
- Related/dependent object types and their fields
- Parent classes and interfaces

BE THOROUGH: Capture EVERY field in request/response objects, including:
- Nested objects and their complete structures
- Collection types and their element types
- Inherited fields from parent classes
- Fields with validation annotations

${filesSection}

Respond with a structured analysis in markdown format.`;
    }

    /**
     * Perform a quick heuristic scan of file content to pre-classify
     * endpoints before sending to LLM for deep analysis.
     */
    quickClassify(content: string): SourceApiType {
        const soapScore = SOAP_INDICATORS.filter(indicator =>
            content.includes(indicator)
        ).length;

        const mvcScore = REST_MVC_INDICATORS.filter(indicator =>
            content.includes(indicator)
        ).length;

        const restScore = REST_PLAIN_INDICATORS.filter(indicator =>
            content.includes(indicator)
        ).length;

        if (soapScore > 0 && soapScore >= mvcScore && soapScore >= restScore) {
            return SourceApiType.SOAP;
        }
        if (mvcScore > 0 && mvcScore >= restScore) {
            return SourceApiType.REST_MVC;
        }
        if (restScore > 0) {
            return SourceApiType.REST_PLAIN;
        }
        return SourceApiType.UNKNOWN;
    }

    /**
     * Scan workspace files to find potential endpoint classes.
     * Returns file paths that likely contain API definitions.
     */
    async findEndpointFiles(folderPath: string): Promise<vscode.Uri[]> {
        const javaPattern = new vscode.RelativePattern(folderPath, '**/*.java');
        const kotlinPattern = new vscode.RelativePattern(folderPath, '**/*.kt');
        const wsdlPattern = new vscode.RelativePattern(folderPath, '**/*.wsdl');
        const xsdPattern = new vscode.RelativePattern(folderPath, '**/*.xsd');

        const [javaFiles, kotlinFiles, wsdlFiles, xsdFiles] = await Promise.all([
            vscode.workspace.findFiles(javaPattern, '**/node_modules/**'),
            vscode.workspace.findFiles(kotlinPattern, '**/node_modules/**'),
            vscode.workspace.findFiles(wsdlPattern, '**/node_modules/**'),
            vscode.workspace.findFiles(xsdPattern, '**/node_modules/**')
        ]);

        return [...javaFiles, ...kotlinFiles, ...wsdlFiles, ...xsdFiles];
    }

    /**
     * Read and filter files that are likely endpoint classes
     * based on quick heuristic analysis.
     */
    async readAndFilterEndpoints(files: vscode.Uri[]): Promise<Map<string, string>> {
        const endpointFiles = new Map<string, string>();
        const allIndicators = [
            ...SOAP_INDICATORS,
            ...REST_MVC_INDICATORS,
            ...REST_PLAIN_INDICATORS,
            'class ',
            'interface ',
            '@interface '
        ];

        for (const file of files) {
            try {
                const content = await vscode.workspace.fs.readFile(file);
                const text = Buffer.from(content).toString('utf-8');

                const isEndpointCandidate = allIndicators.some(indicator =>
                    text.includes(indicator)
                );

                if (isEndpointCandidate || file.fsPath.endsWith('.wsdl') || file.fsPath.endsWith('.xsd')) {
                    endpointFiles.set(file.fsPath, text);
                }
            } catch {
                // skip files that can't be read
            }
        }

        return endpointFiles;
    }

    /**
     * Parse LLM analysis output into structured DetectedEndpoint objects.
     * This provides a best-effort parse of the markdown response.
     */
    parseAnalysisResult(analysisText: string): DetectedEndpoint[] {
        const endpoints: DetectedEndpoint[] = [];
        const sections = analysisText.split(/(?=###\s)/);

        for (const section of sections) {
            const endpoint = this.parseEndpointSection(section);
            if (endpoint) {
                endpoints.push(endpoint);
            }
        }

        return endpoints;
    }

    private parseEndpointSection(section: string): DetectedEndpoint | null {
        const classMatch = section.match(/class[:\s]+[`]?(\w+)[`]?/i);
        if (!classMatch) {
            return null;
        }

        const fileMatch = section.match(/file[:\s]+[`]?([^\s`]+)[`]?/i);
        const typeMatch = section.match(/(SOAP|REST_MVC|REST_PLAIN|rest mvc|rest plain|soap)/i);
        const methodMatch = section.match(/(?:http\s*)?method[:\s]+[`]?(\w+)[`]?/i);
        const pathMatch = section.match(/path[:\s]+[`]?([^\s`]+)[`]?/i);

        let sourceType = SourceApiType.UNKNOWN;
        if (typeMatch) {
            const typeStr = typeMatch[1].toUpperCase().replace(/\s+/g, '_');
            sourceType = (SourceApiType as Record<string, SourceApiType>)[typeStr] || SourceApiType.UNKNOWN;
        }

        return {
            filePath: fileMatch ? fileMatch[1] : '',
            className: classMatch[1],
            methodName: '',
            sourceType,
            httpMethod: methodMatch ? methodMatch[1].toUpperCase() : undefined,
            path: pathMatch ? pathMatch[1] : undefined,
            requestObjects: this.parseObjects(section, 'request'),
            responseObjects: this.parseObjects(section, 'response'),
            dependentObjects: this.parseObjects(section, 'dependent'),
            annotations: this.parseAnnotations(section),
            parentClasses: this.parseParentClasses(section),
            rawContent: section
        };
    }

    private parseObjects(section: string, type: string): ObjectDefinition[] {
        const objects: ObjectDefinition[] = [];
        const regex = new RegExp(`${type}[^:]*:[\\s]*[\\n]([\\s\\S]*?)(?=\\n(?:response|dependent|parent|annotation|###)|$)`, 'i');
        const match = section.match(regex);

        if (match) {
            const objectNames = match[1].match(/[`]?(\w+(?:DTO|Request|Response|Model|Entity|Bean|Vo|Dto))[`]?/g);
            if (objectNames) {
                for (const name of objectNames) {
                    const cleanName = name.replace(/`/g, '');
                    objects.push({
                        name: cleanName,
                        filePath: '',
                        fields: this.parseFields(match[1]),
                        rawContent: match[1]
                    });
                }
            }
        }

        return objects;
    }

    private parseFields(text: string): FieldDefinition[] {
        const fields: FieldDefinition[] = [];
        const fieldPattern = /[-*]\s*[`]?(\w+)[`]?\s*(?::|[(-])\s*[`]?(\w+(?:<[\w,\s]+>)?)[`]?/g;
        let match;

        while ((match = fieldPattern.exec(text)) !== null) {
            const fieldName = match[1];
            const fieldType = match[2];

            const isCollection = /List|Set|Collection|Array|Map/.test(fieldType);
            let collectionType: string | undefined;
            if (isCollection) {
                const genericMatch = fieldType.match(/<(\w+)>/);
                collectionType = genericMatch ? genericMatch[1] : undefined;
            }

            fields.push({
                name: fieldName,
                type: fieldType,
                isRequired: text.includes(`@NotNull`) || text.includes(`required`),
                isCollection,
                collectionType
            });
        }

        return fields;
    }

    private parseAnnotations(section: string): string[] {
        const annotations: string[] = [];
        const annotationPattern = /@(\w+(?:\([^)]*\))?)/g;
        let match;

        while ((match = annotationPattern.exec(section)) !== null) {
            annotations.push(`@${match[1]}`);
        }

        return [...new Set(annotations)];
    }

    private parseParentClasses(section: string): string[] {
        const parents: string[] = [];
        const extendsMatch = section.match(/extends\s+(\w+)/g);
        const implementsMatch = section.match(/implements\s+([\w,\s]+)/g);

        if (extendsMatch) {
            for (const ext of extendsMatch) {
                const className = ext.replace('extends ', '').trim();
                parents.push(className);
            }
        }

        if (implementsMatch) {
            for (const impl of implementsMatch) {
                const interfaces = impl.replace('implements ', '').split(',').map(i => i.trim());
                parents.push(...interfaces);
            }
        }

        return [...new Set(parents)];
    }
}
