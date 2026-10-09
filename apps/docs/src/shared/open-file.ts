/** Both Word formats use the DOCX editor; legacy DOC is converted before loading. */
export function findDocxPath(argv: readonly string[]): string | null {
  return (
    argv.find((arg) => {
      const value = arg.trim()
      return value.length > 0 && !value.startsWith('-') && /\.(docx|doc)$/i.test(value)
    }) ?? null
  )
}
