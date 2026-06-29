import { useEffect, useRef } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';

async function createNotificationFromCheckIn(data: any, userId: string) {
  let type: 'high' | 'ai' | 'success' | 'info' = 'info';
  const intervention = data.interventionType || '';

  if (intervention === 'stall_warning') {
    type = 'high';
  } else if (intervention === 'reschedule_suggestion') {
    type = 'ai';
  } else if (intervention === 'momentum_check') {
    type = 'success';
  } else if (intervention === 'rest_recommendation') {
    type = 'high';
  } else if (intervention === 'end_of_day_review') {
    type = 'info';
  }

  try {
    const notifRef = collection(db, 'users', userId, 'notifications');
    await addDoc(notifRef, {
      type,
      title: data.title || 'Rise Agent Proactive Update',
      message: data.message || data.recommendation || 'The AI companion has analyzed your current focus patterns.',
      timestamp: 'Just now',
      read: false,
      createdAt: new Date().toISOString()
    });
    console.log('[Proactive Check-In] Created Firestore notification:', type, data.title);
  } catch (err) {
    console.error('Failed to create notification document in Firestore:', err);
  }
}

export function useProactiveAgent() {
  const lastCheckRef = useRef<number>(Date.now());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // We want to poll/trigger when the user changes or we load
    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (!user) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }

      const performCheckIn = async () => {
        const now = Date.now();
        const userId = auth.currentUser?.uid;
        if (!userId) return;

        // Check if Firestore lock allows this call (prevent spam)
        const lockKey = `proactive_checkin_${userId}`;
        const lockExpiry = localStorage.getItem(lockKey);
        if (lockExpiry && parseInt(lockExpiry) > now) {
          console.log('[Proactive Check-In] Still locked for', Math.round((parseInt(lockExpiry) - now) / 1000), 's');
          return; // Skip, still locked
        }

        // Set lock for 30 minutes to prevent spamming
        localStorage.setItem(lockKey, (now + 30 * 60 * 1000).toString());

        // Dispatch CustomEvent to indicate agent is checking in
        window.dispatchEvent(new CustomEvent('rise-agent-active', { detail: { active: true } }));
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('rise-agent-active', { detail: { active: false } }));
        }, 3500);

        try {
          console.log('[Proactive Check-In] Querying agent check-in endpoint for user:', userId);
          const response = await fetch('/api/agent/check-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, currentTime: new Date().toISOString() })
          });
          const data = await response.json();
          console.log('[Proactive Check-In] Received response:', data);
          
          if (data.actionRequired && data.interventionType !== 'no_intervention') {
            await createNotificationFromCheckIn(data, userId);
          }
          
          lastCheckRef.current = now;
        } catch (error) {
          console.warn('Proactive check-in failed:', error);
        }
      };

      // Run initial check-in shortly after mount/sign-in
      const initialTimer = setTimeout(() => {
        performCheckIn();
      }, 5000);

      // Schedule 1: Every 2 hours
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(performCheckIn, 2 * 60 * 60 * 1000);

      // Schedule 2: Specific times of day
      const targetTimes = [
        { hour: 9, label: 'morning_plan' },
        { hour: 13, label: 'afternoon_adjust' },
        { hour: 18, label: 'evening_review' }
      ];

      const timeoutIds: NodeJS.Timeout[] = [];

      const scheduleDailyCheckIns = () => {
        const now = new Date();
        targetTimes.forEach(({ hour }) => {
          const target = new Date();
          target.setHours(hour, 0, 0, 0);
          
          // If target time is in the past today, schedule for tomorrow
          if (target.getTime() < now.getTime()) {
            target.setDate(target.getDate() + 1);
          }
          
          const msUntil = target.getTime() - now.getTime();
          const tId = setTimeout(() => {
            performCheckIn();
            // Reschedule for same time tomorrow
            const dailyInterval = setInterval(performCheckIn, 24 * 60 * 60 * 1000);
            intervalRef.current = dailyInterval; // Store in ref (simplified)
          }, msUntil);
          timeoutIds.push(tId);
        });
      };
      
      scheduleDailyCheckIns();

      // Schedule 3: Detect return after long absence
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          const timeSinceLastCheck = Date.now() - lastCheckRef.current;
          if (timeSinceLastCheck > 4 * 60 * 60 * 1000) {
            console.log('[Proactive Check-In] User returned after 4+ hours absence. Performing check-in.');
            performCheckIn();
          }
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearTimeout(initialTimer);
        timeoutIds.forEach(id => clearTimeout(id));
        if (intervalRef.current) clearInterval(intervalRef.current);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);
}
