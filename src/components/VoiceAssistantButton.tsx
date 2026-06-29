import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Sparkles, Clock, X, Volume2, Loader2, AlertCircle, CheckCircle, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAIStatus } from '../hooks/useAIStatus';

interface VoiceAssistantButtonProps {
  userId?: string;
  onCommandResult: (result: {
    action: 'add_task' | 'add_task_blocked' | 'add_task_forced' | 'open_existing' | 'optimize' | 'get_next' | 'complete_current' | 'unknown';
    taskTitle?: string;
    message: string;
    existingTaskId?: string;
    blockedTask?: any;
  }) => void;
}

type AssistantState = 'idle' | 'listening' | 'processing' | 'executing' | 'success' | 'error';

export default function VoiceAssistantButton({ onCommandResult, userId }: VoiceAssistantButtonProps) {
  const [assistantState, setAssistantState] = useState<AssistantState>('idle');
  const [permissionState, setPermissionState] = useState<PermissionState | 'unknown'>('unknown');
  const [showDeniedModal, setShowDeniedModal] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [showStatus, setShowStatus] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [hasUsedVoice, setHasUsedVoice] = useState<boolean>(() => {
    return localStorage.getItem('rise_has_used_voice') === 'true';
  });
  const [pendingBlockedTask, setPendingBlockedTask] = useState<any>(null);

  const recognitionRef = useRef<any>(null);
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const finalTranscriptRef = useRef('');

  // AI Active / Resting Status
  const aiStatus = useAIStatus();

  // Click vs Hold Refs
  const isHoldingRef = useRef(false);
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const justFinishedHoldingRef = useRef(false);

  // Initialize and check permissions
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Try checking via Permission API
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as any })
        .then((permissionStatus) => {
          setPermissionState(permissionStatus.state);
          permissionStatus.onchange = () => {
            setPermissionState(permissionStatus.state);
          };
        })
        .catch((err) => {
          console.warn('Microphone permission check not supported:', err);
        });
    }

    // Load first-time voice tutorial preference from Firestore
    const fetchVoiceTutorialPref = async () => {
      if (!userId) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.hasUsedVoice) {
            setHasUsedVoice(true);
            localStorage.setItem('rise_has_used_voice', 'true');
          } else {
            // If they have never used voice, we'll show tutorial after permission is granted
            if (permissionState === 'granted') {
              setShowTutorial(true);
            }
          }
        }
      } catch (err) {
        console.warn('Error fetching voice usage preference from Firestore:', err);
      }
    };

    fetchVoiceTutorialPref();
  }, [userId, permissionState]);

  // Show tutorial when permission changes to granted and they haven't used voice
  useEffect(() => {
    if (permissionState === 'granted' && !hasUsedVoice) {
      setShowTutorial(true);
    }
  }, [permissionState, hasUsedVoice]);

  // Keyboard shortcut handler (Ctrl+Shift+V or Cmd+Shift+V)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isModifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (isModifierPressed && event.shiftKey && event.key.toUpperCase() === 'V') {
        event.preventDefault();
        handleVoiceButtonClick();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [permissionState, assistantState]);

  const showTemporaryStatus = (msg: string, duration = 3000) => {
    setStatusMessage(msg);
    setShowStatus(true);
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = setTimeout(() => {
      setShowStatus(false);
    }, duration);
  };

  const requestMicPermission = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Successfully obtained permission
      stream.getTracks().forEach((track) => track.stop());
      setPermissionState('granted');
      return true;
    } catch (error: any) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setPermissionState('denied');
        setShowDeniedModal(true);
        return false;
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('No microphone detected on this device. Please connect a microphone.');
        return false;
      }
      return false;
    }
  };

  const startVoiceRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Voice recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setAssistantState('listening');
      setInterimText('');
      finalTranscriptRef.current = '';
      showTemporaryStatus('Listening...', 10000);
      // Hide tutorial once they start speaking
      setShowTutorial(false);
    };

    rec.onresult = (event: any) => {
      let interim = '';
      let finalPart = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalPart += transcript;
        } else {
          interim += transcript;
        }
      }

      if (finalPart) {
        finalTranscriptRef.current += finalPart;
      }

      // Show interim transcript live to user (just visual feedback)
      setInterimText(finalTranscriptRef.current + interim);
    };

    rec.onerror = (event: any) => {
      setAssistantState('idle');
      if (event.error === 'no-speech') {
        showTemporaryStatus("I didn't hear anything. Try again?", 3000);
      } else if (event.error === 'not-allowed') {
        setPermissionState('denied');
        setShowDeniedModal(true);
      } else {
        console.error('Speech recognition error:', event.error);
        showTemporaryStatus(`Error: ${event.error}`, 3000);
      }
    };

    rec.onend = () => {
      // Only process the FINAL transcript when user stops speaking
      const textToProcess = finalTranscriptRef.current.trim();
      if (textToProcess) {
        if (aiStatus.isResting) {
          handleProcessVoiceOffline(textToProcess);
        } else {
          handleProcessVoice(textToProcess);
        }
        finalTranscriptRef.current = '';
      } else {
        setAssistantState('idle');
      }
    };

    recognitionRef.current = rec;
    rec.start();
  };

  const handleProcessVoiceOffline = async (text: string) => {
    if (!userId) {
      setAssistantState('error');
      showTemporaryStatus("Sign in to use voice commands", 3000);
      return;
    }

    setAssistantState('processing');
    showTemporaryStatus('AI resting // Offline parser analyzing...', 10000);

    const lowercase = text.toLowerCase().trim();
    console.log('[Voice Fallback] Processing offline:', lowercase);

    try {
      const tasksRef = collection(db, `users/${userId}/tasks`);
      const snapshot = await getDocs(tasksRef);
      const allTasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as any[];

      // 1. "focus on <task name>" or "start <task name>"
      if (lowercase.startsWith('focus on ') || lowercase.startsWith('start ')) {
        const queryTerm = lowercase.replace('focus on ', '').replace('start ', '').trim();
        const found = allTasks.find(t => t.title.toLowerCase().includes(queryTerm) && t.status !== 'completed');

        if (found) {
          // Update found task to 'in_progress' and others to 'pending'
          const batchPromises = allTasks
            .filter(t => t.status === 'in_progress')
            .map(t => updateDoc(doc(db, `users/${userId}/tasks/${t.id}`), { status: 'pending' }));
          
          await Promise.all(batchPromises);
          await updateDoc(doc(db, `users/${userId}/tasks/${found.id}`), { status: 'in_progress' });

          onCommandResult({
            action: 'open_existing',
            existingTaskId: found.id,
            message: `Starting focus session on: "${found.title}"`
          });
          setAssistantState('success');
          showTemporaryStatus(`Focusing on "${found.title}"`, 3000);
          return;
        } else {
          setAssistantState('error');
          showTemporaryStatus(`No matching pending task found for "${queryTerm}"`, 3000);
          return;
        }
      }

      // 2. "complete <task name>" or "done <task name>"
      if (lowercase.startsWith('complete ') || lowercase.startsWith('done ')) {
        const queryTerm = lowercase.replace('complete ', '').replace('done ', '').trim();
        const found = allTasks.find(t => t.title.toLowerCase().includes(queryTerm) && t.status !== 'completed');

        if (found) {
          await updateDoc(doc(db, `users/${userId}/tasks/${found.id}`), {
            status: 'completed',
            completedAt: new Date().toISOString()
          });

          onCommandResult({
            action: 'complete_current',
            message: `Successfully completed: "${found.title}"`
          });
          setAssistantState('success');
          showTemporaryStatus(`Completed: "${found.title}"`, 3000);
          return;
        } else {
          setAssistantState('error');
          showTemporaryStatus(`No active task found matching "${queryTerm}"`, 3000);
          return;
        }
      }

      // 3. "skip <task name>" or "next"
      if (lowercase.startsWith('skip ') || lowercase === 'next') {
        if (lowercase === 'next') {
          // Find first active or pending task and skip it
          const found = allTasks.find(t => t.status === 'in_progress' || t.status === 'pending');
          if (found) {
            await updateDoc(doc(db, `users/${userId}/tasks/${found.id}`), {
              status: 'abandoned'
            });
            onCommandResult({
              action: 'get_next',
              message: `Skipped task: "${found.title}"`
            });
            setAssistantState('success');
            showTemporaryStatus(`Skipped: "${found.title}"`, 3000);
            return;
          } else {
            setAssistantState('error');
            showTemporaryStatus(`No active or pending tasks to skip`, 3000);
            return;
          }
        } else {
          const queryTerm = lowercase.replace('skip ', '').trim();
          const found = allTasks.find(t => t.title.toLowerCase().includes(queryTerm) && t.status !== 'completed');
          if (found) {
            await updateDoc(doc(db, `users/${userId}/tasks/${found.id}`), {
              status: 'abandoned'
            });
            onCommandResult({
              action: 'get_next',
              message: `Skipped task: "${found.title}"`
            });
            setAssistantState('success');
            showTemporaryStatus(`Skipped: "${found.title}"`, 3000);
            return;
          } else {
            setAssistantState('error');
            showTemporaryStatus(`No matching task found to skip`, 3000);
            return;
          }
        }
      }

      // 4. Default: Add task
      let title = text;
      // Clean prefix if present
      if (lowercase.startsWith('add task to ')) title = text.substring(12);
      else if (lowercase.startsWith('add task ')) title = text.substring(9);
      else if (lowercase.startsWith('add ')) title = text.substring(4);
      else if (lowercase.startsWith('create task to ')) title = text.substring(15);
      else if (lowercase.startsWith('create task ')) title = text.substring(12);
      else if (lowercase.startsWith('create ')) title = text.substring(7);
      else if (lowercase.startsWith('remind me to ')) title = text.substring(13);

      title = title.trim();
      // Capitalize first letter
      title = title.charAt(0).toUpperCase() + title.slice(1);

      const newTaskData = {
        title,
        description: 'Added via voice offline fallback mode',
        priority: 'medium',
        status: 'pending',
        estimatedMinutes: 30,
        actualMinutes: 0,
        createdAt: new Date().toISOString(),
        category: 'other',
        aiAnalyzed: false, // will trigger background enrichment
      };

      const docRef = await addDoc(collection(db, `users/${userId}/tasks`), newTaskData);

      onCommandResult({
        action: 'add_task',
        taskTitle: title,
        message: `Task "${title}" created successfully (Enriching in background)`
      });

      setAssistantState('success');
      showTemporaryStatus(`Task "${title}" added!`, 3000);

    } catch (err) {
      console.error('[Voice Fallback] Failed processing offline voice command:', err);
      setAssistantState('error');
      showTemporaryStatus("Offline parser encountered an error", 3000);
    }

    setTimeout(() => {
      setAssistantState('idle');
      setInterimText('');
    }, 2000);
  };

  const handleProcessVoice = async (text: string) => {
    if (!text.trim()) return;

    const normalizedText = text.toLowerCase().trim();

    if (pendingBlockedTask) {
      if (
        normalizedText.includes('add anyway') ||
        normalizedText.includes('force add') ||
        normalizedText.includes('create anyway') ||
        normalizedText.includes('yes') ||
        normalizedText.includes('do it') ||
        normalizedText.includes('add it anyway')
      ) {
        onCommandResult({
          action: 'add_task_forced',
          taskTitle: pendingBlockedTask.title,
          message: `Task "${pendingBlockedTask.title}" added anyway.`,
          blockedTask: pendingBlockedTask,
        });
        setPendingBlockedTask(null);
        setAssistantState('success');
        showTemporaryStatus(`Task added anyway!`, 3000);
        setTimeout(() => {
          setAssistantState('idle');
          setInterimText('');
        }, 2000);
        return;
      } else if (
        normalizedText.includes('open') ||
        normalizedText.includes('view') ||
        normalizedText.includes('show') ||
        normalizedText.includes('existing')
      ) {
        onCommandResult({
          action: 'open_existing',
          existingTaskId: pendingBlockedTask.existingTaskId,
          message: `Opening existing task.`,
        });
        setPendingBlockedTask(null);
        setAssistantState('success');
        showTemporaryStatus(`Opening existing task...`, 3000);
        setTimeout(() => {
          setAssistantState('idle');
          setInterimText('');
        }, 2000);
        return;
      }
    }

    setAssistantState('processing');
    showTemporaryStatus('Processing...', 10000);

    try {
      const res = await fetch('/api/voice-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, userId }),
      });

      if (!res.ok) throw new Error('Voice command parsing failed');
      const data = await res.json();

      // If blocked due to duplicate, save to client state
      if (data.action === 'add_task_blocked') {
        setPendingBlockedTask({
          title: data.taskTitle,
          existingTaskId: data.existingTaskId,
          ...data.blockedTask,
        });
        setAssistantState('error');
        showTemporaryStatus(data.message || `Similar task exists. Say 'Add anyway' or 'Open existing'.`, 8000);
        onCommandResult(data);
        return;
      }

      // Update status based on predicted action
      let actionMsg = 'Success!';
      if (data.action === 'add_task') {
        setAssistantState('executing');
        actionMsg = 'Adding task...';
        showTemporaryStatus(actionMsg, 10000);
      } else if (data.action === 'optimize') {
        setAssistantState('executing');
        actionMsg = 'Optimizing day...';
        showTemporaryStatus(actionMsg, 10000);
      } else if (data.action === 'get_next') {
        setAssistantState('executing');
        actionMsg = 'Getting next task...';
        showTemporaryStatus(actionMsg, 10000);
      } else if (data.action === 'complete_current') {
        setAssistantState('executing');
        actionMsg = 'Completing current task...';
        showTemporaryStatus(actionMsg, 10000);
      } else {
        actionMsg = data.message || "Command handled!";
      }

      // Mark voice tutorial as completed
      if (!hasUsedVoice) {
        setHasUsedVoice(true);
        localStorage.setItem('rise_has_used_voice', 'true');
        if (userId) {
          try {
            await setDoc(doc(db, 'users', userId), { hasUsedVoice: true }, { merge: true });
          } catch (err) {
            console.warn('Error updating voice usage to Firestore:', err);
          }
        }
      }

      // Trigger action in parent app
      onCommandResult(data);

      setAssistantState('success');
      showTemporaryStatus(data.message || 'Action executed successfully!', 3000);

      setTimeout(() => {
        setAssistantState('idle');
        setInterimText('');
      }, 2000);

    } catch (err) {
      console.error(err);
      setAssistantState('error');
      showTemporaryStatus("Sorry, I couldn't parse that command.", 3000);
      setTimeout(() => setAssistantState('idle'), 3000);
    }
  };

  const startHoldListening = async () => {
    if (assistantState === 'listening') return;
    if (permissionState === 'denied') {
      setShowDeniedModal(true);
      return;
    }
    const hasPermission = permissionState === 'granted' || (await requestMicPermission());
    if (hasPermission) {
      isHoldingRef.current = true;
      startVoiceRecognition();
    }
  };

  const stopHoldListening = () => {
    if (isHoldingRef.current) {
      isHoldingRef.current = false;
      justFinishedHoldingRef.current = true;
      setTimeout(() => {
        justFinishedHoldingRef.current = false;
      }, 200);

      if (recognitionRef.current && assistantState === 'listening') {
        recognitionRef.current.stop();
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle left click
    if (e.button !== 0) return;
    holdTimeoutRef.current = setTimeout(() => {
      startHoldListening();
    }, 300); // 300ms is standard for distinguishing click vs hold
  };

  const handleMouseUp = () => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    stopHoldListening();
  };

  const handleMouseLeave = () => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    stopHoldListening();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    holdTimeoutRef.current = setTimeout(() => {
      startHoldListening();
    }, 300);
  };

  const handleTouchEnd = () => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    stopHoldListening();
  };

  const handleVoiceButtonClick = async () => {
    if (justFinishedHoldingRef.current) {
      return;
    }

    if (assistantState === 'listening') {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setAssistantState('idle');
      return;
    }

    if (permissionState === 'denied') {
      setShowDeniedModal(true);
      return;
    }

    const hasPermission = permissionState === 'granted' || (await requestMicPermission());
    if (hasPermission) {
      startVoiceRecognition();
    }
  };

  // Determine styles depending on the current state
  const isListening = assistantState === 'listening';
  const isProcessing = assistantState === 'processing' || assistantState === 'executing';
  const isSuccess = assistantState === 'success';
  const isError = assistantState === 'error';
  const isDenied = permissionState === 'denied';

  let buttonBg = 'bg-accent-purple hover:bg-accent-purple/95';
  let buttonContent = <Mic className="w-6 h-6 text-white" />;

  if (isListening) {
    buttonBg = 'bg-accent-purple ring-4 ring-accent-purple/30';
    buttonContent = (
      <div className="relative flex items-center justify-center">
        <Mic className="w-6 h-6 text-white" />
        {/* Animated small sound indicator */}
        <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
        </span>
      </div>
    );
  } else if (isProcessing) {
    buttonBg = 'bg-accent-purple';
    buttonContent = <Loader2 className="w-6 h-6 text-white animate-spin" />;
  } else if (isSuccess) {
    buttonBg = 'bg-green-500';
    buttonContent = <CheckCircle className="w-6 h-6 text-white" />;
  } else if (isError) {
    buttonBg = 'bg-accent-red';
    buttonContent = <AlertCircle className="w-6 h-6 text-white" />;
  } else if (isDenied) {
    buttonBg = 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed opacity-70';
    buttonContent = <MicOff className="w-6 h-6 text-white/80" />;
  }

  const tooltipText = isDenied 
    ? 'Microphone access blocked. Click to learn more.' 
    : 'Tap or hold to speak (Ctrl+Shift+V)';
 
  return (
    <>
      {/* Floating Interactive Widget Container */}
      <div className="fixed z-40 right-4 bottom-20 md:right-6 md:bottom-6 flex flex-col items-end pointer-events-none">
        
        {/* 1. Interim Transcript or Floating Status Toast */}
        <AnimatePresence>
          {showStatus && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9 }}
              className="mb-3 mr-1 p-3 max-w-[280px] rounded-xl shadow-md-main bg-bg-card border border-border-main text-xs font-medium text-text-primary flex items-center gap-2 pointer-events-auto"
            >
              {isListening && <span className="w-2 h-2 rounded-full bg-accent-purple animate-pulse" />}
              {isProcessing && <Loader2 className="w-3.5 h-3.5 text-accent-purple animate-spin" />}
              {isSuccess && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
              {isError && <AlertCircle className="w-3.5 h-3.5 text-accent-red" />}
              <span className="leading-snug truncate">
                {isListening && interimText ? `"${interimText}"` : statusMessage}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
 
        {/* 2. First-time Tutorial Card */}
        <AnimatePresence>
          {showTutorial && !showStatus && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="mb-3 mr-1 p-4 max-w-[260px] rounded-2xl shadow-lg bg-accent-purple text-white relative pointer-events-auto border border-accent-purple/20"
            >
              <button 
                onClick={() => setShowTutorial(false)}
                className="absolute top-2 right-2 hover:text-white/80"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold font-sans">Voice Actions Enabled!</h4>
                  <p className="text-[11px] mt-1 text-white/90 leading-relaxed font-sans">
                    Try saying: <span className="font-semibold italic">"Add task to finish my report by tomorrow"</span> or <span className="font-semibold italic">"Optimize my day"</span>.
                  </p>
                </div>
              </div>
              <div className="absolute -bottom-1.5 right-6 w-3 h-3 bg-accent-purple rotate-45" />
            </motion.div>
          )}
        </AnimatePresence>
 
        {/* 3. Floating Interactive Button wrapper */}
        <div className="relative pointer-events-auto select-none">
          {/* Pulsing rings for LISTENING active status */}
          <AnimatePresence>
            {isListening && (
              <>
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0.6, scale: 1 }}
                    animate={{ opacity: 0, scale: 2.2 }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      delay: i * 0.6,
                      ease: "easeOut"
                    }}
                    className="absolute inset-0 rounded-full bg-accent-purple/35 pointer-events-none"
                  />
                ))}
              </>
            )}
          </AnimatePresence>
 
          {/* Core Button */}
          <button
            onClick={handleVoiceButtonClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-md-main transition-all duration-300 transform active:scale-95 cursor-pointer ${buttonBg}`}
            title={tooltipText}
          >
            {buttonContent}
          </button>
        </div>
      </div>

      {/* Permission Denied Custom Modal */}
      <AnimatePresence>
        {showDeniedModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-bg-card border border-border-main rounded-2xl max-w-sm w-full p-6 text-left shadow-lg relative"
            >
              <button
                onClick={() => setShowDeniedModal(false)}
                className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 mb-4 text-accent-red">
                <MicOff className="w-6 h-6" />
                <h3 className="text-md font-bold text-text-primary tracking-tight font-sans">Microphone access needed</h3>
              </div>

              <div className="text-xs text-text-secondary leading-relaxed font-sans space-y-3">
                <p>
                  Rise uses your voice to add tasks and run daily schedule optimization commands quickly. To enable voice access:
                </p>
                <ol className="list-decimal pl-5 space-y-1.5 font-medium">
                  <li>Click the <span className="font-bold">lock icon</span> (or connection settings) in your browser address bar.</li>
                  <li>Find the <span className="font-bold">"Microphone"</span> permission.</li>
                  <li>Change the selection to <span className="font-bold text-accent-purple">"Allow"</span>.</li>
                  <li>Refresh this page to apply changes.</li>
                </ol>
              </div>

              <button
                onClick={() => setShowDeniedModal(false)}
                className="mt-6 w-full py-2.5 px-4 rounded-xl bg-accent-purple text-white text-xs font-bold hover:bg-accent-purple/90 transition shadow-main cursor-pointer"
              >
                Got it, thanks
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
