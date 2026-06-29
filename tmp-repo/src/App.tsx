import React, { useState, useEffect, useRef } from 'react';
import { 
  initAuth, 
  googleSignIn, 
  handleRedirectResult,
  logout, 
  getAccessToken, 
  db, 
  auth,
  handleFirestoreError,
  OperationType
} from './lib/firebase';
import { initializeGoogleAuth, getValidGoogleToken } from './lib/googleAuth';
import { collection, onSnapshot, doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { Task, UserProfile, BehaviorProfile, TabType } from './types';
import BottomNavBar from './components/BottomNavBar';
import Dashboard from './components/Dashboard';
import TaskInput from './components/TaskInput';
import CalendarView from './components/CalendarView';
import BehaviorProfilePage from './components/BehaviorProfilePage';
import ProgressDashboard from './components/ProgressDashboard';
import TasksPage from './components/TasksPage';
import VoiceAssistantButton from './components/VoiceAssistantButton';
import { Sparkles, Brain, LogOut, Loader2, Star, CheckCircle, Shield, AlertCircle, Home as HomeIcon, List as ListIcon, Calendar as CalendarIcon, TrendingUp as TrendingUpIcon, User as UserIcon, Sun, Moon, Bell, X, Check, Info, ChevronRight, AlertTriangle, Play, Menu, Pause, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { timerService, TimerState } from './lib/timerService';
import { useProactiveAgent } from './hooks/useProactiveAgent';

export interface InAppNotification {
  id: string;
  type: 'high' | 'ai' | 'success' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

const DEFAULT_NOTIFICATIONS: InAppNotification[] = [
  { id: 'notif-1', type: 'ai', title: 'Adaptive Strategy Ready', message: 'Rise analyzed your coding patterns and recommends starting your coding focus block 15 mins earlier today.', timestamp: '10m ago', read: false },
  { id: 'notif-2', type: 'success', title: 'Daily Streak Achieved!', message: 'Congratulations! You have hit a 4-day focus streak. Keep up the momentum!', timestamp: '2h ago', read: false },
  { id: 'notif-3', type: 'high', title: 'High Priority Task Due', message: '"Product Strategy Review" is scheduled soon. Make sure to review the calibration details.', timestamp: '4h ago', read: true },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);

  const navItems = [
    { id: 'home' as TabType, label: 'Home', icon: HomeIcon },
    { id: 'tasks' as TabType, label: 'Tasks', icon: ListIcon },
    { id: 'calendar' as TabType, label: 'Calendar', icon: CalendarIcon },
    { id: 'progress' as TabType, label: 'Progress', icon: TrendingUpIcon },
    { id: 'profile' as TabType, label: 'Profile', icon: UserIcon },
  ];
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [authError, setAuthError] = useState<string | null>(null);

  // Theme Switching
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('rise_theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', themeMode === 'dark');
    localStorage.setItem('rise_theme', themeMode);
  }, [themeMode]);

  // Scroll to top on page / tab change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [activeTab]);

  // Proactive check-in agent activation
  useProactiveAgent();

  // One-time cleanup of duplicate tasks on load
  useEffect(() => {
    if (!user) return;

    const cleanupDuplicates = async () => {
      try {
        console.log('[Cleanup] Starting duplicate task cleanup...');
        const tasksRef = collection(db, `users/${user.uid}/tasks`);
        const snapshot = await getDocs(tasksRef);
        const allTasks = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];

        const groups = allTasks.filter(t => t.title).reduce<Record<string, Task[]>>((acc, t) => {
          const k = t.title.toLowerCase().trim();
          (acc[k] ??= []).push(t);
          return acc;
        }, {});

        for (const group of Object.values(groups).filter(g => g.length > 1)) {
          group.sort((a, b) => (a.createdAt ? new Date(a.createdAt).getTime() : 0) - (b.createdAt ? new Date(b.createdAt).getTime() : 0));
          const [oldest, ...toDelete] = group;
          console.log(`[Cleanup] Found duplicate group for "${oldest.title}": keeping oldest (${oldest.id}), deleting ${toDelete.length} duplicates.`);
          await Promise.all(toDelete.filter(t => t.id).map(t => deleteDoc(doc(db, `users/${user.uid}/tasks`, t.id!))));
        }
        console.log('[Cleanup] Duplicate cleanup complete.');
      } catch (err) {
        console.warn('[Cleanup] Failed to clean up duplicate tasks:', err);
      }
    };

    cleanupDuplicates();
  }, [user]);

  const [isAgentCheckingIn, setIsAgentCheckingIn] = useState(false);

  useEffect(() => {
    const handleCheckInEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      setIsAgentCheckingIn(!!customEvent.detail?.active);
    };
    window.addEventListener('rise-agent-active', handleCheckInEvent);
    return () => {
      window.removeEventListener('rise-agent-active', handleCheckInEvent);
    };
  }, []);

  // Notifications Sidebar
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>(DEFAULT_NOTIFICATIONS);

  const markAllNotificationsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    if (user) {
      try {
        const unread = notifications.filter(n => !n.read && !n.id.startsWith('notif-'));
        const batch = unread.map(n => updateDoc(doc(db, 'users', user.uid, 'notifications', n.id), { read: true }));
        await Promise.all(batch);
      } catch (err) {
        console.warn('Failed to mark all notifications read in Firestore:', err);
      }
    }
  };

  const handleNotificationClick = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    if (user && !id.startsWith('notif-')) {
      try {
        await updateDoc(doc(db, 'users', user.uid, 'notifications', id), { read: true });
      } catch (err) {
        console.warn('Failed to mark notification read in Firestore:', err);
      }
    }
  };

  // App States
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [behaviorProfile, setBehaviorProfile] = useState<BehaviorProfile | null>(null);
  const [aiStatus, setAiStatus] = useState<{ 
    isRateLimited: boolean; 
    minutesRemaining: number;
    isResting?: boolean;
    restUntil?: number | null;
  }>({
    isRateLimited: false,
    minutesRemaining: 0,
    isResting: false,
    restUntil: null,
  });
  const sessionCompletedCountRef = useRef(0);

  // Background agent actions logger
  const [autonomousLog, setAutonomousLog] = useState<{ action: string; time: string } | null>(null);

  // Active Timer state for the global banner & tab title
  const [activeTimerState, setActiveTimerState] = useState<TimerState | null>(null);
  const [activeTimerElapsed, setActiveTimerElapsed] = useState<number>(0);

  // Close/reopen away modal state
  const [showAwayModal, setShowAwayModal] = useState(false);
  const [awayDurationText, setAwayDurationText] = useState('');
  const [awayMinutes, setAwayMinutes] = useState(0);
  const [awayTimerState, setAwayTimerState] = useState<TimerState | null>(null);

  // Fetch and poll AI Status
  const fetchAiStatus = async () => {
    try {
      const res = await fetch('/api/ai-status');
      if (res.ok) {
        const data = await res.json();
        setAiStatus(data);
      }
    } catch (err) {
      console.error('Error fetching AI status:', err);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchAiStatus();
    const interval = setInterval(fetchAiStatus, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Initialize Google Identity Services
  useEffect(() => {
    initializeGoogleAuth();
  }, []);

  // Consolidated Google Sign-In Redirect and Auth State handling
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const initAuthFlow = async () => {
      console.log('[App] Starting auth check');
      setLoading(true);
      setAuthChecked(false);

      try {
        console.log('[App] Checking for redirect result...');
        const result = await handleRedirectResult();
        if (result) {
          console.log('[App] Redirect result: SUCCESS', result.user.email);
          setUser(result.user);
          setGoogleToken(result.accessToken);
          initializeGoogleAuth();
        } else {
          console.log('[App] Redirect result: No result (normal load)');
        }
      } catch (err: any) {
        console.error('[App] Error handling redirect result:', err);
        setAuthError(err.message || 'Failed to finish Google Sign In.');
      }

      console.log('[App] Setting up auth state listener...');
      unsubscribe = initAuth(
        (currentUser, token) => {
          console.log('[App] Auth state: Logged in as', currentUser?.email);
          setUser(currentUser);
          setGoogleToken(token);
          setAuthChecked(true);
          setLoading(false);
        },
        () => {
          console.log('[App] Auth state: Not logged in');
          setUser(null);
          setGoogleToken(null);
          setAuthChecked(true);
          setLoading(false);
        }
      );
    };

    initAuthFlow();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Proactive token refresh every 50 minutes (and on initial load/user login)
  useEffect(() => {
    if (!user) return;

    const refresh = () => getValidGoogleToken().then(t => t && setGoogleToken(t));
    refresh();
    const refreshInterval = setInterval(refresh, 50 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [user]);

  // Sync and tick active timer
  useEffect(() => {
    const syncTimer = () => {
      const active = timerService.getActiveTimer();
      setActiveTimerState(active);
      if (active) {
        const elapsed = Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
        setActiveTimerElapsed(elapsed);
        timerService.updateTabTitle(active);
        timerService.setLastTick(Date.now());
      } else {
        setActiveTimerElapsed(0);
        document.title = 'Rise';
      }
    };

    // Subscribe to timer service events
    const unsubscribe = timerService.subscribe(syncTimer);

    // Visibility change listener (Page Visibility API)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        timerService.syncFromStorage();
        syncTimer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initial check
    syncTimer();

    // Set up tick interval
    const interval = setInterval(() => {
      const active = timerService.getActiveTimer();
      if (active) {
        const elapsed = Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
        setActiveTimerElapsed(elapsed);
        timerService.updateTabTitle(active);
        timerService.setLastTick(Date.now());
        setActiveTimerState(prev => {
          if (!prev || prev.taskId !== active.taskId) {
            return active;
          }
          return prev;
        });
      } else {
        setActiveTimerState(prev => {
          if (prev) {
            setActiveTimerElapsed(0);
            document.title = 'Rise';
            return null;
          }
          return prev;
        });
      }
    }, 1000);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, []);

  // Check for interrupted session (browser close & reopen) on app startup
  useEffect(() => {
    if (!user) return;

    // Set user ID in service for offline Firestore updates if needed
    timerService.setUserId(user.uid);

    const timer = timerService.getActiveTimer();
    const lastTick = timerService.getLastTick();

    if (timer && timer.status === 'running' && lastTick) {
      const diffMs = Date.now() - lastTick;
      // If away for more than 15 seconds, trigger recovery
      if (diffMs > 15000) {
        setAwayTimerState(timer);
        
        const totalSecs = Math.floor(diffMs / 1000);
        const hours = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        
        const text = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        setAwayDurationText(text);
        setAwayMinutes(Math.max(1, Math.round(diffMs / 60000)));
        setShowAwayModal(true);
      }
    }
  }, [user]);

  // Handle Recovery Options
  const handleResolveCompleted = async () => {
    if (!user || !awayTimerState) return;
    const taskId = awayTimerState.taskId;
    
    const matchedTask = tasks.find(t => t.id === taskId);
    const category = matchedTask?.category || 'other';

    const lastTick = timerService.getLastTick() || Date.now();
    const elapsedMs = lastTick - awayTimerState.startedAt;
    const actualMins = Math.max(1, Math.round(elapsedMs / 60000));

    timerService.clearTimer();
    setShowAwayModal(false);

    try {
      const taskRef = doc(db, `users/${user.uid}/tasks`, taskId);
      await setDoc(taskRef, {
        status: 'completed',
        actualMinutes: actualMins,
        completedAt: new Date().toISOString(),
        timerStatus: 'completed'
      }, { merge: true });

      setTasks(prev => prev.map(t => t.id === taskId ? {
        ...t,
        status: 'completed',
        actualMinutes: actualMins,
        completedAt: new Date().toISOString(),
        timerStatus: 'completed'
      } : t));

      const profData = await timerService.updateBehaviorStats(user.uid, 'completed', category, actualMins, tasks.length);
      if (profData) {
        setBehaviorProfile(profData);
      }
      triggerAutonomousAgent(`Completed task "${awayTimerState.taskTitle}" in ${actualMins} minutes (session recovered from offline check)`);
    } catch (err) {
      console.error('Error resolving completed task offline:', err);
    }
  };

  const handleResolveResume = () => {
    setShowAwayModal(false);
  };

  const handleResolveCancel = async () => {
    if (!user || !awayTimerState) return;
    const taskId = awayTimerState.taskId;

    timerService.clearTimer();
    setShowAwayModal(false);

    try {
      const taskRef = doc(db, `users/${user.uid}/tasks`, taskId);
      await setDoc(taskRef, {
        status: 'pending',
        timerStatus: 'completed',
        timerStartedAt: null
      }, { merge: true });

      setTasks(prev => prev.map(t => t.id === taskId ? {
        ...t,
        status: 'pending',
        timerStatus: 'completed',
        timerStartedAt: null
      } : t));
    } catch (err) {
      console.error('Error resolving cancelled task offline:', err);
    }
  };

  // Fetch Firestore Data when User is logged in
  useEffect(() => {
    if (!user) return;

    // 1. Fetch or create User Profile
    const fetchProfile = async () => {
      const userRef = doc(db, 'users', user.uid);
      const initialProfile: UserProfile = {
        email: user.email || '',
        name: user.displayName || 'Rise Companion',
        photoURL: user.photoURL || '',
        createdAt: new Date().toISOString(),
        preferences: { tone: 'casual', notificationEmail: user.email || '' }
      };
      try {
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
          setUserProfile(docSnap.data() as UserProfile);
        } else {
          await setDoc(userRef, initialProfile);
          setUserProfile(initialProfile);
        }
      } catch (err) {
        setUserProfile(initialProfile);
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      }
    };

    // 2. Fetch or create Behavior Profile
    const fetchBehaviorProfile = async () => {
      const bRef = doc(db, `users/${user.uid}/behaviorProfile`, 'profile');
      const initialB: BehaviorProfile = {
        summary: 'Rise companion has launched. Begin your day to extract scheduling patterns.',
        strengths: ['Early morning analytical sprint'],
        weaknesses: ['Late afternoon admin friction'],
        peakProductivityHours: [9, 10, 14],
        averageTaskDuration: 25,
        completionRate: 85,
        lastUpdated: new Date().toISOString(),
      };
      try {
        const bSnap = await getDoc(bRef);
        if (bSnap.exists()) {
          setBehaviorProfile(bSnap.data() as BehaviorProfile);
        } else {
          await setDoc(bRef, initialB);
          setBehaviorProfile(initialB);
        }
      } catch (err) {
        setBehaviorProfile(initialB);
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}/behaviorProfile/profile`);
      }
    };

    Promise.all([fetchProfile(), fetchBehaviorProfile()]);

    // 3. Realtime Listener on Tasks Subcollection
    const tasksRef = collection(db, `users/${user.uid}/tasks`);
    const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
      const loadedTasks: Task[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(loadedTasks);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/tasks`);
    });

    // 4. Realtime Listener on Notifications Subcollection
    const notifRef = collection(db, `users/${user.uid}/notifications`);
    const unsubNotif = onSnapshot(notifRef, (snapshot) => {
      const loadedNotifs: InAppNotification[] = snapshot.docs.map(doc => {
        const data = doc.data();
        let uiType: 'high' | 'ai' | 'success' | 'info' = 'info';
        let uiTitle = 'Rise Companion Update';
        
        const rawType = data.type || '';
        if (rawType === 'stall_warning' || rawType === 'high') {
          uiType = 'high';
          uiTitle = 'Attention Required';
        } else if (rawType === 'reschedule_suggestion' || rawType === 'ai') {
          uiType = 'ai';
          uiTitle = 'AI Adjustment Suggested';
        } else if (rawType === 'momentum_check' || rawType === 'success') {
          uiType = 'success';
          uiTitle = 'Momentum Unlocked!';
        } else if (rawType === 'rest_recommendation') {
          uiType = 'high';
          uiTitle = 'Rest Recommended';
        } else if (rawType === 'end_of_day_review' || rawType === 'info') {
          uiType = 'info';
          uiTitle = 'Evening Review';
        }

        return {
          id: doc.id,
          type: uiType,
          title: data.title || uiTitle,
          message: data.message || '',
          timestamp: data.createdAt ? new Date(data.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now',
          read: !!data.read
        };
      });

      setNotifications([...loadedNotifs, ...DEFAULT_NOTIFICATIONS]);
    }, (err) => {
      console.warn('Failed to listen to notifications subcollection:', err);
    });

    return () => {
      unsubTasks();
      unsubNotif();
    };
  }, [user]);

  // Background AI task enrichment coordinator
  useEffect(() => {
    if (!user) return;
    
    const unanalyzedTasks = tasks.filter(t => t.id && t.aiAnalyzed === false);
    if (unanalyzedTasks.length === 0) return;

    // To prevent infinite loop/multiple simultaneous requests for the same task
    const enriching = (window as any).__enrichingTaskIds || new Set<string>();
    (window as any).__enrichingTaskIds = enriching;

    unanalyzedTasks.forEach(async (task) => {
      const taskId = task.id!;
      if (enriching.has(taskId)) return;

      enriching.add(taskId);
      console.log(`[App Background AI] Enriching task "${task.title}" (ID: ${taskId})`);

      try {
        const response = await fetch('/api/tasks/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            category: task.category === 'other' ? 'auto' : task.category,
            difficulty: task.difficulty || 'medium',
            recurring: task.recurring || 'one-time',
            deadline: task.deadline || '',
            behaviorProfile,
            userId: user.uid,
          }),
        });

        if (response.ok) {
          const aiData = await response.json();
          console.log(`[App Background AI] Task "${task.title}" enriched successfully:`, aiData);

          const taskDocRef = doc(db, `users/${user.uid}/tasks/${taskId}`);
          await updateDoc(taskDocRef, {
            category: aiData.category || 'other',
            priority: aiData.priority || 'medium',
            estimatedMinutes: aiData.estimatedMinutes || 30,
            aiAnalyzed: true
          });

          // Trigger subtask breakdown if hard difficulty or estimatedMinutes > 60
          const resolvedCategory = aiData.category || 'other';
          const estimatedMinutes = aiData.estimatedMinutes || 30;
          if (estimatedMinutes > 60 || task.difficulty === 'hard') {
            console.log(`[App Background AI] Launching subtask generation for: ${task.title}`);
            fetch('/api/tasks/breakdown', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId,
                title: task.title,
                description: task.description,
                category: resolvedCategory,
                estimatedMinutes,
                difficulty: task.difficulty,
                behaviorProfile,
                userId: user.uid
              })
            }).then(res => {
              if (res.ok) {
                console.log(`[App Background AI] Subtasks generated successfully!`);
              }
            }).catch(err => console.error('Subtask breakdown failed:', err));
          }
        } else if (response.status === 429) {
          console.warn(`[App Background AI] Rate limited enriching task "${task.title}"`);
          queueForLaterEnrichment(taskId, task);
        } else {
          console.warn(`[App Background AI] Failed enriching task "${task.title}": ${response.status}`);
          queueForLaterEnrichment(taskId, task);
        }
      } catch (err) {
        console.error(`[App Background AI] Error enriching task "${task.title}":`, err);
        queueForLaterEnrichment(taskId, task);
      } finally {
        enriching.delete(taskId);
      }
    });
  }, [tasks, user, behaviorProfile]);

  const queueForLaterEnrichment = (taskId: string, task: any) => {
    const queue = JSON.parse(localStorage.getItem('rise_ai_queue') || '[]');
    if (!queue.some((q: any) => q.taskId === taskId)) {
      queue.push({
        taskId,
        title: task.title,
        description: task.description,
        category: task.category,
        difficulty: task.difficulty,
        recurring: task.recurring,
        deadline: task.deadline || '',
        queuedAt: Date.now(),
        retries: 0
      });
      localStorage.setItem('rise_ai_queue', JSON.stringify(queue));
    }
  };

  // Process the AI enrichment queue periodically
  useEffect(() => {
    if (!user) return;

    const processAIQueue = async () => {
      const queue = JSON.parse(localStorage.getItem('rise_ai_queue') || '[]');
      if (queue.length === 0) return;

      try {
        const statusRes = await fetch('/api/ai-status');
        if (statusRes.ok) {
          const status = await statusRes.json();
          if (status.isResting || status.isRateLimited) {
            console.log('[AI Queue] AI still resting, will try again later');
            return;
          }
        }
      } catch (err) {
        console.warn('[AI Queue] Failed to check AI status, pausing queue execution:', err);
        return;
      }

      console.log(`[AI Queue] Processing ${queue.length} items in the retry queue...`);
      const updatedQueue = [...queue];

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (item.retries > 5) {
          // Remove from queue if more than 5 retries
          const index = updatedQueue.findIndex((q: any) => q.taskId === item.taskId);
          if (index !== -1) updatedQueue.splice(index, 1);
          continue;
        }

        try {
          const taskDocRef = doc(db, `users/${user.uid}/tasks/${item.taskId}`);
          const taskDoc = await getDoc(taskDocRef);
          
          if (taskDoc.exists() && !taskDoc.data().aiAnalyzed) {
            const taskData = taskDoc.data();
            const response = await fetch('/api/tasks/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: taskData.title,
                description: taskData.description,
                category: taskData.category === 'other' ? 'auto' : taskData.category,
                difficulty: taskData.difficulty || 'medium',
                recurring: taskData.recurring || 'one-time',
                deadline: taskData.deadline || '',
                behaviorProfile,
                userId: user.uid,
              })
            });

            if (response.ok) {
              const aiData = await response.json();
              await updateDoc(taskDocRef, {
                category: aiData.category || 'other',
                priority: aiData.priority || 'medium',
                estimatedMinutes: aiData.estimatedMinutes || 30,
                aiAnalyzed: true
              });
              console.log(`[AI Queue] Successfully enriched queued task "${taskData.title}"`);
              
              // Remove from queue
              const index = updatedQueue.findIndex((q: any) => q.taskId === item.taskId);
              if (index !== -1) updatedQueue.splice(index, 1);
            } else {
              item.retries++;
            }
          } else {
            // Already analyzed or deleted, remove from queue
            const index = updatedQueue.findIndex((q: any) => q.taskId === item.taskId);
            if (index !== -1) updatedQueue.splice(index, 1);
          }
        } catch (error) {
          item.retries++;
        }
      }

      localStorage.setItem('rise_ai_queue', JSON.stringify(updatedQueue));
    };

    // Run queue on load and every 2 minutes
    processAIQueue();
    const interval = setInterval(processAIQueue, 2 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, behaviorProfile]);

  const handleSignIn = async () => {
    setLoading(true);
    setAuthError(null);
    try {
      await googleSignIn();
    } catch (err: any) {
      const errStr = err instanceof Error ? err.message : String(err);
      if (errStr.includes('auth/unauthorized-domain') || errStr.includes('unauthorized-domain')) {
        console.warn('Sign-in failed due to unauthorized domain:', errStr);
        setAuthError('Please sign in from the authorized domain.');
      } else {
        console.error(err);
        setAuthError(errStr);
      }
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await logout();
      setUser(null);
      setGoogleToken(null);
      setUserProfile(null);
      setTasks([]);
      setBehaviorProfile(null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Trigger Autonomous AI Background Agent
  const triggerAutonomousAgent = async (lastActionDescription: string, type?: string, priority?: string) => {
    if (!user) return;

    if (type === 'completed') sessionCompletedCountRef.current++;
    const shouldRun = type === 'optimize' || type === 'deadline'
      || (type === 'skipped' && priority === 'high')
      || (type === 'completed' && sessionCompletedCountRef.current >= 3 && !(sessionCompletedCountRef.current = 0));

    if (!shouldRun) {
      console.log(`[Autonomous Agent Guard] Skipped running agent for action: "${lastActionDescription}". Condition not met.`);
      return;
    }

    try {
      const res = await fetch('/api/autonomous-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: tasks.filter(t => t.status === 'pending' || t.status === 'in_progress'),
          behaviorProfile,
          lastAction: lastActionDescription,
          recipientEmail: userProfile?.preferences?.notificationEmail || user.email,
          accessToken: googleToken,
          userId: user.uid,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const logEntry = data.shouldReschedule
          ? { action: `Autonomous AI Rescheduled today's calendar based on: "${data.explanation}"`, time: new Date().toLocaleTimeString() }
          : { action: `Neural agent verified tasks state: ${data.explanation}`, time: new Date().toLocaleTimeString() };
        setAutonomousLog(logEntry);
        setTimeout(() => setAutonomousLog(null), 8000);
      }
    } catch (err) {
      console.error('Error triggering autonomous background agent:', err);
    }
  };

  // Process voice results from Floating Voice assistant button
  const handleVoiceCommandResult = async (result: {
    action: 'add_task' | 'add_task_blocked' | 'add_task_forced' | 'open_existing' | 'optimize' | 'get_next' | 'complete_current' | 'unknown';
    taskTitle?: string;
    message: string;
    existingTaskId?: string;
    blockedTask?: any;
  }) => {
    if (!user) return;

    if (result.action === 'add_task') {
      // Server-side already created the task successfully. 
      // Just trigger autonomous agent context sync and keep client in sync!
      if (result.taskTitle) {
        triggerAutonomousAgent(`Voice added task: "${result.taskTitle}"`, 'voice');
      }
    } else if (result.action === 'add_task_blocked') {
      // Create a warning notification in the user's feed about the blocked duplicate
      try {
        const notifRef = collection(db, `users/${user.uid}/notifications`);
        await setDoc(doc(notifRef), {
          type: 'high',
          title: 'Similar Task Exists',
          message: result.message || `You already have a similar task. Saying 'Add anyway' will create it, or saying 'Open existing' will view it.`,
          timestamp: new Date().toLocaleTimeString(),
          read: false,
          createdAt: new Date().toISOString()
        });
      } catch (err) {
        console.error('Error writing duplicate notification:', err);
      }
    } else if (result.action === 'add_task_forced' && result.blockedTask) {
      // Create task on the client side because the user explicitly said "Add anyway"
      try {
        const newTaskData: Omit<Task, 'id'> = {
          title: result.blockedTask.title,
          description: result.blockedTask.description || 'Added via voice command (forced)',
          priority: result.blockedTask.priority || 'medium',
          status: 'pending',
          estimatedMinutes: result.blockedTask.estimatedMinutes || 30,
          actualMinutes: 0,
          createdAt: new Date().toISOString(),
          category: result.blockedTask.category || 'other',
        };

        await setDoc(doc(collection(db, `users/${user.uid}/tasks`)), newTaskData);
        triggerAutonomousAgent(`Voice added task (forced): "${result.blockedTask.title}"`, 'voice');
      } catch (err) {
        console.error('Error adding forced voice task:', err);
      }
    } else if (result.action === 'open_existing') {
      // Simply navigate to the Tasks tab
      setActiveTab('tasks');
    } else if (result.action === 'optimize') {
      setActiveTab('home');
    } else if (result.action === 'get_next') {
      setActiveTab('home');
    } else if (result.action === 'complete_current') {
      // Find highest task and mark complete
      const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
      if (pending.length > 0 && pending[0].id) {
        try {
          await setDoc(doc(db, `users/${user.uid}/tasks`, pending[0].id), {
            status: 'completed',
            completedAt: new Date().toISOString(),
          }, { merge: true });
          triggerAutonomousAgent(`Voice completed current task`, 'voice');
        } catch (err) {
          console.error(err);
        }
      }
    }
  };

  // Render Loading state
  if (loading || !authChecked) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-accent-purple animate-spin mb-4" />
        <p className="text-xs font-mono tracking-widest text-text-secondary">CONNECTING TO RISE Companion...</p>
      </div>
    );
  }

  // Render Login state
  if (!user) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Glow backdrop decorative */}
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-accent-purple-light/10 dark:bg-accent-purple-light/5 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-accent-purple-light/10 dark:bg-accent-purple-light/5 blur-[120px]" />

        <div className="max-w-md w-full text-center z-10">
          <div className="w-12 h-12 bg-accent-purple rounded-xl flex items-center justify-center mx-auto mb-6 shadow-md-main">
            <span className="text-2xl font-black italic tracking-tighter text-white">R</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-text-primary mb-2 font-sans">RISE</h1>
          <p className="text-xs text-accent-purple font-sans uppercase tracking-widest mb-6">AI Personal Productivity Companion</p>
          
          <div className="bg-bg-card border border-border-main rounded-2xl p-6 shadow-main text-left mb-6">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-3">Silent Adaptation Philosophy</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Rise never asks you to set targets or manually micro-manage lists. The AI silently adapts to your behavior, completes dynamic schedule updates, and schedules directly around overlaps on your real Google Calendar.
            </p>
          </div>

          {authError && (
            <div className="mb-6 p-4 bg-accent-red-light/50 border border-accent-red/20 rounded-xl text-left flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-accent-red flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-accent-red">Sign In Error</h4>
                <p className="text-[11px] text-accent-red/90 mt-1 leading-relaxed">{authError}</p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleSignIn}
              disabled={loading}
              className="gsi-material-button w-full cursor-pointer hover:shadow-md-main transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: "block" }}>
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                </div>
                <span className="gsi-material-button-contents text-text-primary">
                  {loading ? 'Redirecting to Google...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Authenticated App
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col lg:flex-row relative pb-16 lg:pb-0 font-sans">
      
      {/* 1. SIDEBAR NAVIGATION - Desktop only (above 1024px) */}
      <aside className="hidden lg:flex w-[80px] bg-bg-card border-r-[1.5px] border-border-main py-8 flex-col justify-between items-center shrink-0 h-screen sticky top-0 z-30">
        <div className="flex flex-col items-center gap-12 w-full">
          {/* Top Logo and brand */}
          <div className="flex flex-col items-center">
            <h1 className="font-serif text-[28px] italic font-semibold tracking-tighter leading-none text-text-primary">R.</h1>
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted [writing-mode:vertical-rl] mt-6 select-none opacity-70">
              RISE / V2.0
            </div>
          </div>

          {/* Nav Items */}
          <nav className="flex flex-col items-center gap-4 w-full px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-accent-purple text-white shadow-sm'
                      : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary'
                  }`}
                  title={item.label}
                >
                  <Icon className="w-5 h-5" />
                </button>
              );
            })}
          </nav>
        </div>
        
        {/* Proactive Agent Indicator at the bottom of sidebar */}
        <div className="flex flex-col items-center pb-2">
          <AnimatePresence>
            {isAgentCheckingIn && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex flex-col items-center text-center gap-1.5"
              >
                <div className="w-8 h-8 rounded-full bg-accent-purple/10 border border-accent-purple/20 flex items-center justify-center text-accent-purple">
                  <Sparkles className="w-4 h-4 animate-spin" />
                </div>
                <span className="text-[8px] font-bold text-accent-purple tracking-wider uppercase font-mono animate-pulse">
                  Agent Active
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen relative">
        
        {/* 2. HEADER */}
        <header className="sticky top-0 z-30 bg-bg-card border-b-[1.5px] border-border-main h-14 lg:h-[60px] px-4 md:px-6 flex justify-between items-center w-full shrink-0">
          {/* Logo on mobile and tablet, hidden on desktop */}
          <div className="lg:hidden flex flex-col text-left">
            <h1 className="text-xl font-extrabold font-syne text-text-primary leading-none tracking-tight">Rise</h1>
            <span className="text-[8px] text-text-secondary mt-1 leading-none font-mono uppercase tracking-wider">Neural Productivity</span>
          </div>

          {/* Spacing helper on desktop */}
          <div className="hidden lg:block" />

          {/* Right side elements */}
          <div className="flex items-center gap-3">
            {/* AI Status Badge */}
            <div className="flex items-center gap-1.5 text-[11px] font-mono select-none">
              {aiStatus.isResting ? (
                <div 
                  title="AI is currently cooling down/resting to maintain optimal performance."
                  className="flex items-center gap-1.5 text-accent-amber bg-accent-amber/10 border border-accent-amber/20 px-2.5 py-1 rounded-full cursor-help"
                >
                  <Pause className="w-3 h-3 text-accent-amber animate-pulse" />
                  <span className="hidden sm:inline">AI resting ({aiStatus.restUntil ? Math.max(1, Math.ceil((aiStatus.restUntil - Date.now()) / 60000)) : 1}m remaining)</span>
                  <span className="sm:hidden">Resting</span>
                </div>
              ) : (
                <div 
                  title="AI engine is fully active and processing background calibration."
                  className="flex items-center gap-1.5 text-accent-green bg-accent-green/10 border border-accent-green/20 px-2.5 py-1 rounded-full cursor-help"
                >
                  <Sparkles className="w-3 h-3 text-accent-green" />
                  <span className="hidden sm:inline">AI Active</span>
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              onClick={() => setThemeMode(prev => prev === 'light' ? 'dark' : 'light')}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-subtle text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              title="Toggle Theme"
            >
              {themeMode === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
            </button>

            {/* Notification Bell */}
            <button
              onClick={() => setNotificationsOpen(true)}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-subtle text-text-secondary hover:text-text-primary transition-colors cursor-pointer relative"
              title="Notifications"
            >
              <motion.div
                animate={notifications.some(n => !n.read) ? {
                  rotate: [0, -10, 10, -10, 10, -5, 5, 0],
                } : {}}
                transition={{
                  repeat: notifications.some(n => !n.read) ? Infinity : 0,
                  repeatDelay: 5,
                  duration: 0.6,
                }}
              >
                <Bell className="w-4.5 h-4.5" />
              </motion.div>
              {notifications.some(n => !n.read) && (
                <span className="absolute top-2.5 right-2.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-purple opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-purple"></span>
                </span>
              )}
            </button>

            {/* User Avatar with dropdown */}
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="w-9 h-9 rounded-full overflow-hidden border border-border-main hover:border-accent-purple transition-all cursor-pointer flex items-center justify-center"
              >
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full bg-accent-purple-light text-accent-purple flex items-center justify-center font-bold text-sm">
                    {(user.displayName || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
              </button>

              <AnimatePresence>
                {userDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserDropdownOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 5 }}
                      className="absolute right-0 top-11 w-56 bg-bg-card border border-border-main rounded-xl p-3 shadow-md-main z-50 text-left"
                    >
                      <p className="text-xs font-bold text-text-primary truncate">{user.displayName || 'User'}</p>
                      <p className="text-[10px] text-text-secondary truncate mt-0.5">{user.email}</p>
                      <div className="h-[1px] bg-border-main my-2" />
                      <button
                        onClick={handleSignOut}
                        className="w-full text-left py-2 px-2.5 text-xs font-semibold text-accent-red hover:bg-accent-red-light rounded-lg flex items-center gap-2 transition cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

          </div>
        </header>

        {/* Persistent Background Active Timer Banner */}
        {activeTab !== 'home' && activeTimerState && (
          <div 
            onClick={() => setActiveTab('home')}
            className="bg-accent-purple-light/30 dark:bg-accent-purple-light/10 border-b border-border-main px-6 py-2.5 flex items-center justify-between cursor-pointer transition duration-150 z-25"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-purple opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-purple"></span>
              </span>
              <p className="text-xs font-semibold text-text-primary truncate">
                Active Timer: <span className="text-text-secondary font-normal">{activeTimerState.taskTitle}</span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-mono font-bold text-accent-purple">
                {Math.floor(activeTimerElapsed / 60).toString().padStart(2, '0')}:{(activeTimerElapsed % 60).toString().padStart(2, '0')}
              </span>
              <span className="text-[10px] text-text-secondary font-semibold bg-bg-card px-2 py-0.5 rounded border border-border-main">
                Resume Focus
              </span>
            </div>
          </div>
        )}

        {/* Autonomous Background AI Agent Banner */}
        {autonomousLog && (
          <div className="max-w-xl mx-auto w-full px-4 mt-4 lg:mt-6">
            <div className="p-3 bg-accent-purple-light/10 border border-accent-purple-light rounded-xl flex items-center justify-between text-left">
              <div className="flex items-center gap-2 pr-2">
                <Shield className="w-3.5 h-3.5 text-accent-purple shrink-0" />
                <p className="text-[10px] text-accent-purple font-mono leading-snug">{autonomousLog.action}</p>
              </div>
              <span className="text-[8px] text-text-secondary font-mono shrink-0">{autonomousLog.time}</span>
            </div>
          </div>
        )}

        {/* Main Tab Switch Router */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'home' && (
                <Dashboard 
                  userId={user.uid}
                  tasks={tasks}
                  setTasks={setTasks}
                  behaviorProfile={behaviorProfile}
                  setBehaviorProfile={setBehaviorProfile}
                  onViewAllTasks={() => setActiveTab('tasks')}
                  triggerAutonomousAgent={triggerAutonomousAgent}
                  googleAccessToken={googleToken}
                  userEmail={user.email || ''}
                  userName={userProfile?.name || user.displayName || ''}
                />
              )}

              {activeTab === 'tasks' && (
                <TasksPage 
                  userId={user.uid} 
                  tasks={tasks} 
                  setTasks={setTasks} 
                  triggerAutonomousAgent={triggerAutonomousAgent}
                />
              )}

              {activeTab === 'calendar' && (
                <CalendarView 
                  googleAccessToken={googleToken} 
                  onConnectGoogle={handleSignIn} 
                  tasks={tasks}
                />
              )}

              {activeTab === 'progress' && (
                <ProgressDashboard 
                  userId={user.uid} 
                  tasks={tasks} 
                  setTasks={setTasks} 
                  behaviorProfile={behaviorProfile}
                />
              )}

              {activeTab === 'profile' && (
                <BehaviorProfilePage 
                  userId={user.uid} 
                  userProfile={userProfile} 
                  setUserProfile={setUserProfile}
                  behaviorProfile={behaviorProfile}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* 3. NOTIFICATION PANEL (Slide in from right) */}
      <AnimatePresence>
        {notificationsOpen && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setNotificationsOpen(false)}
              className="fixed inset-0 bg-black z-40 cursor-pointer"
            />
            {/* Sidebar Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="fixed top-0 right-0 h-full w-full sm:w-[380px] bg-bg-card border-l border-border-main z-50 flex flex-col shadow-md-main text-left"
            >
              <div className="p-4 border-b border-border-main flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary font-sans uppercase tracking-wider">Notifications</h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={markAllNotificationsRead}
                    className="text-[11px] font-semibold text-accent-purple hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Mark all read</span>
                  </button>
                  <button
                    onClick={() => setNotificationsOpen(false)}
                    className="p-1 text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-subtle transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* List of notifications */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <Bell className="w-8 h-8 text-text-muted mb-3" />
                    <h4 className="text-sm font-bold text-text-primary">You're all caught up!</h4>
                    <p className="text-xs text-text-muted mt-1">No new notifications</p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const borderStyles = {
                      high: 'border-l-4 border-l-accent-red',
                      ai: 'border-l-4 border-l-accent-purple',
                      success: 'border-l-4 border-l-accent-green',
                      info: 'border-l-4 border-l-accent-blue',
                    };
                    const iconColors = {
                      high: 'text-accent-red',
                      ai: 'text-accent-purple',
                      success: 'text-accent-green',
                      info: 'text-accent-blue',
                    };
                    const NotifIcon = n.type === 'high' ? AlertCircle : n.type === 'ai' ? Sparkles : n.type === 'success' ? CheckCircle : Info;

                    return (
                      <div
                        key={n.id}
                        onClick={() => handleNotificationClick(n.id)}
                        className={`p-3 rounded-xl border border-border-main transition-all duration-200 cursor-pointer flex gap-3 ${borderStyles[n.type]} ${
                          !n.read ? 'bg-accent-purple-light/10' : 'bg-bg-card'
                        }`}
                      >
                        <div className={`mt-0.5 shrink-0 ${iconColors[n.type]}`}>
                          <NotifIcon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-text-primary leading-tight">{n.title}</p>
                          <p className="text-[11px] text-text-secondary mt-1 leading-snug">{n.message}</p>
                          <span className="text-[9px] text-text-muted mt-2 block font-mono">{n.timestamp}</span>
                        </div>
                        {!n.read && (
                          <div className="shrink-0 self-center">
                            <div className="w-2.5 h-2.5 bg-accent-purple rounded-full" />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Voice Assistant Float Action button */}
      <VoiceAssistantButton onCommandResult={handleVoiceCommandResult} userId={user?.uid} />

      {/* Navigation bottom bar - Mobile/Tablet only */}
      <BottomNavBar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Interrupted Focus Session Recovery Modal */}
      <AnimatePresence>
        {showAwayModal && awayTimerState && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-bg-card border border-border-main rounded-2xl max-w-md w-full p-6 text-left shadow-md-main relative"
            >
              {/* Icon Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-accent-purple-light text-accent-purple rounded-xl border border-accent-purple/20">
                  <Brain className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary tracking-tight">Active Session Recovered</h3>
                  <p className="text-[10px] text-text-secondary">Rise detected an interrupted focus block</p>
                </div>
              </div>

              {/* Message */}
              <div className="mb-6 space-y-2">
                <p className="text-xs text-text-secondary leading-relaxed">
                  You had a task running: <span className="text-text-primary font-semibold">"{awayTimerState.taskTitle}"</span>. 
                  You were away for <span className="text-accent-purple font-extrabold">{awayDurationText}</span>.
                </p>
                <p className="text-xs text-text-secondary leading-relaxed">
                  How should Rise count this time?
                </p>
              </div>

              {/* Buttons options */}
              <div className="space-y-2.5">
                <button
                  onClick={handleResolveCompleted}
                  className="w-full py-3 px-4 bg-accent-purple hover:bg-accent-purple/90 text-white font-bold text-xs rounded-xl flex items-center justify-between transition active:scale-98 cursor-pointer"
                >
                  <span>🎯 I completed it</span>
                  <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded">Count {awayDurationText}</span>
                </button>

                <button
                  onClick={handleResolveResume}
                  className="w-full py-3 px-4 bg-bg-card hover:bg-bg-subtle text-text-primary font-bold text-xs rounded-xl flex items-center justify-between border border-border-main transition active:scale-98 cursor-pointer"
                >
                  <span>⏳ Keep timing (count the time)</span>
                  <span className="text-[10px] text-text-secondary">Continue running</span>
                </button>

                <button
                  onClick={handleResolveCancel}
                  className="w-full py-3 px-4 bg-accent-red-light hover:bg-accent-red-light/80 text-accent-red font-bold text-xs rounded-xl flex items-center justify-between border border-accent-red/20 transition active:scale-98 cursor-pointer"
                >
                  <span>❌ Discard and cancel session</span>
                  <span className="text-[10px] opacity-70">Reset to pending</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
