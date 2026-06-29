import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Plus, Sparkles, Loader2, Calendar, Award, RotateCw } from 'lucide-react';
import { addDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Task, BehaviorProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface TaskInputProps {
  userId: string;
  behaviorProfile: BehaviorProfile | null;
  onTaskAdded: (newTask: Task) => void;
  triggerAutonomousAgent: (actionDescription: string, type?: string, priority?: string) => void;
}

export default function TaskInput({ userId, behaviorProfile, onTaskAdded, triggerAutonomousAgent }: TaskInputProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [category, setCategory] = useState<string>('auto'); // 'auto' | 'learning' | 'coding' | 'personal' | 'other'
  const [isRecurring, setIsRecurring] = useState<boolean>(false);

  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [abandonCount, setAbandonCount] = useState(0);
  const [dismissedForTitle, setDismissedForTitle] = useState('');

  const isVague = (taskTitle: string): boolean => {
    const words = taskTitle.trim().split(/\s+/);
    if (words.length < 3) return true;
    
    const vagueWords = ['stuff', 'things', 'work', 'do', 'project', 'tasks', 'something'];
    const lowerTitle = taskTitle.toLowerCase();
    
    const hasOnlyVagueWords = words.every(w => 
      vagueWords.includes(w.toLowerCase()) || 
      ['my', 'the', 'a', 'on', 'and', 'or', 'with'].includes(w.toLowerCase())
    );
    
    // Check for action verb
    const actionVerbs = ['write', 'build', 'create', 'review', 'send', 'complete', 'finish', 
                         'design', 'develop', 'analyze', 'prepare', 'submit', 'study', 'read',
                         'call', 'email', 'meet', 'plan', 'organize', 'fix', 'update', 'test'];
    const hasActionVerb = words.some(w => actionVerbs.includes(w.toLowerCase()));
    
    return hasOnlyVagueWords || !hasActionVerb;
  };

  useEffect(() => {
    if (title !== dismissedForTitle) {
      setDismissedForTitle('');
    }
  }, [title]);

  useEffect(() => {
    if (!title || title.trim().length < 4) {
      setShowSuggestions(false);
      return;
    }
    
    const timer = setTimeout(async () => {
      let count = 0;
      if (userId) {
        try {
          const tasksRef = collection(db, 'users', userId, 'tasks');
          const q = query(tasksRef, where('status', '==', 'abandoned'));
          const snapshot = await getDocs(q);
          const lowercaseTitle = title.toLowerCase().trim();
          const matches = snapshot.docs.filter(doc => {
            const data = doc.data();
            return (data.title || '').toLowerCase().trim() === lowercaseTitle;
          });
          count = matches.length;
          setAbandonCount(count);
        } catch (err) {
          console.warn('Failed to check abandon history:', err);
        }
      }

      if (isVague(title) || count >= 2) {
        try {
          const response = await fetch('/api/tasks/improve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description, abandonCount: count })
          });
          if (response.ok) {
            const data = await response.json();
            if (data.alternatives && data.alternatives.length > 0) {
              setSuggestions(data.alternatives);
              setShowSuggestions(true);
            }
          }
        } catch (error) {
          console.warn('Task improvement check failed:', error);
        }
      } else {
        setShowSuggestions(false);
      }
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [title, description, userId]);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setTitle(text);
        setIsExpanded(true);
      };

      rec.onerror = (err: any) => {
        console.error('Speech input error:', err.error);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      setRecognition(rec);
    }
  }, []);

  const handleToggleVoiceInput = () => {
    if (!recognition) {
      alert('Speech input is not supported in your browser.');
      return;
    }
    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  };

  const [contextIssues, setContextIssues] = useState<any[]>([]);
  const [bypassWarnings, setBypassWarnings] = useState(false);

  const handleAddTask = async (e?: React.FormEvent, forceAdd = false) => {
    if (e) e.preventDefault();
    if (!title.trim()) return;

    setAnalyzing(true);
    try {
      // 1. Context Analysis & Pattern/Duplicate Detection (Non-blocking try-catch)
      if (contextIssues.length === 0 && !forceAdd) {
        try {
          const contextRes = await fetch('/api/tasks/analyze-context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              newTaskTitle: title,
              newTaskDescription: description,
              userId,
              behaviorProfile
            })
          });
          if (contextRes.ok) {
            const contextData = await contextRes.json();
            if (contextData.issues && contextData.issues.length > 0) {
              setContextIssues(contextData.issues);
              setAnalyzing(false);
              return; // Halt and show warnings to user
            }
          }
        } catch (contextErr) {
          console.warn('Context warning check skipped:', contextErr);
        }
      }

      // Determine initial Category
      const resolvedCategory = (category !== 'auto' ? category : 'other') as Task['category'];

      // 2. Prepare task record immediately with defaults and mark aiAnalyzed: false
      const newTaskData: Omit<Task, 'id'> = {
        title,
        description,
        priority: 'medium',
        status: 'pending',
        estimatedMinutes: 30,
        actualMinutes: 0,
        createdAt: new Date().toISOString(),
        category: resolvedCategory,
        deadline: deadline || undefined,
        difficulty,
        recurring: isRecurring ? 'daily' : 'one-time',
        aiAnalyzed: false, // background AI enrichment indicator
      };

      // 3. Write task to Firestore
      const path = `users/${userId}/tasks`;
      let docRef;
      try {
        docRef = await addDoc(collection(db, path), newTaskData);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }

      const taskWithId: Task = {
        id: docRef?.id,
        ...newTaskData,
      };

      // Reset form fields
      setTitle('');
      setDescription('');
      setDeadline('');
      setDifficulty('medium');
      setCategory('auto');
      setIsRecurring(false);
      setIsExpanded(false);
      setContextIssues([]);
      
      // Callback (adds instantly to UI)
      onTaskAdded(taskWithId);

      // Trigger Autonomous Agent immediately for basic action
      triggerAutonomousAgent(`Added task "${title}" (AI calibration running in background)`, 'added');

    } catch (err) {
      console.error('Error adding task:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="bg-transparent border-none p-0 mb-8 max-w-[600px] text-left w-full">
      <form onSubmit={handleAddTask} className="space-y-4">
        {/* Title input & voice designed as an elegant bottom-bordered wrap */}
        <div className="relative flex items-center bg-transparent border-b-2 border-text-primary py-3 flex-row gap-2 transition-all duration-200">
          <input
            type="text"
            placeholder={isListening ? "Listening..." : "Declare your intent..."}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim().length > 0) {
                setIsExpanded(true);
              }
            }}
            disabled={analyzing}
            className="flex-grow bg-transparent text-text-primary outline-none border-none text-base md:text-xl placeholder-text-muted font-serif italic py-1"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleVoiceInput}
              disabled={analyzing}
              className={`p-2 rounded-full transition-colors cursor-pointer ${
                isListening 
                  ? 'text-accent-red bg-accent-red-light border border-accent-red/20 animate-pulse' 
                  : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary'
              }`}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <span className="hidden sm:inline font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted">[hold to speak]</span>
          </div>
        </div>

        {/* Task Improvement Suggestions Panel */}
        <AnimatePresence>
          {showSuggestions && title !== dismissedForTitle && (
            <motion.div 
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              className="bg-accent-purple/5 dark:bg-accent-purple/10 border border-accent-purple/20 rounded-xl p-4 my-2 text-left space-y-3 font-mono text-xs overflow-hidden"
            >
              <div className="flex items-center justify-between text-accent-purple font-bold text-[10px] uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-accent-purple animate-pulse" />
                  <span>{abandonCount >= 2 ? `ABANDONED ${abandonCount} TIMES: MAKE IT STICK?` : 'Make this more specific?'}</span>
                </div>
                <button 
                  type="button" 
                  onClick={() => {
                    setDismissedForTitle(title);
                    setShowSuggestions(false);
                  }}
                  className="text-[9px] underline hover:text-text-primary cursor-pointer border-none bg-transparent"
                >
                  Use original
                </button>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                {suggestions.map((alt: any, idx: number) => (
                  <button 
                    key={idx}
                    type="button"
                    className="text-left p-3 rounded-lg bg-bg-card border border-border-main hover:border-accent-purple hover:bg-accent-purple-light/5 transition-all cursor-pointer group space-y-1 w-full"
                    onClick={() => {
                      setTitle(alt.title);
                      if (alt.estimatedMinutes) {
                        // Keep track or update fields if needed
                      }
                      setShowSuggestions(false);
                    }}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-sans font-bold text-text-primary text-xs group-hover:text-accent-purple transition-colors">{alt.title}</span>
                      <span className="text-[9px] text-text-muted shrink-0 bg-bg-subtle px-1.5 py-0.5 rounded border border-border-main">{alt.estimatedMinutes || 30} min</span>
                    </div>
                    <p className="text-[10px] text-text-secondary font-sans leading-relaxed italic">{alt.rationale}</p>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expandable Add Details toggle link */}
        <div className="flex justify-between items-center py-1">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-primary hover:underline font-bold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>{isExpanded ? '- LESS DETAILS' : '+ ADD DETAILS'}</span>
          </button>
        </div>

        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden space-y-4 pt-1"
            >
              {/* Category Pills Selector */}
              <div>
                <label className="block text-[10px] font-extrabold text-text-secondary uppercase tracking-widest mb-2 font-mono">Category</label>
                <div className="flex flex-wrap gap-1.5 font-mono">
                  {[
                    { id: 'auto', label: '✨ AI Auto-detect' },
                    { id: 'learning', label: 'Study' },
                    { id: 'coding', label: 'Work' },
                    { id: 'personal', label: 'Personal' },
                    { id: 'other', label: 'Other' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={`px-3 py-1.5 rounded text-[10px] uppercase font-bold tracking-wider transition-all cursor-pointer border-[1.5px] ${
                        category === cat.id
                          ? 'bg-text-primary text-bg-primary border-text-primary'
                          : 'bg-bg-card text-text-secondary border-border-main hover:bg-bg-subtle'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty & Recurring */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono">
                {/* Difficulty Pills */}
                <div>
                  <label className="block text-[10px] font-extrabold text-text-secondary uppercase tracking-widest mb-2">Difficulty</label>
                  <div className="flex bg-bg-subtle p-1 rounded border-[1.5px] border-border-main gap-1">
                    {(['easy', 'medium', 'hard'] as const).map((diff) => (
                      <button
                        key={diff}
                        type="button"
                        onClick={() => setDifficulty(diff)}
                        className={`flex-1 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition-all cursor-pointer ${
                          difficulty === diff
                            ? 'bg-text-primary text-bg-primary font-extrabold shadow-sm'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {diff}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Recurring Toggle Switch */}
                <div>
                  <label className="block text-[10px] font-extrabold text-text-secondary uppercase tracking-widest mb-2">Recurring Task</label>
                  <div className="flex bg-bg-subtle p-1 rounded border-[1.5px] border-border-main gap-1">
                    <button
                      type="button"
                      onClick={() => setIsRecurring(false)}
                      className={`flex-1 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition-all cursor-pointer ${
                        !isRecurring ? 'bg-text-primary text-bg-primary font-extrabold shadow-sm' : 'text-text-secondary'
                      }`}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRecurring(true)}
                      className={`flex-1 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition-all cursor-pointer ${
                        isRecurring ? 'bg-text-primary text-bg-primary font-extrabold shadow-sm' : 'text-text-secondary'
                      }`}
                    >
                      Yes (Daily)
                    </button>
                  </div>
                </div>
              </div>

              {/* Deadline Due Date */}
              <div>
                <label className="block text-[10px] font-extrabold text-text-secondary uppercase tracking-widest mb-2 font-mono">Due Date / Deadline</label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full bg-bg-card text-text-primary border-[1.5px] border-border-main rounded px-3 py-2 focus:outline-none focus:border-text-primary transition text-xs font-mono cursor-pointer"
                />
              </div>

              {/* Description textarea */}
              <div>
                <label className="block text-[10px] font-extrabold text-text-secondary uppercase tracking-widest mb-2 font-mono">Description / Notes</label>
                <textarea
                  placeholder="Add details, links, context or criteria..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-bg-card text-text-primary border-[1.5px] border-border-main rounded px-3 py-2 focus:outline-none focus:border-text-primary transition text-xs placeholder-text-muted resize-none font-sans"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {contextIssues.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 bg-amber-500/10 border-2 border-amber-500/40 rounded text-left space-y-3 font-mono text-xs"
            >
              <div className="flex items-center gap-2 text-amber-500 font-bold text-[10px] uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                <span>AI Context warnings detected</span>
              </div>
              <ul className="space-y-2 list-disc pl-4 text-text-secondary">
                {contextIssues.map((issue, idx) => (
                  <li key={idx}>
                    <span className="font-extrabold text-amber-500">[{issue.type.replace('_', ' ').toUpperCase()}]</span>: {issue.message} <em className="text-text-muted block mt-0.5">Suggestion: {issue.suggestion}</em>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleAddTask(undefined, true)}
                  className="px-3 py-1.5 bg-amber-500 text-bg-primary hover:bg-amber-600 rounded text-[9px] font-bold uppercase tracking-wider cursor-pointer border-none transition duration-150"
                >
                  Add Anyway
                </button>
                <button
                  type="button"
                  onClick={() => setContextIssues([])}
                  className="px-3 py-1.5 bg-bg-card hover:bg-bg-subtle text-text-secondary border border-border-main rounded text-[9px] font-bold uppercase tracking-wider cursor-pointer transition duration-150"
                >
                  Adjust details
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit button */}
        <button
          type="submit"
          disabled={!title.trim() || analyzing}
          className="w-full py-3.5 px-8 bg-text-primary text-bg-primary font-mono text-[10px] uppercase tracking-[0.15em] transition duration-200 cursor-pointer text-center flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 border-none"
        >
          {analyzing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-bg-primary" />
              <span>AI CALIBRATING...</span>
            </>
          ) : (
            <>
              <span>ADD TASK</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
