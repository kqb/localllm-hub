import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';
import type { AgentState } from '@/types';

describe('agentStore', () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: new Map() });
  });

  it('initializes with empty agents map', () => {
    const { agents } = useAgentStore.getState();
    expect(agents.size).toBe(0);
  });

  it('sets a new agent', () => {
    const mockAgent: AgentState = {
      session: 'test-session',
      state: 'IDLE',
      progress: 0,
      last_activity: Date.now(),
      last_output: '',
    };

    useAgentStore.getState().setAgent('test-session', mockAgent);

    const { agents } = useAgentStore.getState();
    expect(agents.size).toBe(1);
    expect(agents.get('test-session')).toEqual(mockAgent);
  });

  it('updates an existing agent', () => {
    const mockAgent: AgentState = {
      session: 'test-session',
      state: 'IDLE',
      progress: 0,
      last_activity: Date.now(),
      last_output: '',
    };

    useAgentStore.getState().setAgent('test-session', mockAgent);
    useAgentStore.getState().updateAgent('test-session', {
      state: 'WORKING',
      progress: 50
    });

    const { agents } = useAgentStore.getState();
    const agent = agents.get('test-session');
    expect(agent?.state).toBe('WORKING');
    expect(agent?.progress).toBe(50);
  });

  it('removes an agent', () => {
    const mockAgent: AgentState = {
      session: 'test-session',
      state: 'IDLE',
      progress: 0,
      last_activity: Date.now(),
      last_output: '',
    };

    useAgentStore.getState().setAgent('test-session', mockAgent);
    expect(useAgentStore.getState().agents.size).toBe(1);

    useAgentStore.getState().removeAgent('test-session');
    expect(useAgentStore.getState().agents.size).toBe(0);
  });

  it('clears all agents', () => {
    const mockAgent1: AgentState = {
      session: 'session-1',
      state: 'IDLE',
      progress: 0,
      last_activity: Date.now(),
      last_output: '',
    };

    const mockAgent2: AgentState = {
      session: 'session-2',
      state: 'WORKING',
      progress: 50,
      last_activity: Date.now(),
      last_output: 'output',
    };

    useAgentStore.getState().setAgent('session-1', mockAgent1);
    useAgentStore.getState().setAgent('session-2', mockAgent2);
    expect(useAgentStore.getState().agents.size).toBe(2);

    useAgentStore.getState().clearAgents();
    expect(useAgentStore.getState().agents.size).toBe(0);
  });
});
