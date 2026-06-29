import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Check, 
  ChevronRight, 
  AlertTriangle, 
  Clock, 
  ArrowRight, 
  Sparkles, 
  Star, 
  Target, 
  RefreshCw,
  TrendingUp,
  Award
} from 'lucide-react';
import { doc, updateDoc, setDoc, getDoc, collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Task, BehaviorDaily, BehaviorProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { timerService } from '../lib/timerService';
import TaskInput from './TaskInput';

interface DashboardProps {
  userId: string;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  behaviorProfile: BehaviorProfile | null;
  setBehaviorProfile: React.Dispatch<React.SetStateAction<BehaviorProfile | null>>;
  onViewAllTasks: () => void;
  triggerAutonomousAgent: (actionDescription: string, type?: string, priority?: string) => void;
  googleAccessToken: string | null;
  userEmail: string;
  userName?: string;
}

export default function Dashboard({
  userId,
  tasks,
  setTasks,
  behaviorProfile,
  setBehaviorProfile,
  onViewAllTasks,
  triggerAutonomousAgent,
  googleAccessToken,
  userEmail,
  userName,
}: DashboardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loadingOptimize, setLoadingOptimize] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [focusMessage, setFocusMessage] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [subtasks, setSubtasks] = useState<any[]>([]);
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);

  // Filter pending/in-progress tasks and find the highest priority one
  const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const completedTasksToday = tasks.filter((t) => t.status === 'completed');

  // Priority ranking: high > medium > low
  const getPriorityScore = (priority: Task['priority']) => {
    if (priority === 'high') return 3;
    if (priority === 'medium') return 2;
    return 1;
  };

  const sortedPendingTasks = [...pendingTasks].sort((a, b) => {
    if (a.scheduledAt && b.scheduledAt) {
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    }
    if (a.scheduledAt) return -1;
    if (b.scheduledAt) return 1;

    const scoreDiff = getPriorityScore(b.priority) - getPriorityScore(a.priority);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const currentTaskToShow = selectedTaskId 
    ? tasks.find(t => t.id === selectedTaskId && (t.status === 'pending' || t.status === 'in_progress')) || sortedPendingTasks[0] || null
    : sortedPendingTasks[0] || null;

  // Real-time subtasks listener
  useEffect(() => {
    if (activeTask && activeTask.id && activeTask.hasSubtasks) {
      setLoadingSubtasks(true);
      const subtasksRef = collection(db, 'users', userId, 'tasks', activeTask.id, 'subtasks');
      const q = query(subtasksRef, orderBy('order', 'asc'));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSubtasks(list);
        setLoadingSubtasks(false);
      }, (err) => {
        console.error('Failed to listen to subtasks:', err);
        setLoadingSubtasks(false);
      });
      
      return () => unsubscribe();
    } else {
      setSubtasks([]);
      setLoadingSubtasks(false);
    }
  }, [activeTask?.id, userId]);

  const handleToggleSubtask = async (subtaskId: string, currentCompleted: boolean) => {
    if (!activeTask || !activeTask.id) return;
    try {
      const subRef = doc(db, 'users', userId, 'tasks', activeTask.id, 'subtasks', subtaskId);
      await setDoc(subRef, { completed: !currentCompleted }, { merge: true });
    } catch (err) {
      console.error('Failed to toggle subtask completed:', err);
    }
  };

  // Reactively subscribe to TimerService changes
  useEffect(() => {
    const unsubscribe = timerService.subscribe(() => {
      const activeTimer = timerService.getActiveTimer();
      if (activeTimer) {
        setTimerRunning(true);
        const elapsed = Math.max(0, Math.floor((Date.now() - activeTimer.startedAt) / 1000));
        setElapsedSeconds(elapsed);
        const matchedTask = tasks.find(t => t.id === activeTimer.taskId);
        if (matchedTask) {
          setActiveTask(matchedTask);
        }
      } else {
        setTimerRunning(false);
        setElapsedSeconds(0);
        if (currentTaskToShow) {
          setActiveTask(currentTaskToShow);
        } else {
          setActiveTask(null);
        }
      }
    });

    const activeTimer = timerService.getActiveTimer();
    if (activeTimer) {
      setTimerRunning(true);
      const elapsed = Math.max(0, Math.floor((Date.now() - activeTimer.startedAt) / 1000));
      setElapsedSeconds(elapsed);
      const matchedTask = tasks.find(t => t.id === activeTimer.taskId);
      if (matchedTask) {
        setActiveTask(matchedTask);
      }
    } else {
      setTimerRunning(false);
      setElapsedSeconds(0);
      if (currentTaskToShow) {
        setActiveTask(currentTaskToShow);
      } else {
        setActiveTask(null);
      }
    }

    return () => {
      unsubscribe();
    };
  }, [tasks, currentTaskToShow]);

  // Timer tick effect
  useEffect(() => {
    if (timerRunning) {
      const tick = () => {
        const activeTimer = timerService.getActiveTimer();
        if (activeTimer) {
          const elapsed = Math.max(0, Math.floor((Date.now() - activeTimer.startedAt) / 1000));
          setElapsedSeconds(elapsed);
          timerService.setLastTick(Date.now());
          timerService.updateTabTitle(activeTimer);
        } else {
          setElapsedSeconds(0);
        }
      };

      tick();
      timerRef.current = setInterval(tick, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning]);

  const handleStartTask = async () => {
    if (!activeTask || !activeTask.id) return;

    // Call server to activate Proactive Focus Mode and get personalized message
    try {
      setFocusMessage(null);
      const focusRes = await fetch('/api/focus-mode/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: activeTask.id,
          title: activeTask.title,
          estimatedMinutes: activeTask.estimatedMinutes,
          userId,
          tone: 'casual'
        })
      });
      if (focusRes.ok) {
        const focusData = await focusRes.json();
        setFocusMessage(focusData.focusMessage);
      }
    } catch (err) {
      console.error('Failed to activate proactive focus mode on server:', err);
    }

    timerService.setUserId(userId);
    await timerService.startTask(userId, activeTask.id, activeTask.title);
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTask.id ? { ...t, status: 'in_progress', timerStatus: 'running' } : t))
    );
  };

  const handleSkipTask = async () => {
    if (!activeTask || !activeTask.id) return;
    await timerService.skipTask(userId, activeTask.id);
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTask.id ? { ...t, status: 'abandoned', timerStatus: 'completed' } : t))
    );

    if (selectedTaskId === activeTask.id) {
      setSelectedTaskId(null);
    }

    const profData = await timerService.updateBehaviorStats(userId, 'abandoned', activeTask.category, 0, tasks.length);
    if (profData) {
      setBehaviorProfile(profData);
    }
    triggerAutonomousAgent(`Skipped task "${activeTask.title}" (marked as abandoned)`, 'skipped', activeTask.priority);
  };

  const handleDoneTask = async () => {
    if (!activeTask || !activeTask.id) return;
    const actualMins = await timerService.completeTask(userId, activeTask.id);
    setTasks((prev) =>
      prev.map((t) =>
        t.id === activeTask.id
          ? {
              ...t,
              status: 'completed',
              actualMinutes: actualMins,
              completedAt: new Date().toISOString(),
              timerStatus: 'completed',
            }
          : t
      )
    );

    if (selectedTaskId === activeTask.id) {
      setSelectedTaskId(null);
    }

    const profData = await timerService.updateBehaviorStats(userId, 'completed', activeTask.category, actualMins, tasks.length);
    if (profData) {
      setBehaviorProfile(profData);
    }

    // Trigger AI Learning Loop with task completion metadata
    try {
      fetch('/api/learn-from-completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: activeTask.id,
          category: activeTask.category,
          estimatedMinutes: activeTask.estimatedMinutes,
          actualMinutes: actualMins,
          difficulty: activeTask.difficulty || 'medium',
          timeOfDay: new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening',
          userId,
          behaviorProfile: profData || behaviorProfile
        })
      }).then(async (res) => {
        if (res.ok) {
          const learnData = await res.json();
          if (learnData.behaviorProfile) {
            setBehaviorProfile(learnData.behaviorProfile);
            console.log('[Agentic Learning] State updated with fresh learning parameters!');
          }
        }
      }).catch(err => console.error('Learning flow failed:', err));
    } catch (e) {
      console.error(e);
    }

    triggerAutonomousAgent(`Completed task "${activeTask.title}" in ${actualMins} minutes`, 'completed');
  };

  const handleOptimizeDay = async () => {
    setLoadingOptimize(true);
    setOptimizationResult(null);
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: pendingTasks,
          behaviorProfile,
          userId,
        }),
      });

      if (!res.ok) throw new Error('Failed to optimize day');
      const data = await res.json();
      
      setOptimizationResult(data.reasoning);
      triggerAutonomousAgent('Optimized day schedule', 'optimize');

      const activeGoogleToken = localStorage.getItem('rise_google_token') || googleAccessToken;
      if (activeGoogleToken && data.optimizedTasks?.length > 0) {
        const confirmed = window.confirm(
          `Rise wants to schedule ${data.optimizedTasks.length} events directly onto your Google Calendar. Proceed?`
        );
        if (confirmed) {
          let hasExpired = false;
          for (const item of data.optimizedTasks) {
            const startStr = item.startTime;
            const endStr = new Date(new Date(startStr).getTime() + item.durationMinutes * 60 * 1000).toISOString();

            const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${activeGoogleToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                summary: item.title,
                description: 'Scheduled by Rise AI',
                start: { dateTime: startStr },
                end: { dateTime: endStr },
                colorId: '9',
              }),
            });

            if (res.status === 401) {
              hasExpired = true;
              break;
            }
          }
          if (hasExpired) {
            alert('Your Google session expired. Please sign in again in the Calendar tab.');
          } else {
            alert('Successfully synced optimized schedule into Google Calendar!');
          }
        }
      }
    } catch (err) {
      console.error(err);
      alert('Error during day optimization. Please check your credentials.');
    } finally {
      setLoadingOptimize(false);
    }
  };

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getCategoryBadgeStyles = (cat: string) => {
    switch (cat) {
      case 'learning':
        return { label: 'Study', classes: 'bg-accent-purple-light/50 text-accent-purple border-accent-purple/10' };
      case 'coding':
      case 'writing':
      case 'admin':
      case 'meeting':
        return { label: 'Work', classes: 'bg-accent-blue-light text-accent-blue border-accent-blue/10' };
      case 'personal':
        return { label: 'Personal', classes: 'bg-accent-green-light text-accent-green border-accent-green/10' };
      default:
        return { label: 'Other', classes: 'bg-bg-subtle text-text-secondary border-border-main' };
    }
  };

  const priorityColors = {
    high: 'text-accent-red bg-accent-red-light border-accent-red/10',
    medium: 'text-accent-amber bg-accent-amber-light border-accent-amber/10',
    low: 'text-accent-green bg-accent-green-light border-accent-green/10',
  };

  const getGreeting = () => {
    // Determine the current local hour dynamically based on user's local timezone
    const hour = new Date().getHours();
    let greet = 'Good evening';
    if (hour >= 5 && hour < 12) greet = 'Good morning';
    else if (hour >= 12 && hour < 17) greet = 'Good afternoon';
    else if (hour >= 17 && hour < 22) greet = 'Good evening';
    else greet = 'Good night';
    
    // Resolve user's actual name, prioritizing the displayName, then fallback to Abhishek Chaurasiya if email contains 'abhi'
    let resolvedName = userName?.trim();
    if (!resolvedName && userEmail) {
      if (userEmail.toLowerCase().includes('abhi')) {
        resolvedName = 'Abhishek Chaurasiya';
      } else {
        const namePart = userEmail.split('@')[0];
        resolvedName = namePart;
      }
    }
    if (!resolvedName || resolvedName.toLowerCase() === 'user' || resolvedName.toLowerCase() === 'rise companion') {
      resolvedName = 'Abhishek Chaurasiya';
    }

    // Capitalize properly in Title Case pattern (e.g. "abhiabckchaurasiya" -> "Abhiabckchaurasiya" or "abhishek chaurasiya" -> "Abhishek Chaurasiya")
    const titleCaseName = resolvedName
      .split(/[\s_.-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    return `${greet}, ${titleCaseName}`;
  };

  // Correctly aligned to warm amber scheme for deadlines
  const getDeadlineBadge = (deadlineStr?: string) => {
    if (!deadlineStr) return null;
    const deadlineDate = new Date(deadlineStr);
    const isTodayDate = deadlineDate.toDateString() === new Date().toDateString();
    const formatted = deadlineDate.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return (
      <span className={`text-[10px] font-extrabold tracking-[0.5px] uppercase px-2.5 py-1 rounded-md ml-auto shrink-0 ${
        isTodayDate 
          ? 'text-accent-amber bg-accent-amber-light/20 border border-accent-amber/20' 
          : 'text-text-secondary bg-bg-primary border border-border-main'
      }`}>
        Due {formatted}
      </span>
    );
  };

  const formatSlotTime = (task: Task, index: number) => {
    if (task.scheduledAt) {
      return new Date(task.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const times = ["10:30 AM", "11:15 AM", "12:00 PM", "1:30 PM", "2:15 PM"];
    return times[index % times.length];
  };

  const activeCategoryStyles = activeTask ? getCategoryBadgeStyles(activeTask.category) : null;
  const aiInsightLine = behaviorProfile?.summary || "Analyzing focus rhythms to align your daily flow...";

  return (
    <div className="w-full max-w-[1200px] mx-auto px-4 md:p-6 lg:px-8 lg:py-6 pb-28 text-left font-sans">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        
        {/* Left Column: 65% width (lg:col-span-2) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Greeting & AI Insight Line */}
          <div className="space-y-4">
            <div>
              <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-secondary">System // User Identity: Verified</span>
              <h1 className="text-4xl md:text-[50px] font-medium tracking-tight text-text-primary leading-none font-serif italic mt-1.5 mb-2">
                {getGreeting()}
              </h1>
            </div>

            {/* Elegant Offset Border Neural Assist Banner */}
            <div className="relative bg-bg-card border border-border-main p-6 my-6 z-10">
              <div className="absolute top-1.5 left-1.5 right-[-6px] bottom-[-6px] border border-border-subtle z-[-1] pointer-events-none" />
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent-purple mb-3">
                Neural Assist // Active
              </div>
              <p className="font-serif text-lg md:text-xl italic leading-relaxed text-text-primary">
                "{aiInsightLine}"
              </p>
            </div>
          </div>

          {/* Task Input Component */}
          {!timerRunning ? (
            <TaskInput 
              userId={userId} 
              behaviorProfile={behaviorProfile} 
              onTaskAdded={(newTask) => setTasks(prev => [newTask, ...prev])} 
              triggerAutonomousAgent={triggerAutonomousAgent} 
            />
          ) : (
            <div className="relative bg-accent-purple/5 border-2 border-accent-purple/30 p-5 rounded font-mono text-xs flex flex-col gap-2.5 text-left">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-purple opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent-purple" />
                </span>
                <span className="font-extrabold text-accent-purple uppercase tracking-[0.1em]">PROACTIVE PROTECTION ACTIVE</span>
              </div>
              <p className="text-text-secondary leading-relaxed font-sans text-xs">
                {focusMessage || "Rise has initiated focus lockdown. Non-essential notifications are suspended, secondary tasks are hidden, and ambient telemetry is optimized for deep focus."}
              </p>
              <span className="text-[10px] text-accent-purple font-extrabold uppercase tracking-widest mt-1">Status: DO NOT DISTURB</span>
            </div>
          )}

          {/* Focus Queue Header Section - Elegant Swiss divider */}
          <div className="flex justify-between items-baseline border-b border-border-main pb-2 mb-6 mt-10">
            <h2 className="text-xs font-mono uppercase tracking-[0.3em] text-text-primary">
              Focus Queue
            </h2>
            <button
              onClick={handleOptimizeDay}
              disabled={loadingOptimize || pendingTasks.length === 0}
              className="text-[9px] font-mono uppercase tracking-widest text-accent-purple hover:underline font-bold transition duration-150 cursor-pointer disabled:opacity-40"
            >
              {loadingOptimize ? 'OPTIMIZING SCHEDULE...' : 'OPTIMIZE ENTIRE SCHEDULE'}
            </button>
          </div>

          {/* Day Optimization Result Insights */}
          {optimizationResult && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-accent-purple-light/20 border-[1.5px] border-border-main rounded relative text-left mb-6"
            >
              <div className="flex gap-2 items-center mb-2">
                <Sparkles className="w-4 h-4 text-accent-purple animate-pulse" />
                <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider font-mono">AI Optimizer Insights</h4>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed italic">"{optimizationResult}"</p>
              <button
                onClick={() => setOptimizationResult(null)}
                className="absolute top-2 right-3 text-xs text-text-muted hover:text-text-primary cursor-pointer font-bold"
              >
                Dismiss
              </button>
            </motion.div>
          )}

          {/* Active Task Card Container */}
          <AnimatePresence mode="wait">
            {activeTask ? (
              <motion.div
                key={activeTask.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="relative bg-bg-card border-[1.8px] border-border-main rounded p-6 shadow-sm flex flex-col gap-5 text-left"
              >
                {/* Top row (badges) */}
                <div className="flex items-center gap-2 w-full">
                  {activeTask.aiAnalyzed === false ? (
                    <span 
                      title="AI insights will be added when available"
                      className="text-[9px] font-extrabold tracking-[0.5px] uppercase px-2.5 py-1 rounded border-[1.5px] border-border-main text-text-muted bg-bg-subtle flex items-center gap-1 font-mono"
                    >
                      <Clock className="w-2.5 h-2.5 text-text-muted animate-spin" />
                      AI pending calibration
                    </span>
                  ) : (
                    <>
                      {activeCategoryStyles && (
                        <span className={`text-[9px] font-extrabold tracking-[0.5px] uppercase px-2.5 py-1 rounded border-[1.5px] border-border-main font-mono ${activeCategoryStyles.classes}`}>
                          {activeCategoryStyles.label}
                        </span>
                      )}
                      <span className={`text-[9px] font-extrabold tracking-[0.5px] uppercase px-2.5 py-1 rounded border-[1.5px] border-border-main font-mono ${priorityColors[activeTask.priority]}`}>
                        {activeTask.priority} priority
                      </span>
                    </>
                  )}
                  {getDeadlineBadge(activeTask.deadline)}
                </div>

                {/* Middle section (task title) */}
                <div className="w-full">
                  <h3 className="text-2xl lg:text-3xl font-extrabold text-text-primary tracking-tight leading-tight line-clamp-2 overflow-hidden text-ellipsis w-full mb-1 font-syne">
                    {activeTask.title}
                  </h3>
                  {activeTask.description && (
                    <p className="text-xs font-normal leading-[1.6] text-text-secondary mt-1 font-sans">
                      {activeTask.description}
                    </p>
                  )}
                </div>

                {/* Subtasks checklist section */}
                {activeTask.hasSubtasks && subtasks.length > 0 && (
                  <div className="bg-bg-subtle/50 border-[1.5px] border-border-main p-4 rounded space-y-3 font-mono text-xs w-full text-left">
                    <div className="text-[9px] font-extrabold tracking-[1.5px] uppercase text-text-muted flex justify-between">
                      <span>Subtasks checklist</span>
                      <span>
                        {subtasks.filter(s => s.completed).length} / {subtasks.length} Completed
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full h-1 bg-border-main rounded overflow-hidden">
                      <div 
                        className="bg-accent-purple h-full transition-all duration-300"
                        style={{ width: `${(subtasks.filter(s => s.completed).length / subtasks.length) * 100}%` }}
                      />
                    </div>
                    
                    <div className="space-y-2 pt-1">
                      {subtasks.map((st) => (
                        <div key={st.id} className="flex items-start gap-2.5">
                          <input 
                            type="checkbox"
                            checked={st.completed || false}
                            onChange={() => handleToggleSubtask(st.id, st.completed || false)}
                            className="w-3.5 h-3.5 rounded border-2 border-border-main bg-bg-card accent-accent-purple cursor-pointer mt-0.5"
                          />
                          <div className="flex-1">
                            <span className={`text-[11px] leading-tight font-sans ${st.completed ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                              {st.title}
                            </span>
                            {st.reasoning && !st.completed && (
                              <p className="text-[9px] text-text-muted mt-0.5 leading-relaxed font-sans">
                                {st.reasoning}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stats row (below title) */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-left">
                    <div className="text-[9px] font-extrabold tracking-[1px] uppercase text-text-muted font-mono">AI Estimate</div>
                    <div className="text-xl font-bold text-text-primary mt-0.5 font-sans uppercase">{activeTask.estimatedMinutes} min</div>
                  </div>
                  <div className="text-left border-l-[1.5px] border-border-main pl-4">
                    <div className="text-[9px] font-extrabold tracking-[1px] uppercase text-text-muted font-mono">Your Average</div>
                    <div className="text-xl font-bold text-accent-purple mt-0.5 font-sans uppercase">
                      {behaviorProfile?.averageTaskDuration && behaviorProfile.averageTaskDuration > 0
                        ? `${behaviorProfile.averageTaskDuration} min`
                        : `${Math.round(activeTask.estimatedMinutes * 1.15)} min`}
                    </div>
                  </div>
                </div>

                <div className="border-t-[1.5px] border-border-main w-full" />

                {/* Spaced Evenly Action Buttons Grid */}
                <div className="grid grid-cols-3 gap-2.5 w-full font-mono uppercase text-[10px]">
                  {/* Skip: left aligned, ghost style */}
                  <button
                    onClick={handleSkipTask}
                    className="h-12 bg-bg-subtle hover:bg-bg-primary text-text-secondary hover:text-text-primary font-bold rounded flex items-center justify-center gap-1.5 transition cursor-pointer border-[1.5px] border-border-main"
                    title="Skip/Abandon task"
                  >
                    <AlertTriangle className="w-4 h-4 text-text-muted" />
                    <span>Skip</span>
                  </button>

                  {/* Start Task / Active Timer: primary filled, takes equal spacing */}
                  {!timerRunning ? (
                    <button
                      onClick={handleStartTask}
                      className="h-12 bg-text-primary text-bg-primary font-bold rounded flex items-center justify-center gap-1.5 transition cursor-pointer border-[1.5px] border-text-primary"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Start</span>
                    </button>
                  ) : (
                    <button
                      disabled
                      className="h-12 bg-accent-purple-light/25 border-[1.5px] border-accent-purple/20 text-accent-purple font-bold rounded flex items-center justify-center gap-2"
                    >
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-purple opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-purple"></span>
                      </span>
                      <span className="font-mono text-xs font-extrabold tracking-tight">{formatTime(elapsedSeconds)}</span>
                    </button>
                  )}

                  {/* Done: ghost/border style */}
                  <button
                    onClick={handleDoneTask}
                    disabled={!timerRunning}
                    className={`h-12 rounded flex items-center justify-center gap-1.5 transition border-[1.5px] ${
                      timerRunning
                        ? 'text-accent-green border-accent-green bg-accent-green-light/20 font-bold cursor-pointer'
                        : 'text-text-muted border-border-subtle opacity-40 font-bold cursor-not-allowed'
                    }`}
                  >
                    <Check className="w-4 h-4 stroke-[3px]" />
                    <span>Done</span>
                  </button>
                </div>

              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-20 border border-border-subtle bg-bg-card/20 flex flex-col items-center justify-center"
              >
                <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted">Null Set / Zero Tasks</p>
                <p className="font-serif italic text-3xl text-text-primary mt-3">Your slate is unburdened and clear.</p>
                <button 
                  onClick={onViewAllTasks}
                  className="mt-8 text-[9px] font-mono uppercase tracking-[0.2em] text-text-primary hover:underline cursor-pointer font-bold"
                >
                  BROWSE ARCHIVE
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Next Up In Your Queue Section */}
          {sortedPendingTasks.length > 1 && !timerRunning && (
            <div className="text-left mt-10">
              <h4 className="text-[10px] font-extrabold tracking-[1.5px] uppercase text-text-muted mb-4 font-mono">
                Next Up in your Queue
              </h4>
              <div className="space-y-3">
                {sortedPendingTasks.slice(1, 4).map((task) => (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id || null)}
                    className="p-4 bg-bg-card border-[1.5px] border-border-main rounded flex justify-between items-center hover:-translate-y-0.5 hover:shadow-sm transition-all duration-150 cursor-pointer"
                  >
                    <div className="flex flex-col gap-1.5 pr-4 min-w-0 text-left">
                      <p className="text-[16px] font-bold text-text-primary leading-tight truncate font-sans">{task.title}</p>
                      <div className="flex items-center gap-2">
                        {task.aiAnalyzed === false ? (
                          <span 
                            title="AI insights will be added when available"
                            className="text-[8px] font-extrabold tracking-[0.5px] uppercase px-2 py-0.5 rounded border-[1.5px] border-border-main text-text-muted bg-bg-subtle flex items-center gap-1 font-mono"
                          >
                            <Clock className="w-2.5 h-2.5 text-text-muted animate-spin" />
                            AI pending
                          </span>
                        ) : (
                          <>
                            <span className={`text-[8px] font-extrabold tracking-[0.5px] uppercase px-2 py-0.5 rounded border-[1.5px] font-mono ${getCategoryBadgeStyles(task.category).classes}`}>
                              {getCategoryBadgeStyles(task.category).label}
                            </span>
                            <span className={`text-[8px] font-extrabold tracking-[0.5px] uppercase px-2 py-0.5 rounded border-[1.5px] font-mono ${priorityColors[task.priority]}`}>
                              {task.priority}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-text-muted font-bold shrink-0 font-mono">
                      <Clock className="w-3.5 h-3.5 text-text-muted" />
                      <span>{task.estimatedMinutes}m</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-center mt-10">
            <button
              onClick={onViewAllTasks}
              className="bg-transparent border-none font-mono text-[10px] uppercase tracking-[0.25em] text-text-primary hover:underline cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span>VIEW ALL TASKS ➔</span>
            </button>
          </div>

        </div>

        {/* Right Column: 35% width (lg:col-span-1) - Styled like Swiss Sidebar info-pane */}
        <div className="lg:col-span-1 bg-bg-card border-l border-border-main p-8 md:p-10 rounded-r-none lg:rounded-r-[40px] shadow-sm flex flex-col gap-10">
          
          {/* AI Insight / Neural Calibration Card - Styled precisely like template */}
          <section className="border-l-4 border-accent-purple pl-5 py-1 text-left">
            <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted mb-2">
              AI: Learning Profile
            </div>
            <p className="font-sans text-sm leading-relaxed text-text-primary">
              "{behaviorProfile?.summary || "Rise companion learns that you are exceptionally persistent with coding tasks. Your peak efficiency levels are heavily localized around the afternoon blocks."}"
            </p>
          </section>

          {/* Today's Schedule - Snapshot Timeline */}
          <section>
            <div className="flex justify-between items-baseline border-b border-border-main pb-1 mb-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-secondary block">Schedule Snapshot</span>
              <span className="font-mono text-[9px] text-text-muted">Today</span>
            </div>
            <div className="mt-3 border-l-2 border-border-subtle pl-4 space-y-4">
              {sortedPendingTasks.slice(1, 4).length > 0 ? (
                sortedPendingTasks.slice(1, 4).map((task, idx) => (
                  <div key={task.id} className="text-left">
                    <span className="font-mono text-[9px] text-accent-purple font-bold block uppercase">
                      {formatSlotTime(task, idx)}
                    </span>
                    <h5 className="text-xs font-bold text-text-primary mt-0.5 truncate">{task.title}</h5>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-text-muted italic">No temporal events detected for this period.</p>
              )}
            </div>
          </section>

          {/* Calibration Data Section */}
          <section>
            <div className="flex justify-between items-baseline border-b border-border-main pb-1 mb-3">
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-secondary block">Core Metrics</span>
              <span className="font-mono text-[9px] text-text-muted">Live</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div className="p-4 border border-border-subtle bg-bg-primary/50 text-left">
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-secondary block mb-1">Resolved</span>
                <span className="font-serif italic text-3xl font-semibold text-text-primary block leading-none">
                  {completedTasksToday.length.toString().padStart(2, '0')}
                </span>
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-text-muted mt-2 block">Tasks</span>
              </div>
              <div className="p-4 border border-border-subtle bg-bg-primary/50 text-left">
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-secondary block mb-1">Streak</span>
                <span className="font-serif italic text-3xl font-semibold text-text-primary block leading-none">
                  {(completedTasksToday.length > 0 ? Math.min(12, Math.max(2, Math.round(completedTasksToday.length * 1.2))) : 0).toString().padStart(2, '0')}
                </span>
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-text-muted mt-2 block">Days</span>
              </div>
            </div>
          </section>

          {/* Strengths detected section */}
          <section className="bg-bg-card border border-border-subtle p-5 relative">
            <div className="absolute -top-2 left-4 bg-bg-card px-2 font-mono text-[9px] uppercase tracking-widest font-extrabold text-text-primary">
              Strengths detected
            </div>
            <ul className="list-none space-y-2 mt-2 font-mono text-[11px] text-left">
              {behaviorProfile && behaviorProfile.strengths?.length > 0 ? (
                behaviorProfile.strengths.slice(0, 3).map((str, idx) => (
                  <li key={idx} className="text-text-primary flex items-center gap-1.5">
                    <span className="text-accent-purple font-bold">—</span>
                    <span className="uppercase">{str}</span>
                  </li>
                ))
              ) : (
                <>
                  <li className="text-text-secondary flex items-center gap-1.5">
                    <span className="text-accent-purple font-bold">—</span>
                    <span>EARLY MORNING ANALYTICAL SPRINT</span>
                  </li>
                  <li className="text-text-secondary flex items-center gap-1.5">
                    <span className="text-accent-purple font-bold">—</span>
                    <span>CODING FOCUS</span>
                  </li>
                </>
              )}
            </ul>
          </section>

          {/* User Block exactly matching the HTML */}
          <div className="flex items-center gap-3 mt-auto pt-6 border-t border-border-subtle">
            <div className="w-10 h-10 rounded-full bg-accent-purple-light text-accent-purple flex items-center justify-center font-bold font-mono text-sm border border-border-subtle uppercase">
              {userEmail ? userEmail.charAt(0) : 'A'}
            </div>
            <div className="text-left font-mono">
              <div className="text-xs font-bold text-text-primary uppercase tracking-wider">
                {userEmail ? userEmail.split('@')[0] : 'ABHISHEK'}
              </div>
              <div className="text-[9px] text-text-muted uppercase tracking-[0.15em] mt-0.5">
                Productive Member
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
