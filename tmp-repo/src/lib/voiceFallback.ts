/**
 * CLIENT-SIDE VOICE FALLBACK
 * Pure deterministic processing — no AI, no API calls.
 * Used when AI is rate-limited or quota is exhausted.
 */

import { parseDeadlineFast } from './deterministicChecks';

export type VoiceFallbackAction =
  | 'add_task'
  | 'optimize'
  | 'get_next'
  | 'complete_current'
  | 'unknown';

export interface VoiceFallbackResult {
  action: VoiceFallbackAction;
  taskTitle?: string;
  deadline?: string;
  confidence: 'high' | 'medium' | 'low';
  message: string;
}

// ── Intent patterns ───────────────────────────────────────────────────────

const OPTIMIZE_PATTERNS = [
  /\b(optimize|schedule|plan|arrange|sort)\b.*\b(day|today|schedule|tasks?)\b/i,
  /\b(my|the)\s+(day|schedule|tasks?)\b.*\b(plan|optimize|arrange)\b/i,
];

const GET_NEXT_PATTERNS = [
  /\bwhat('?s| is)?\b.*\b(next|now|should i do|my next)\b/i,
  /\b(show|tell|give)?\s*me\b.*\bnext\s+task\b/i,
  /\bnext\s+task\b/i,
];

const COMPLETE_PATTERNS = [
  /\b(mark|set|flag)\b.*\b(done|complete|finished|as done)\b/i,
  /\b(finish|complete)\b.*\b(task|current|this|it)\b/i,
  /\bi('?m| am)\s+(done|finished)\b/i,
  /\bcurrent\s+task.*\bdone\b/i,
];

const ADD_TASK_PATTERNS = [
  /\b(add|create|new|make)\s+(a\s+)?task\b/i,
  /\bremind\s+me\s+to\b/i,
  /\bi\s+need\s+to\b/i,
  /\bi\s+have\s+to\b/i,
  /\bdon'?t\s+forget\s+to\b/i,
  /\bput\s+(this|it|a task)\b.*\bon\s+(my\s+)?(list|todo)\b/i,
  /\b(task|todo)\b.*:\s*.+/i,
];

// ── Filler word stripping ─────────────────────────────────────────────────

const COMMAND_PREFIXES = [
  /^(add\s+(a\s+)?task\s+to\s+)/i,
  /^(add\s+(a\s+)?task:?\s*)/i,
  /^(create\s+(a\s+)?task\s+to\s+)/i,
  /^(create\s+(a\s+)?task:?\s*)/i,
  /^(new\s+task:?\s*)/i,
  /^(remind\s+me\s+to\s+)/i,
  /^(i\s+need\s+to\s+)/i,
  /^(i\s+have\s+to\s+)/i,
  /^(don'?t\s+forget\s+to\s+)/i,
  /^(please\s+)/i,
  /^(can\s+you\s+)/i,
  /^(make\s+(a\s+)?task\s+to\s+)/i,
  /^(put\s+(this\s+)?on\s+(my\s+)?list:?\s*)/i,
];

const FILLER_WORDS = /\b(um+|uh+|er+|hmm*|like|you know|you know what|so|yeah|kind of|kinda|sort of|i mean|basically|actually|literally|ok so|okay so|well|right|anyway|anyways)\b\s*/gi;

const DEADLINE_SUFFIX = /\s+by\s+(today|tomorrow|next\s+\w+|in\s+\d+\s+\w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*$/i;

function stripCommandAndFillers(transcript: string): string {
  let text = transcript.trim();

  // Remove command prefixes (try longest match first)
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const re of COMMAND_PREFIXES) {
      const match = text.match(re);
      if (match) {
        text = text.slice(match[0].length).trim();
        stripped = true;
        break;
      }
    }
  }

  // Remove filler words
  text = text.replace(FILLER_WORDS, ' ').replace(/\s{2,}/g, ' ').trim();

  return text;
}

function capitalizeTitle(title: string): string {
  if (!title) return title;
  // Capitalize first letter
  let result = title.charAt(0).toUpperCase() + title.slice(1);
  // Capitalize names (words following "call", "email", "meet", "contact", "with")
  result = result.replace(/\b(call|email|meet|contact|with|from|to|ask)\s+([a-z])/gi, (_, verb, letter) => {
    return `${verb} ${letter.toUpperCase()}`;
  });
  return result;
}

function extractDeadline(text: string): { clean: string; deadline: string | undefined } {
  const match = text.match(DEADLINE_SUFFIX);
  if (match) {
    const deadlineText = text.slice(-match[0].length).trim();
    const clean = text.slice(0, text.length - match[0].length).trim();
    const parsed = parseDeadlineFast(deadlineText);
    return { clean, deadline: parsed?.toISOString() };
  }
  // Also try to parse deadline from full text without removing it from title
  const parsed = parseDeadlineFast(text);
  return { clean: text, deadline: parsed?.toISOString() ?? undefined };
}

// ── Main export ───────────────────────────────────────────────────────────

export function fallbackVoiceProcessing(transcript: string): VoiceFallbackResult {
  const lower = transcript.toLowerCase().trim();

  // Check optimize
  if (OPTIMIZE_PATTERNS.some(p => p.test(lower))) {
    return {
      action: 'optimize',
      confidence: 'high',
      message: 'Optimizing your day schedule.',
    };
  }

  // Check get_next
  if (GET_NEXT_PATTERNS.some(p => p.test(lower))) {
    return {
      action: 'get_next',
      confidence: 'high',
      message: 'Fetching your next task.',
    };
  }

  // Check complete
  if (COMPLETE_PATTERNS.some(p => p.test(lower))) {
    return {
      action: 'complete_current',
      confidence: 'high',
      message: 'Marking current task as done.',
    };
  }

  // Check add_task
  const isAddTask = ADD_TASK_PATTERNS.some(p => p.test(lower));
  if (isAddTask) {
    const stripped = stripCommandAndFillers(transcript);
    const { clean, deadline } = extractDeadline(stripped);
    const taskTitle = capitalizeTitle(clean);
    return {
      action: 'add_task',
      taskTitle,
      deadline,
      confidence: taskTitle.length > 3 ? 'high' : 'medium',
      message: `Adding task: "${taskTitle}"`,
    };
  }

  // Last resort: if it sounds like a task description (has a verb), treat as add_task
  const hasVerb = /\b(write|build|create|review|send|complete|finish|design|develop|analyze|prepare|submit|study|read|call|email|meet|plan|organize|fix|update|test|buy|get|make|check|schedule|research|deploy|implement|record|edit|publish)\b/i.test(transcript);
  if (hasVerb && transcript.split(' ').length >= 3) {
    const stripped = stripCommandAndFillers(transcript);
    const { clean, deadline } = extractDeadline(stripped);
    const taskTitle = capitalizeTitle(clean);
    return {
      action: 'add_task',
      taskTitle,
      deadline,
      confidence: 'medium',
      message: `Adding task: "${taskTitle}"`,
    };
  }

  return {
    action: 'unknown',
    confidence: 'low',
    message: 'Could not understand the command. Please try again.',
  };
}
