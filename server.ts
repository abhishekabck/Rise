import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, Timestamp, collection, getDocs, addDoc, query, where, orderBy, limit, deleteDoc } from 'firebase/firestore';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Firebase App & Firestore on Server-side
const exactFirebaseConfig = {
  apiKey: "AIzaSyDdpgRPxsu92dVF7mgWRkC6XMu0BZGYMSI",
  authDomain: "rise-2fdc8.firebaseapp.com",
  projectId: "rise-2fdc8",
  storageBucket: "rise-2fdc8.firebasestorage.app",
  messagingSenderId: "560620540392",
  appId: "1:560620540392:web:42c314174a4d9a9e93145d"
};

const firebaseApp = getApps().length === 0 ? initializeApp(exactFirebaseConfig) : getApp();
const db = getFirestore(firebaseApp);

// Initialize Gemini client on server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || 'AQ.Ab8RN6K8LDFk5c9_Aced1yGRsuFjX2iwDuqw25ioB2Od4mbZwg',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// AI Rate Limit Tracking
let isRateLimited = false;
let rateLimitResetTime = 0;

function setIsRateLimited(limited: boolean) {
  isRateLimited = limited;
  rateLimitResetTime = limited ? Date.now() + 600_000 : 0;
}

// Stamp every rate-limit fallback response so test runners can detect it
function rateLimitedJson(res: any, data: object) {
  return res.json({ ...data, _rateLimitFallback: true });
}

const isRateLimitError = (e: any) => e?.status === 429 ||
  (e?.message && (e.message.includes('429') ||
    e.message.toLowerCase().includes('quota') ||
    e.message.toLowerCase().includes('rate limit')));

