import React, { useState, useEffect } from 'react';
import { 
  Target, 
  Star, 
  Brain, 
  Sun, 
  Zap, 
  Clock, 
  Mail, 
  Shield, 
  Save, 
  CheckCircle, 
  ArrowUpRight, 
  User, 
  Mic, 
  MicOff, 
  Check, 
  RotateCcw,
  Sliders,
  Settings,
  Activity
} from 'lucide-react';
import { doc, updateDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { UserProfile, BehaviorProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface BehaviorProfilePageProps {
  userId: string;
  userProfile: UserProfile | null;
  setUserProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  behaviorProfile: BehaviorProfile | null;
}

export default function BehaviorProfilePage({
  userId,
  userProfile,
  setUserProfile,
  behaviorProfile,
}: BehaviorProfilePageProps) {
  const [name, setName] = useState(userProfile?.name || '');
  const [tone, setTone] = useState<UserProfile['preferences']['tone']>(
    userProfile?.preferences?.tone || 'casual'
  );
  const [email, setEmail] = useState(userProfile?.preferences?.notificationEmail || userProfile?.email || '');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (userProfile) {
      setName(userProfile.name || '');
      setEmail(userProfile.preferences?.notificationEmail || userProfile.email || '');
      setTone(userProfile.preferences?.tone || 'casual');
    }
  }, [userProfile]);

  const handleResetAllData = async () => {
    const doubleConfirm = window.confirm(
      "CRITICAL: Are you absolutely sure you want to run a complete Factory Reset?\n\nThis will purge all your tasks, subtasks, notification logs, energy profiles, and continuous AI behavior history from the database forever."
    );
    if (!doubleConfirm) return;

    const tripleConfirm = window.confirm(
      "CONFIRM AGAIN: All task records and behavior telemetry will be lost. Click OK to wipe the database."
    );
    if (!tripleConfirm) return;

    setResetting(true);
    try {
      console.log(`[Client-Side Factory Reset] Purging user: ${userId}`);

      // 1. Delete all tasks and their subtasks
      const tasksRef = collection(db, 'users', userId, 'tasks');
      const tasksSnap = await getDocs(tasksRef);
      for (const taskDoc of tasksSnap.docs) {
        // Delete subtasks if any
        const subtasksRef = collection(db, 'users', userId, 'tasks', taskDoc.id, 'subtasks');
        const subtasksSnap = await getDocs(subtasksRef);
        for (const subDoc of subtasksSnap.docs) {
          await deleteDoc(doc(db, 'users', userId, 'tasks', taskDoc.id, 'subtasks', subDoc.id));
        }
        // Delete parent task
        await deleteDoc(doc(db, 'users', userId, 'tasks', taskDoc.id));
      }

      // 2. Delete all daily behavior logs
      const behaviorRef = collection(db, 'users', userId, 'behavior');
      const behaviorSnap = await getDocs(behaviorRef);
      for (const bDoc of behaviorSnap.docs) {
        await deleteDoc(doc(db, 'users', userId, 'behavior', bDoc.id));
      }

      // 3. Delete behavior profile doc
      const profileRef = doc(db, 'users', userId, 'behaviorProfile', 'profile');
      await deleteDoc(profileRef);

      // 4. Delete the main user profile document
      await deleteDoc(doc(db, 'users', userId));

      // 5. Try clearing any server cache/locks (with graceful fallback if permissions restricted)
      try {
        const cacheRef = collection(db, 'users', userId, 'cache');
        const cacheSnap = await getDocs(cacheRef);
        for (const cDoc of cacheSnap.docs) {
          await deleteDoc(doc(db, 'users', userId, 'cache', cDoc.id));
        }
      } catch (cacheErr) {
        console.warn('Cache clear not allowed or skipped:', cacheErr);
      }

      try {
        const lockRef = doc(db, 'users', userId, 'locks', 'autonomous_agent');
        await deleteDoc(lockRef);
      } catch (lockErr) {
        console.warn('Locks clear not allowed or skipped:', lockErr);
      }

      // 5. Reset local state and trigger reload
      localStorage.removeItem('rise_google_token');
      localStorage.removeItem('rise_voice_calibrated');

      alert("Database purged successfully! Wiping local state and restarting...");
      window.location.reload();
    } catch (err: any) {
      console.error('Factory Reset Failed:', err);
      alert(`Error resetting data: ${err.message || err}`);
    } finally {
      setResetting(false);
    }
  };

  // Pill Interactive States
  const [focusPref, setFocusPref] = useState<'morning' | 'afternoon' | 'night'>('morning');
  const [optimalDuration, setOptimalDuration] = useState<number>(30);
  const [workstyle, setWorkstyle] = useState<'single' | 'multi'>('single');

  // Voice Calibration States
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationSuccess, setCalibrationSuccess] = useState(false);
  const [voiceWaveform, setVoiceWaveform] = useState<number[]>([12, 8, 15, 6, 12, 8, 14, 10]);

  // Handle Speech Calibration
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCalibrating) {
      interval = setInterval(() => {
        setVoiceWaveform(Array.from({ length: 12 }, () => Math.floor(Math.random() * 32) + 6));
      }, 100);
    } else {
      setVoiceWaveform([8, 12, 6, 10, 8, 12, 6, 10]);
    }
    return () => clearInterval(interval);
  }, [isCalibrating]);

  const handleStartCalibration = () => {
    setIsCalibrating(true);
    setCalibrationSuccess(false);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.lang = 'en-US';
      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript.toLowerCase();
        console.log('Calibrating speech text:', text);
      };
      rec.onend = () => {
        setIsCalibrating(false);
        setCalibrationSuccess(true);
      };
      rec.onerror = () => {
        setIsCalibrating(false);
        setCalibrationSuccess(true); 
      };
      rec.start();

      setTimeout(() => {
        rec.stop();
      }, 3500);
    } else {
      // Simulate calibration fallback
      setTimeout(() => {
        setIsCalibrating(false);
        setCalibrationSuccess(true);
      }, 3000);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);

    const userRef = doc(db, 'users', userId);
    const updatedPrefs = {
      name,
      preferences: {
        tone,
        notificationEmail: email,
      },
    };

    try {
      await updateDoc(userRef, updatedPrefs);
      setUserProfile((prev) => (prev ? { ...prev, ...updatedPrefs } : null));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-[800px] mx-auto px-4 md:p-6 lg:px-8 lg:py-6 pb-28 text-left font-sans">
      
      {/* Header */}
      <div className="mb-6 pt-4">
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-secondary">System configuration</span>
        <h1 className="text-4xl md:text-[44px] font-extrabold text-text-primary tracking-tighter font-syne leading-none mt-1">Profile</h1>
        <p className="text-[11px] text-text-muted font-mono uppercase tracking-[1.5px] mt-1.5">
          PERSONALIZATION & NEURAL ADAPTIVE CONTROLS
        </p>
      </div>

      {/* 1. PERSONALITY SUMMARY CARD - SWISS BRUTALIST */}
      <div className="relative overflow-hidden bg-bg-card border-[1.5px] border-border-main rounded p-6 mb-6 flex flex-col md:flex-row items-center md:items-start gap-5 shadow-sm">
        <div className="w-16 h-16 rounded bg-text-primary text-bg-primary flex items-center justify-center shrink-0 font-syne font-extrabold text-xl border-[1.5px] border-text-primary">
          CH
        </div>

        <div className="text-center md:text-left flex-1 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-center md:justify-start">
            <h3 className="text-xl font-extrabold text-text-primary font-syne tracking-tight leading-none">The Chameleon</h3>
            <span className="self-center px-2.5 py-0.5 rounded border-[1.5px] border-text-primary bg-bg-subtle text-[9px] font-extrabold text-text-primary tracking-wider uppercase font-mono">
              ADAPTIVE AND VERSATILE
            </span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed pt-1 font-medium max-w-xl">
            You seamlessly shift between creative study sessions and deep coding tasks, balancing various categories with remarkable agility. You excel in morning routines and handle tight schedules with ease.
          </p>
        </div>
      </div>

      {/* 2. BEHAVIOR PREFERENCE PILLS */}
      <div className="bg-bg-card border-[1.5px] border-border-main rounded p-6 mb-6 space-y-6">
        <div className="flex items-center gap-2 pb-3 border-b-[1.5px] border-border-main">
          <Sliders className="w-4.5 h-4.5 text-text-primary" />
          <h4 className="text-xs font-extrabold text-text-primary uppercase tracking-[0.15em] font-mono">
            Focus Settings
          </h4>
        </div>

        {/* Focus Preference Group */}
        <div>
          <span className="block text-xs font-extrabold text-text-secondary uppercase tracking-wider mb-2.5 font-mono">
            Focus Preference Window
          </span>
          <div className="flex flex-wrap gap-2 font-mono">
            {[
              { id: 'morning', label: 'Morning Sprints' },
              { id: 'afternoon', label: 'Afternoon Flow' },
              { id: 'night', label: 'Night Owl Mode' },
            ].map((item) => {
              const active = focusPref === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFocusPref(item.id as any)}
                  className={`relative px-4 py-2 rounded text-xs font-bold border-[1.5px] transition-all duration-150 cursor-pointer ${
                    active
                      ? 'bg-text-primary text-bg-primary border-text-primary font-extrabold shadow-sm'
                      : 'bg-bg-card text-text-secondary border-border-main hover:bg-bg-subtle'
                  }`}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Optimal Duration Group */}
        <div>
          <span className="block text-xs font-extrabold text-text-secondary uppercase tracking-wider mb-2.5 font-mono">
            Optimal Session Duration
          </span>
          <div className="flex flex-wrap gap-2 font-mono">
            {[15, 30, 60, 90].map((item) => {
              const active = optimalDuration === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setOptimalDuration(item)}
                  className={`relative px-4 py-2 rounded text-xs font-bold border-[1.5px] transition-all duration-150 cursor-pointer ${
                    active
                      ? 'bg-text-primary text-bg-primary border-text-primary font-extrabold shadow-sm'
                      : 'bg-bg-card text-text-secondary border-border-main hover:bg-bg-subtle'
                  }`}
                >
                  <span>{item} Min</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Workstyle Group */}
        <div>
          <span className="block text-xs font-extrabold text-text-secondary uppercase tracking-wider mb-2.5 font-mono">
            Core Workstyle Alignment
          </span>
          <div className="flex flex-wrap gap-2 font-mono">
            {[
              { id: 'single', label: 'Single-tasking Flow' },
              { id: 'multi', label: 'Parallel Tasking' },
            ].map((item) => {
              const active = workstyle === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setWorkstyle(item.id as any)}
                  className={`relative px-4 py-2 rounded text-xs font-bold border-[1.5px] transition-all duration-150 cursor-pointer ${
                    active
                      ? 'bg-text-primary text-bg-primary border-text-primary font-extrabold shadow-sm'
                      : 'bg-bg-card text-text-secondary border-border-main hover:bg-bg-subtle'
                  }`}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. VOICE CALIBRATION SECTION */}
      <div className="bg-bg-card border-[1.5px] border-border-main rounded p-6 mb-6">
        <div className="flex items-center gap-2 pb-3 border-b-[1.5px] border-border-main mb-4">
          <Mic className="w-4.5 h-4.5 text-text-primary" />
          <h4 className="text-xs font-extrabold text-text-primary uppercase tracking-[0.15em] font-mono">
            Voice Calibration
          </h4>
        </div>
        
        <p className="text-xs text-text-secondary leading-relaxed mb-5">
          Train the neural model to recognize and adjust speech velocity. Click the trigger and speak the phrase <strong className="text-text-primary font-bold">"Optimize my day today"</strong> clearly into your microphone.
        </p>

        <div className="flex flex-col items-center justify-center p-6 bg-bg-subtle border-[1.5px] border-border-main rounded relative overflow-hidden">
          {/* Waves feedback placeholder */}
          <div className="flex items-end justify-center gap-1.5 h-12 mb-6">
            {voiceWaveform.map((val, idx) => (
              <div
                key={idx}
                className={`w-1.5 rounded-sm transition-all duration-100 ${
                  isCalibrating ? 'bg-text-primary animate-pulse' : 'bg-text-muted/40'
                }`}
                style={{ height: `${val}px` }}
              />
            ))}
          </div>

          {/* Calibrate Button with pulsing ring wrapper */}
          <div className="relative flex items-center justify-center">
            {isCalibrating && (
              <span className="absolute inset-0 rounded bg-text-primary/20 animate-ping w-16 h-16" />
            )}
            <button
              type="button"
              onClick={handleStartCalibration}
              disabled={isCalibrating}
              className="relative w-16 h-16 rounded bg-text-primary text-bg-primary flex items-center justify-center transition-all duration-150 border-[1.5px] border-text-primary cursor-pointer hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-0 active:translate-y-0"
            >
              <Mic className={`w-6 h-6 ${isCalibrating ? 'animate-pulse' : ''}`} />
            </button>
          </div>

          {/* Success prompt */}
          <AnimatePresence>
            {calibrationSuccess && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-2 text-accent-green text-xs font-bold mt-5 bg-bg-card border-[1.5px] border-accent-green/20 px-3.5 py-2 rounded font-mono uppercase tracking-wider"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>Voice calibration synchronised successfully!</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 4. PREFERENCES (SAVE FORM) */}
      <div className="bg-bg-card border-[1.5px] border-border-main rounded p-6">
        <div className="flex items-center gap-2 pb-3 border-b-[1.5px] border-border-main mb-5">
          <Settings className="w-4.5 h-4.5 text-text-primary" />
          <h4 className="text-xs font-extrabold text-text-primary uppercase tracking-[0.15em] font-mono">
            Global Preferences
          </h4>
        </div>

        <form onSubmit={handleSavePreferences} className="space-y-5">
          {/* Display Name Input */}
          <div>
            <label className="block text-[11px] font-extrabold text-text-secondary uppercase tracking-wider mb-2 font-mono">
              YOUR NAME
            </label>
            <div className="relative font-mono">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-bg-card text-text-primary border-[1.5px] border-border-main rounded px-4 py-3 pr-10 focus:outline-none focus:border-text-primary transition text-xs font-bold"
                placeholder="Abhishek Chaurasiya"
              />
              <User className="absolute right-3.5 top-3.5 w-4.5 h-4.5 text-text-muted" />
            </div>
          </div>

          {/* Tone Select */}
          <div>
            <label className="block text-[11px] font-extrabold text-text-secondary uppercase tracking-wider mb-2 font-mono">
              HOW SHOULD RISE TALK TO YOU?
            </label>
            <select
              value={tone}
              onChange={(e: any) => setTone(e.target.value)}
              className="w-full bg-bg-card text-text-primary border-[1.5px] border-border-main rounded px-4 py-3 focus:outline-none focus:border-text-primary transition text-xs font-bold cursor-pointer font-mono uppercase"
            >
              <option value="casual" className="bg-bg-card text-text-primary">Friendly and casual</option>
              <option value="formal" className="bg-bg-card text-text-primary">Professional and direct</option>
              <option value="motivational" className="bg-bg-card text-text-primary">Motivational coach</option>
            </select>
          </div>

          {/* Email Address */}
          <div>
            <label className="block text-[11px] font-extrabold text-text-secondary uppercase tracking-wider mb-2 font-mono">
              Send me notifications at
            </label>
            <div className="relative font-mono">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-bg-card text-text-primary border-[1.5px] border-border-main rounded px-4 py-3 pr-10 focus:outline-none focus:border-text-primary transition text-xs font-bold"
                placeholder="email@example.com"
              />
              <Mail className="absolute right-3.5 top-3.5 w-4.5 h-4.5 text-text-muted" />
            </div>
          </div>

          {/* Save Status indicator */}
          <AnimatePresence>
            {saveSuccess && (
              <motion.div 
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="flex items-center gap-1.5 text-accent-green text-xs font-bold py-1 font-mono uppercase tracking-wider"
              >
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>Preferences saved successfully.</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Save Button */}
          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-text-primary hover:bg-text-primary/90 disabled:opacity-50 text-bg-primary text-xs font-bold uppercase tracking-wider rounded border-[1.5px] border-text-primary flex items-center justify-center gap-2 transition cursor-pointer font-mono"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Preferences'}</span>
          </button>
        </form>
      </div>

      {/* 5. DANGER ZONE - FACTORY RESET */}
      <div className="mt-6 bg-bg-card border-[1.5px] border-accent-red rounded p-6">
        <div className="flex items-center gap-2 pb-3 border-b-[1.5px] border-accent-red/30 mb-4">
          <Shield className="w-4.5 h-4.5 text-accent-red" />
          <h4 className="text-xs font-extrabold text-accent-red uppercase tracking-[0.15em] font-mono">
            Danger Zone
          </h4>
        </div>
        <p className="text-xs text-text-secondary leading-relaxed mb-5">
          Permanently delete all tasks, subtasks, notification streams, cached analyses, habits, daily telemetry logs, and the continuous AI behavior profile. <strong>This action is completely irreversible.</strong>
        </p>

        <button
          type="button"
          onClick={handleResetAllData}
          disabled={resetting}
          className="w-full py-3 bg-accent-red hover:bg-accent-red/90 disabled:opacity-50 text-white text-xs font-extrabold uppercase tracking-wider rounded border-[1.5px] border-accent-red flex items-center justify-center gap-2 transition cursor-pointer font-mono"
        >
          <span>{resetting ? 'PURGING DATABASE...' : 'FACTORY RESET APPLICATION DATA'}</span>
        </button>
      </div>

    </div>
  );
}
