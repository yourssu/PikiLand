export class LlmLogClassifierService {
  /**
   * Distinguishes genuine application bugs/exceptions from false positives
   * (e.g. user input strings like "search?q=500" or simple non-error text containing numbers).
   */
  public isGenuineApplicationError(rawLog: string): boolean {
    if (!rawLog || rawLog.trim().length === 0) {
      return false;
    }

    const trimmed = rawLog.trim();

    // 1. Rejection heuristic: pure number or simple query parameter inputs
    if (/^\d{3}$/.test(trimmed) || /^[\w_]+=\d+$/.test(trimmed)) {
      return false;
    }

    // 2. Rejection heuristic: HTTP access log lines with 2xx/3xx/4xx without explicit error stacks
    if (
      /HTTP\/1\.[01]"\s+[234]\d{2}/.test(trimmed) &&
      !/(exception|error|fatal|panic|traceback|stacktrace|nullpointer)/i.test(trimmed)
    ) {
      return false;
    }

    // 3. Positive indicators: presence of stack trace symbols, exception class names, or explicit crash logs
    const errorIndicators = [
      /\b(Exception|Error|Fatal|Panic|Critical|Severe)\b/i,
      /\bat\s+[\w$.]+\([\w$.]+:\d+\)/, // Java / Node stack trace
      /File ".*", line \d+, in /, // Python traceback
      /goroutine \d+ \[running\]:/, // Go panic stack
      /statuscode\s*=\s*5\d{2}/i,
      /HTTP\/[12](\.[01])?\s+5\d{2}/,
    ];

    return errorIndicators.some((regex) => regex.test(trimmed));
  }
}

export const llmLogClassifierService = new LlmLogClassifierService();