async function sendGmail(accessToken: string, to: string, subject: string, body: string) {
  const raw = Buffer.from([
    `To: ${to}`, `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '', body,
  ].join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${await res.text()}`);
}

function parseGeminiText(text: string | null | undefined): any {
  if (!text) throw new Error('Empty response from Gemini');
  return JSON.parse(text);
}

async function deleteCollection(userId: string, name: string) {
  const snap = await getDocs(collection(db, 'users', userId, name));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

// ── TEST MODE ─────────────────────────────────────────────────────────────────
// When TEST_MODE=true the server generates context-aware mock responses instead
// of calling Gemini. Zero quota consumed. Switch on with: TEST_MODE=true tsx server.ts
const TEST_MODE = process.env.TEST_MODE === 'true';

function mockGenerateContent(prompt: string): string {
  const p = prompt.toLowerCase();

  // ── /api/tasks/analyze ───────────────────────────────────────────────────
  if (p.includes('category preferred') || p.includes('difficulty level')) {
    // Extract ONLY the task title field (not full prompt which contains category names in instructions)
    const titleRaw = (prompt.match(/- Title: "([^"]+)"/) ?? [])[1] ?? '';
    const t = titleRaw.toLowerCase();

    let category = 'other';
    const codingKw = ['code', 'implement', 'build', 'deploy', 'debug', 'fix', 'api', 'middleware',
      'authentication', 'fastapi', 'typescript', 'dashboard', 'database', 'backend', 'frontend',
      'endpoint', 'server', 'docker', 'test', 'function', 'class', 'module', 'script'];
    const writingKw = ['write', 'blog', 'report', 'documentation', 'doc', 'essay', 'post',
      'readme', 'content', 'presentation', 'article', 'draft', 'memo'];
    const meetingKw = ['call', 'meeting', 'standup', 'sync', 'interview', 'team', 'review'];
    const learningKw = ['learn', 'study', 'course', 'read', 'tutorial', 'research'];
    const adminKw = ['admin', 'invoice', 'expense', 'tax', 'submit', 'file', 'budget'];

    if (codingKw.some(k => t.includes(k))) category = 'coding';
    else if (writingKw.some(k => t.includes(k))) category = 'writing';
    else if (meetingKw.some(k => t.includes(k))) category = 'meeting';
    else if (learningKw.some(k => t.includes(k))) category = 'learning';
    else if (adminKw.some(k => t.includes(k))) category = 'admin';

    // Respect explicit category override
    const overrideVal = (prompt.match(/- Category Preferred: "([^"]+)"/) ?? [])[1];
    if (overrideVal && overrideVal !== 'auto') category = overrideVal;

    // Extract difficulty from the actual field (not keyword scan of full prompt)
    const diffVal = ((prompt.match(/- Difficulty Level: "([^"]+)"/) ?? [])[1] ?? 'medium').toLowerCase();
    let estimatedMinutes = diffVal === 'hard' ? 90 : diffVal === 'easy' ? 15 : 30;

    // Extract behavior profile numbers from the actual prompt lines
    const completionRate = parseInt((prompt.match(/- Completion rate: (\d+)%/) ?? [])[1] ?? '70');
    const avgDuration = parseInt((prompt.match(/- Average task duration: (\d+) mins/) ?? [])[1] ?? '30');
    if (completionRate >= 85 && avgDuration <= 25)
      estimatedMinutes = Math.max(10, Math.round(estimatedMinutes * 0.6));
    else if (completionRate <= 65 && avgDuration >= 50)
      estimatedMinutes = Math.round(estimatedMinutes * 1.5);

    // Extract deadline from the actual field
    const deadlineVal = (prompt.match(/- Deadline: "([^"]+)"/) ?? [])[1] ?? 'not specified';
    const priority = (deadlineVal && deadlineVal !== 'not specified') ? 'high' : 'medium';

    return JSON.stringify({ category, estimatedMinutes, priority });
  }

  // ── /api/voice-command ───────────────────────────────────────────────────
  if (p.includes('process this voice command') || p.includes('voice assistant')) {
    const transcriptMatch = prompt.match(/Process this voice command transcript: "([^"]+)"/i);
    const transcript = (transcriptMatch?.[1] ?? '').toLowerCase();

    if (transcript.includes('optimize') || transcript.includes('schedule my day'))
      return JSON.stringify({ action: 'optimize', confidence: 'high', message: 'Optimizing your day.' });
    if (transcript.includes('next task') || transcript.includes('whats my next') || transcript.includes("what's my next"))
      return JSON.stringify({ action: 'get_next', confidence: 'high', message: 'Here is your next task.' });

    // Parse pendingTasks from prompt (sent as JSON array)
    const pendingSection = prompt.match(/Existing pending tasks[^:]*:\s*(\[[\s\S]*?\])\s*(?:\n\s*\n|$)/i)?.[1];
    let pendingTasks: Array<{id: string; title: string; category?: string}> = [];
    try { if (pendingSection) pendingTasks = JSON.parse(pendingSection); } catch {}

    // Mark as done: "mark X as done"
    if (transcript.includes('mark') && (transcript.includes('done') || transcript.includes('complete'))) {
      const stopWords = new Set(['mark', 'done', 'the', 'as', 'it', 'that', 'this', 'a', 'an', 'task', 'complete', 'my']);
      const keywords = transcript.split(/\s+/).filter((w: string) => w.length > 3 && !stopWords.has(w));
      const match = pendingTasks.find((t: any) => keywords.some((k: string) => t.title.toLowerCase().includes(k)));
      return JSON.stringify({ action: 'complete_specific', taskId: match?.id ?? pendingTasks[0]?.id ?? '1', confidence: 'high', message: 'Task marked done.' });
    }

    // Finish/complete specific task: may need clarification
    if ((transcript.includes('finish') || transcript.includes('complete the')) && pendingTasks.length > 0) {
      const stopWords = new Set(['mark', 'done', 'the', 'as', 'it', 'that', 'this', 'a', 'an', 'task', 'complete', 'finish', 'my', 'and', 'for']);
      const keywords = transcript.split(/\s+/).filter((w: string) => w.length > 3 && !stopWords.has(w));
      const catMatches = pendingTasks.filter((t: any) => keywords.some((k: string) => (t.category ?? '').includes(k)));
      const titleMatches = pendingTasks.filter((t: any) => keywords.some((k: string) => t.title.toLowerCase().includes(k)));
      const matches = catMatches.length ? catMatches : titleMatches;
      if (matches.length === 1)
        return JSON.stringify({ action: 'complete_specific', taskId: matches[0].id, confidence: 'high', message: 'Task done.' });
      if (matches.length >= 2)
        return JSON.stringify({ action: 'complete_specific', needsClarification: true, clarificationOptions: matches.map((t: any) => t.title), confidence: 'medium', message: 'Which task did you mean?' });
    }

    // Default: add_task — clean up transcript
    let taskTitle = transcript;

    // Strip leading fillers iteratively
    const leadingFiller = /^(mm+|um+|uh+|er+|hmm+|yeah|so|ok|hey|like)\s+/i;
    for (let i = 0; i < 10 && leadingFiller.test(taskTitle); i++)
      taskTitle = taskTitle.replace(leadingFiller, '');

    // Strip command prefix
    const cmdPrefixes = ['add a task to ', 'add task to ', 'add a task ', 'add task ',
      'remind me to ', 'i need to ', 'i have to ', 'please create ', 'please add ',
      'create task ', 'new task ', 'make a task to ', 'make task '];
    for (const pfx of cmdPrefixes) {
      if (taskTitle.startsWith(pfx)) { taskTitle = taskTitle.slice(pfx.length); break; }
    }

    // Strip leading fillers again after prefix removal
    for (let i = 0; i < 5 && leadingFiller.test(taskTitle); i++)
      taskTitle = taskTitle.replace(leadingFiller, '');

    // Strip inline fillers
    taskTitle = taskTitle.replace(/\b(um+|uh+|er+|like|you know|kind of|kinda|sort of|i mean|basically|actually|literally|pls|please)\b\s*/gi, '');

    // Fix homophones
    taskTitle = taskTitle
      .replace(/\bwright\b/gi, 'write')
      .replace(/\brevue\b/gi, 'review')
      .replace(/\bbag\b/gi, 'bug');

    // Capitalize proper nouns after action verbs
    taskTitle = taskTitle.replace(/\b(call|email|meet|contact)\s+([a-z])/gi, (_, v, c) => `${v} ${c.toUpperCase()}`);

    taskTitle = taskTitle.replace(/\s+/g, ' ').trim();
    if (taskTitle) taskTitle = taskTitle.charAt(0).toUpperCase() + taskTitle.slice(1);

    const hasCommandPrefix = /\b(add|create|remind|make|new)\b/.test(transcript);
    const wordCount = taskTitle.split(/\s+/).filter((w: string) => w.length > 0).length;
    const confidence = hasCommandPrefix ? 'high' : wordCount >= 3 ? 'medium' : 'low';

    return JSON.stringify({ action: 'add_task', taskTitle, category: 'other',
      estimatedMinutes: 30, priority: 'medium', difficulty: 'medium', confidence,
      message: `Task added: ${taskTitle}` });
  }

  // ── /api/tasks/breakdown ─────────────────────────────────────────────────
  if (p.includes('break down') || p.includes('subtask') || p.includes('breakdown specialist')) {
    const titleMatch = prompt.match(/Title:\s*["']([^"']+)["']/i);
    const title = titleMatch?.[1] ?? 'Task';
    return JSON.stringify({
      subtasks: [
        { title: `Plan and outline approach for: ${title}`, estimatedMinutes: 15, order: 1, reasoning: 'Clarity first' },
        { title: `Set up environment and dependencies`, estimatedMinutes: 20, order: 2, reasoning: 'Foundation' },
        { title: `Implement core logic`, estimatedMinutes: 30, order: 3, reasoning: 'Main work' },
        { title: `Write tests and review`, estimatedMinutes: 20, order: 4, reasoning: 'Quality gate' },
        { title: `Document and finalize`, estimatedMinutes: 15, order: 5, reasoning: 'Completeness' },
      ],
      executionStrategy: 'Sequential approach: plan → build → test → document.',
    });
  }

  // ── /api/tasks/analyze-context ───────────────────────────────────────────
  if (p.includes('pattern detector') || p.includes('new task:')) {
    // Extract new task title from actual prompt format: New task: "${title}" - ...
    const newTask = ((prompt.match(/New task: "([^"]+)"/) ?? [])[1] ?? '').toLowerCase();
    const issues: any[] = [];

    // Parse existing tasks from prompt lines: - "Title" (status: X, ...)
    const existingEntries = [...prompt.matchAll(/- "([^"]+)" \(status: (\w+)/gi)]
      .map(m => ({ title: m[1].toLowerCase(), status: m[2].toLowerCase(), raw: m[1] }));

    // Duplicate detection: word overlap or near-identical after stripping articles
    const normalize = (s: string) => s.replace(/\b(the|a|an)\b/gi, '').replace(/\s+/g, ' ').trim();
    const newNorm = normalize(newTask);
    const newWords = new Set(newTask.split(' ').filter((w: string) => w.length > 3));

    for (const entry of existingEntries) {
      const existWords = new Set(entry.title.split(' ').filter((w: string) => w.length > 3));
      const overlap = [...newWords].filter(w => existWords.has(w)).length;
      const isDuplicate = overlap >= 2
        || (overlap >= 1 && Math.abs(newTask.length - entry.title.length) < 10)
        || normalize(entry.title) === newNorm;
      if (isDuplicate) {
        issues.push({ type: 'duplicate', severity: 'warning',
          message: `Similar task already exists: "${entry.raw}"`,
          suggestion: 'Consider continuing the existing task.',
          relatedTaskIds: ['1'] });
        break;
      }
    }

    // Abandonment detection: count tasks with abandoned status
    const abandonedCount = existingEntries.filter(e => e.status === 'abandoned').length;
    if (abandonedCount >= 2) {
      issues.push({ type: 'recurring_abandonment', severity: 'warning',
        message: `You have abandoned similar tasks ${abandonedCount} times before.`,
        suggestion: 'Try breaking it into smaller steps.',
        relatedTaskIds: ['1', '2', '3'].slice(0, abandonedCount) });
    }

    return JSON.stringify({ issues, shouldProceed: true });
  }

  return JSON.stringify({ message: 'Mock response' });
}

// Cache helper
async function getCachedOrGenerate(
  userId: string | undefined,
  cacheKey: string,
  generateFn: () => Promise<any>,
  ttlMs: number
): Promise<any> {
  if (!userId) {
    console.log(`[Cache Bypass] No userId provided. Executing directly.`);
    return await generateFn();
  }

  const cacheRef = doc(db, 'users', userId, 'cache', cacheKey);
  try {
    const cachedSnap = await getDoc(cacheRef);
    if (cachedSnap.exists()) {
      const data = cachedSnap.data();
      const expiresAtMillis = data.expiresAt?.toMillis?.() ?? null;
      if (expiresAtMillis && expiresAtMillis > Date.now()) {
        console.log(`[Cache Hit] Key: ${cacheKey} for user ${userId}`);
        return data.value;
      }
    }
  } catch (err) {
    console.error(`[Cache Read Error] Key: ${cacheKey}:`, err);
  }

  // Cache miss or expired - generate new
  const newValue = await generateFn();

  try {
    await setDoc(cacheRef, {
      value: newValue,
      generatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + ttlMs)
    });
    console.log(`[Cache Write] Key: ${cacheKey} saved for user ${userId}`);
  } catch (err) {
    console.error(`[Cache Write Error] Key: ${cacheKey}:`, err);
  }

  return newValue;
}

// API endpoint: Test health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// API: Clear all user data for fresh start (Factory Reset)
app.post('/api/admin/clear-user-data', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log(`[Factory Reset] Cleaning up database for user: ${userId}`);

    const tasksSnap = await getDocs(collection(db, 'users', userId, 'tasks'));
    await Promise.all([
      ...tasksSnap.docs.map(async taskDoc => {
        const subtasksSnap = await getDocs(collection(db, 'users', userId, 'tasks', taskDoc.id, 'subtasks'));
        await Promise.all(subtasksSnap.docs.map(d => deleteDoc(d.ref)));
        await deleteDoc(taskDoc.ref);
      }),
      deleteCollection(userId, 'behavior'),
      deleteDoc(doc(db, 'users', userId, 'behaviorProfile', 'profile')),
      deleteCollection(userId, 'notifications'),
      deleteCollection(userId, 'cache'),
      deleteDoc(doc(db, 'users', userId, 'locks', 'autonomous_agent')),
    ]);

    console.log(`[Factory Reset] Successfully deleted all data for user ${userId}`);
    res.json({ success: true, message: "All user data deleted successfully." });
  } catch (error: any) {
    console.error('Failed to clear user data:', error);
    res.status(500).json({ error: error.message || 'Failed to clear user data' });
  }
});

