import { create } from 'zustand';
import type { AgentState } from '@/types';

interface AgentStore {
  agents: Map<string, AgentState>;
  setAgent: (session: string, state: AgentState) => void;
  updateAgent: (session: string, updates: Partial<AgentState>) => void;
  removeAgent: (session: string) => void;
  clearAgents: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: new Map(),

  setAgent: (session, state) =>
    set((store) => {
      const agents = new Map(store.agents);
      agents.set(session, state);
      return { agents };
    }),

  updateAgent: (session, updates) =>
    set((store) => {
      const agents = new Map(store.agents);
      const current = agents.get(session);
      if (current) {
        agents.set(session, { ...current, ...updates });
      }
      return { agents };
    }),

  removeAgent: (session) =>
    set((store) => {
      const agents = new Map(store.agents);
      agents.delete(session);
      return { agents };
    }),

  clearAgents: () => set({ agents: new Map() }),
}));
