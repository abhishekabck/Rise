/**
 * RUNTIME QUOTA GUARDIAN
 * Controls which AI operations are allowed based on daily usage percentage.
 * Priority tiers protect critical operations while blocking background work first.
 */

export type AIOperation =
  | 'taskAnalysis'
  | 'voiceCommand'
  | 'taskBreakdown'
  | 'optimize'
  | 'analyzeContext'
  | 'taskImprove'
  | 'personalityInsight'
  | 'progressInsight'
  | 'weeklyReview'
  | 'autonomousAgent'
  | 'checkInAgent'
  | 'learnFromCompletion'
  | 'batchTaskAnalysis';

const PRIORITY: Record<string, number> = {
  taskAnalysis: 1,         // CRITICAL  — never blocked until 95%
  voiceCommand: 2,         // HIGH      — blocked at 80%
  taskBreakdown: 2,
  batchTaskAnalysis: 2,
  optimize: 3,             // MEDIUM    — blocked at 60%
  analyzeContext: 3,
  taskImprove: 4,          // LOW       — blocked at 40%
  personalityInsight: 4,
  progressInsight: 4,
  weeklyReview: 4,
  autonomousAgent: 5,      // BACKGROUND — blocked at 30%
  checkInAgent: 5,
  learnFromCompletion: 5,
};

const THRESHOLDS: Record<number, number> = {
  1: 95,
  2: 80,
  3: 60,
  4: 40,
  5: 30,
};

const STORAGE_KEY = 'rise_quota_state';

interface QuotaState {
  callsToday: number;
  lastReset: string; // date string (toDateString)
}

export class QuotaGuardian {
  private callsToday: number;
  private dailyLimit: number;
  private lastReset: string;
  private persistFn: ((calls: number) => void) | null = null;

  constructor(dailyLimit = 1500) {
    this.dailyLimit = dailyLimit;
    const loaded = this.loadState();
    this.callsToday = loaded.callsToday;
    this.lastReset = loaded.lastReset;
  }

  private loadState(): QuotaState {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const state: QuotaState = JSON.parse(raw);
          const today = new Date().toDateString();
          if (state.lastReset === today) return state;
        }
      }
    } catch {}
    return { callsToday: 0, lastReset: new Date().toDateString() };
  }

  private saveState() {
    try {
      if (typeof localStorage !== 'undefined') {
        const state: QuotaState = { callsToday: this.callsToday, lastReset: this.lastReset };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch {}
    if (this.persistFn) this.persistFn(this.callsToday);
  }

  private maybeResetCounter() {
    const today = new Date().toDateString();
    if (today !== this.lastReset) {
      this.callsToday = 0;
      this.lastReset = today;
      this.saveState();
    }
  }

  shouldAllow(operation: string): boolean {
    this.maybeResetCounter();
    const priority = PRIORITY[operation] ?? 4;
    const threshold = THRESHOLDS[priority] ?? 40;
    const usagePercent = (this.callsToday / this.dailyLimit) * 100;
    return usagePercent < threshold;
  }

  recordCall(operation: string) {
    this.maybeResetCounter();
    this.callsToday++;
    this.saveState();
  }

  getUsagePercent(): number {
    this.maybeResetCounter();
    return (this.callsToday / this.dailyLimit) * 100;
  }

  getCallsToday(): number {
    this.maybeResetCounter();
    return this.callsToday;
  }

  onPersist(fn: (calls: number) => void) {
    this.persistFn = fn;
  }

  // ── Test helpers ─────────────────────────────────────────────────────────
  setCallsToday(n: number) {
    this.callsToday = n;
  }

  simulateNextDay() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.lastReset = tomorrow.toDateString();
    this.callsToday = 0;
  }
}

export const guardian = new QuotaGuardian();