// API endpoint: Get AI Status
app.get('/api/ai-status', (req, res) => {
  if (isRateLimited && Date.now() > rateLimitResetTime) setIsRateLimited(false);
  res.json({
    isRateLimited,
    isResting: isRateLimited,
    restUntil: rateLimitResetTime > 0 ? rateLimitResetTime : null,
    minutesRemaining: isRateLimited ? Math.max(1, Math.ceil((rateLimitResetTime - Date.now()) / 60000)) : 0
  });
});

// API: Generate Insights
app.post('/api/generate-insights', async (req, res) => {
  try {
    const { type, behaviorProfile, tasks, userId } = req.body;
    let prompt = '';
    let cacheKey = '';
    let ttlMs = 0;

    if (type === 'progress') {
      const dateStr = new Date().toISOString().split('T')[0];
      cacheKey = `progress_insight_${userId || 'global'}_${dateStr}`;
      ttlMs = 6 * 60 * 60 * 1000; // 6 hours
      prompt = `
        Based on the user's weekly performance with completed tasks: ${JSON.stringify(tasks || [])}
        and their behavioral profile: ${JSON.stringify(behaviorProfile || {})}
        Write a single, encouraging, fresh, and high-quality dynamic AI insight sentence (maximum 25 words) analyzing this week's performance. Focus on growth and actionable intelligence. Return a JSON with an "insight" key containing the text.
      `;
    } else {
      cacheKey = `personality_${userId || 'global'}`;
      ttlMs = 7 * 24 * 60 * 60 * 1000; // 7 days
      prompt = `
        Based on the user's productivity behavior profile: ${JSON.stringify(behaviorProfile || {})}
        Write a concise, high-quality, professional AI Personality Summary paragraph (3 to 4 sentences, maximum 85 words) describing their work style, peak hours, and actionable advice to optimize focus. Return a JSON with an "insight" key containing the text.
      `;
    }

    const generateFn = async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              insight: { type: 'STRING' }
            },
            required: ['insight']
          }
        }
      });

      return parseGeminiText(response.text);
    };

    const data = await getCachedOrGenerate(userId, cacheKey, generateFn, ttlMs);
    res.json(data);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      console.warn('Gemini rate limit hit for generate-insights. Using fallback response.');
      setIsRateLimited(true);
      const { type } = req.body;
      if (type === 'progress') {
        return rateLimitedJson(res, { insight: "You are on track today. Keep going." });
      } else {
        return rateLimitedJson(res, { insight: "Building your unique work pattern profile..." });
      }
    }
    console.error('Insights generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate insights' });
  }
});

// API: Analyze Task
app.post('/api/tasks/analyze', async (req, res) => {
  try {
    const { title, description, category, difficulty, recurring, deadline, behaviorProfile, userId } = req.body;
    
    const prompt = `
      You are Rise, a behavior-learning personal productivity companion. 
      Analyze the following task details and determine the category, estimated completion duration in minutes, and priority.
      
      User Input Details:
      - Title: "${title}"
      - Description: "${description || ''}"
      - Category Preferred: "${category || 'auto'}" (If "auto", you must detect the category yourself)
      - Difficulty Level: "${difficulty || 'not specified'}" (easy, medium, hard)
      - Recurring Cycle: "${recurring || 'one-time'}"
      - Deadline: "${deadline || 'not specified'}"
      
      User Behavior Profile details for context:
      - Completion rate: ${behaviorProfile?.completionRate || 'N/A'}%
      - Average task duration: ${behaviorProfile?.averageTaskDuration || 'N/A'} mins
      - Strengths: ${JSON.stringify(behaviorProfile?.strengths || [])}
      - Weaknesses: ${JSON.stringify(behaviorProfile?.weaknesses || [])}
      
      Instructions:
      1. If the Category Preferred is NOT "auto" and is one of "coding", "writing", "admin", "meeting", "learning", "other", return that exact category. Otherwise, analyze the title/description and detect the best category from: "coding", "writing", "admin", "meeting", "learning", "other".
      2. Estimate a dynamic completion duration (estimatedMinutes) as a positive integer. Align this with the user's productivity rate, difficulty level, and strengths. For example, "hard" tasks or complex writing should take more time, while easy tasks should be shorter. If the user is quick at a specific category, adjust the estimate downward.
      3. Assign an optimal Priority ("low", "medium", "high"). Elevate priority if there is an upcoming deadline or high difficulty.
    `;

    const responseText = TEST_MODE
      ? mockGenerateContent(prompt)
      : (await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                category: { type: 'STRING', enum: ['coding', 'writing', 'admin', 'meeting', 'learning', 'personal', 'other'] },
                estimatedMinutes: { type: 'INTEGER' },
                priority: { type: 'STRING', enum: ['low', 'medium', 'high'] }
              },
              required: ['category', 'estimatedMinutes', 'priority']
            }
          }
        })).text;

    const data = parseGeminiText(responseText);
    res.json(data);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      console.warn('Gemini rate limit hit for task analysis. Using fallback response.');
      setIsRateLimited(true);
      return rateLimitedJson(res, {
        category: 'other',
        estimatedMinutes: 30,
        priority: 'medium'
      });
    }
    console.error('Task analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze task' });
  }
});

