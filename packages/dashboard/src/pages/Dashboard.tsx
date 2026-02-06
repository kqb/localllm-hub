import { ServiceCard, ModelCard } from '@/components/services';

export function Dashboard() {
  return (
    <div className="max-w-[1400px] mx-auto p-6 flex flex-col gap-6">
      {/* Status Row */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ServiceCard />
        <ModelCard />
      </section>

      {/* TODO: Add more sections */}
      {/* - MLX Models */}
      {/* - Context Monitor */}
      {/* - System Health Grid */}
      {/* - Agent Monitor */}
    </div>
  );
}
