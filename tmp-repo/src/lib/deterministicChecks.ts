/**
 * DETERMINISTIC PRE-CHECKS
 * Fast, zero-API-call detection for common patterns.
 * Use these BEFORE calling AI to save quota.
 */

// ── Category detection ────────────────────────────────────────────────────

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(code|coding|programming|debug|deploy|fix bug|api|backend|frontend|implement|refactor|build|commit|pr|pull request|unit test|jest|pytest|dockerfile|kubernetes|npm|pip|git)\b/i, category: 'coding' },
  { pattern: /\b(write|writing|blog|article|essay|documentation|docs|email|letter|draft|copy|content|script|report|proposal|readme)\b/i, category: 'writing' },
  { pattern: /\b(meet|meeting|call|sync|standup|interview|1:1|one.on.one|zoom|hangout|teams|presentation|demo)\b/i, category: 'meeting' },
  { pattern: /\b(study|read|learn|course|lecture|research|tutorial|book|video|lesson|practice|flashcard|certification)\b/i, category: 'learning' },
  { pattern: /\b(submit|file|fill|form|admin|paperwork|expense|invoice|tax|sign|approval|register|enroll|permit)\b/i, category: 'admin' },
  { pattern: /\b(gym|workout|exercise|run|jog|yoga|meditate|cook|grocery|shopping|laundry|clean|chore|personal|family|doctor|appointment)\b/i, category: 'personal' },
];

export function detectCategoryFast(title: string): string | null {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(title)) return category;
  }
  return null;
}

// ── Deadline parsing ──────────────────────────────────────────────────────

export function parseDeadlineFast(text: string): Date | null {
  const lower = text.toLowerCase();
  const now = new Date();

  if (/\btoday\b/.test(lower)) return now;

  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }

  if (/\bnext week\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d;
  }

  if (/\bnext month\b/.test(lower)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return d;
  }

  // "in N days / weeks / months"
  const inMatch = lower.match(/\bin (\d+)\s+(day|week|month)s?\b/);
  if (inMatch) {
    const num = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const d = new Date(now);
    if (unit === 'day') d.setDate(d.getDate() + num);
    else if (unit === 'week') d.setDate(d.getDate() + num * 7);
    else if (unit === 'month') d.setMonth(d.getMonth() + num);
    return d;
  }

  // "by monday / tuesday / ..." (nearest future weekday)
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const byMatch = lower.match(/\bby\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (byMatch) {
    const targetDay = weekdays.indexOf(byMatch[1]);
    const d = new Date(now);
    const diff = (targetDay - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  return null;
}

// ── Voice intent detection ────────────────────────────────────────────────

export interface FastIntent {
  action: 'optimize' | 'get_next' | 'complete_current';
  confidence: 'high';
}

export function detectVoiceIntentFast(transcript: string): FastIntent | null {
  const text = transcript.toLowerCase().trim();

  if (/\b(optimize|schedule|plan|arrange|sort)\b.*\b(day|today|schedule|tasks?)\b/.test(text) ||
      /\b(day|today|schedule|tasks?)\b.*\b(optimize|schedule|plan|arrange|sort)\b/.test(text)) {
    return { action: 'optimize', confidence: 'high' };
  }

  if (/\bwhat('?s| is)?\b.*\b(next|now|should i do)\b/.test(text) ||
      /\b(next|show me next)\s+task\b/.test(text)) {
    return { action: 'get_next', confidence: 'high' };
  }

  if (/\b(mark|finish|complete|done|finished)\b.*\b(task|current|this|it)\b/.test(text) ||
      /\b(i('?m| am)\s+(done|finished))\b/.test(text)) {
    return { action: 'complete_current', confidence: 'high' };
  }

  return null;
}

// ── Difficulty estimation ─────────────────────────────────────────────────

export function estimateMinutesFast(difficulty: 'easy' | 'medium' | 'hard', category?: string): number {
  const base: Record<string, number> = {
    easy: 15,
    medium: 30,
    hard: 60,
  };
  const categoryMultiplier: Record<string, number> = {
    coding: 1.5,
    writing: 1.3,
    meeting: 1.0,
    learning: 1.2,
    admin: 0.8,
    personal: 0.9,
    other: 1.0,
  };
  const minutes = base[difficulty] ?? 30;
  const mult = category ? (categoryMultiplier[category] ?? 1.0) : 1.0;
  return Math.round(minutes * mult);
}
