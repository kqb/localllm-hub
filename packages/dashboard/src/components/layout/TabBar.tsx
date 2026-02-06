import * as Tabs from '@radix-ui/react-tabs';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';

const tabs = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'models', label: 'Models' },
  { value: 'config', label: 'Config' },
  { value: 'development', label: 'Development' },
  { value: 'logs', label: 'Logs' },
] as const;

export function TabBar() {
  const { activeTab, setActiveTab } = useUIStore();

  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as typeof activeTab)}
    >
      <Tabs.List className="flex gap-1 px-6 border-b border-border bg-bg-2">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              'px-4 py-3 text-sm font-medium transition-colors relative',
              'hover:text-text',
              'data-[state=active]:text-accent',
              'data-[state=inactive]:text-text-2'
            )}
          >
            {tab.label}
            <span
              className={cn(
                'absolute bottom-0 left-0 right-0 h-0.5 transition-colors',
                'data-[state=active]:bg-accent',
                activeTab === tab.value ? 'bg-accent' : 'bg-transparent'
              )}
            />
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
