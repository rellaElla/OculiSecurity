import jwt from 'jsonwebtoken';

export const TEST_JWT_SECRET = 'test-secret-change-in-production-min32chars!!';

export interface TokenOptions {
  actor?: string;
  orgId?: string;
  roles?: string[];
  expiresIn?: string | number;
}

export function generateTestToken(options: TokenOptions = {}): string {
  const {
    actor = 'test-user',
    orgId = 'test-org',
    roles = ['editor'],
    expiresIn = '1h',
  } = options;

  return jwt.sign(
    { sub: actor, actor, orgId, roles },
    TEST_JWT_SECRET,
    { expiresIn }
  );
}
