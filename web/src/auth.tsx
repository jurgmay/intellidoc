import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Anchor, Button, Center, Loader, Stack, Text, Title } from '@mantine/core';
import { nav, signInAgain } from './api/signIn';

export interface Me { name: string; email: string; roles: string[]; isAdmin: boolean; hasAccess: boolean; signedInByDevelopmentBypass: boolean }

/** No provider (as in most tests) means nobody is signed in and nothing is hidden. */
const AuthContext = createContext<Me | null>(null);
export const useMe = (): Me | null => useContext(AuthContext);
/** Settings and the margin report are for administrators. With no sign-in information everything shows (the API still decides). */
export const useIsAdmin = (): boolean => { const me = useMe(); return me ? me.isAdmin : true; };

export async function signOut(): Promise<void> {
  const res = await fetch('/api/auth/logout', { method: 'POST' });
  const { redirect } = (await res.json().catch(() => ({ redirect: '/' }))) as { redirect?: string };
  nav.to(redirect || '/');
}

function SignedOut() {
  return (
    <Center h="100vh"><Stack align="center" gap="sm">
      <Title order={3}>You have signed out</Title>
      <Text c="dimmed" size="sm">Close this window, or sign in again.</Text>
      <Button component="a" href="/api/auth/login">Sign in</Button>
    </Stack></Center>
  );
}
function NoAccess({ me }: { me: Me }) {
  return (
    <Center h="100vh"><Stack align="center" gap="sm" maw={460}>
      <Title order={3}>No access to IntelliDoc</Title>
      <Text ta="center">You are signed in as {me.name} ({me.email}), but this account has not been given a role in IntelliDoc. Ask an administrator to assign you one, then sign in again.</Text>
      <Anchor component="button" type="button" onClick={() => void signOut()}>Sign out</Anchor>
    </Stack></Center>
  );
}

/** Finds out who is signed in. Nobody: go and sign in. Signed in with no role: say so. Otherwise show the app. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ me: Me } | 'loading' | 'error'>('loading');
  const signedOutPage = window.location.pathname === '/signed-out';
  useEffect(() => {
    if (signedOutPage) return;
    void (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.status === 401) { signInAgain(); return; }
        if (!res.ok) throw new Error(String(res.status));
        setState({ me: (await res.json()) as Me });
      } catch { setState('error'); }
    })();
  }, [signedOutPage]);
  if (signedOutPage) return <SignedOut />;
  if (state === 'error') return <Center h="100vh"><Text c="red">Could not reach IntelliDoc. Reload the page to try again.</Text></Center>;
  if (state === 'loading') return <Center h="100vh"><Loader /></Center>;
  if (!state.me.hasAccess) return <NoAccess me={state.me} />;
  return <AuthContext.Provider value={state.me}>{children}</AuthContext.Provider>;
}
