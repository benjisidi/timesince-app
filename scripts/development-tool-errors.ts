export function reportDevelopmentToolError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Development database error: ${message}`);
  process.exitCode = 1;
}
