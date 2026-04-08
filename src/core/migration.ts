function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeQuestionStatusMap<T = unknown>(
  questionStatusMap: Record<string, T> | null | undefined,
): Record<string, T> {
  if (!isPlainObject(questionStatusMap)) return {};
  return Object.entries(questionStatusMap).reduce((acc, [questionId, questionState]) => {
    acc[String(questionId)] = questionState as T;
    return acc;
  }, {} as Record<string, T>);
}
