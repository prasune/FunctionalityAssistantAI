import { HttpCall, HttpHeader, ApiCallChain, ParsedLogResult } from './types';

/**
 * Parses Splunk/local log files to extract API calls and their downstream dependencies.
 * 
 * Supports multiple log formats:
 * 1. Standard HTTP logging (request/response lines)
 * 2. JSON-structured logs (common in microservices)
 * 3. Key-value pair Splunk logs
 */
export class LogParser {

  /**
   * Parse the log file content and extract API call chains.
   */
  parse(logContent: string): ParsedLogResult {
    const warnings: string[] = [];
    const lines = logContent.split('\n').filter(line => line.trim().length > 0);

    if (lines.length === 0) {
      return { apiCallChains: [], warnings: ['Log file is empty'], rawLogContent: logContent };
    }

    // Try JSON-structured log parsing first
    const jsonCalls = this.tryParseJsonLogs(lines, warnings);
    if (jsonCalls.length > 0) {
      const chains = this.buildCallChains(jsonCalls, warnings);
      return { apiCallChains: chains, warnings, rawLogContent: logContent };
    }

    // Try key-value Splunk format
    const kvCalls = this.tryParseKeyValueLogs(lines, warnings);
    if (kvCalls.length > 0) {
      const chains = this.buildCallChains(kvCalls, warnings);
      return { apiCallChains: chains, warnings, rawLogContent: logContent };
    }

    // Fall back to standard HTTP logging pattern
    const httpCalls = this.tryParseStandardHttpLogs(lines, warnings);
    if (httpCalls.length > 0) {
      const chains = this.buildCallChains(httpCalls, warnings);
      return { apiCallChains: chains, warnings, rawLogContent: logContent };
    }

    // Final fallback: try to extract any HTTP-like patterns
    const fallbackCalls = this.tryParseFallback(lines, warnings);
    if (fallbackCalls.length > 0) {
      const chains = this.buildCallChains(fallbackCalls, warnings);
      return { apiCallChains: chains, warnings, rawLogContent: logContent };
    }

    warnings.push('Could not parse any API calls from the log file. Please ensure the log contains HTTP request/response data.');
    return { apiCallChains: [], warnings, rawLogContent: logContent };
  }

