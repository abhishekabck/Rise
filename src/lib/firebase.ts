import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User
} from 'firebase/auth';
import { getFirestore, collection, query, limit, getDocs } from 'firebase/firestore';

const exactFirebaseConfig = {
  apiKey: "AIzaSyDdpgRPxsu92dVF7mgWRkC6XMu0BZGYMSI",
  authDomain: "rise-2fdc8.firebaseapp.com",
  projectId: "rise-2fdc8",
  storageBucket: "rise-2fdc8.firebasestorage.app",
  messagingSenderId: "560620540392",
  appId: "1:560620540392:web:42c314174a4d9a9e93145d"
};

const app = getApps().length === 0 ? initializeApp(exactFirebaseConfig) : getApp();
export const db = getFirestore(app);
export const auth = getAuth(app);

// Startup connection test to log success or failure to console
(async function runStartupConnectionTest() {
  try {
    console.log('[Firebase Connection Test] Verifying Firestore connection...');
    // Attempt a light query to test connectivity
    const q = query(collection(db, '_connection_test_'), limit(1));
    await getDocs(q);
    console.log('[Firebase Connection Test] SUCCESS: Firestore is successfully connected to the default database on project rise-2fdc8!');
  } catch (err) {
    console.error('[Firebase Connection Test] FAILURE: Firestore connection failed. Error details:', err);
  }
})();

// Configure provider with OAuth scopes
export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/calendar');
provider.addScope('https://www.googleapis.com/auth/calendar.events');
provider.addScope('https://www.googleapis.com/auth/gmail.send');
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
provider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline'
});

// Local in-memory caching of the access token (never save in localStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errStr = error instanceof Error ? error.message : String(error);
  const isOfflineError = 
    errStr.toLowerCase().includes('offline') || 
    errStr.toLowerCase().includes('unavailable') || 
    errStr.toLowerCase().includes('network') ||
    errStr.toLowerCase().includes('failed to get document because the client is offline');

  if (isOfflineError) {
    console.warn(`Firestore network offline during operation [${operationType}] on path [${path}]. Continuing with local state fallback.`);
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: errStr,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error details: ', JSON.stringify(errInfo));

  throw new Error(JSON.stringify(errInfo));
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) {
        const storedToken = localStorage.getItem('rise_google_access_token') || localStorage.getItem('rise_google_token');
        cachedAccessToken = storedToken;
        onAuthSuccess(user, storedToken);
      }
    } else {
      cachedAccessToken = null;
      localStorage.removeItem('rise_google_token');
      localStorage.removeItem('rise_google_access_token');
      localStorage.removeItem('rise_google_token_expiry');
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<void> => {
  try {
    isSigningIn = true;
    console.log('[Auth] Attempting sign-in with popup...');
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
      localStorage.setItem('rise_google_token', cachedAccessToken);
      localStorage.setItem('rise_google_access_token', cachedAccessToken);
      localStorage.setItem('rise_google_token_expiry', (Date.now() + 3600000).toString());
      console.log('[Auth] Popup sign-in successful:', result.user.email);
    }
  } catch (error: any) {
    console.warn('[Auth] Popup sign-in error or blocked, trying redirect fallback...', error);
    if (
      error.code === 'auth/popup-blocked' ||
      error.code === 'auth/popup-closed-by-user' ||
      error.code === 'auth/cancelled-popup-request' ||
      error.message?.includes('popup')
    ) {
      try {
        await signInWithRedirect(auth, provider);
      } catch (redirectError: any) {
        console.error('[Auth] Redirect fallback error:', redirectError);
        throw redirectError;
      }
    } else {
      throw error;
    }
  } finally {
    isSigningIn = false;
  }
};

export const handleRedirectResult = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Failed to extract access token from Google Credentials');
      }
      cachedAccessToken = credential.accessToken;
      localStorage.setItem('rise_google_token', cachedAccessToken);
      localStorage.setItem('rise_google_access_token', cachedAccessToken);
      localStorage.setItem('rise_google_token_expiry', (Date.now() + 3600000).toString());
      return { user: result.user, accessToken: cachedAccessToken };
    }
    return null;
  } catch (error: any) {
    console.error('Redirect result error:', error);
    throw error;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken || localStorage.getItem('rise_google_access_token') || localStorage.getItem('rise_google_token');
};

export const setAccessToken = (token: string | null) => {
  cachedAccessToken = token;
  if (token) {
    localStorage.setItem('rise_google_token', token);
    localStorage.setItem('rise_google_access_token', token);
    localStorage.setItem('rise_google_token_expiry', (Date.now() + 3600000).toString());
  } else {
    localStorage.removeItem('rise_google_token');
    localStorage.removeItem('rise_google_access_token');
    localStorage.removeItem('rise_google_token_expiry');
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem('rise_google_token');
  localStorage.removeItem('rise_google_access_token');
  localStorage.removeItem('rise_google_token_expiry');
};
