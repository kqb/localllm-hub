import { useState } from 'react';
import { Card, CardHeader, CardContent, LoadingText, Badge } from '@/components/ui';
import { useSkills, useSkillDetail } from '@/hooks/useSkills';

export function SkillsCard() {
  const { data: skills, isLoading, error } = useSkills();
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const { data: skillDetail } = useSkillDetail(expandedSkill, !!expandedSkill);

  if (isLoading) return <Card><CardHeader>🧩 Skills Manager</CardHeader><CardContent><LoadingText /></CardContent></Card>;
  if (error) return <Card><CardHeader>🧩 Skills Manager</CardHeader><CardContent><div className="text-red text-sm">Failed to load skills</div></CardContent></Card>;
  if (!skills || skills.length === 0) {
    return (
      <Card>
        <CardHeader>🧩 Skills Manager</CardHeader>
        <CardContent><div className="text-text-2 text-sm">No skills found</div></CardContent>
      </Card>
    );
  }

  const customCount = skills.filter(s => s.type === 'custom').length;
  const builtinCount = skills.filter(s => s.type === 'built-in').length;

  const toggleSkill = (name: string) => {
    setExpandedSkill(expandedSkill === name ? null : name);
  };

  return (
    <Card>
      <CardHeader>🧩 Skills Manager</CardHeader>
      <CardContent>
        <div className="mb-3 text-sm text-text-2">
          {skills.length} skills ({customCount} custom, {builtinCount} built-in)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {skills.map((skill) => (
            <div
              key={skill.name}
              className="bg-bg-3 border border-border rounded p-3 cursor-pointer hover:border-accent transition-colors"
              onClick={() => skill.hasSkillMd && toggleSkill(skill.name)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">{skill.name}</span>
                <Badge variant={skill.type === 'custom' ? 'purple' : 'blue'}>
                  {skill.type}
                </Badge>
              </div>
              <div className="text-xs text-text-2">
                {skill.description || <em className="text-text-2">No description</em>}
              </div>
              {skill.hasSkillMd && expandedSkill === skill.name && (
                <div className="mt-3 pt-3 border-t border-border">
                  <pre className="text-xs whitespace-pre-wrap font-mono text-text-2 max-h-64 overflow-y-auto">
                    {skillDetail?.content || 'Loading...'}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
