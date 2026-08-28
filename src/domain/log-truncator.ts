export class LogTruncator {
  private static readonly MAX_LOG_SIZE = 12000;
  private static readonly HEAD_LINES = 100;
  private static readonly TAIL_LINES = 200;

  private static readonly ANSI_REGEX = /\u001b\[[0-9;]*[a-zA-Z]/g;
  private static readonly ERROR_PATTERNS = [
    /error/i,
    /fail/i,
    /exception/i,
    /fatal/i,
    /critical/i,
    /panic/i,
    /traceback/i,
    /nullpointer/i,
    /stacktrace/i,
    /\[5\d{2}\]/,
  ];

  public truncate(rawLog: string | null | undefined): string {
    if (!rawLog || rawLog.trim().length === 0) {
      return "";
    }

    // 1. Strip ANSI escape sequences
    const cleanLog = rawLog.replace(LogTruncator.ANSI_REGEX, "");

    // 2. If short enough, return as is
    if (cleanLog.length <= LogTruncator.MAX_LOG_SIZE) {
      return cleanLog;
    }

    // 3. Line-based truncation with error preservation
    const lines = cleanLog.split("\n");
    if (lines.length <= LogTruncator.HEAD_LINES + LogTruncator.TAIL_LINES) {
      return cleanLog.substring(cleanLog.length - LogTruncator.MAX_LOG_SIZE);
    }

    const head = lines.slice(0, LogTruncator.HEAD_LINES);
    const middle = lines.slice(LogTruncator.HEAD_LINES, lines.length - LogTruncator.TAIL_LINES);
    const tail = lines.slice(lines.length - LogTruncator.TAIL_LINES);

    // Extract any critical error lines from the middle segment
    const errorLinesFromMiddle = middle.filter((line) =>
      LogTruncator.ERROR_PATTERNS.some((pattern) => pattern.test(line))
    );

    const result: string[] = [];
    result.push(...head);

    if (errorLinesFromMiddle.length > 0) {
      result.push("\n--- [Truncated middle section: Preserved Error Frames] ---");
      // Keep up to 50 most relevant error frames from the middle
      result.push(...errorLinesFromMiddle.slice(0, 50));
      result.push("--- [End of Preserved Error Frames] ---\n");
    } else {
      result.push(`\n... [Truncated ${middle.length} non-critical lines] ...\n`);
    }

    result.push(...tail);

    const truncated = result.join("\n");
    if (truncated.length > LogTruncator.MAX_LOG_SIZE) {
      return (
        truncated.substring(0, 1000) +
        "\n...[truncated]...\n" +
        truncated.substring(truncated.length - (LogTruncator.MAX_LOG_SIZE - 1000))
      );
    }

    return truncated;
  }
}
