import { z } from 'zod';

/** A TEXT column holding JSON that must match `schema`. */
export function jsonColumn<T extends z.ZodType>(schema: T) {
  return z
    .string()
    .transform((text, context): unknown => {
      try {
        const value: unknown = JSON.parse(text);
        return value;
      } catch {
        context.addIssue({ code: 'custom', message: 'Stored JSON is malformed' });
        return z.NEVER;
      }
    })
    .pipe(schema);
}
