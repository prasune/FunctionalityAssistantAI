import { HttpCall, WireMockStub } from './types';

/**
 * Generates WireMock stub Java code from parsed downstream HTTP calls.
 */
export class WireMockGenerator {

  /**
   * Generate WireMock stub code for a single downstream call.
   */
  generateStub(call: HttpCall, index: number): WireMockStub {
    const name = this.generateStubName(call, index);
    const javaCode = this.generateStubJavaCode(call, name);

    return { name, downstreamCall: call, javaCode };
  }

  /**
   * Generate all WireMock stubs for a list of downstream calls.
   */
  generateStubs(calls: HttpCall[]): WireMockStub[] {
    return calls.map((call, index) => this.generateStub(call, index));
  }

  /**
   * Generate a descriptive name for the WireMock stub.
   */
  private generateStubName(call: HttpCall, index: number): string {
    const path = call.path || '/unknown';
    const segments = path.split('/').filter(s => s.length > 0);
    const lastSegment = segments[segments.length - 1] || 'endpoint';
    const cleanSegment = lastSegment.replace(/[^a-zA-Z0-9]/g, '');
    return `stub${call.method.charAt(0) + call.method.slice(1).toLowerCase()}${cleanSegment.charAt(0).toUpperCase() + cleanSegment.slice(1)}_${index}`;
  }

  /**
   * Generate the Java code for a WireMock stub setup.
   */
  private generateStubJavaCode(call: HttpCall, stubName: string): string {
    const lines: string[] = [];
    const wireMockMethod = this.getWireMockMethodName(call.method);

    lines.push(`    // Stub: ${call.method} ${call.path}`);
    lines.push(`    private void ${stubName}() {`);
    lines.push(`        stubFor(${wireMockMethod}(urlPathEqualTo("${this.escapeJavaString(call.path)}"))`);

    // Add request header matchers
    const relevantHeaders = call.requestHeaders.filter(h =>
      !['host', 'connection', 'content-length', 'user-agent', 'accept-encoding']
        .includes(h.name.toLowerCase())
    );

    for (const header of relevantHeaders) {
      lines.push(`            .withHeader("${this.escapeJavaString(header.name)}", equalTo("${this.escapeJavaString(header.value)}"))`);
    }

    // Add request body matcher for POST/PUT/PATCH
    if (call.requestBody && ['POST', 'PUT', 'PATCH'].includes(call.method)) {
      if (this.isValidJson(call.requestBody)) {
        lines.push(`            .withRequestBody(equalToJson(${this.formatJsonString(call.requestBody)}))`);
      } else {
        lines.push(`            .withRequestBody(equalTo("${this.escapeJavaString(call.requestBody)}"))`);
      }
    }

    // Build response
    lines.push(`            .willReturn(aResponse()`);
    lines.push(`                .withStatus(${call.responseStatusCode})`);

    // Add response headers
    const contentTypeHeader = call.responseHeaders.find(h =>
      h.name.toLowerCase() === 'content-type'
    );
    if (contentTypeHeader) {
      lines.push(`                .withHeader("Content-Type", "${this.escapeJavaString(contentTypeHeader.value)}")`);
    } else if (call.responseBody && this.isValidJson(call.responseBody)) {
      lines.push(`                .withHeader("Content-Type", "application/json")`);
    }

    // Add response body
    if (call.responseBody) {
      if (this.isValidJson(call.responseBody)) {
        lines.push(`                .withBody(${this.formatJsonString(call.responseBody)})`);
      } else {
        lines.push(`                .withBody("${this.escapeJavaString(call.responseBody)}")`);
      }
    }

    lines.push(`            ));`);
    lines.push(`    }`);

    return lines.join('\n');
  }

  /**
   * Generate a combined setup method that calls all stub methods.
   */
  generateCombinedSetupMethod(stubs: WireMockStub[]): string {
    const lines: string[] = [];
    lines.push(`    protected void setupWireMockStubs() {`);

    for (const stub of stubs) {
      lines.push(`        ${stub.name}();`);
    }

    lines.push(`    }`);
    return lines.join('\n');
  }

  /**
   * Generate the WireMock static imports needed.
   */
  generateImports(): string[] {
    return [
      'import static com.github.tomakehurst.wiremock.client.WireMock.stubFor;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.get;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.post;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.put;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.delete;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.patch;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.equalToJson;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;',
      'import static com.github.tomakehurst.wiremock.client.WireMock.resetAllRequests;'
    ];
  }

  /**
   * Map HTTP method to WireMock method name.
   */
  private getWireMockMethodName(method: string): string {
    const mapping: Record<string, string> = {
      'GET': 'get',
      'POST': 'post',
      'PUT': 'put',
      'DELETE': 'delete',
      'PATCH': 'patch',
      'HEAD': 'head',
      'OPTIONS': 'options'
    };
    return mapping[method.toUpperCase()] || 'get';
  }

  /**
   * Escape special characters for Java string literals.
   */
  private escapeJavaString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Format a JSON string for use in Java code as a multi-line string or inline.
   */
  private formatJsonString(json: string): string {
    try {
      const parsed = JSON.parse(json);
      const prettyJson = JSON.stringify(parsed, null, 2);
      const lines = prettyJson.split('\n');

      if (lines.length <= 1) {
        return `"${this.escapeJavaString(prettyJson)}"`;
      }

      // Use concatenated string for multi-line JSON
      const javaLines = lines.map((line, i) => {
        const escaped = this.escapeJavaString(line);
        if (i === 0) {
          return `"${escaped}\\n"`;
        } else if (i === lines.length - 1) {
          return `                    + "${escaped}"`;
        } else {
          return `                    + "${escaped}\\n"`;
        }
      });

      return javaLines.join('\n');
    } catch {
      return `"${this.escapeJavaString(json)}"`;
    }
  }

  /**
   * Check if a string is valid JSON.
   */
  private isValidJson(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }
}
