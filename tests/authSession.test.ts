import assert from 'node:assert/strict';
import test from 'node:test';

type CreateInitialAuthState = (storage: { getItem(key: string): string | null }, pathname: string) => {
  user: { name: string; role: string; username?: string } | null;
  isLoggedIn: boolean;
  showLanding: boolean;
  showDatacoreLanding: boolean;
};

async function loadCreateInitialAuthState(): Promise<CreateInitialAuthState | undefined> {
  try {
    return (await import('../src/lib/authSession.ts')).createInitialAuthState;
  } catch {
    return undefined;
  }
}

test('restores a persisted authenticated user without showing either landing page', async () => {
  const createInitialAuthState = await loadCreateInitialAuthState();

  assert.equal(typeof createInitialAuthState, 'function');
  const values = new Map([
    ['token', 'valid-token'],
    ['oil_system_user', JSON.stringify({ name: '系统管理员', role: 'admin', username: 'admin' })],
  ]);
  const state = createInitialAuthState!({ getItem: (key) => values.get(key) ?? null }, '/datacore');

  assert.deepEqual(state, {
    user: { name: '系统管理员', role: 'admin', username: 'admin' },
    isLoggedIn: true,
    showLanding: false,
    showDatacoreLanding: false,
  });
});

test('does not restore a saved user without a token', async () => {
  const createInitialAuthState = await loadCreateInitialAuthState();
  assert.equal(typeof createInitialAuthState, 'function');
  const state = createInitialAuthState!({
    getItem: (key) => key === 'oil_system_user'
      ? JSON.stringify({ name: '系统管理员', role: 'admin', username: 'admin' })
      : null,
  }, '/datacore');

  assert.deepEqual(state, {
    user: null,
    isLoggedIn: false,
    showLanding: false,
    showDatacoreLanding: true,
  });
});
