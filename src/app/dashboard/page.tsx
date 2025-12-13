'use client';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type User = {
  id: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  country: string | null;
  image_urls: string[] | null;
  verification_photo_url: string | null;
  is_verified: 'verified' | 'unverified' | 'pending' | null;
  created_at: string;
};

type PendingUser = User & {
  verification_photos: string[]; // Array of all photos in the folder
};

type ImageLoaderProps = {
  src: string;
  alt: string;
  className: string;
};

function ImageWithLoader({ src, alt, className }: ImageLoaderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="relative w-full h-96 rounded-2xl overflow-hidden shadow-2xl group">
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 rounded-2xl">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-transform group-hover:scale-105 ${className} ${hasError ? 'hidden' : ''}`}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
      />
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-gray-500 rounded-2xl">
          Failed to load image
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [currentUser, setCurrentUser] = useState<PendingUser | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [adminName, setAdminName] = useState('Admin');
  const [genderUpdateStatus, setGenderUpdateStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setAdminName(data.user?.user_metadata?.full_name || data.user?.email?.split('@')[0] || 'Admin');
    });
    loadPendingUsers();
    const interval = setInterval(() => {
      loadPendingUsers();
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  async function loadPendingUsers() {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('is_verified', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading pending users:', error);
      setPendingUsers([]);
      return;
    }

    const usersWithPhotos = await Promise.all(
      (data || []).map(async (user: User) => {
        const { data: files } = await supabase.storage
          .from('verificationphotos')
          .list(user.id, { limit: 100 });
        const photoUrls = files
          ?.filter(f => f.name.endsWith('.jpg') || f.name.endsWith('.png') || f.name.endsWith('.jpeg'))
          .map(f => supabase.storage.from('verificationphotos').getPublicUrl(`${user.id}/${f.name}`).data.publicUrl) || [];
        return { ...user, verification_photos: photoUrls } as PendingUser;
      })
    );
    setPendingUsers(usersWithPhotos);
  }

  function startVerification() {
    if (pendingUsers.length === 0) return;
    setIsVerifying(true);
    setCurrentUser(pendingUsers[0]);
  }

  function handleDecision(decision: 'verified' | 'rejected') {
    if (!currentUser) return;
    const updatePromise = supabase
      .from('users')
      .update({ is_verified: decision })
      .eq('id', currentUser.id);

    updatePromise.then(() => {
      const remaining = pendingUsers.filter(u => u.id !== currentUser.id);
      setPendingUsers(remaining);
      if (remaining.length > 0) {
        setCurrentUser(remaining[0]);
      } else {
        setCurrentUser(null);
        setIsVerifying(false);
      }
    });
  }

  async function handleGenderChange(newGender: string) {
    if (!currentUser) return;
    setGenderUpdateStatus('saving');

    const { error } = await supabase
      .from('users')
      .update({ gender: newGender })
      .eq('id', currentUser.id);

    if (error) {
      console.error('Error updating gender:', error);
      setGenderUpdateStatus('error');
      setTimeout(() => setGenderUpdateStatus('idle'), 3000);
    } else {
      setCurrentUser({ ...currentUser, gender: newGender });
      setPendingUsers(prev =>
        prev.map(u => (u.id === currentUser.id ? { ...u, gender: newGender } : u))
      );
      setGenderUpdateStatus('success');
      setTimeout(() => setGenderUpdateStatus('idle'), 2000);
    }
  }

  const genderOptions = ['Male', 'Female'];

  if (!isVerifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-10">
            <div>
              <h1 className="text-5xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                MistMatch Admin
              </h1>
              <p className="text-xl text-gray-400 mt-2">Welcome back, <span className="text-amber-300 font-bold">{adminName}</span></p>
            </div>
            <button
              onClick={() => supabase.auth.signOut().then(() => router.push('/login'))}
              className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 px-6 py-3 rounded-xl font-bold text-lg transition-all duration-300 shadow-lg hover:shadow-xl"
            >
              Logout
            </button>
          </div>
          <div className="flex justify-center mb-10">
            <button
              onClick={startVerification}
              disabled={pendingUsers.length === 0}
              className="group bg-gradient-to-r from-green-600 via-blue-600 to-purple-600 px-12 py-6 rounded-2xl font-bold text-2xl transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl hover:shadow-3xl"
            >
              Verify Users ({pendingUsers.length} pending)
            </button>
          </div>
          {pendingUsers.length === 0 && (
            <div className="text-center text-gray-400 text-xl animate-pulse">
              No pending users at the moment. Great job!
            </div>
          )}
        </div>
      </div>
    );
  }

  // Verification Mode
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => setIsVerifying(false)}
          className="mb-8 px-6 py-3 bg-gray-800/50 backdrop-blur-sm rounded-xl font-bold text-lg hover:bg-gray-700/50 transition-all duration-300 border border-gray-600 hover:border-amber-500"
        >
          ← Back to Dashboard
        </button>

        <AnimatePresence mode="wait">
          {currentUser && (
            <motion.div
              key={currentUser.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-12"
            >
              {/* Main content: two columns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Left: Profile Photos - horizontal scrollable row (max 4 visible at once on large screens) */}
                <div className="space-y-6">
                  <h2 className="text-4xl font-bold text-center mb-8 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                    Profile Photos
                  </h2>
                  <div className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory">
                    {currentUser.image_urls?.slice(0, 4).map((url, i) => (
                      <div key={i} className="flex-none w-80 snap-center">
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <ImageWithLoader
                            src={url}
                            alt={`Profile ${i + 1}`}
                            className="rounded-2xl shadow-2xl"
                          />
                        </a>
                      </div>
                    ))}
                    {(!currentUser.image_urls || currentUser.image_urls.length === 0) && (
                      <p className="text-gray-500">No profile photos</p>
                    )}
                  </div>
                </div>

                {/* Right: Verification Photos + User Info */}
                <div className="space-y-8">
                  <h2 className="text-4xl font-bold text-center mb-8 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                    Verification Photos
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {currentUser.verification_photos?.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                        <ImageWithLoader
                          src={url}
                          alt={`Verification ${i + 1}`}
                          className="rounded-2xl shadow-2xl border-4 border-amber-500/50"
                        />
                      </a>
                    ))}
                  </div>

                  {/* User Info + Gender Change */}
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="bg-gray-800/50 backdrop-blur-sm p-8 rounded-2xl border border-gray-600/50 space-y-6"
                  >
                    <h3 className="text-3xl font-bold text-center text-amber-300">{currentUser.name || 'Anonymous'}</h3>
                    <p className="text-2xl text-center text-gray-400">
                      {currentUser.age} • {currentUser.gender || 'Not specified'} • {currentUser.country}
                    </p>
                    <p className="text-lg text-center text-gray-500">ID: {currentUser.id}</p>

                    {/* Gender Change Dropdown - only Male/Female */}
                    <div className="mt-6">
                      <label className="block text-lg font-medium text-gray-300 mb-3 text-center">
                        Change Gender
                      </label>
                      <div className="relative max-w-xs mx-auto">
                        <select
                          value={currentUser.gender || 'Male'}
                          onChange={(e) => handleGenderChange(e.target.value)}
                          disabled={genderUpdateStatus === 'saving'}
                          className="w-full px-6 py-4 text-lg bg-gray-900/80 border border-gray-600 rounded-xl focus:outline-none focus:border-amber-500 transition-all appearance-none cursor-pointer"
                        >
                          {genderOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {genderUpdateStatus === 'saving' && (
                        <p className="mt-3 text-amber-400 text-center text-sm">Saving...</p>
                      )}
                      {genderUpdateStatus === 'success' && (
                        <p className="mt-3 text-green-400 text-center text-sm animate-pulse">Gender updated!</p>
                      )}
                      {genderUpdateStatus === 'error' && (
                        <p className="mt-3 text-red-400 text-center text-sm">Failed to update gender</p>
                      )}
                    </div>
                  </motion.div>
                </div>
              </div>

              {/* Decision Buttons - centered below everything */}
              <div className="flex gap-12 justify-center mt-12">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleDecision('verified')}
                  className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 px-24 py-12 rounded-3xl font-bold text-5xl transition-all duration-300 shadow-2xl hover:shadow-3xl border border-green-500/50"
                >
                  APPROVE
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleDecision('rejected')}
                  className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 px-24 py-12 rounded-3xl font-bold text-5xl transition-all duration-300 shadow-2xl hover:shadow-3xl border border-red-500/50"
                >
                  REJECT
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}