// API: Optimize Schedule
app.post('/api/optimize', async (req, res) => {
  try {
    const { tasks, behaviorProfile, userId, accessToken } = req.body;

    const prompt = `
      Optimize the daily schedule for Rise's user using ENERGY-AWARE SCHEDULING rules.
      
      Pending tasks:
      ${JSON.stringify(tasks)}

      Behavior Profile context:
      - Peak productivity hours: ${JSON.stringify(behaviorProfile?.peakProductivityHours || [])}
      - Strengths: ${JSON.stringify(behaviorProfile?.strengths || [])}
      - Weaknesses: ${JSON.stringify(behaviorProfile?.weaknesses || [])}
      - Avg task duration: ${behaviorProfile?.averageTaskDuration || '30'} mins

      ENERGY MANAGEMENT RULES:
      1. After every 2 hard tasks scheduled in a row, insert a 15-minute break (type: "break", title: "☕ Refresh Break").
      2. After every 4 hours of focused work, insert a 30-minute break (type: "break", title: "☕ Rest Break").
      3. Match task difficulty to time of day:
         - Peak hours: schedule hardest, most strategic tasks
         - Post-lunch dip (2-3pm): schedule easy admin tasks
         - End of day: schedule routine or creative tasks (not analytical)
      4. Match category to energy:
         - Coding requires sustained focus - protect 90+ minute blocks
         - Writing requires creativity - schedule when user is fresh
         - Admin can be batched in short bursts
         - Meetings can interrupt flow - cluster them together

      Generate a fully optimized, energy-balanced schedule starting from: ${new Date().toISOString()}.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            reasoning: { type: 'STRING' },
            energyStrategy: { type: 'STRING' },
            totalFocusTime: { type: 'STRING' },
            breakCount: { type: 'INTEGER' },
            schedule: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  type: { type: 'STRING', enum: ['task', 'break', 'buffer'] },
                  taskId: { type: 'STRING' },
                  title: { type: 'STRING' },
                  startTime: { type: 'STRING' },
                  endTime: { type: 'STRING' },
                  energyLevel: { type: 'STRING', enum: ['high', 'medium', 'low'] },
                  reasoning: { type: 'STRING' }
                },
                required: ['type', 'title', 'startTime', 'endTime', 'energyLevel', 'reasoning']
              }
            }
          },
          required: ['reasoning', 'energyStrategy', 'totalFocusTime', 'breakCount', 'schedule']
        }
      }
    });

    const data = parseGeminiText(response.text);

    // Backward compatibility: Map task items to optimizedTasks array
    const optimizedTasks = data.schedule
      .filter((item: any) => item.type === 'task')
      .map((item: any) => {
        const start = new Date(item.startTime);
        const end = new Date(item.endTime);
        const duration = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000));
        return {
          taskId: item.taskId || '',
          title: item.title,
          startTime: item.startTime,
          durationMinutes: duration
        };
      });

    const finalResponse = {
      reasoning: data.reasoning,
      energyStrategy: data.energyStrategy,
      totalFocusTime: data.totalFocusTime,
      breakCount: data.breakCount,
      schedule: data.schedule,
      optimizedTasks
    };

    // Auto-update Firestore tasks schedules
    if (userId) {
      await Promise.all(optimizedTasks.filter(i => i.taskId).map(item =>
        setDoc(doc(db, 'users', userId, 'tasks', item.taskId), {
          scheduledAt: item.startTime, estimatedMinutes: item.durationMinutes
        }, { merge: true }).catch(err => console.error(`Failed to update task ${item.taskId} schedule:`, err))
      ));
    }

    // Call calendar sync internally if accessToken is available
    if (accessToken && userId) {
      try {
        console.log(`[Auto-Sync] Triggering server-side calendar sync...`);
        const syncRes = await fetch('http://localhost:3000/api/calendar/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schedule: data.schedule,
            accessToken,
            userId
          })
        });
        if (syncRes.ok) {
          const syncData = await syncRes.json();
          finalResponse.reasoning += `\n\nGoogle Calendar Auto-Synced! Created ${syncData.eventsCreated} events.`;
        }
      } catch (err) {
        console.error('Failed auto calendar sync inside optimize API:', err);
      }
    }

    res.json(finalResponse);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      console.warn('Gemini rate limit hit for schedule optimize. Using fallback response.');
      setIsRateLimited(true);
      const { tasks } = req.body;
      const optimizedTasks = (tasks || []).map((t: any, index: number) => {
        const start = new Date(Date.now() + index * 45 * 60 * 1000).toISOString();
        return {
          taskId: t.id || `fallback-${index}`,
          title: t.title || 'Task',
          startTime: start,
          durationMinutes: t.estimatedMinutes || 30
        };
      });
      const schedule = optimizedTasks.map((ot: any) => ({
        type: 'task',
        taskId: ot.taskId,
        title: ot.title,
        startTime: ot.startTime,
        endTime: new Date(new Date(ot.startTime).getTime() + ot.durationMinutes * 60000).toISOString(),
        energyLevel: 'medium',
        reasoning: 'Fallback standard schedule due to Gemini rest mode.'
      }));
      return rateLimitedJson(res, {
        reasoning: "AI is resting. Scheduled tasks based on creation order to preserve continuous flow.",
        energyStrategy: "Direct pacing with standard durations.",
        totalFocusTime: "120",
        breakCount: 0,
        schedule,
        optimizedTasks
      });
    }
    console.error('Optimize Day error:', error);
    res.status(500).json({ error: error.message || 'Failed to optimize day' });
  }
});

// API: Autonomous AI Agent Analyzer
app.post('/api/autonomous-agent', async (req, res) => {
  try {
    const { tasks, behaviorProfile, lastAction, recipientEmail, accessToken, userId } = req.body;

    // Apply 5-minute locks check per user
    if (userId) {
      const lockRef = doc(db, 'users', userId, 'locks', 'autonomous_agent');
      try {
        const lockSnap = await getDoc(lockRef);
        if (lockSnap.exists()) {
          const lockData = lockSnap.data();
          const lockedAt = lockData.lockedAt;
          const lockedAtMillis = lockedAt?.toMillis ? lockedAt.toMillis() : (typeof lockedAt === 'number' ? lockedAt : (lockedAt instanceof Date ? lockedAt.getTime() : null));
          
          if (lockedAtMillis && (Date.now() - lockedAtMillis < 5 * 60 * 1000)) {
            console.log(`[Lock Active] Autonomous agent is locked for user ${userId}. Skipping call.`);
            return res.json({
              shouldReschedule: false,
              explanation: "Autonomous agent rate limit lock active. Try again in 5 minutes.",
              notificationSubject: "Rise Agent Sync",
              notificationMessage: "Rise agent is syncing your habits in the background."
            });
          }
        }
        
        // Set lock
        await setDoc(lockRef, {
          lockedAt: Timestamp.now()
        });
      } catch (lockErr) {
        console.error('Error handling autonomous agent lock:', lockErr);
      }
    }

    const prompt = `
      You are Rise's autonomous AI background agent. 
      The user just performed an action: "${lastAction}".
      
      Analyze the remaining tasks and the user's continuous productivity behavior profile:
      Profile: ${JSON.stringify(behaviorProfile)}
      Remaining Tasks: ${JSON.stringify(tasks)}

      Determine:
      1. Should today's schedule be dynamically rescheduled? (e.g. if a hard task was skipped, a meeting was delayed, or a high-difficulty task is overdue).
      2. Are there urgent tasks being ignored or tasks with upcoming deadlines at risk?
      
      Generate a customized, urgent email response designed exactly with the user's tone: "${behaviorProfile?.preferences?.tone || 'casual'}".
      - Be fresh and highly personalized, never generic.
      - If rescheduling is needed, provide the recommended steps.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            shouldReschedule: { type: 'BOOLEAN' },
            explanation: { type: 'STRING' },
            notificationSubject: { type: 'STRING' },
            notificationMessage: { type: 'STRING' }
          },
          required: ['shouldReschedule', 'explanation', 'notificationSubject', 'notificationMessage']
        }
      }
    });

    const data = parseGeminiText(response.text);

    // If notification required and recipientEmail + accessToken are available, send the email!
    if (recipientEmail && accessToken) {
      try {
        await sendGmail(accessToken, recipientEmail, data.notificationSubject, data.notificationMessage);
        console.log(`Autonomous Notification email successfully sent to ${recipientEmail}`);
      } catch (err) {
        console.error('Error sending autonomous email notification:', err);
      }
    }

    res.json(data);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      console.warn('Gemini rate limit hit for autonomous-agent. Using fallback response.');
      setIsRateLimited(true);
      return rateLimitedJson(res, {
        shouldReschedule: false,
        explanation: "AI is resting. Keeping your current scheduled order.",
        notificationSubject: "Rise Companion Update",
        notificationMessage: "Continuing with current schedule today."
      });
    }
    console.error('Autonomous agent analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed autonomous analysis' });
  }
});

