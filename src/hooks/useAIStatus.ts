import { useState, useEffect } from 'react';

export interface AIStatus {
  isResting: boolean;
  restUntil: number | null;
  fallbackActive: boolean;
}

export function useAIStatus() {
  const [aiStatus, setAIStatus] = useState<AIStatus>({
    isResting: false,
    restUntil: null,
    fallbackActive: false
  });

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/ai-status');
        if (!res.ok) {
          throw new Error('AI Status API returned error status');
        }
        const data = await res.json();
        setAIStatus({
          isResting: !!data.isResting || !!data.isRateLimited,
          restUntil: data.restUntil || null,
          fallbackActive: !!data.isResting || !!data.isRateLimited
        });
      } catch (error) {
        console.warn('AI status check failed, assuming fallback mode is active:', error);
        setAIStatus({
          isResting: true,
          restUntil: null,
          fallbackActive: true
        });
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000); // check status every 30 seconds

    return () => clearInterval(interval);
  }, []);

  return aiStatus;
}
