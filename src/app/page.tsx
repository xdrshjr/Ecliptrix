'use client';

import React from 'react';
import Header from '@/components/Header';
import Taskbar from '@/components/Taskbar';
import Container from '@/components/Container';
import Footer from '@/components/Footer';
import { useTasks } from '@/hooks/useTasks';

export default function HomePage() {
  const {
    tabs,
    activeTabId,
    activeTask,
    createTask,
    selectTab,
    closeTab,
    updateTask,
  } = useTasks();

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <Taskbar
        tabs={tabs}
        activeTabId={activeTabId}
        onCreateTask={createTask}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
      />
      <Container activeTask={activeTask} onUpdateTask={updateTask} />
      <Footer />
    </div>
  );
} 