  /**
   * Try to parse JSON-structured log lines.
   * Common in microservices using structured logging (logback JSON, etc.)
   */
  private tryParseJsonLogs(lines: string[], warnings: string[]): HttpCall[] {
    const calls: HttpCall[] = [];

    for (const line of lines) {
      try {
        // Try to extract JSON from the line
        const jsonMatch = line.match(/\{.*\}/s);
        if (!jsonMatch) {continue;}

        const parsed = JSON.parse(jsonMatch[0]);

        // Look for HTTP call indicators in the JSON
        if (this.isHttpCallJson(parsed)) {
          const call = this.extractHttpCallFromJson(parsed);
          if (call) {
            calls.push(call);
          }
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    return calls;
  }

  /**
   * Check if a JSON object represents an HTTP call log entry.
   */
  private isHttpCallJson(obj: Record<string, unknown>): boolean {
    const httpIndicators = [
      'httpMethod', 'http_method', 'method', 'requestMethod',
      'requestUrl', 'request_url', 'url', 'uri', 'path',
      'statusCode', 'status_code', 'responseCode', 'response_code', 'httpStatus',
      'request', 'response'
    ];

    return httpIndicators.some(key =>
      key in obj ||
      (typeof obj === 'object' && obj !== null &&
        Object.keys(obj).some(k => k.toLowerCase().includes('request') || k.toLowerCase().includes('response')))
    );
  }

  /**
   * Extract an HttpCall from a JSON log object.
   */
  private extractHttpCallFromJson(obj: Record<string, unknown>): HttpCall | null {
    const method = this.extractStringField(obj, ['httpMethod', 'http_method', 'method', 'requestMethod']) || 'GET';
    const url = this.extractStringField(obj, ['requestUrl', 'request_url', 'url', 'uri', 'requestUri', 'request_uri']) || '';
    const statusCode = this.extractNumberField(obj, ['statusCode', 'status_code', 'responseCode', 'response_code', 'httpStatus', 'status']) || 200;
    const traceId = this.extractStringField(obj, ['traceId', 'trace_id', 'correlationId', 'correlation_id', 'x-trace-id', 'requestId', 'request_id']);
    const timestamp = this.extractStringField(obj, ['timestamp', 'time', '@timestamp', 'date']);
    const duration = this.extractNumberField(obj, ['duration', 'durationMs', 'duration_ms', 'elapsed', 'responseTime', 'response_time']);

    if (!url) {return null;}

    // Extract request/response bodies
    let requestBody: string | null = null;
    let responseBody: string | null = null;
    const requestHeaders: HttpHeader[] = [];
    const responseHeaders: HttpHeader[] = [];

    const requestObj = obj['requestBody'] || obj['request_body'] || obj['request'];
    if (requestObj && typeof requestObj === 'object') {
      requestBody = JSON.stringify(requestObj);
    } else if (typeof requestObj === 'string') {
      requestBody = requestObj;
    }

    const responseObj = obj['responseBody'] || obj['response_body'] || obj['response'];
    if (responseObj && typeof responseObj === 'object') {
      responseBody = JSON.stringify(responseObj);
    } else if (typeof responseObj === 'string') {
      responseBody = responseObj;
    }

    // Extract headers if present
    const reqHeaders = obj['requestHeaders'] || obj['request_headers'] || obj['headers'];
    if (reqHeaders && typeof reqHeaders === 'object' && !Array.isArray(reqHeaders)) {
      for (const [name, value] of Object.entries(reqHeaders as Record<string, unknown>)) {
        requestHeaders.push({ name, value: String(value) });
      }
    }

    const resHeaders = obj['responseHeaders'] || obj['response_headers'];
    if (resHeaders && typeof resHeaders === 'object' && !Array.isArray(resHeaders)) {
      for (const [name, value] of Object.entries(resHeaders as Record<string, unknown>)) {
        responseHeaders.push({ name, value: String(value) });
      }
    }

    const path = this.extractPath(url);

    return {
      method: method.toUpperCase(),
      url,
      path,
      requestHeaders,
      requestBody,
      responseStatusCode: statusCode,
      responseHeaders,
      responseBody,
      traceId: traceId || null,
      timestamp: timestamp || null,
      durationMs: duration || null
    };
  }

  /**
   * Try to parse key-value format Splunk logs.
   * Format: key1=value1 key2=value2 key3="value with spaces"
   */
  private tryParseKeyValueLogs(lines: string[], warnings: string[]): HttpCall[] {
    const calls: HttpCall[] = [];
    let currentCall: Partial<HttpCall> | null = null;

    for (const line of lines) {
      const kvPairs = this.parseKeyValuePairs(line);
      if (Object.keys(kvPairs).length === 0) {continue;}

      // Check if this line contains HTTP call data
      const hasHttpData = Object.keys(kvPairs).some(k => {
        const lower = k.toLowerCase();
        return lower.includes('url') || lower.includes('uri') || lower.includes('method') ||
               lower.includes('status') || lower.includes('request') || lower.includes('response');
      });

      if (!hasHttpData) {continue;}

      const method = kvPairs['method'] || kvPairs['httpMethod'] || kvPairs['http_method'] || '';
      const url = kvPairs['url'] || kvPairs['uri'] || kvPairs['requestUrl'] || kvPairs['request_url'] || '';
      const statusStr = kvPairs['status'] || kvPairs['statusCode'] || kvPairs['status_code'] || kvPairs['responseCode'] || '';
      const statusCode = parseInt(statusStr, 10) || 0;
      const traceId = kvPairs['traceId'] || kvPairs['trace_id'] || kvPairs['correlationId'] || kvPairs['correlation_id'] || null;
      const timestamp = kvPairs['timestamp'] || kvPairs['time'] || null;
      const durationStr = kvPairs['duration'] || kvPairs['durationMs'] || kvPairs['duration_ms'] || '';
      const durationMs = parseInt(durationStr, 10) || null;

      // Detect request vs response lines
      const direction = kvPairs['direction'] || kvPairs['type'] || kvPairs['eventType'] || '';
      const isRequest = direction.toLowerCase().includes('request') || line.toLowerCase().includes('request');
      const isResponse = direction.toLowerCase().includes('response') || line.toLowerCase().includes('response');

      if (isRequest && url) {
        currentCall = {
          method: (method || 'GET').toUpperCase(),
          url,
          path: this.extractPath(url),
          requestHeaders: [],
          requestBody: kvPairs['body'] || kvPairs['requestBody'] || kvPairs['request_body'] || null,
          responseStatusCode: 0,
          responseHeaders: [],
          responseBody: null,
          traceId: traceId || null,
          timestamp: timestamp || null,
          durationMs
        };
      } else if (isResponse && currentCall) {
        currentCall.responseStatusCode = statusCode || 200;
        currentCall.responseBody = kvPairs['body'] || kvPairs['responseBody'] || kvPairs['response_body'] || null;
        if (currentCall.method && currentCall.url && currentCall.path) {
          calls.push(currentCall as HttpCall);
        }
        currentCall = null;
      } else if (url && method) {
        // Single-line log entry with all data
        calls.push({
          method: method.toUpperCase(),
          url,
          path: this.extractPath(url),
          requestHeaders: [],
          requestBody: kvPairs['requestBody'] || kvPairs['request_body'] || kvPairs['body'] || null,
          responseStatusCode: statusCode || 200,
          responseHeaders: [],
          responseBody: kvPairs['responseBody'] || kvPairs['response_body'] || null,
          traceId: traceId || null,
          timestamp: timestamp || null,
          durationMs
        });
      }
    }

    if (currentCall && currentCall.method && currentCall.url && currentCall.path) {
      warnings.push('Found an incomplete request without a matching response.');
      currentCall.responseStatusCode = currentCall.responseStatusCode || 200;
      calls.push(currentCall as HttpCall);
    }

    return calls;
  }

  /**
   * Parse key-value pairs from a line.
   */
  private parseKeyValuePairs(line: string): Record<string, string> {
    const pairs: Record<string, string> = {};
    // Match key=value or key="quoted value" patterns
    const regex = /(\w+)=(?:"([^"]*?)"|'([^']*?)'|(\S+))/g;
    let match;

    while ((match = regex.exec(line)) !== null) {
      const key = match[1];
      const value = match[2] ?? match[3] ?? match[4];
      pairs[key] = value;
    }

    return pairs;
  }

  /**
   * Try to parse standard HTTP logging format.
   * Looks for patterns like:
   * - "Sending request: POST http://..."
   * - "Request: GET /api/v1/users"
   * - "Response: 200 OK"
   * - ">> POST http://..."
   * - "<< 200"
   */
  private tryParseStandardHttpLogs(lines: string[], warnings: string[]): HttpCall[] {
    const calls: HttpCall[] = [];
    let currentCall: Partial<HttpCall> | null = null;
    let collectingRequestBody = false;
    let collectingResponseBody = false;
    let bodyBuffer = '';

    const requestPattern = /(?:(?:Sending|Outgoing|>>|->|Request|Calling|Invoking|Downstream)\s*(?:request)?[:\s]*)(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(https?:\/\/[^\s]+|\/[^\s]*)/i;
    const responsePattern = /(?:(?:Received|Incoming|<<|<-|Response|Result)\s*(?:response)?[:\s]*)(?:HTTP\/[\d.]+\s+)?(\d{3})\s*/i;
    const statusOnlyPattern = /(?:status|statusCode|response_code)\s*[=:]\s*(\d{3})/i;
    const bodyStartPattern = /(?:(?:Request|Response)\s*[Bb]ody|payload)[:\s]*(.*)$/i;
    const headerPattern = /^\s*([\w-]+)\s*:\s*(.+)$/;
    const tracePattern = /(?:trace[-_]?[Ii]d|correlation[-_]?[Ii]d|request[-_]?[Ii]d)\s*[=:]\s*([^\s,]+)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for trace ID
      const traceMatch = line.match(tracePattern);
      const traceId = traceMatch ? traceMatch[1] : null;

      // Check for request line
      const requestMatch = line.match(requestPattern);
      if (requestMatch) {
        // Save previous call if exists
        if (currentCall && currentCall.method && currentCall.url) {
          if (collectingRequestBody) {
            currentCall.requestBody = bodyBuffer.trim() || null;
          }
          if (collectingResponseBody) {
            currentCall.responseBody = bodyBuffer.trim() || null;
          }
          currentCall.responseStatusCode = currentCall.responseStatusCode || 200;
          calls.push(currentCall as HttpCall);
        }

        collectingRequestBody = false;
        collectingResponseBody = false;
        bodyBuffer = '';

        currentCall = {
          method: requestMatch[1].toUpperCase(),
          url: requestMatch[2],
          path: this.extractPath(requestMatch[2]),
          requestHeaders: [],
          requestBody: null,
          responseStatusCode: 0,
          responseHeaders: [],
          responseBody: null,
          traceId: traceId || null,
          timestamp: this.extractTimestamp(line),
          durationMs: null
        };
        continue;
      }

      // Check for response line
      const responseMatch = line.match(responsePattern);
      const statusMatch = line.match(statusOnlyPattern);
      if ((responseMatch || statusMatch) && currentCall) {
        if (collectingRequestBody) {
          currentCall.requestBody = bodyBuffer.trim() || null;
          collectingRequestBody = false;
          bodyBuffer = '';
        }
        if (collectingResponseBody) {
          currentCall.responseBody = bodyBuffer.trim() || null;
          collectingResponseBody = false;
          bodyBuffer = '';
        }
        currentCall.responseStatusCode = parseInt(responseMatch ? responseMatch[1] : statusMatch![1], 10);
        if (traceId && !currentCall.traceId) {
          currentCall.traceId = traceId;
        }
        continue;
      }

      // Check for body content
      const bodyMatch = line.match(bodyStartPattern);
      if (bodyMatch && currentCall) {
        if (collectingRequestBody) {
          currentCall.requestBody = bodyBuffer.trim() || null;
        }
        if (collectingResponseBody) {
          currentCall.responseBody = bodyBuffer.trim() || null;
        }

        bodyBuffer = bodyMatch[1] || '';

        if (line.toLowerCase().includes('request')) {
          collectingRequestBody = true;
          collectingResponseBody = false;
        } else {
          collectingResponseBody = true;
          collectingRequestBody = false;
        }
        continue;
      }

      // Collect body lines
      if ((collectingRequestBody || collectingResponseBody) && currentCall) {
        // Stop collecting if we hit a new log entry (timestamp pattern)
        if (this.looksLikeNewLogEntry(line) && bodyBuffer.length > 0) {
          if (collectingRequestBody) {
            currentCall.requestBody = bodyBuffer.trim() || null;
            collectingRequestBody = false;
          }
          if (collectingResponseBody) {
            currentCall.responseBody = bodyBuffer.trim() || null;
            collectingResponseBody = false;
          }
          bodyBuffer = '';
        } else {
          bodyBuffer += (bodyBuffer ? '\n' : '') + line.trim();
        }
        continue;
      }

      // Check for headers when we have a current call
      if (currentCall && !collectingRequestBody && !collectingResponseBody) {
        const headerMatch2 = line.match(headerPattern);
        if (headerMatch2 && !this.looksLikeNewLogEntry(line)) {
          const header: HttpHeader = { name: headerMatch2[1], value: headerMatch2[2].trim() };
          if (currentCall.responseStatusCode) {
            currentCall.responseHeaders = currentCall.responseHeaders || [];
            currentCall.responseHeaders.push(header);
          } else {
            currentCall.requestHeaders = currentCall.requestHeaders || [];
            currentCall.requestHeaders.push(header);
          }
        }
      }
    }

    // Don't forget the last call
    if (currentCall && currentCall.method && currentCall.url) {
      if (collectingRequestBody) {
        currentCall.requestBody = bodyBuffer.trim() || null;
      }
      if (collectingResponseBody) {
        currentCall.responseBody = bodyBuffer.trim() || null;
      }
      currentCall.responseStatusCode = currentCall.responseStatusCode || 200;
      currentCall.path = currentCall.path || this.extractPath(currentCall.url);
      calls.push(currentCall as HttpCall);
    }

    return calls;
  }

  /**
   * Fallback parser that looks for any URL + method patterns.
   */
  private tryParseFallback(lines: string[], warnings: string[]): HttpCall[] {
    const calls: HttpCall[] = [];
    const urlMethodPattern = /(GET|POST|PUT|DELETE|PATCH)\s+(https?:\/\/[^\s]+|\/[^\s]*)/gi;

    const fullContent = lines.join('\n');
    let match;

    while ((match = urlMethodPattern.exec(fullContent)) !== null) {
      const method = match[1].toUpperCase();
      const url = match[2];

      // Try to find a nearby status code
      const nearby = fullContent.substring(match.index, Math.min(match.index + 500, fullContent.length));
      const statusMatch = nearby.match(/(?:status|code|response)[:\s=]*(\d{3})/i);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 200;

      // Try to find a nearby JSON body
      let requestBody: string | null = null;
      let responseBody: string | null = null;

      const jsonMatches = nearby.match(/\{[\s\S]*?\}/g);
      if (jsonMatches && jsonMatches.length > 0) {
        requestBody = this.tryParseJson(jsonMatches[0]);
        if (jsonMatches.length > 1) {
          responseBody = this.tryParseJson(jsonMatches[1]);
        }
      }

      calls.push({
        method,
        url,
        path: this.extractPath(url),
        requestHeaders: [],
        requestBody,
        responseStatusCode: statusCode,
        responseHeaders: [],
        responseBody,
        traceId: null,
        timestamp: null,
        durationMs: null
      });
    }

    if (calls.length > 0) {
      warnings.push('Used fallback parser - some request/response details may be incomplete. Consider using structured JSON logging for better results.');
    }

    return calls;
  }

  /**
   * Build API call chains from a flat list of HTTP calls.
   * Groups calls by trace ID or by sequence (first call = main, rest = downstream).
   */
  private buildCallChains(calls: HttpCall[], warnings: string[]): ApiCallChain[] {
    if (calls.length === 0) {return [];}

    // Try to group by trace ID first
    const traceGroups = new Map<string, HttpCall[]>();
    const noTraceIdCalls: HttpCall[] = [];

    for (const call of calls) {
      if (call.traceId) {
        const group = traceGroups.get(call.traceId) || [];
        group.push(call);
        traceGroups.set(call.traceId, group);
      } else {
        noTraceIdCalls.push(call);
      }
    }

    const chains: ApiCallChain[] = [];

    // Process trace-grouped calls
    for (const [, groupCalls] of traceGroups) {
      if (groupCalls.length === 0) {continue;}

      const mainCall = groupCalls[0];
      const downstreamCalls = groupCalls.slice(1);
      const testName = this.generateTestName(mainCall);

      chains.push({ mainCall, downstreamCalls, testName });
    }

    // Process calls without trace IDs
    if (noTraceIdCalls.length > 0) {
      if (chains.length === 0) {
        // If no trace-grouped chains exist, treat the first call as main and rest as downstream
        const mainCall = noTraceIdCalls[0];
        const downstreamCalls = noTraceIdCalls.slice(1);
        const testName = this.generateTestName(mainCall);

        chains.push({ mainCall, downstreamCalls, testName });
      } else {
        // Add ungrouped calls as downstream of the first chain
        warnings.push(`${noTraceIdCalls.length} call(s) without trace IDs were added as downstream calls to the first API chain.`);
        chains[0].downstreamCalls.push(...noTraceIdCalls);
      }
    }

    return chains;
  }

  /**
   * Generate a descriptive test name from an HTTP call.
   */
  private generateTestName(call: HttpCall): string {
    const path = call.path || call.url;
    const segments = path.split('/').filter(s => s.length > 0 && !s.startsWith('{') && !s.match(/^\d+$/));
    const lastSegments = segments.slice(-2);

    const nameParts = lastSegments.map(s =>
      s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, '')
    );

    return `test${call.method.charAt(0) + call.method.slice(1).toLowerCase()}${nameParts.join('')}`;
  }

  /**
   * Extract the path component from a URL.
   */
  private extractPath(url: string): string {
    try {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        return parsed.pathname + (parsed.search || '');
      }
      return url;
    } catch {
      return url;
    }
  }

