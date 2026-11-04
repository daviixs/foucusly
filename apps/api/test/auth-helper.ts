import { signToken } from "../src/auth/index.js";

export const TEST_AUTH_SECRET = "test-secret-not-for-production-0123456789";
process.env.AUTH_SECRET = TEST_AUTH_SECRET;

export function authHeader(profileId: string): string {
  return `Bearer ${signToken(profileId, TEST_AUTH_SECRET)}`;
}