// API: Send Custom Email Notification (Fresh generated via Gemini)
app.post('/api/smart-notify', async (req, res) => {
  try {
    const { urgency, tone, taskTitle, recipientEmail, accessToken } = req.body;

    if (!recipientEmail || !accessToken) {
      return res.status(400).json({ error: 'recipientEmail and Google accessToken are required' });
    }

    const prompt = `
      Generate a fresh email reminder for the task: "${taskTitle}".
      Tone parameter: "${tone || 'casual'}" (casual, formal, or motivational)
      Urgency parameter: "${urgency || 'medium'}" (low: gentle tone; medium: direct tone; high: assertive tone)

      Write a compelling, fresh and hyper-personalized subject and message body. Avoid boilerplate templates. Keep it highly action-focused.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            subject: { type: 'STRING' },
            body: { type: 'STRING' }
          },
          required: ['subject', 'body']
        }
      }
    });

    const data = parseGeminiText(response.text);

    // Send email using Gmail API
    await sendGmail(accessToken, recipientEmail, data.subject, data.body);
    res.json({ success: true, email: data });
  } catch (error: any) {
    if (isRateLimitError(error)) {
      console.warn('Gemini rate limit hit for smart notify. Using fallback response.');
      setIsRateLimited(true);
      return rateLimitedJson(res, {
        success: true,
        email: {
          subject: `Reminder: ${req.body.taskTitle}`,
          body: `Hi there, just a friendly reminder to stay on track with your task: "${req.body.taskTitle}". Let's get to it!`
        }
      });
    }
    console.error('Smart notification error:', error);
    res.status(500).json({ error: error.message || 'Failed to send notification' });
  }
});

