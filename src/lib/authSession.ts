export type StoredUserInfo = {
  name: string;
  role: string;
  username?: string;
};

type SessionStorageReader = {
  getItem(key: string): string | null;
};

export function createInitialAuthState(storage: SessionStorageReader, pathname: string) {
  let user: StoredUserInfo | null = null;
  const token = storage.getItem('token');
  const savedUser = storage.getItem('oil_system_user');

  if (token && savedUser) {
    try {
      const parsed = JSON.parse(savedUser);
      if (parsed?.name && parsed?.role) user = parsed;
    } catch {
      user = null;
    }
  }

  return {
    user,
    isLoggedIn: Boolean(user),
    showLanding: !user && pathname === '/axon',
    showDatacoreLanding: !user && pathname !== '/axon',
  };
}
