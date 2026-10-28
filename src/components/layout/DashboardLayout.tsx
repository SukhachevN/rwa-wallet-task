import React, { Component, useState, ErrorInfo, ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

class DashboardErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || 'Something went wrong' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8">
          <h1 className="text-xl font-semibold text-gray-900">Dashboard failed to load</h1>
          <p className="mt-2 text-gray-600">{this.state.message}</p>
          <button
            type="button"
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export const DashboardLayout = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <div className="flex h-screen bg-neutral-50">
      <Sidebar isCollapsed={isSidebarCollapsed} toggleSidebar={toggleSidebar} />
      <main
        className={`flex-1 overflow-y-auto transition-all duration-300 ${
          isSidebarCollapsed ? 'ml-4' : 'ml-0'
        }`}
      >
        <DashboardErrorBoundary>
          <Outlet />
        </DashboardErrorBoundary>
      </main>
    </div>
  );
};