import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/api/client';

export interface Skill {
  name: string;
  type: 'custom' | 'built-in';
  description?: string;
  hasSkillMd: boolean;
}

export interface SkillDetail {
  content: string;
}

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => fetchApi<Skill[]>('/skills'),
  });
}

export function useSkillDetail(name: string | null, enabled = false) {
  return useQuery({
    queryKey: ['skills', name],
    queryFn: () => fetchApi<SkillDetail>(`/skills/${encodeURIComponent(name!)}`),
    enabled: enabled && name !== null,
  });
}
