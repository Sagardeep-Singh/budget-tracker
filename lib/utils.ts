import { Prisma } from '@prisma/client';

/**
 * Recursively converts Date and Prisma.Decimal fields to strings so service
 * results can cross the server -> client boundary as plain JSON.
 */
export const toSerializable = <T>(value: T): T => {
  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }
  if (value instanceof Prisma.Decimal) {
    return value.toString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = toSerializable(val);
    }
    return result as T;
  }
  return value;
};