  /**
   * Extract a timestamp from a log line.
   */
  private extractTimestamp(line: string): string | null {
    const patterns = [
      /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
      /(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2})/,
      /(\d{10,13})/ // Unix timestamp
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {return match[1];}
    }

    return null;
  }

  /**
   * Check if a line looks like a new log entry (has timestamp prefix).
   */
  private looksLikeNewLogEntry(line: string): boolean {
    return /^\s*\d{4}-\d{2}-\d{2}|^\s*\d{2}\/\w{3}\/\d{4}|^\s*\[?\d{2}:\d{2}:\d{2}/.test(line);
  }

  /**
   * Extract a string field from an object by trying multiple key names.
   */
  private extractStringField(obj: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      if (key in obj && typeof obj[key] === 'string') {
        return obj[key] as string;
      }
    }
    return null;
  }

  /**
   * Extract a number field from an object by trying multiple key names.
   */
  private extractNumberField(obj: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      if (key in obj) {
        const val = obj[key];
        if (typeof val === 'number') {return val;}
        if (typeof val === 'string') {
          const parsed = parseInt(val, 10);
          if (!isNaN(parsed)) {return parsed;}
        }
      }
    }
    return null;
  }

  /**
   * Try to parse a string as JSON. Return the string if valid, null otherwise.
   */
  private tryParseJson(str: string): string | null {
    try {
      JSON.parse(str);
      return str;
    } catch {
      return null;
    }
  }
}
