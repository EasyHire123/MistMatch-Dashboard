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
    <div className={`relative ${className}`}>
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 rounded">
          <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-transform ${hasError ? 'hidden' : ''}`}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
      />
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-gray-500 text-xs">
          Failed to load
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 20; // Load 20 users at a time
const LOAD_MORE_THRESHOLD = 3; // Load next batch when ≤3 users remain in queue

export default function Dashboard() {
  const [mode, setMode] = useState<'dashboard' | 'user-verification' | 'gender-verification'>('dashboard');
  const [allPendingUsers, setAllPendingUsers] = useState<PendingUser[]>([]); // Full fetched list
  const [queueUsers, setQueueUsers] = useState<PendingUser[]>([]); // Current verification queue
  const [totalPending, setTotalPending] = useState(0);
  const [totalUnknown, setTotalUnknown] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [currentUser, setCurrentUser] = useState<PendingUser | null>(null);
  const [isUserVerifying, setIsUserVerifying] = useState(false);
  const [genderUsers, setGenderUsers] = useState<User[]>([]);
  const [filteredGenderUsers, setFilteredGenderUsers] = useState<User[]>([]);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [genderFilter, setGenderFilter] = useState<'all' | 'unknown' | 'Male' | 'Female'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [adminName, setAdminName] = useState('Admin');
  const [genderUpdateStatus, setGenderUpdateStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setAdminName(data.user?.user_metadata?.full_name || data.user?.email?.split('@')[0] || 'Admin');
    });
    loadNextBatch(); // Initial load
    fetchUnknownCount().then(setTotalUnknown);
    const interval = setInterval(() => {
      loadNextBatch(true); // Refresh periodically (append if needed)
      fetchUnknownCount().then(setTotalUnknown);
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (mode === 'gender-verification') {
      fetchAllUsers().then(setGenderUsers);
      setCurrentPage(1);
    }
  }, [mode]);

  useEffect(() => {
    let filtered = [...genderUsers];
    if (genderFilter !== 'all') {
      filtered = filtered.filter(u => {
        if (genderFilter === 'unknown') return !u.gender;
        return u.gender === genderFilter;
      });
    }
    if (sortOrder === 'asc') {
      filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else {
      filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    setFilteredGenderUsers(filtered);
    setCurrentPage(1);
  }, [genderUsers, genderFilter, sortOrder]);

  async function fetchUnknownCount() {
    const { count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .is('gender', null);
    return count || 0;
  }

  async function fetchAllUsers() {
    const { data } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    return data || [];
  }

  async function fetchPendingUsers() {
    const { data, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact' })
      .eq('is_verified', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading pending users:', error);
      return { users: [], total: 0 };
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

    return { users: usersWithPhotos, total: count || 0 };
  }

  async function loadNextBatch(refresh = false) {
    const { users, total } = await fetchPendingUsers();
    setTotalPending(total);

    if (refresh) {
      // On periodic refresh: replace full list, but keep current queue intact if verifying
      setAllPendingUsers(users);
      if (!isUserVerifying) {
        const nextBatch = users.slice(0, PAGE_SIZE);
        setQueueUsers(nextBatch);
        setHasMore(users.length > PAGE_SIZE);
      }
    } else {
      // Normal load/append
      setAllPendingUsers(users);
      const start = queueUsers.length;
      const nextBatch = users.slice(start, start + PAGE_SIZE);
      setQueueUsers(prev => [...prev, ...nextBatch]);
      setHasMore(start + nextBatch.length < users.length);
    }
  }

  // Auto-load more when queue is running low
  useEffect(() => {
    if (isUserVerifying && queueUsers.length <= LOAD_MORE_THRESHOLD && hasMore) {
      loadNextBatch();
    }
  }, [queueUsers.length, isUserVerifying, hasMore]);

  function startVerification() {
    if (queueUsers.length === 0) return;
    setIsUserVerifying(true);
    setCurrentUser(queueUsers[0]);
  }

  function handleDecision(decision: 'verified' | 'rejected') {
    if (!currentUser) return;

    supabase
      .from('users')
      .update({ is_verified: decision === 'verified' ? 'verified' : 'unverified' })
      .eq('id', currentUser.id)
      .then(() => {
        // Remove from queue
        const remainingQueue = queueUsers.filter(u => u.id !== currentUser.id);
        setQueueUsers(remainingQueue);

        // Update total count optimistically
        setTotalPending(prev => Math.max(0, prev - 1));

        if (remainingQueue.length > 0) {
          setCurrentUser(remainingQueue[0]);
        } else {
          setCurrentUser(null);
          setIsUserVerifying(false);
          setMode('dashboard');
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
      setQueueUsers(prev =>
        prev.map(u => (u.id === currentUser.id ? { ...u, gender: newGender } : u))
      );
      setGenderUpdateStatus('success');
      setTimeout(() => setGenderUpdateStatus('idle'), 2000);
    }
  }

  async function handleGenderUpdate(userId: string, newGender: 'Male' | 'Female') {
    const { error } = await supabase
      .from('users')
      .update({ gender: newGender })
      .eq('id', userId);

    if (error) {
      console.error('Error updating gender:', error);
    } else {
      setGenderUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, gender: newGender } : u))
      );
      setTotalUnknown(prev => Math.max(0, prev - 1));
    }
  }

  const genderOptions = ['Male', 'Female'];

  if (mode === 'dashboard') {
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
          <div className="flex flex-col items-center gap-4 mb-10">
            <button
              onClick={() => { setMode('user-verification'); startVerification(); }}
              disabled={queueUsers.length === 0}
              className="group bg-gradient-to-r from-green-600 via-blue-600 to-purple-600 px-12 py-6 rounded-2xl font-bold text-2xl transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl hover:shadow-3xl"
            >
              Verify Users ({totalPending} pending)
            </button>
            <button
              onClick={() => setMode('gender-verification')}
              className="group bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 px-12 py-6 rounded-2xl font-bold text-2xl transition-all duration-300 hover:scale-105 shadow-2xl hover:shadow-3xl"
            >
              Verify Genders
            </button>
          </div>
          {totalPending === 0 && (
            <div className="text-center text-gray-400 text-xl animate-pulse">
              No pending user verifications at the moment. Great job!
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'user-verification') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white p-8">
        <div className="max-w-7xl mx-auto">
          <button
            onClick={() => { setIsUserVerifying(false); setMode('dashboard'); }}
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
                  {/* Left: Profile Photos */}
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
                              className="w-full h-96 rounded-2xl shadow-2xl overflow-hidden"
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
                            className="w-full h-96 rounded-2xl shadow-2xl border-4 border-amber-500/50 overflow-hidden"
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

                      {/* Gender Change Dropdown */}
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

                {/* Decision Buttons */}
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

                {/* Optional indicator when loading more */}
                {queueUsers.length <= LOAD_MORE_THRESHOLD && hasMore && (
                  <p className="text-center text-amber-400 animate-pulse mt-8">Loading more users...</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!currentUser && (
            <div className="text-center text-3xl text-gray-400 mt-20">
              No more users to verify. Great job!
            </div>
          )}
        </div>
      </div>
    );
  }

  // Gender Verification Mode
  const paginatedUsers = filteredGenderUsers.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const totalPages = Math.ceil(filteredGenderUsers.length / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => setMode('dashboard')}
          className="mb-8 px-6 py-3 bg-gray-800/50 backdrop-blur-sm rounded-xl font-bold text-lg hover:bg-gray-700/50 transition-all duration-300 border border-gray-600 hover:border-amber-500"
        >
          ← Back to Dashboard
        </button>

        <div className="mb-8">
          <h1 className="text-4xl font-bold text-center mb-6 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            Gender Verification
          </h1>
          <div className="flex justify-center gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Filter by Gender</label>
              <select
                value={genderFilter}
                onChange={(e) => { setGenderFilter(e.target.value as any); }}
                className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-amber-500"
              >
                <option value="all">All</option>
                <option value="unknown">Unknown</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Sort by Date</label>
              <select
                value={sortOrder}
                onChange={(e) => { setSortOrder(e.target.value as any); }}
                className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-amber-500"
              >
                <option value="desc">Newest First</option>
                <option value="asc">Oldest First</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {paginatedUsers.map((user) => (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gray-800/50 backdrop-blur-sm p-6 rounded-2xl border border-gray-600/50 space-y-4"
            >
              <h3 className="text-2xl font-bold text-center text-amber-300">
                {user.name || 'Anonymous'}
              </h3>
              <p className="text-xl text-center text-gray-400">
                {user.age} • {user.country}
              </p>
              <div className="flex justify-center">
                <span
                  className={`px-4 py-2 rounded-full text-sm font-bold ${
                    !user.gender
                      ? 'bg-gray-600 text-gray-300'
                      : user.gender === 'Male'
                      ? 'bg-blue-500 text-white'
                      : 'bg-pink-500 text-white'
                  }`}
                >
                  {user.gender || 'Unknown'}
                </span>
              </div>
              <div className="flex justify-center gap-2 flex-wrap">
                {user.image_urls?.slice(0, 4).map((url, i) => (
                  <div key={i} className="w-24 h-24 rounded-lg overflow-hidden shadow-md">
                    <ImageWithLoader
                      src={url}
                      alt={`Photo ${i + 1}`}
                      className="w-full h-full"
                    />
                  </div>
                )) || (
                  <div className="w-24 h-24 bg-gray-700 rounded-lg flex items-center justify-center text-gray-500 text-sm">
                    No Photo
                  </div>
                )}
              </div>
              <div className="flex justify-center gap-6 mt-6">
                <button
                  onClick={() => handleGenderUpdate(user.id, 'Male')}
                  className={`px-8 py-4 rounded-2xl font-bold text-lg transition-all duration-300 ${
                    user.gender === 'Male'
                      ? 'bg-blue-600 text-white shadow-lg hover:shadow-xl'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Male
                </button>
                <button
                  onClick={() => handleGenderUpdate(user.id, 'Female')}
                  className={`px-8 py-4 rounded-2xl font-bold text-lg transition-all duration-300 ${
                    user.gender === 'Female'
                      ? 'bg-pink-600 text-white shadow-lg hover:shadow-xl'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Female
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {totalPages > 0 && (
          <div className="flex justify-center items-center gap-4 mt-12">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-6 py-3 bg-gray-800/50 backdrop-blur-sm rounded-xl font-bold text-lg hover:bg-gray-700/50 transition-all duration-300 border border-gray-600 hover:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-xl text-gray-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-6 py-3 bg-gray-800/50 backdrop-blur-sm rounded-xl font-bold text-lg hover:bg-gray-700/50 transition-all duration-300 border border-gray-600 hover:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}

        {filteredGenderUsers.length === 0 && (
          <div className="text-center text-3xl text-gray-400 mt-20">
            No users to verify gender for with current filters.
          </div>
        )}
      </div>
    </div>
  );
}