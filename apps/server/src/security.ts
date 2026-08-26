import { timingSafeEqual } from "node:crypto";

export function secureSecretEqual(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string") return false;
  const left = Buffer.from(candidate); const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