// API: Process Voice Command (Actually does things now!)
app.post('/api/voice-command', async (req, res) => {
  try {
    const { transcript, userId, accessToken, behaviorProfile, pendingTasks } = req.body;

    const pendingTasksContext = pendingTasks && pendingTasks.length > 0
      ? `\nExisting pending tasks (for matching completion commands):\n${JSON.stringify(pendingTasks, null, 2)}`
      : '';

    const prompt = `
      You are Rise, an AI-powered voice assistant for productivity.
      Process this voice command transcript: "${transcript}"
      ${pendingTasksContext}

      STEP 1 — CLEAN THE TRANSCRIPT:
      - Fix common homophones based on task context: wright→write, revue→review, bag→bug (tech), right→write (writing context), sea→see, etc.
      - Strip ALL filler words: um, uh, er, hmm, like, you know, so, yeah, kind of, kinda, sort of, i mean, basically, actually, literally, ok so, anyway.
      - Strip command prefixes: "add a task to", "remind me to", "please create", "i need to", "i have to", "create task", "new task", "add task to", "make a task to".
      - Capitalize proper nouns (names, places): "call john" → "Call John", "email sarah" → "Email Sarah".
      - The resulting taskTitle should be clean, concise, properly capitalized, and action-focused.

      STEP 2 — CLASSIFY THE ACTION:
      1. "add_task" — user wants to create a new task. Extract: taskTitle (cleaned), category, estimatedMinutes, priority, difficulty.
      2. "optimize" — user wants to schedule/optimize their day.
      3. "get_next" — user wants to see/know their next task.
      4. "complete_current" — user wants to complete the active/current task.
      5. "complete_specific" — user wants to complete a task by name. Match against pendingTasks list.
         - If EXACTLY ONE task matches: set taskId to that task's id, confidence to "high".
         - If MULTIPLE tasks match and it's ambiguous: set needsClarification=true, clarificationOptions=[matching task titles], action="complete_specific".
      6. "unknown" — command not recognized.

      STEP 3 — RATE CONFIDENCE:
      - "high": clear, unambiguous command
      - "medium": reasonable interpretation but some uncertainty
      - "low": very unclear, guessing

      Provide a short (max 15 words) feedback message.
    `;

    const voiceResponseText = TEST_MODE
      ? mockGenerateContent(prompt)
      : (await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                action: { type: 'STRING', enum: ['add_task', 'optimize', 'get_next', 'complete_current', 'complete_specific', 'unknown'] },
                taskTitle: { type: 'STRING' },
                category: { type: 'STRING', enum: ['coding', 'writing', 'admin', 'meeting', 'learning', 'personal', 'other'] },
                estimatedMinutes: { type: 'INTEGER' },
                priority: { type: 'STRING', enum: ['low', 'medium', 'high'] },
                difficulty: { type: 'STRING', enum: ['easy', 'medium', 'hard'] },
                targetTaskKeyword: { type: 'STRING' },
                taskId: { type: 'STRING' },
                needsClarification: { type: 'BOOLEAN' },
                clarificationOptions: { type: 'ARRAY', items: { type: 'STRING' } },
                message: { type: 'STRING' },
                originalTranscript: { type: 'STRING' },
                confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] }
              },
              required: ['action', 'message', 'confidence']
            }
          }
        })).text;

    if (!voiceResponseText) throw new Error('Empty response from Gemini');
    const result = JSON.parse(voiceResponseText);

    // ACTUALLY EXECUTE THE ACTIONS IN FIRESTORE
    if (userId) {
      if (result.action === 'add_task' && result.taskTitle) {
        const title = result.taskTitle;
        const cat = result.category || 'other';
        const est = result.estimatedMinutes || 30;
        const prio = result.priority || 'medium';
        const diff = result.difficulty || 'medium';

        // Check for duplicate warning before creating the task
        let isDuplicate = false;
        let blockedMessage = '';
        let existingTaskId = '';

        try {
          const contextCheck = await fetch('http://localhost:3000/api/tasks/analyze-context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              newTaskTitle: title,
              newTaskDescription: '',
              userId
            })
          });

          if (contextCheck.ok) {
            const contextResult = await contextCheck.json();
            const duplicateIssue = contextResult.issues?.find(
              (issue: any) => issue.type === 'duplicate' && issue.severity === 'critical'
            );

            if (duplicateIssue) {
              isDuplicate = true;
              blockedMessage = duplicateIssue.message || `You already have a similar task: "${title}". Did you mean to update it?`;
              existingTaskId = duplicateIssue.relatedTaskIds?.[0] || '';
            }
          }
        } catch (err) {
          console.error('Error in voice-command duplicate check:', err);
        }

        if (isDuplicate) {
          return res.json({
            action: 'add_task_blocked',
            reason: 'duplicate',
            message: blockedMessage,
            existingTaskId,
            taskTitle: title,
            blockedTask: {
              title,
              category: cat,
              estimatedMinutes: est,
              priority: prio,
              difficulty: diff,
              description: `Added via voice command: "${transcript}"`
            }
          });
        }

        const newTaskRef = doc(collection(db, 'users', userId, 'tasks'));
        const newTask = {
          title,
          description: `Added via voice command: "${transcript}"`,
          category: cat,
          estimatedMinutes: est,
          actualMinutes: 0,
          priority: prio,
          difficulty: diff,
          status: 'pending',
          createdAt: new Date().toISOString(),
          recurring: 'one-time'
        };
        await setDoc(newTaskRef, newTask);
        result.message = `Task added: "${title}" (${est} mins, ${prio} priority). Scheduled automatically!`;
        
        // Auto-run pattern analysis (fire-and-forget)
        fetch(`http://localhost:3000/api/tasks/analyze-context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newTaskTitle: title, newTaskDescription: newTask.description, userId })
        }).catch(() => {});

      } else if (result.action === 'optimize') {
        const tasksRef = collection(db, 'users', userId, 'tasks');
        const snap = await getDocs(tasksRef);
        const pendingTasks = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((t: any) => t.status === 'pending');

        if (pendingTasks.length > 0) {
          const optRes = await fetch(`http://localhost:3000/api/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tasks: pendingTasks,
              behaviorProfile,
              userId,
              accessToken
            })
          });
          if (optRes.ok) {
            const optData = await optRes.json();
            result.message = `Day optimized successfully! Energy strategy applied. Scheduled ${pendingTasks.length} tasks. ${optData.reasoning}`;
          }
        } else {
          result.message = "You don't have any pending tasks to optimize right now.";
        }

      } else if (result.action === 'complete_current' || result.action === 'complete_specific') {
        const tasksRef = collection(db, 'users', userId, 'tasks');
        const snap = await getDocs(tasksRef);
        const tasksList = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

        let taskToComplete: any = null;
        if (result.action === 'complete_current') {
          taskToComplete = tasksList.find(t => t.status === 'in_progress' || t.status === 'pending');
        } else if (result.action === 'complete_specific' && result.targetTaskKeyword) {
          const kw = result.targetTaskKeyword.toLowerCase();
          taskToComplete = tasksList.find(t => t.title.toLowerCase().includes(kw));
        }

        if (taskToComplete) {
          await setDoc(doc(db, 'users', userId, 'tasks', taskToComplete.id), {
            status: 'completed',
            completedAt: new Date().toISOString(),
            actualMinutes: taskToComplete.estimatedMinutes || 30
          }, { merge: true });

          result.message = `Marked task "${taskToComplete.title}" as Done! Emergent pattern detection running in background...`;

          fetch(`http://localhost:3000/api/learn-from-completion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: taskToComplete.id,
              category: taskToComplete.category,
              estimatedMinutes: taskToComplete.estimatedMinutes || 30,
              actualMinutes: taskToComplete.estimatedMinutes || 30,
              difficulty: taskToComplete.difficulty || 'medium',
              timeOfDay: new Date().toLocaleTimeString(),
              userId,
              behaviorProfile
            })
          }).catch(() => {});
        } else {
          result.message = "I couldn't find an active or pending task to complete.";
        }
      }
    }

    res.json(result);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      console.warn('Gemini rate limit hit for voice command. Using fallback response.');
      setIsRateLimited(true);
      return rateLimitedJson(res, {
        action: 'unknown',
        message: "Voice processing is temporarily resting. Please try typing or adding tasks manually.",
        confidence: 'low'
      });
    }
    console.error('Voice command error:', error);
    res.status(500).json({ error: error.message || 'Failed to process voice command' });
  }
});

// NEW ENDPOINT 1: AUTO TASK BREAKDOWN
app.post('/api/tasks/breakdown', async (req, res) => {
  try {
    const { taskId, title, description, category, estimatedMinutes, difficulty, behaviorProfile, userId } = req.body;

    const prompt = `
      You are Rise's task breakdown specialist. The user has a complex task that needs to be split into manageable subtasks.

      Task to break down:
      - Title: "${title}"
      - Description: "${description || ''}"
      - Category: ${category}
      - Estimated total time: ${estimatedMinutes} minutes
      - Difficulty: ${difficulty}

      User's behavior context:
      - Average task duration they actually complete: ${behaviorProfile?.averageTaskDuration || 30} minutes
      - Strengths: ${JSON.stringify(behaviorProfile?.strengths || [])}
      - Weaknesses: ${JSON.stringify(behaviorProfile?.weaknesses || [])}

      Generate 3-6 logical subtasks that:
      1. Can each be completed in 15-45 minutes
      2. Follow a natural execution order
      3. Are specific and actionable (not vague like "research" or "plan")
      4. Match the user's strengths (start with their strong areas to build momentum)
      5. Total estimated time roughly equals the parent task time
    `;

    const breakdownResponseText = TEST_MODE
      ? mockGenerateContent(prompt)
      : (await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                subtasks: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      title: { type: 'STRING' },
                      estimatedMinutes: { type: 'INTEGER' },
                      order: { type: 'INTEGER' },
                      reasoning: { type: 'STRING' }
                    },
                    required: ['title', 'estimatedMinutes', 'order', 'reasoning']
                  }
                },
                executionStrategy: { type: 'STRING' }
              },
              required: ['subtasks', 'executionStrategy']
            },
            temperature: 0.4
          }
        })).text;

    if (!breakdownResponseText) throw new Error('Empty response from Gemini');
    const data = JSON.parse(breakdownResponseText);

    // Create subtasks in Firestore
    if (userId && taskId) {
      const subtasks = data.subtasks || [];
      await Promise.all([
        ...subtasks.map((st: any) => setDoc(
          doc(db, 'users', userId, 'tasks', taskId, 'subtasks', `subtask_${st.order}`),
          { title: st.title, estimatedMinutes: st.estimatedMinutes, order: st.order, reasoning: st.reasoning, completed: false, createdAt: new Date().toISOString() }
        )),
        setDoc(doc(db, 'users', userId, 'tasks', taskId), { hasSubtasks: true, executionStrategy: data.executionStrategy }, { merge: true }),
      ]);
    }

    res.json(data);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      setIsRateLimited(true);
      return rateLimitedJson(res, {
        subtasks: [
          { title: 'Plan and outline approach', estimatedMinutes: 15, order: 1, reasoning: 'Fallback: AI resting' },
          { title: 'Execute core work', estimatedMinutes: 30, order: 2, reasoning: 'Fallback: AI resting' },
          { title: 'Review and finalize', estimatedMinutes: 15, order: 3, reasoning: 'Fallback: AI resting' },
        ],
        executionStrategy: 'Standard sequential approach (AI offline fallback)'
      });
    }
    console.error('Auto breakdown error:', error);
    res.status(500).json({ error: error.message || 'Failed to auto breakdown task' });
  }
});

// NEW ENDPOINT 2: PATTERN DETECTION AND DUPLICATE WARNING
app.post('/api/tasks/analyze-context', async (req, res) => {
  try {
    const { newTaskTitle, newTaskDescription, existingTasks, behaviorProfile, userId } = req.body;

    let tasksToAnalyze = existingTasks;
    if (!tasksToAnalyze && userId) {
      // Query last 30 user tasks from Firestore
      const tasksRef = collection(db, 'users', userId, 'tasks');
      const snap = await getDocs(tasksRef);
      tasksToAnalyze = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as any))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 30);
    }

    const prompt = `
      You are Rise's pattern detector. Analyze if this new task has issues based on user history.

      New task: "${newTaskTitle}" - ${newTaskDescription || ''}

      Last 30 user tasks:
      ${(tasksToAnalyze || []).map((t: any) => `- "${t.title}" (status: ${t.status}, category: ${t.category}, created: ${t.createdAt})`).join('\n')}
    `;

    const contextResponseText = TEST_MODE
      ? mockGenerateContent(prompt)
      : (await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                issues: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      type: { type: 'STRING', enum: ['duplicate', 'recurring_abandonment', 'dependency', 'unrealistic_timing', 'pattern_warning'] },
                      severity: { type: 'STRING', enum: ['info', 'warning', 'critical'] },
                      message: { type: 'STRING' },
                      suggestion: { type: 'STRING' },
                      relatedTaskIds: { type: 'ARRAY', items: { type: 'STRING' } }
                    },
                    required: ['type', 'severity', 'message', 'suggestion']
                  }
                },
                shouldProceed: { type: 'BOOLEAN' },
                modifiedTaskSuggestion: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING' },
                    splitInto: { type: 'ARRAY', items: { type: 'STRING' } }
                  }
                }
              },
              required: ['issues', 'shouldProceed']
            },
            temperature: 0.3
          }
        })).text;

    if (!contextResponseText) throw new Error('Empty response from Gemini');
    const data = JSON.parse(contextResponseText);
    res.json(data);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      console.warn('Gemini rate limit hit for analyze-context. Returning empty issues (graceful fallback).');
      setIsRateLimited(true);
      return rateLimitedJson(res, { issues: [], shouldProceed: true });
    }
    console.error('Task context analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze task context' });
  }
});

// NEW ENDPOINT 3: AUTO ESTIMATE LEARNING
app.post('/api/learn-from-completion', async (req, res) => {
  try {
    const { taskId, category, estimatedMinutes, actualMinutes, difficulty, timeOfDay, userId, behaviorProfile } = req.body;

    const accuracy = actualMinutes / (estimatedMinutes || 30);

    // Update behaviorProfile in Firestore
    if (userId) {
      const bRef = doc(db, 'users', userId, 'behaviorProfile', 'profile');
      const bSnap = await getDoc(bRef);
      let updatedProfile = behaviorProfile || {};

      if (bSnap.exists()) {
        updatedProfile = bSnap.data();
      }

      // Smooth average task duration
      const prevAvg = updatedProfile.averageTaskDuration || 30;
      const newAvg = Math.round((prevAvg * 4 + actualMinutes) / 5);
      updatedProfile.averageTaskDuration = newAvg;

      const strengths = updatedProfile.strengths || [];
      const weaknesses = updatedProfile.weaknesses || [];
      if (accuracy < 0.7 && !strengths.includes(category)) strengths.push(category);
      else if (accuracy > 1.5 && !weaknesses.includes(category)) weaknesses.push(category);
      updatedProfile.strengths = strengths;
      updatedProfile.weaknesses = weaknesses;
      updatedProfile.lastUpdated = new Date().toISOString();

      await setDoc(bRef, updatedProfile, { merge: true });

      // Run Gemini learning every 5 completed tasks
      const tasksRef = collection(db, 'users', userId, 'tasks');
      const allSnap = await getDocs(tasksRef);
      const completions = allSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(t => t.status === 'completed' && t.completedAt)
        .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
        .slice(0, 5);

      if (completions.length >= 5) {
        const prompt = `
          Analyze this batch of 5 recent task completions and detect emerging patterns.

          Completions:
          ${completions.map(c => `- ${c.category} task "${c.title}" - estimated ${c.estimatedMinutes}m, actual ${c.actualMinutes}m, completed at ${c.completedAt}`).join('\n')}

          Detect:
          1. Time-of-day patterns: Does user complete certain categories faster at specific times?
          2. Estimation drift: Is the user consistently over/underestimating certain types?
          3. Energy patterns: Are tasks earlier in day faster than later?
          4. New strengths/weaknesses emerging?
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                behaviorUpdates: {
                  type: 'OBJECT',
                  properties: {
                    peakProductivityHours: { type: 'ARRAY', items: { type: 'INTEGER' } },
                    newStrengths: { type: 'ARRAY', items: { type: 'STRING' } },
                    newWeaknesses: { type: 'ARRAY', items: { type: 'STRING' } },
                    estimationAdjustments: {
                      type: 'OBJECT',
                      properties: {
                        coding: { type: 'NUMBER' },
                        writing: { type: 'NUMBER' },
                        admin: { type: 'NUMBER' },
                        meeting: { type: 'NUMBER' },
                        learning: { type: 'NUMBER' },
                        other: { type: 'NUMBER' }
                      }
                    }
                  }
                },
                shouldNotifyUser: { type: 'BOOLEAN' },
                insightMessage: { type: 'STRING' }
              },
              required: ['behaviorUpdates', 'shouldNotifyUser', 'insightMessage']
            },
            temperature: 0.4
          }
        });

        if (response.text) {
          const learnData = parseGeminiText(response.text);
          
          // Apply multiplier to Firestore behavior profile
          await setDoc(bRef, {
            peakProductivityHours: learnData.behaviorUpdates.peakProductivityHours || updatedProfile.peakProductivityHours,
            strengths: [...new Set([...updatedProfile.strengths, ...(learnData.behaviorUpdates.newStrengths || [])])],
            weaknesses: [...new Set([...updatedProfile.weaknesses, ...(learnData.behaviorUpdates.newWeaknesses || [])])],
            estimationAdjustments: learnData.behaviorUpdates.estimationAdjustments
          }, { merge: true });

          // Create notification for user
          if (learnData.shouldNotifyUser && learnData.insightMessage) {
            const notifRef = doc(collection(db, 'users', userId, 'notifications'));
            await setDoc(notifRef, {
              message: learnData.insightMessage,
              createdAt: new Date().toISOString(),
              read: false
            });
          }

          return res.json({ success: true, updatedProfile, geminiAnalysis: learnData });
        }
      }

      return res.json({ success: true, updatedProfile });
    }

    res.json({ success: true, accuracy });
  } catch (error: any) {
    console.error('Learn from completion error:', error);
    res.status(500).json({ error: error.message || 'Failed completion learning' });
  }
});

