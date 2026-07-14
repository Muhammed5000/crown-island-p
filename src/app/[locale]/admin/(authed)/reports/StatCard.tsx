import { Card, CardBody } from '@/components/ui/Card';

/**
 * KPI stat tile — the dashboard's inline metric block extracted as a component
 * (label treatment + gold tabular value) since the Reports page renders many.
 */
export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
        <p className="mt-2 font-display text-3xl font-semibold text-gold-700 tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardBody>
    </Card>
  );
}
