import React, { useState } from 'react';
import { Trash2, Check, Play, AlertCircle, Calendar, Clock, Inbox, Tag, Plus, X, RotateCcw } from 'lucide-react';
import { doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Task } from '../types';
import TaskInput from './TaskInput';
import { motion, AnimatePresence } from 'motion/react';

interface TasksPageProps {
  userId: string;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  triggerAutonomousAgent: (actionDescription: string, type?: string, priority?: string) => void;
}

export default function TasksPage({
  userId,
  tasks,
  setTasks,
  triggerAutonomousAgent,
}: TasksPageProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'abandoned'>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Custom State Delete Confirmation Modal
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [deletingTaskTitle, setDeletingTaskTitle] = useState<string>('');

  const triggerDeleteConfirm = (taskId: string | undefined, taskTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!taskId) return;
    setDeletingTaskId(taskId);
    setDeletingTaskTitle(taskTitle);
  };

  const confirmDeleteTask = async () => {
    if (!deletingTaskId) return;
    const taskRef = doc(db, `users/${userId}/tasks`, deletingTaskId);
    try {
      await deleteDoc(taskRef);
      setTasks((prev) => prev.filter((t) => t.id !== deletingTaskId));
      triggerAutonomousAgent(`Deleted task "${deletingTaskTitle}" permanently.`, 'deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${userId}/tasks/${deletingTaskId}`);
    } finally {
      setDeletingTaskId(null);
      setDeletingTaskTitle('');
    }
  };

  const handleUpdateStatus = async (taskId: string | undefined, newStatus: Task['status'], taskTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!taskId) return;
    const taskRef = doc(db, `users/${userId}/tasks`, taskId);
    const updatedFields: Partial<Task> = { 
      status: newStatus,
      ...(newStatus === 'completed' ? { completedAt: new Date().toISOString() } : {})
    };

    try {
      await updateDoc(taskRef, updatedFields);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...updatedFields } : t))
      );
      triggerAutonomousAgent(`Updated status of "${taskTitle}" to ${newStatus}`, newStatus === 'completed' ? 'completed' : 'updated');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}/tasks/${taskId}`);
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'pending') return t.status === 'pending';
    return t.status === statusFilter;
  });

  const getHumanDeadline = (deadlineStr?: string) => {
    if (!deadlineStr) return null;
    const deadline = new Date(deadlineStr);
    const today = new Date();
    
    const dDate = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
    const tDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const diffTime = dDate.getTime() - tDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    if (diffDays > 1) return `Due in ${diffDays} days`;
    if (diffDays < 0) return `Overdue by ${Math.abs(diffDays)} days`;
    return null;
  };

  const getCategoryBadgeStyles = (cat: string) => {
    switch (cat) {
      case 'learning':
        return { label: 'Study', classes: 'bg-accent-purple/5 text-accent-purple border-accent-purple/20' };
      case 'coding':
      case 'writing':
      case 'admin':
      case 'meeting':
        return { label: 'Work', classes: 'bg-accent-blue/5 text-accent-blue border-accent-blue/20' };
      case 'personal':
        return { label: 'Personal', classes: 'bg-accent-green/5 text-accent-green border-accent-green/20' };
      default:
        return { label: 'Other', classes: 'bg-bg-subtle text-text-secondary border-border-main' };
    }
  };

  const priorityBadgeStyles = {
    high: 'text-accent-red bg-accent-red/5 border-accent-red/20',
    medium: 'text-accent-amber bg-accent-amber/5 border-accent-amber/20',
    low: 'text-accent-green bg-accent-green/5 border-accent-green/20',
  };

  const statusBadgeStyles = {
    pending: 'text-text-muted bg-bg-subtle border-border-main',
    in_progress: 'text-accent-purple bg-accent-purple/5 border-accent-purple/20 animate-pulse',
    completed: 'text-accent-green bg-accent-green/5 border-accent-green/20',
    abandoned: 'text-accent-red bg-accent-red/5 border-accent-red/20',
  };

  return (
    <div className="w-full max-w-[800px] mx-auto px-4 md:p-6 lg:px-8 lg:py-6 pb-28 text-left relative font-sans">
      
      {/* Header */}
      <div className="mb-6 pt-4">
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-secondary">Task Queue</span>
        <h1 className="text-4xl md:text-[44px] font-extrabold text-text-primary tracking-tighter font-syne leading-none mt-1">Tasks</h1>
        <p className="text-[11px] text-text-muted font-mono uppercase tracking-[1.5px] mt-1.5">
          QUEUE DIRECTORY & INTEGRATED FOCUS CONTROLS
        </p>
      </div>

      {/* Filter Tabs scrollable */}
      <div className="flex gap-1 overflow-x-auto bg-bg-card p-1 border-[1.5px] border-border-main rounded mb-6 scrollbar-none shadow-sm font-mono">
        {([
          { id: 'all', label: 'All' },
          { id: 'pending', label: 'Pending' },
          { id: 'in_progress', label: 'Focusing' },
          { id: 'completed', label: 'Completed' },
          { id: 'abandoned', label: 'Abandoned' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3.5 py-2.5 text-xs font-bold uppercase tracking-wider rounded transition-all duration-150 flex-1 text-center whitespace-nowrap cursor-pointer ${
              statusFilter === tab.id
                ? 'bg-text-primary text-bg-primary font-extrabold border-[1.5px] border-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-subtle'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Task List */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-20 bg-bg-card border-[1.5px] border-border-main rounded flex flex-col items-center justify-center font-mono">
          <Inbox className="w-12 h-12 text-text-muted mb-3" />
          <p className="text-xs text-text-secondary uppercase tracking-wider">No tasks match this filter. Add or activate more.</p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredTasks.map((task) => {
            const humanDeadline = getHumanDeadline(task.deadline);
            const isCompleted = task.status === 'completed';
            const isAbandoned = task.status === 'abandoned';
            
            // Set 4px left border according to priority (or grey if completed)
            let borderLeftClass = 'border-l-[4px] border-l-border-main';
            if (isCompleted) {
              borderLeftClass = 'border-l-[4px] border-l-text-muted/40';
            } else if (task.priority === 'high') {
              borderLeftClass = 'border-l-[4px] border-l-accent-red';
            } else if (task.priority === 'medium') {
              borderLeftClass = 'border-l-[4px] border-l-accent-amber';
            } else if (task.priority === 'low') {
              borderLeftClass = 'border-l-[4px] border-l-accent-green';
            }

            const catInfo = getCategoryBadgeStyles(task.category);

            return (
              <div
                key={task.id}
                className={`bg-bg-card border-[1.5px] border-border-main rounded p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center hover:translate-x-1 hover:border-text-secondary transition-all duration-200 gap-4 ${borderLeftClass}`}
              >
                <div className="text-left space-y-2 flex-1 w-full min-w-0">
                  {/* Category, Priority, and Status Badges */}
                  <div className="flex items-center gap-1.5 flex-wrap font-mono">
                    {task.aiAnalyzed === false ? (
                      <span 
                        title="AI insights will be added when available"
                        className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border-[1.5px] border-border-main text-text-muted bg-bg-subtle flex items-center gap-1"
                      >
                        <Clock className="w-2.5 h-2.5 text-text-muted animate-spin" />
                        AI pending
                      </span>
                    ) : (
                      <>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border-[1.5px] ${catInfo.classes}`}>
                          {catInfo.label}
                        </span>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border-[1.5px] ${priorityBadgeStyles[task.priority]}`}>
                          {task.priority}
                        </span>
                      </>
                    )}
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border-[1.5px] ${statusBadgeStyles[task.status]}`}>
                      {task.status === 'in_progress' ? 'Focusing' : task.status}
                    </span>
                  </div>

                  {/* Task title bold (with strikethrough if completed) */}
                  <h3 className={`text-base font-bold text-text-primary leading-tight font-sans truncate ${isCompleted ? 'line-through text-text-muted font-medium' : ''}`}>
                    {task.title}
                  </h3>

                  {task.description && (
                    <p className={`text-xs text-text-secondary leading-relaxed line-clamp-2 ${isCompleted ? 'text-text-muted/60' : ''}`}>
                      {task.description}
                    </p>
                  )}

                  {/* Bottom Row metadata */}
                  <div className="flex flex-wrap items-center gap-3 text-text-muted text-[11px] pt-1 font-mono uppercase tracking-wider">
                    <div className="flex items-center gap-1 shrink-0">
                      <Clock className="w-3.5 h-3.5 opacity-70" />
                      <span>{task.estimatedMinutes}m estimate</span>
                    </div>

                    {humanDeadline && (
                      <div className={`flex items-center gap-1 shrink-0 ${isCompleted ? 'text-text-muted/50' : 'text-accent-amber font-semibold'}`}>
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{humanDeadline}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Task Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0 self-end sm:self-center font-mono">
                  {!isCompleted && !isAbandoned && (
                    <>
                      {task.status !== 'in_progress' ? (
                        <button
                          onClick={(e) => handleUpdateStatus(task.id, 'in_progress', task.title, e)}
                          title="Start focusing"
                          className="p-2 bg-bg-card hover:bg-bg-subtle text-text-primary rounded border-[1.5px] border-border-main transition cursor-pointer"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      ) : null}
                      <button
                        onClick={(e) => handleUpdateStatus(task.id, 'completed', task.title, e)}
                        title="Mark complete"
                        className="p-2 bg-bg-card hover:bg-bg-subtle text-text-primary rounded border-[1.5px] border-border-main transition cursor-pointer"
                      >
                        <Check className="w-4 h-4 stroke-[2.5]" />
                      </button>
                      <button
                        onClick={(e) => handleUpdateStatus(task.id, 'abandoned', task.title, e)}
                        title="Skip task"
                        className="p-2 bg-bg-card hover:bg-bg-subtle text-text-primary rounded border-[1.5px] border-border-main transition cursor-pointer"
                      >
                        <AlertCircle className="w-4 h-4" />
                      </button>
                    </>
                  )}

                  {/* Restore button for abandoned tasks */}
                  {isAbandoned && (
                    <button
                      onClick={(e) => handleUpdateStatus(task.id, 'pending', task.title, e)}
                      title="Restore task to pending queue"
                      className="px-2.5 py-1.5 bg-bg-card hover:bg-bg-subtle text-text-primary rounded border-[1.5px] border-border-main transition cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Restore</span>
                    </button>
                  )}

                  <button
                    onClick={(e) => triggerDeleteConfirm(task.id, task.title, e)}
                    title="Delete permanently"
                    className="p-2 bg-bg-card hover:bg-bg-subtle text-text-primary border-[1.5px] border-border-main rounded transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating brutalist "+" button with sharp corner box */}
      <button
        onClick={() => setIsCreateModalOpen(true)}
        className="fixed bottom-20 right-6 lg:bottom-10 lg:right-10 w-12 h-12 rounded bg-text-primary text-bg-primary shadow-sm flex items-center justify-center hover:translate-x-[-2px] hover:translate-y-[-2px] transition duration-200 border-[1.5px] border-text-primary active:translate-x-0 active:translate-y-0 z-40 cursor-pointer"
        title="Create New Task"
      >
        <Plus className="w-6 h-6 stroke-[2.5]" />
      </button>

      {/* Create Task Modal Dialog */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <>
            {/* Dark blur backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCreateModalOpen(false)}
              className="fixed inset-0 bg-black z-50 cursor-pointer"
            />
            
            {/* Modal Body */}
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="fixed inset-x-4 bottom-20 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 max-w-lg w-full bg-bg-card border-[1.5px] border-border-main rounded p-6 shadow-sm z-50 text-left"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider font-mono">New Productivity Task</h3>
                <button
                  onClick={() => setIsCreateModalOpen(false)}
                  className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-bg-subtle transition cursor-pointer border-[1.5px] border-transparent"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <TaskInput 
                userId={userId}
                behaviorProfile={null}
                onTaskAdded={(newTask) => {
                  setTasks(prev => [newTask, ...prev]);
                  setIsCreateModalOpen(false);
                }}
                triggerAutonomousAgent={triggerAutonomousAgent}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Professional State-Driven Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingTaskId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingTaskId(null)}
              className="fixed inset-0 bg-black z-50 cursor-pointer"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="fixed inset-x-4 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-sm w-full bg-bg-card border-[1.5px] border-border-main rounded p-5 shadow-sm z-50 text-left font-sans"
            >
              <h3 className="text-sm font-extrabold text-text-primary uppercase tracking-wider mb-2 font-mono">Delete Task</h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-5">
                Are you sure you want to permanently delete <strong className="text-text-primary">"{deletingTaskTitle}"</strong>? This action cannot be reversed.
              </p>
              <div className="flex items-center justify-end gap-2 font-mono">
                <button
                  onClick={() => setDeletingTaskId(null)}
                  className="px-4 py-2 bg-bg-card hover:bg-bg-subtle text-text-secondary text-xs font-bold rounded border-[1.5px] border-border-main transition cursor-pointer uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteTask}
                  className="px-4 py-2 bg-text-primary text-bg-primary text-xs font-bold rounded border-[1.5px] border-border-main transition cursor-pointer uppercase tracking-wider"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
