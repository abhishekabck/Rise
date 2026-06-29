import { doc, updateDoc, Timestamp, setDoc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { Task, BehaviorDaily, BehaviorProfile } from '../types';

export interface TimerState {
  taskId: string;
  taskTitle: string;
  startedAt: number; // Unix timestamp in milliseconds
  status: 'running';
}

class TimerService {
  private listeners: (() => void)[] = [];

  getActiveTimer(): TimerState | null {
    const data = localStorage.getItem('rise_active_timer');
    if (!data) return null;
    try {
      const state = JSON.parse(data) as TimerState;
      if (state && state.taskId && state.status === 'running') {
        return state;
      }
      return null;
    } catch {
      return null;
    }
  }

  getUserId(): string | null {
    return localStorage.getItem('rise_user_id');
  }

  setUserId(userId: string) {
    localStorage.setItem('rise_user_id', userId);
  }

  getLastTick(): number | null {
    const tick = localStorage.getItem('rise_timer_last_tick');
    return tick ? parseInt(tick, 10) : null;
  }

  setLastTick(tick: number) {
    localStorage.setItem('rise_timer_last_tick', tick.toString());
  }

  async startTask(userId: string, taskId: string, taskTitle: string): Promise<TimerState> {
    const now = Date.now();
    const timerState: TimerState = {
      taskId,
      taskTitle,
      startedAt: now,
      status: 'running',
    };
    localStorage.setItem('rise_active_timer', JSON.stringify(timerState));
    localStorage.setItem('rise_user_id', userId);
    this.setLastTick(now);

    // Save to Firestore in task document
    const taskRef = doc(db, `users/${userId}/tasks`, taskId);
    const startedAtTimestamp = Timestamp.fromMillis(now);
    try {
      await updateDoc(taskRef, {
        timerStartedAt: startedAtTimestamp,
        timerStatus: 'running',
        status: 'in_progress',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}/tasks/${taskId}`);
    }

    this.updateTabTitle(timerState);
    this.notify();

    return timerState;
  }

  async completeTask(userId: string, taskId: string): Promise<number> {
    const timerState = this.getActiveTimer();
    let actualMinutes = 1;
    if (timerState && timerState.taskId === taskId) {
      const elapsedMs = Date.now() - timerState.startedAt;
      actualMinutes = Math.max(1, Math.round(elapsedMs / 60000));
    }

    this.clearTimer();

    // Save to Firestore
    const taskRef = doc(db, `users/${userId}/tasks`, taskId);
    try {
      await updateDoc(taskRef, {
        actualMinutes,
        completedAt: new Date().toISOString(),
        timerStatus: 'completed',
        status: 'completed',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}/tasks/${taskId}`);
    }

    this.notify();
    return actualMinutes;
  }

  async skipTask(userId: string, taskId: string): Promise<void> {
    this.clearTimer();

    const taskRef = doc(db, `users/${userId}/tasks`, taskId);
    try {
      await updateDoc(taskRef, {
        status: 'abandoned',
        timerStatus: 'completed',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}/tasks/${taskId}`);
    }

    this.notify();
  }

  clearTimer() {
    localStorage.removeItem('rise_active_timer');
    localStorage.removeItem('rise_timer_last_tick');
    document.title = 'Rise';
    this.notify();
  }

  updateTabTitle(timerState: TimerState | null) {
    if (timerState && timerState.status === 'running') {
      const elapsedSec = Math.floor((Date.now() - timerState.startedAt) / 1000);
      const mins = Math.floor(elapsedSec / 60);
      const secs = elapsedSec % 60;
      const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      document.title = `${formatted} - Rise | ${timerState.taskTitle}`;
    } else {
      document.title = 'Rise';
    }
  }

  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  syncFromStorage() {
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  // Help update behavior stats in background
  async updateBehaviorStats(userId: string, action: 'completed' | 'abandoned', category: string, minutes: number, totalTasks: number) {
    const todayStr = new Date().toISOString().split('T')[0];
    const dailyRef = doc(db, `users/${userId}/behavior`, todayStr);
    const profileRef = doc(db, `users/${userId}/behaviorProfile`, 'profile');

    try {
      const dailySnap = await getDoc(dailyRef);
      let dailyData: BehaviorDaily = {
        tasksCompleted: 0,
        tasksAbandoned: 0,
        avgCompletionTime: 0,
        peakHours: [],
        preferredCategories: [],
        abandonedCategories: [],
        completionRate: 0,
      };

      if (dailySnap.exists()) {
        dailyData = dailySnap.data() as BehaviorDaily;
      }

      if (action === 'completed') {
        dailyData.tasksCompleted += 1;
        const totalCompleted = dailyData.tasksCompleted;
        dailyData.avgCompletionTime = Math.round(
          (dailyData.avgCompletionTime * (totalCompleted - 1) + minutes) / totalCompleted
        );
        const currentHour = new Date().getHours();
        if (!dailyData.peakHours.includes(currentHour)) {
          dailyData.peakHours.push(currentHour);
        }
        if (!dailyData.preferredCategories.includes(category)) {
          dailyData.preferredCategories.push(category);
        }
      } else {
        dailyData.tasksAbandoned += 1;
        if (!dailyData.abandonedCategories.includes(category)) {
          dailyData.abandonedCategories.push(category);
        }
      }

      const totalActions = dailyData.tasksCompleted + dailyData.tasksAbandoned;
      dailyData.completionRate = totalActions > 0 ? Math.round((dailyData.tasksCompleted / totalActions) * 100) : 0;

      await setDoc(dailyRef, dailyData);

      const profileSnap = await getDoc(profileRef);
      let profData: BehaviorProfile = {
        summary: 'Initializing continuous learning pattern...',
        strengths: ['Adaptive schedule planning'],
        weaknesses: [],
        peakProductivityHours: [9, 10, 14, 15],
        averageTaskDuration: 25,
        completionRate: 80,
        lastUpdated: new Date().toISOString(),
      };

      if (profileSnap.exists()) {
        profData = profileSnap.data() as BehaviorProfile;
      }

      const updatedProfileCompleted = (profData.completionRate * 10 + (action === 'completed' ? 100 : 0)) / 11;
      profData.completionRate = Math.round(updatedProfileCompleted);
      if (action === 'completed') {
        profData.averageTaskDuration = Math.round((profData.averageTaskDuration * 4 + minutes) / 5);
        if (!profData.strengths.includes(`${category} focus`)) {
          profData.strengths.push(`${category} focus`);
        }
      } else {
        if (!profData.weaknesses.includes(`${category} friction`)) {
          profData.weaknesses.push(`${category} friction`);
        }
      }
      profData.lastUpdated = new Date().toISOString();

      if (totalTasks % 3 === 0) {
        profData.summary = `Rise companion learns that you are exceptionally persistent with ${category} tasks. Your peak efficiency levels are heavily localized around the afternoon blocks.`;
      }

      await setDoc(profileRef, profData);
      return profData;
    } catch (err) {
      console.error('Error in timer service behavioral log:', err);
      return null;
    }
  }
}

export const timerService = new TimerService();
