import { z } from 'zod';

/**
 * The same schema with every object, at any depth, set to strip unknown keys instead of refusing them.
 * Clients parse host replies with it, so an older app keeps working when a newer host adds fields.
 * Checks, refinements, transforms and defaults are kept; lazy schemas (such as `z.json()`) are left as they are.
 */
export function lenient<T extends z.core.$ZodType>(schema: T): T {
  if (schema instanceof z.ZodObject) {
    const { def } = schema._zod;
    const shape = Object.fromEntries(Object.entries(def.shape).map(([key, value]) => [key, lenient(value)]));
    return schema.clone({ ...def, shape, catchall: undefined });
  }
  if (schema instanceof z.ZodArray) {
    const { def } = schema._zod;
    return schema.clone({ ...def, element: lenient(def.element) });
  }
  if (schema instanceof z.ZodRecord) {
    const { def } = schema._zod;
    return schema.clone({ ...def, valueType: lenient(def.valueType) });
  }
  if (schema instanceof z.ZodUnion) {
    const { def } = schema._zod;
    return schema.clone({ ...def, options: def.options.map((option) => lenient(option)) });
  }
  if (schema instanceof z.ZodIntersection) {
    const { def } = schema._zod;
    return schema.clone({ ...def, left: lenient(def.left), right: lenient(def.right) });
  }
  if (schema instanceof z.ZodTuple) {
    const { def } = schema._zod;
    return schema.clone({ ...def, items: def.items.map((item) => lenient(item)), rest: def.rest === null ? null : lenient(def.rest) });
  }
  if (schema instanceof z.ZodPipe) {
    const { def } = schema._zod;
    return schema.clone({ ...def, in: lenient(def.in), out: lenient(def.out) });
  }
  if (schema instanceof z.ZodOptional) {
    const { def } = schema._zod;
    return schema.clone({ ...def, innerType: lenient(def.innerType) });
  }
  if (schema instanceof z.ZodNullable) {
    const { def } = schema._zod;
    return schema.clone({ ...def, innerType: lenient(def.innerType) });
  }
  if (schema instanceof z.ZodDefault) {
    const { def } = schema._zod;
    return schema.clone({ ...def, innerType: lenient(def.innerType) });
  }
  if (schema instanceof z.ZodPrefault) {
    const { def } = schema._zod;
    return schema.clone({ ...def, innerType: lenient(def.innerType) });
  }
  if (schema instanceof z.ZodNonOptional) {
    const { def } = schema._zod;
    return schema.clone({ ...def, innerType: lenient(def.innerType) });
  }
  if (schema instanceof z.ZodReadonly) {
    const { def } = schema._zod;
    return schema.clone({ ...def, innerType: lenient(def.innerType) });
  }
  if (schema instanceof z.ZodCatch) {
    const { def } = schema._zod;
    return schema.clone({ ...def, innerType: lenient(def.innerType) });
  }
  return schema;
}
