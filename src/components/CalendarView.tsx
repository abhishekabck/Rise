import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  Loader2, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  AlertTriangle, 
  Inbox, 
  Sparkles, 
  CalendarDays, 
  CalendarRange, 
  CheckCircle2 
} from 'lucide-react';
import { Task } from '../types';

interface CalendarViewProps {
  googleAccessToken: string | null;
  onConnectGoogle: () => void;
  tasks: Task[];
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

type ViewMode = 'month' | 'week' | 'day';

export default function CalendarView({ googleAccessToken, onConnectGoogle, tasks }: CalendarViewProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [lastSyncedText, setLastSyncedText] = useState('Synced just now');
  const [lastSyncedTime, setLastSyncedTime] = useState<Date>(new Date());

  // Interactive views states
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date("2026-06-26T10:17:03-07:00")); // Lock to target base or today
  const [selectedDate, setSelectedDate] = useState(new Date("2026-06-26T10:17:03-07:00"));

  // Track current system time for the timeline red indicator line
  const [currentTime, setCurrentTime] = useState(new Date("2026-06-26T10:17:03-07:00"));

  useEffect(() => {
    // Keep currentTime updated, or static base for mock 2026 dates
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const fetchCalendarEvents = useCallback(async () => {
    const token = localStorage.getItem('rise_google_token') || googleAccessToken;
    if (!token) return;
    
    setLoading(true);
    setError(null);
    setTokenExpired(false);
    try {
      const timeMin = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toISOString();
      const timeMax = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 1).toISOString();
      
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=100`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
        }
      );

      if (res.status === 401) {
        setTokenExpired(true);
        setError('Your Google session expired. Please sign in again to sync calendar.');
        setEvents([]);
        return;
      }

      if (!res.ok) {
        setError('Unable to load Google Calendar. Please reconnect calendar access.');
        setEvents([]);
        return;
      }

      const data = await res.json();
      setEvents(data.items || []);
      setLastSyncedTime(new Date());
      setLastSyncedText('Synced just now');
    } catch (err: any) {
      console.error('Failed to connect to Google Calendar servers.', err);
      setError('Unable to load Google Calendar. Ensure permission is granted.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [googleAccessToken, currentDate]);

  useEffect(() => {
    const token = localStorage.getItem('rise_google_token') || googleAccessToken;
    if (token) {
      fetchCalendarEvents();
    }
  }, [googleAccessToken, fetchCalendarEvents]);

  // Update "Synced X min ago" text
  useEffect(() => {
    const interval = setInterval(() => {
      const diffMs = new Date().getTime() - lastSyncedTime.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins === 0) {
        setLastSyncedText('Synced just now');
      } else if (diffMins === 1) {
        setLastSyncedText('Synced 1 min ago');
      } else {
        setLastSyncedText(`Synced ${diffMins} mins ago`);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [lastSyncedTime]);

  const handlePrev = () => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    } else if (viewMode === 'week') {
      const prevWeek = new Date(currentDate);
      prevWeek.setDate(currentDate.getDate() - 7);
      setCurrentDate(prevWeek);
    } else {
      const prevDay = new Date(currentDate);
      prevDay.setDate(currentDate.getDate() - 1);
      setCurrentDate(prevDay);
      setSelectedDate(prevDay);
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    } else if (viewMode === 'week') {
      const nextWeek = new Date(currentDate);
      nextWeek.setDate(currentDate.getDate() + 7);
      setCurrentDate(nextWeek);
    } else {
      const nextDay = new Date(currentDate);
      nextDay.setDate(currentDate.getDate() + 1);
      setCurrentDate(nextDay);
      setSelectedDate(nextDay);
    }
  };

  const jumpToToday = () => {
    const today = new Date("2026-06-26T10:17:03-07:00");
    setCurrentDate(today);
    setSelectedDate(today);
  };

  // Helper date matching logic
  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getDate() === d2.getDate() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getFullYear() === d2.getFullYear();
  };

  const isToday = (d: Date) => {
    return isSameDay(d, new Date("2026-06-26T10:17:03-07:00"));
  };

  // Gather items for a date
  const getDayItems = (d: Date) => {
    const dayTasks = tasks.filter(t => {
      const tDate = t.scheduledAt || t.deadline || t.createdAt;
      if (!tDate) return false;
      return isSameDay(new Date(tDate), d);
    });

    const dayEvents = events.filter(e => {
      const startStr = e.start.dateTime || e.start.date;
      if (!startStr) return false;
      return isSameDay(new Date(startStr), d);
    });

    return { tasks: dayTasks, events: dayEvents };
  };

  // Generate 42 calendar grid days (including prev/next month buffer)
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay(); // Sunday is 0
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  const gridDays: Date[] = [];
  // Prev month trailing days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    gridDays.push(new Date(year, month - 1, prevMonthTotalDays - i));
  }
  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    gridDays.push(new Date(year, month, d));
  }
  // Next month leading days to complete grid (usually 42 elements for consistent 6 weeks grid)
  const remainingCells = 42 - gridDays.length;
  for (let d = 1; d <= remainingCells; d++) {
    gridDays.push(new Date(year, month + 1, d));
  }

  // Week view columns (7 days of selected/current week starting Sunday)
  const getWeekDays = (baseDate: Date) => {
    const currentDayOfWeek = baseDate.getDay();
    const sunday = new Date(baseDate);
    sunday.setDate(baseDate.getDate() - currentDayOfWeek);
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const nextDay = new Date(sunday);
      nextDay.setDate(sunday.getDate() + i);
      days.push(nextDay);
    }
    return days;
  };

  const weekDays = getWeekDays(currentDate);

  // Filter tasks & events for Selected Date (used in detailed Schedule Column)
  const { tasks: selectedTasks, events: selectedEvents } = getDayItems(selectedDate);

  // Time format
  const formatTime = (dateTimeStr?: string) => {
    if (!dateTimeStr) return 'All Day';
    const date = new Date(dateTimeStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Build Hourly Timeline Slots (8 AM to 8 PM)
  const hours = Array.from({ length: 13 }, (_, i) => i + 8); // 8 AM to 8 PM

  // Calculate stats for SELECTED date
  const selectedFocusMinutes = selectedTasks.reduce((acc, t) => acc + (t.estimatedMinutes || 0), 0);
  const tasksCount = selectedTasks.length;
  const meetingsCount = selectedEvents.length;

  const getAiInsight = () => {
    if (tasksCount === 0 && meetingsCount === 0) {
      return "An clear, unburdened day ahead. Take this opportunity to organize future sprints or recharge.";
    }
    if (selectedFocusMinutes > 180) {
      return `You have ${Math.round(selectedFocusMinutes / 60)} hours of deep work blocked. Perfect for tackling complex development and coding sprints.`;
    }
    if (meetingsCount > 3) {
      return "This is a meeting-heavy day. Rise suggests scheduling 10-minute micro-breaks after each sync to avoid focus decay.";
    }
    return "Balanced distribution of work and syncs today. Rise recommends tackling high-priority tasks between 9 AM and 11 AM.";
  };

  // Day timeline events filter for exact slots (simple slot assignment helper)
  const getItemsForHour = (date: Date, hour: number) => {
    const filteredTasks = tasks.filter(t => {
      const tDate = t.scheduledAt || t.deadline;
      if (!tDate) return false;
      const d = new Date(tDate);
      return isSameDay(d, date) && d.getHours() === hour;
    });

    const filteredEvents = events.filter(e => {
      const startStr = e.start.dateTime || e.start.date;
      if (!startStr) return false;
      const d = new Date(startStr);
      return isSameDay(d, date) && d.getHours() === hour;
    });

    return { hourTasks: filteredTasks, hourEvents: filteredEvents };
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div className="w-full max-w-[1200px] mx-auto px-2 sm:px-4 md:p-6 lg:px-8 lg:py-6 pb-28 text-left font-sans">
      
      {/* 1. Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-secondary">Schedule Orchestration</span>
          <h1 className="text-3xl md:text-[44px] font-extrabold text-text-primary tracking-tighter font-syne leading-none mt-1">Calendar</h1>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto font-mono">
          {/* View Toggle Pills */}
          <div className="bg-bg-card border-[1.5px] border-border-main p-0.5 sm:p-1 rounded flex items-center shadow-sm">
            {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2 py-1 sm:px-3.5 sm:py-1.5 rounded text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  viewMode === mode
                    ? 'bg-text-primary text-bg-primary font-extrabold border-[1.5px] border-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Today Button */}
          <button
            onClick={jumpToToday}
            className="px-3 py-1.5 sm:px-4 sm:py-2.5 bg-bg-card hover:bg-bg-subtle text-text-primary font-bold text-[10px] sm:text-xs rounded border-[1.5px] border-border-main shadow-sm transition cursor-pointer uppercase tracking-wider"
          >
            Today
          </button>
        </div>
      </div>

      {/* Sync status pill below header */}
      {googleAccessToken && (
        <div className="flex items-center gap-2 mb-6">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded border-[1.5px] border-border-main bg-bg-card text-[9px] font-bold text-text-primary font-mono uppercase tracking-wider">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent-green"></span>
            </span>
            <span>{lastSyncedText}</span>
          </div>
          <button
            onClick={fetchCalendarEvents}
            disabled={loading}
            className="p-1.5 bg-bg-card hover:bg-bg-subtle text-text-primary rounded border-[1.5px] border-border-main transition cursor-pointer"
            title="Refresh Sync"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {/* Reconnect Google session warning banner */}
      {tokenExpired && (
        <div className="mb-6 p-4 bg-accent-amber-light/20 border-[1.5px] border-border-main rounded flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-accent-amber-light text-accent-amber rounded border border-accent-amber/20">
              <AlertTriangle className="w-5 h-5 shrink-0" />
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary">Google session expired</p>
              <p className="text-xs text-text-secondary">Your Google session needs a refresh to sync new events and maintain perfect coordination.</p>
            </div>
          </div>
          <button
            onClick={onConnectGoogle}
            className="px-4 py-2 bg-text-primary text-bg-primary font-bold text-xs rounded uppercase tracking-wider border-[1.5px] border-border-main transition cursor-pointer font-mono"
          >
            Reconnect Calendar
          </button>
        </div>
      )}

      {/* Loader for API actions */}
      {loading && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-bg-card border-[1.5px] border-border-main rounded shadow-sm">
          <Loader2 className="w-5 h-5 text-accent-purple animate-spin" />
          <p className="text-xs text-text-secondary font-mono uppercase tracking-wider">Syncing calendars with Google servers...</p>
        </div>
      )}

      {/* Errors display */}
      {error && !tokenExpired && (
        <div className="mb-6 p-4 bg-accent-red-light/10 border-[1.5px] border-border-main rounded flex items-start gap-3 text-left">
          <AlertTriangle className="w-5 h-5 text-accent-red shrink-0" />
          <div>
            <p className="text-xs text-accent-red font-medium">{error}</p>
            <button
              onClick={onConnectGoogle}
              className="mt-2 text-xs font-bold text-accent-purple hover:underline cursor-pointer"
            >
              Reconnect Google Account
            </button>
          </div>
        </div>
      )}

      {/* No Authentication state fallback */}
      {!googleAccessToken ? (
        <div className="bg-bg-card border-[1.5px] border-border-main rounded p-8 text-center flex flex-col items-center justify-center min-h-[350px]">
          <CalendarIcon className="w-16 h-16 text-text-primary opacity-30 mb-4 stroke-[1.5]" />
          <h3 className="text-xl font-bold text-text-primary mb-2 font-syne">Coordinate with Google Calendar</h3>
          <p className="text-xs text-text-secondary max-w-sm mb-6 leading-relaxed">
            Connect your Google Calendar so Rise can automatically overlay tasks around your real-life meetings, classes, and appointments.
          </p>
          <button
            onClick={onConnectGoogle}
            className="px-6 py-3 bg-text-primary text-bg-primary font-extrabold text-xs uppercase tracking-wider rounded border-[1.5px] border-border-main transition cursor-pointer font-mono"
          >
            Enable Calendar Integration
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* ==================== VIEW MODES RENDERING ==================== */}
          {viewMode === 'month' && (
            <div className="bg-bg-card border-[1.5px] border-border-main rounded p-2 sm:p-6 overflow-hidden">
              {/* Month navigation controller */}
              <div className="flex justify-between items-center mb-4 sm:mb-6 px-1">
                <h2 className="text-lg sm:text-2xl font-bold text-text-primary tracking-tight font-syne">
                  {monthNames[month]} {year}
                </h2>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    onClick={handlePrev}
                    className="p-1.5 sm:p-2 text-text-secondary hover:text-text-primary hover:bg-bg-subtle rounded border-[1.5px] border-border-main transition cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                  <button
                    onClick={handleNext}
                    className="p-1.5 sm:p-2 text-text-secondary hover:text-text-primary hover:bg-bg-subtle rounded border-[1.5px] border-border-main transition cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                </div>
              </div>

              {/* Day of week labels */}
              <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center text-[8px] sm:text-[9px] font-extrabold uppercase tracking-[0.1em] sm:tracking-[0.15em] mb-2 sm:mb-3 text-text-secondary font-mono">
                <span className="text-text-muted opacity-60">Su</span>
                <span>Mo</span>
                <span>Tu</span>
                <span>We</span>
                <span>Th</span>
                <span>Fr</span>
                <span className="text-text-muted opacity-60">Sa</span>
              </div>

              {/* 42-day Grid Cells */}
              <div className="grid grid-cols-7 gap-1 sm:gap-2 md:gap-3 border-t-[1.5px] border-border-main pt-2 sm:pt-3">
                {gridDays.map((day, idx) => {
                  const isCurrentMonth = day.getMonth() === month;
                  const isSelected = isSameDay(day, selectedDate);
                  const activeToday = isToday(day);
                  const { tasks: dayTasks, events: dayEvents } = getDayItems(day);

                  return (
                    <button
                      key={`grid-day-${idx}`}
                      onClick={() => {
                        setSelectedDate(day);
                        setCurrentDate(day);
                      }}
                      className={`min-h-[42px] sm:min-h-[72px] md:min-h-[96px] aspect-square relative rounded p-1 sm:p-2 border border-border-main sm:border-[1.5px] text-left flex flex-col justify-between transition-all duration-150 hover:bg-bg-subtle group cursor-pointer ${
                        !isCurrentMonth ? 'opacity-35 bg-bg-subtle/30' : 'bg-bg-card'
                      } ${
                        isSelected ? 'ring-1 sm:ring-2 ring-text-primary border-transparent' : ''
                      }`}
                    >
                      {/* Date Indicator bubble */}
                      <div className="flex justify-between items-start w-full">
                        <span className={`w-4 h-4 sm:w-6 sm:h-6 rounded flex items-center justify-center text-[9px] sm:text-xs font-bold leading-none ${
                          activeToday 
                            ? 'bg-text-primary text-bg-primary shadow-sm' 
                            : isSelected 
                              ? 'text-text-primary border border-text-primary sm:border-[1.5px]' 
                              : 'text-text-primary'
                        }`}>
                          {day.getDate()}
                        </span>
                      </div>

                      {/* Stack of Colored event bars */}
                      <div className="space-y-0.5 sm:space-y-1 w-full mt-1 sm:mt-2">
                        {/* Rise Tasks bar indicator */}
                        {dayTasks.slice(0, 2).map((t, tid) => (
                          <div 
                            key={`task-bar-${t.id || tid}`} 
                            className="h-0.5 sm:h-1 bg-accent-purple rounded-full w-full opacity-80" 
                            title={`Task: ${t.title}`}
                          />
                        ))}
                        {/* Google Event bar indicator */}
                        {dayEvents.slice(0, 2).map((e, eid) => (
                          <div 
                            key={`event-bar-${e.id || eid}`} 
                            className="h-0.5 sm:h-1 bg-accent-blue rounded-full w-full opacity-80" 
                            title={`Event: ${e.summary}`}
                          />
                        ))}
                        
                        {/* N more badge */}
                        {(dayTasks.length + dayEvents.length) > 3 && (
                          <div className="text-[6px] sm:text-[8px] font-bold text-text-secondary leading-none text-right font-mono">
                            +{ (dayTasks.length + dayEvents.length) - 3 }
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === 'week' && (
            <div className="bg-bg-card border-[1.5px] border-border-main rounded p-5 overflow-x-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-text-primary tracking-tight font-syne">
                  Week of {weekDays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – {weekDays[6].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </h2>
                <div className="flex items-center gap-2">
                  <button onClick={handlePrev} className="p-1.5 border-[1.5px] border-border-main rounded hover:bg-bg-subtle"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={handleNext} className="p-1.5 border-[1.5px] border-border-main rounded hover:bg-bg-subtle"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>

              {/* 7 Columns Timeline */}
              <div className="grid grid-cols-7 gap-2 min-w-[700px] border-t-[1.5px] border-border-main pt-4">
                {weekDays.map((day, dIdx) => {
                  const isDayToday = isToday(day);
                  const isDaySelected = isSameDay(day, selectedDate);
                  const dayItems = getDayItems(day);

                  return (
                    <div 
                      key={`week-col-${dIdx}`} 
                      onClick={() => setSelectedDate(day)}
                      className={`p-2 rounded border-[1.5px] transition cursor-pointer ${
                        isDaySelected ? 'bg-bg-subtle border-text-primary' : 'border-transparent hover:bg-bg-subtle/50'
                      }`}
                    >
                      <div className="text-center mb-4">
                        <p className={`text-[9px] font-bold uppercase tracking-wider font-mono ${isDayToday ? 'text-accent-purple' : 'text-text-secondary'}`}>
                          {day.toLocaleDateString([], { weekday: 'short' })}
                        </p>
                        <p className={`text-base font-extrabold w-8 h-8 flex items-center justify-center mx-auto rounded mt-1 ${
                          isDayToday ? 'bg-text-primary text-bg-primary shadow-sm' : 'text-text-primary'
                        }`}>
                          {day.getDate()}
                        </p>
                      </div>

                      {/* Display Stack of Blocks */}
                      <div className="space-y-1.5 min-h-[150px]">
                        {dayItems.tasks.map((task) => (
                          <div 
                            key={`wk-t-${task.id}`} 
                            className="p-2 bg-accent-purple/5 border-l-2 border-l-accent-purple text-left rounded"
                          >
                            <p className="text-[10px] font-bold text-text-primary truncate">{task.title}</p>
                            <p className="text-[8px] text-accent-purple font-mono font-semibold">{task.estimatedMinutes}m</p>
                          </div>
                        ))}
                        {dayItems.events.map((event) => (
                          <div 
                            key={`wk-e-${event.id}`} 
                            className="p-2 bg-accent-blue/5 border-l-2 border-l-accent-blue text-left rounded"
                          >
                            <p className="text-[10px] font-bold text-text-primary truncate">{event.summary}</p>
                            <p className="text-[8px] text-accent-blue font-mono font-semibold">{formatTime(event.start.dateTime || event.start.date)}</p>
                          </div>
                        ))}
                        {dayItems.tasks.length === 0 && dayItems.events.length === 0 && (
                          <p className="text-[9px] text-text-muted italic text-center mt-8 font-mono uppercase tracking-wider">Available</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === 'day' && (
            <div className="bg-bg-card border-[1.5px] border-border-main rounded p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-text-primary font-syne">
                  {selectedDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </h2>
                <div className="flex items-center gap-2">
                  <button onClick={handlePrev} className="p-1.5 border-[1.5px] border-border-main rounded hover:bg-bg-subtle"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={handleNext} className="p-1.5 border-[1.5px] border-border-main rounded hover:bg-bg-subtle"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>

              {/* Detailed full day timeline columns */}
              <div className="space-y-3.5 border-t-[1.5px] border-border-main pt-6">
                {hours.map((hour) => {
                  const { hourTasks, hourEvents } = getItemsForHour(selectedDate, hour);
                  const isCurrentHour = isToday(selectedDate) && currentTime.getHours() === hour;

                  return (
                    <div key={`day-v-${hour}`} className={`flex gap-4 items-start relative ${isCurrentHour ? 'bg-bg-subtle p-2 rounded border-[1.5px] border-border-main' : ''}`}>
                      <div className="text-xs font-bold text-text-muted font-mono w-14 text-right pt-2">
                        {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                      </div>

                      <div className="flex-1 space-y-2">
                        {hourTasks.map((t) => (
                          <div key={t.id} className="p-4 bg-accent-purple/5 border-l-4 border-l-accent-purple border-t border-b border-r border-border-main rounded text-left shadow-sm">
                            <h4 className="text-xs font-bold text-text-primary leading-tight font-sans">{t.title}</h4>
                            <p className="text-[11px] text-text-secondary mt-1">{t.description || 'Focus Block scheduled by Rise.'}</p>
                            <span className="inline-block mt-2 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 bg-accent-purple text-white rounded font-mono">
                              Rise Task • {t.estimatedMinutes} mins
                            </span>
                          </div>
                        ))}

                        {hourEvents.map((e) => (
                          <div key={e.id} className="p-4 bg-accent-blue/5 border-l-4 border-l-accent-blue border-t border-b border-r border-border-main rounded text-left shadow-sm">
                            <h4 className="text-xs font-bold text-text-primary leading-tight font-sans">{e.summary}</h4>
                            <p className="text-[11px] text-text-secondary mt-1">{e.description || 'Google Calendar Event.'}</p>
                            <span className="inline-block mt-2 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 bg-accent-blue text-white rounded font-mono">
                              Google Event • {formatTime(e.start.dateTime)}
                            </span>
                          </div>
                        ))}

                        {hourTasks.length === 0 && hourEvents.length === 0 && (
                          <div className="py-3 border-b border-border-main/50 text-left text-xs text-text-secondary/70 italic flex items-center gap-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
                            <span className="font-mono uppercase tracking-wider text-[10px]">Available focus block</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}


          {/* ==================== TWO-COLUMN DETAILS SECTION BELOW MONTH ==================== */}
          {viewMode === 'month' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
              
              {/* Left Column (60% equivalent: lg:col-span-3) */}
              <div className="lg:col-span-3 space-y-4">
                <h3 className="text-xs font-extrabold text-text-secondary uppercase tracking-[1.5px] font-mono">
                  SCHEDULE FOR {selectedDate.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}
                </h3>

                {/* Vertical timeline details */}
                <div className="bg-bg-card border-[1.5px] border-border-main rounded p-5 relative space-y-4">
                  
                  {/* Current timeline indicator line if selected date is today */}
                  {isToday(selectedDate) && (
                    <div className="absolute left-[70px] right-5 border-t-2 border-text-primary border-dashed z-20 pointer-events-none opacity-60 flex items-center justify-between" style={{
                      top: `${Math.max(20, Math.min(95, ((currentTime.getHours() - 8) / 12) * 100))}%`
                    }}>
                      <span className="bg-text-primary text-bg-primary font-mono text-[8px] font-bold px-1 rounded transform -translate-y-1/2">
                        NOW
                      </span>
                    </div>
                  )}

                  {selectedTasks.length === 0 && selectedEvents.length === 0 ? (
                    <div className="text-center py-12 flex flex-col items-center justify-center">
                      <Inbox className="w-10 h-10 text-text-muted mb-3" />
                      <p className="text-sm font-bold text-text-primary uppercase tracking-wider font-mono">No Scheduled Sprints</p>
                      <p className="text-xs text-text-secondary max-w-xs leading-relaxed mt-1">
                        There are no tasks or synchronizations registered for this day. Double check other dates or schedule a new task.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {hours.map((hour) => {
                        const { hourTasks, hourEvents } = getItemsForHour(selectedDate, hour);

                        return (
                          <div key={`timeline-item-${hour}`} className="flex gap-4 items-start border-b border-border-main/40 pb-3 last:border-none">
                            {/* Hour identifier label */}
                            <div className="text-[11px] font-bold text-text-secondary font-mono w-14 text-right shrink-0 pt-1">
                              {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                            </div>

                            {/* Content blocks */}
                            <div className="flex-1 space-y-2">
                              {hourTasks.map((task) => (
                                <div 
                                  key={`timeline-task-${task.id}`}
                                  className="p-3 bg-bg-card border-[1.5px] border-border-main border-l-[4px] border-l-accent-purple rounded flex flex-col sm:flex-row justify-between sm:items-center gap-2 text-left hover:translate-x-1 transition-transform"
                                >
                                  <div>
                                    <h5 className="text-xs font-bold text-text-primary leading-tight font-sans">{task.title}</h5>
                                    {task.description && <p className="text-[10px] text-text-secondary leading-snug mt-0.5 line-clamp-1">{task.description}</p>}
                                  </div>
                                  <span className="text-[9px] font-bold text-accent-purple bg-accent-purple/5 border border-accent-purple/20 px-2 py-0.5 rounded font-mono shrink-0 self-start sm:self-auto uppercase tracking-wider">
                                    Rise Task • {task.estimatedMinutes}m
                                  </span>
                                </div>
                              ))}

                              {hourEvents.map((event) => (
                                <div 
                                  key={`timeline-event-${event.id}`}
                                  className="p-3 bg-bg-card border-[1.5px] border-border-main border-l-[4px] border-l-accent-blue rounded flex flex-col sm:flex-row justify-between sm:items-center gap-2 text-left hover:translate-x-1 transition-transform"
                                >
                                  <div>
                                    <h5 className="text-xs font-bold text-text-primary leading-tight font-sans">{event.summary}</h5>
                                    {event.description && <p className="text-[10px] text-text-secondary leading-snug mt-0.5 line-clamp-1">{event.description}</p>}
                                  </div>
                                  <span className="text-[9px] font-bold text-accent-blue bg-accent-blue/5 border border-accent-blue/20 px-2 py-0.5 rounded font-mono shrink-0 self-start sm:self-auto uppercase tracking-wider">
                                    Google Sync • {formatTime(event.start.dateTime)}
                                  </span>
                                </div>
                              ))}

                              {hourTasks.length === 0 && hourEvents.length === 0 && (
                                <div className="py-2 text-[10px] text-text-secondary/70 italic font-mono uppercase tracking-wider">
                                  Available for focus block
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              </div>

              {/* Right Column (40% equivalent: lg:col-span-2) */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="text-xs font-extrabold text-text-secondary uppercase tracking-[1.5px] font-mono">
                  AI SCHEDULING INSIGHTS
                </h3>

                {/* Insights Bento Card */}
                <div className="bg-bg-card border-[1.5px] border-border-main rounded p-5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <Sparkles className="w-16 h-16 text-text-primary" />
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-text-primary animate-pulse" />
                    <h4 className="text-xs font-extrabold text-text-primary uppercase tracking-widest font-mono">
                      Neural Schedule Assist
                    </h4>
                  </div>

                  {/* Summary Indicators Grid */}
                  <div className="grid grid-cols-2 gap-3 mb-5 text-left">
                    <div className="p-3 bg-bg-subtle rounded border-[1.5px] border-border-main">
                      <p className="text-[9px] font-bold text-text-secondary uppercase tracking-wider font-mono">Total Focus Blocks</p>
                      <p className="text-xl font-extrabold text-text-primary mt-1 font-mono">{selectedFocusMinutes} MIN</p>
                    </div>
                    <div className="p-3 bg-bg-subtle rounded border-[1.5px] border-border-main">
                      <p className="text-[9px] font-bold text-text-secondary uppercase tracking-wider font-mono">Queue Ratio</p>
                      <p className="text-xl font-extrabold text-text-primary mt-1 font-mono">{tasksCount}T / {meetingsCount}M</p>
                    </div>
                  </div>

                  {/* Suggested break times */}
                  <div className="space-y-2 mb-4 text-left">
                    <p className="text-[9px] font-bold text-text-secondary uppercase tracking-wider font-mono">Suggested Break intervals</p>
                    <div className="p-3 bg-bg-subtle border-[1.5px] border-border-main rounded flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-text-primary shrink-0" />
                      <p className="text-xs font-medium text-text-primary leading-relaxed">
                        Schedule a 15-minute recess around <span className="font-extrabold text-text-primary">11:30 AM</span> to sustain top focus speed.
                      </p>
                    </div>
                  </div>

                  {/* Neural Advice */}
                  <div className="space-y-1 mb-5 text-left">
                    <p className="text-[9px] font-bold text-text-secondary uppercase tracking-wider font-mono">Strategic Calibration</p>
                    <p className="text-xs text-text-secondary leading-relaxed italic mt-1 bg-bg-subtle/50 p-3 rounded border-[1.5px] border-border-main">
                      "{getAiInsight()}"
                    </p>
                  </div>

                  {/* Action optimize this day button */}
                  <button 
                    onClick={() => {
                      const audio = new Audio();
                      // Non-blocking interaction feedback instead of alert()
                      const btn = document.getElementById("optimize-day-btn");
                      if (btn) {
                        btn.innerText = "ALIGNMENT IN PROGRESS...";
                        setTimeout(() => {
                          btn.innerText = "SCHEDULE OPTIMIZED ✓";
                          setTimeout(() => {
                            btn.innerText = "OPTIMIZE THIS DAY";
                          }, 2000);
                        }, 1200);
                      }
                    }}
                    id="optimize-day-btn"
                    className="w-full py-2.5 bg-text-primary text-bg-primary font-bold text-xs uppercase tracking-wider rounded border-[1.5px] border-border-main transition cursor-pointer font-mono"
                  >
                    Optimize This Day
                  </button>
                </div>

              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
}
