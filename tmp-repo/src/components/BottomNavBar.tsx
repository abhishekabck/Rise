import React from 'react';
import { Home, List, Calendar, TrendingUp, User } from 'lucide-react';
import { TabType } from '../types';

interface BottomNavBarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export default function BottomNavBar({ activeTab, setActiveTab }: BottomNavBarProps) {
  const navItems = [
    { id: 'home' as TabType, label: 'Home', icon: Home },
    { id: 'tasks' as TabType, label: 'Tasks', icon: List },
    { id: 'calendar' as TabType, label: 'Calendar', icon: Calendar },
    { id: 'progress' as TabType, label: 'Progress', icon: TrendingUp },
    { id: 'profile' as TabType, label: 'Profile', icon: User },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card border-t-[1.5px] border-border-main px-4 py-2 pb-safe lg:hidden shadow-sm">
      <div className="max-w-md mx-auto flex justify-between items-center h-14 font-mono">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex-1 flex flex-col items-center justify-center py-1.5 transition-all duration-150 cursor-pointer min-h-[48px] ${
                isActive ? 'text-accent-purple font-bold' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : 'stroke-[1.75px]'}`} />
              <span className="text-[9px] uppercase tracking-wider mt-1">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