// NEW ENDPOINT 5: FOCUS MODE - PROACTIVE PROTECTION
app.post('/api/focus-mode/activate', async (req, res) => {
  try {
    const { taskId, title, estimatedMinutes, userId, tone } = req.body;

    if (userId) {
      // Set focus mode active in Firestore
      await setDoc(doc(db, 'users', userId, 'focusState', 'active'), {
        focusModeActive: true,
        activeTaskId: taskId,
        activatedAt: new Date().toISOString(),
        timerMinutes: estimatedMinutes || 45
      });
    }

    const prompt = `
      The user is about to start a high-focus session.
      Task: "${title}"
      Duration: ${estimatedMinutes || 45} minutes
      User tone preference: ${tone || 'casual'}

      Generate a brief, energizing focus-start message (max 20 words) that:
      - Acknowledges the task
      - Sets clear intention
      - Matches their tone
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            focusMessage: { type: 'STRING' }
          },
          required: ['focusMessage']
        },
        temperature: 0.7
      }
    });

    const data = parseGeminiText(response.text);
    res.json({ success: true, focusMessage: data.focusMessage });
  } catch (error: any) {
    console.error('Focus mode activate error:', error);
    res.status(500).json({ error: error.message || 'Failed to activate focus mode' });
  }
});

// NEW ENDPOINT 7: REAL CALENDAR INTEGRATION (Server-side auto sync)
app.post('/api/calendar/sync', async (req, res) => {
  try {
    const { schedule, accessToken, userId } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required for calendar sync' });
    }
    const items = schedule || [];
    let eventsCreated = 0;
    let conflicts = 0;

    for (const item of items) {
      let summary = item.title;
      let description = item.reasoning || 'Scheduled by Rise AI';
      let colorId = '9'; // blueberry
      let isBreak = item.type === 'break';

      if (isBreak) {
        summary = item.title || '☕ Break';
        description = 'Energy recovery break. Rest and hydrate!';
        colorId = '8'; // grey
      } else {
        summary = `🎯 [Rise] ${summary}`;
      }

      try {
        const startStr = item.startTime;
        const endStr = item.endTime || new Date(new Date(startStr).getTime() + (item.durationMinutes || 30) * 60000).toISOString();

        const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            summary,
            description,
            start: { dateTime: startStr },
            end: { dateTime: endStr },
            colorId,
            reminders: isBreak ? undefined : {
              useDefault: false,
              overrides: [{ method: 'popup', minutes: 10 }]
            }
          })
        });

        if (calRes.ok) {
          const createdEv = await calRes.json();
          eventsCreated++;

          if (userId && item.taskId) {
            try {
              await setDoc(doc(db, 'users', userId, 'tasks', item.taskId), {
                calendarEventId: createdEv.id
              }, { merge: true });
            } catch (err) {
              console.error(`Failed to update task with calendarEventId:`, err);
            }
          }
        } else {
          const errTxt = await calRes.text();
          console.error(`Google Calendar event creation failed:`, errTxt);
          if (calRes.status === 409) conflicts++;
        }
      } catch (err) {
        console.error(`Error creating calendar event for item ${item.title}:`, err);
      }
    }

    res.json({
      eventsCreated,
      conflicts,
      conflictsResolved: conflicts,
      calendarUrl: "https://calendar.google.com"
    });
  } catch (error: any) {
    console.error('Calendar sync error:', error);
    res.status(500).json({ error: error.message || 'Failed calendar sync' });
  }
});

// NEW ENDPOINT 8: PROACTIVE CHECK-IN AGENT
app.post('/api/agent/check-in', async (req, res) => {
  try {
    const { userId, completedToday, pendingToday, activeTask, minutesSinceLastAction, behaviorProfile } = req.body;

    const prompt = `
      You are Rise's proactive check-in agent. Current time: ${new Date().toISOString()}.

      User context:
      - Tasks completed today: ${completedToday || 0}
      - Tasks remaining today: ${pendingToday || 0}
      - Currently active task: "${activeTask || 'none'}"
      - Last activity: ${minutesSinceLastAction || 0} minutes ago
      - Behavior profile: ${JSON.stringify(behaviorProfile || {})}

      Determine if the user needs an intervention. Be sparing - only intervene if genuinely helpful.

      Intervention types:
      1. "momentum_check" - User completed 2+ tasks recently, encourage continuation
      2. "stall_warning" - User has been inactive on a task too long
      3. "reschedule_suggestion" - Tasks are at risk of being missed today
      4. "rest_recommendation" - User has been working too long without break
      5. "end_of_day_review" - It's evening, summarize the day
      6. "no_intervention" - User is fine, don't bother them
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            interventionType: { type: 'STRING', enum: ['momentum_check', 'stall_warning', 'reschedule_suggestion', 'rest_recommendation', 'end_of_day_review', 'no_intervention'] },
            actionRequired: { type: 'BOOLEAN' },
            message: { type: 'STRING' },
            automaticAction: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ['reschedule', 'create_break', 'send_email', 'none'] },
                details: { type: 'OBJECT' }
              },
              required: ['type']
            }
          },
          required: ['interventionType', 'actionRequired', 'message', 'automaticAction']
        },
        temperature: 0.5
      }
    });

    const data = parseGeminiText(response.text);

    // Save notification in Firestore if action is required
    if (userId && data.actionRequired && data.interventionType !== 'no_intervention') {
      const notifRef = doc(collection(db, 'users', userId, 'notifications'));
      await setDoc(notifRef, {
        message: data.message,
        type: data.interventionType,
        createdAt: new Date().toISOString(),
        read: false
      });
    }

    res.json(data);
  } catch (error: any) {
    console.error('Check-in agent error:', error);
    res.status(500).json({ error: error.message || 'Failed check-in execution' });
  }
});

