import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const USERNAME_DOMAIN = "veltrix.xyz";

function usernameToEmail(input: string): string {
  const v = input.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${USERNAME_DOMAIN}`;
}

type AuthState = {
  authed: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
  sessionToken: string | null;
  signInWithUsername: (username: string, password: string) => Promise<{ error?: string }>;
  signUpWithUsername: (
    username: string,
    password: string,
    refCode?: string,
  ) => Promise<{ error?: string; recoveryToken?: string }>;
  recoverAccount: (
    username: string,
    token: string,
    newPassword: string,
  ) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithUsername = async (username: string, password: string) => {
    const email = usernameToEmail(username);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  };

  const signUpWithUsername = async (
    username: string,
    password: string,
    refCode?: string,
  ) => {
    const uname = username.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(uname)) {
      return { error: "Username must be 3–20 chars (letters, numbers, _)" };
    }
    if (!password || password.length < 6) {
      return { error: "Password must be at least 6 characters" };
    }
    const email = `${uname}@${USERNAME_DOMAIN}`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          username: uname,
          full_name: uname,
          ...(refCode ? { ref_code: refCode } : {}),
        },
      },
    });
    if (error) return { error: error.message };
    return {};
  };

  const recoverAccount = async (_username: string, _token: string, _newPassword: string) => {
    return { error: "Account recovery not yet implemented" };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        authed: !!session,
        loading,
        user,
        session,
        sessionToken: session?.access_token ?? null,
        signInWithUsername,
        signUpWithUsername,
        recoverAccount,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
