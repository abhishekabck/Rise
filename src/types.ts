export interface UserPreferences {
  tone: 'casual' | 'formal' | 'motivational';
  notificationEmail: string;
}

export interface UserProfile {
  email: string;
  name: string;
  photoURL?: string;
  createdAt: string;
  preferences?: UserPreferences;
}

export interface Task {
  id?: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
  estimatedMinutes: number;
  actualMinutes: number;
  scheduledAt?: string; // ISO string
  completedAt?: string; // ISO string
  createdAt: string;    // ISO string
  category: 'coding' | 'writing' | 'admin' | 'meeting' | 'learning' | 'personal' | 'other';
  deadline?: string;     // ISO string format
  difficulty?: 'easy' | 'medium' | 'hard';
  recurring?: 'one-time' | 'daily' | 'weekly' | 'monthly';
  aiAnalyzed?: boolean;
}

export interface BehaviorDaily {
  tasksCompleted: number;
  tasksAbandoned: number;
  avgCompletionTime: number;
  peakHours: number[];
  preferredCategories: string[];
  abandonedCategories: string[];
  completionRate: number;
}

export interface BehaviorProfile {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  peakProductivityHours: number[];
  averageTaskDuration: number;
  completionRate: number;
  lastUpdated: string;
}

export type TabType = 'home' | 'tasks' | 'calendar' | 'progress' | 'profile';