// NEW ENDPOINT 9: SMART TASK REWORDING
app.post('/api/tasks/improve', async (req, res) => {
  try {
    const { title, description, abandonCount } = req.body;

    const prompt = `
      The user wrote this task: "${title}"
      ${description ? `Description: ${description}` : ''}

      This task ${abandonCount > 0 ? `has been abandoned ${abandonCount} times` : 'is too vague to be actionable'}.

      Rewrite it to be:
      1. Specific and actionable (starts with a verb)
      2. Outcome-focused (what success looks like)
      3. Time-boundable (clear scope)

      Output 3 alternative versions.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            alternatives: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  rationale: { type: 'STRING' },
                  estimatedMinutes: { type: 'INTEGER' }
                },
                required: ['title', 'rationale', 'estimatedMinutes']
              }
            },
            originalWasVague: { type: 'BOOLEAN' },
            suggestion: { type: 'STRING' }
          },
          required: ['alternatives', 'originalWasVague', 'suggestion']
        },
        temperature: 0.6
      }
    });

    const data = parseGeminiText(response.text);
    res.json(data);
  } catch (error: any) {
    console.error('Task improve error:', error);
    res.status(500).json({ error: error.message || 'Failed task improvement' });
  }
});

// NEW ENDPOINT 10: WEEKLY REVIEW AGENT
app.all('/api/agent/weekly-review', async (req, res) => {
  try {
    const { totalCompleted, totalAbandoned, categoryStats, actualPeakHours, comparisonStats, streakInfo } = { ...req.query, ...req.body } as any;

    const prompt = `
      Generate a comprehensive weekly review for the user.

      Week data:
      - Total tasks completed: ${totalCompleted || 4}
      - Total tasks abandoned: ${totalAbandoned || 1}
      - Categories breakdown: ${JSON.stringify(categoryStats || { coding: 2, admin: 1, learning: 1 })}
      - Peak productivity hours actually used: ${JSON.stringify(actualPeakHours || [9, 10])}
      - Compared to last week: ${comparisonStats || '20% increase in focus blocks'}
      - Streak status: ${streakInfo || '3 day streak active'}

      Generate a structured weekly review with:
      1. The win of the week (specific accomplishment to celebrate)
      2. The pattern (what behavioral pattern emerged this week)
      3. The friction (where user struggled)
      4. The opportunity (specific recommendation for next week)
      5. The number (one key metric to focus on next week)

      Tone: thoughtful, like a 1-on-1 with a great coach. Not corporate.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            win: { type: 'STRING' },
            pattern: { type: 'STRING' },
            friction: { type: 'STRING' },
            opportunity: { type: 'STRING' },
            focusMetric: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                currentValue: { type: 'NUMBER' },
                targetValue: { type: 'NUMBER' },
                rationale: { type: 'STRING' }
              },
              required: ['name', 'currentValue', 'targetValue', 'rationale']
            },
            headline: { type: 'STRING' }
          },
          required: ['win', 'pattern', 'friction', 'opportunity', 'focusMetric', 'headline']
        },
        temperature: 0.7
      }
    });

    const data = parseGeminiText(response.text);
    res.json(data);
  } catch (error: any) {
    console.error('Weekly review agent error:', error);
    res.status(500).json({ error: error.message || 'Failed weekly review generation' });
  }
});

// BATCH ENDPOINT: Analyze multiple tasks in a single Gemini call (saves quota)
app.post('/api/tasks/batch-analyze', async (req, res) => {
  try {
    const { tasks, behaviorProfile } = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'tasks array is required' });
    }

    const taskList = tasks.map((t: any, i: number) =>
      `${i + 1}. "${t.title}" (difficulty: ${t.difficulty || 'medium'}, category hint: ${t.category || 'auto'})`
    ).join('\n');

    const prompt = `
      Analyze these ${tasks.length} tasks and return an analysis array in the same order.

      User behavior context:
      - Average task duration: ${behaviorProfile?.averageTaskDuration || 30} mins
      - Strengths: ${JSON.stringify(behaviorProfile?.strengths || [])}
      - Weaknesses: ${JSON.stringify(behaviorProfile?.weaknesses || [])}

      Tasks to analyze:
      ${taskList}

      For each task, determine: category (coding/writing/admin/meeting/learning/personal/other), estimatedMinutes (integer), priority (low/medium/high).
      Return a JSON array with exactly ${tasks.length} objects in the same order as input.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            analyses: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  category: { type: 'STRING', enum: ['coding', 'writing', 'admin', 'meeting', 'learning', 'personal', 'other'] },
                  estimatedMinutes: { type: 'INTEGER' },
                  priority: { type: 'STRING', enum: ['low', 'medium', 'high'] }
                },
                required: ['category', 'estimatedMinutes', 'priority']
              }
            }
          },
          required: ['analyses']
        }
      }
    });

    const data = parseGeminiText(response.text);
    res.json(data);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      setIsRateLimited(true);
      const { tasks } = req.body;
      return rateLimitedJson(res, {
        analyses: (tasks || []).map(() => ({ category: 'other', estimatedMinutes: 30, priority: 'medium' }))
      });
    }
    console.error('Batch analyze error:', error);
    res.status(500).json({ error: error.message || 'Failed batch analysis' });
  }
});

// Vite Middleware for Development / static build for production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
