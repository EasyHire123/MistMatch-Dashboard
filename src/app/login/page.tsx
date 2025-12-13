'use client';

import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!;

export default function LoginPage() {
  const router = useRouter();

  // Auto-redirect if already logged in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        checkAdminAndRedirect(session.user.id);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        checkAdminAndRedirect(session.user.id);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const checkAdminAndRedirect = async (userId: string) => {
    const { data } = await supabase
      .from('admins')
      .select('id')
      .eq('id', userId)
      .single();

    if (data) {
      // This line ALWAYS works
      window.location.replace('/dashboard');
    }
  };

  const handleSuccess = async (response: any) => {
    const { credential } = response;
    await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: credential,
    });
    // No router.push here — the onAuthStateChange above will catch it and redirect
  };

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 p-12 rounded-2xl shadow-2xl">
          <h1 className="text-4xl font-bold text-amber-400 text-center mb-10">
            Admin Login
          </h1>
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => alert('Google login failed')}
              useOneTap
            />
          </div>
        </div>
      </div>
    </GoogleOAuthProvider>
  );
}