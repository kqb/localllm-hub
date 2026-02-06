import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({ activeTab: 'dashboard', sidebarOpen: true });
  });

  it('initializes with dashboard tab active', () => {
    const { activeTab } = useUIStore.getState();
    expect(activeTab).toBe('dashboard');
  });

  it('initializes with sidebar open', () => {
    const { sidebarOpen } = useUIStore.getState();
    expect(sidebarOpen).toBe(true);
  });

  it('sets active tab', () => {
    useUIStore.getState().setActiveTab('models');
    expect(useUIStore.getState().activeTab).toBe('models');

    useUIStore.getState().setActiveTab('config');
    expect(useUIStore.getState().activeTab).toBe('config');
  });

  it('toggles sidebar', () => {
    expect(useUIStore.getState().sidebarOpen).toBe(true);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });
});
