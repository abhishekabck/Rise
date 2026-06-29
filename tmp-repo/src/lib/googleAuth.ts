import { auth } from './firebase';

declare global {
  interface Window {
    google: any;
  }
}

let tokenClient: any = null;
let currentAccessToken: string | null = null;
let tokenExpiryTime: number = 0;

export const initializeGoogleAuth = () => {
  if (typeof window === 'undefined' || !window.google) {
    console.warn('Google Identity Services not loaded yet');
    return;
  }

  const clientId = (import.meta as any).env.VITE_GOOGLE_CLIENT_ID || '560620540392-f04v8736un9egepkvvunbshhfe0qreof.apps.googleusercontent.com';

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/gmail.send'
    ].join(' '),
    callback: (response: any) => {
      if (response.access_token) {
        currentAccessToken = response.access_token;
        tokenExpiryTime = Date.now() + (response.expires_in * 1000);
        localStorage.setItem('rise_google_access_token', response.access_token);
        localStorage.setItem('rise_google_token_expiry', tokenExpiryTime.toString());
        // Sync with legacy key
        localStorage.setItem('rise_google_token', response.access_token);
        console.log('Google token refreshed silently via callback');
      }
    }
  });
};

export const getValidGoogleToken = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;

  // Check if current token is still valid (with 5 min buffer)
  const expiry = parseInt(localStorage.getItem('rise_google_token_expiry') || '0');
  const accessToken = localStorage.getItem('rise_google_access_token') || localStorage.getItem('rise_google_token');

  if (accessToken && expiry > Date.now() + 300000) {
    return accessToken;
  }

  // Token expired or expiring soon, request silent refresh
  return new Promise((resolve) => {
    if (!tokenClient) {
      initializeGoogleAuth();
    }

    if (!tokenClient) {
      console.warn('Token client not available, returning null');
      resolve(null);
      return;
    }

    tokenClient.callback = (response: any) => {
      if (response.access_token) {
        currentAccessToken = response.access_token;
        tokenExpiryTime = Date.now() + (response.expires_in * 1000);
        localStorage.setItem('rise_google_access_token', response.access_token);
        localStorage.setItem('rise_google_token_expiry', tokenExpiryTime.toString());
        // Sync with legacy key
        localStorage.setItem('rise_google_token', response.access_token);
        resolve(response.access_token);
      } else {
        console.warn('Silent refresh failed to obtain access token in callback:', response);
        resolve(null);
      }
    };

    try {
      // Request access token with prompt='' for silent flow
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      console.error('Failed to request silent access token:', err);
      resolve(null);
    }
  });
};

export const reconnectGoogle = (): Promise<string | null> => {
  return new Promise((resolve) => {
    if (!tokenClient) {
      initializeGoogleAuth();
    }
    if (!tokenClient) {
      resolve(null);
      return;
    }

    tokenClient.callback = (response: any) => {
      if (response.access_token) {
        currentAccessToken = response.access_token;
        tokenExpiryTime = Date.now() + (response.expires_in * 1000);
        localStorage.setItem('rise_google_access_token', response.access_token);
        localStorage.setItem('rise_google_token_expiry', tokenExpiryTime.toString());
        localStorage.setItem('rise_google_token', response.access_token);
        resolve(response.access_token);
      } else {
        resolve(null);
      }
    };

    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
};
