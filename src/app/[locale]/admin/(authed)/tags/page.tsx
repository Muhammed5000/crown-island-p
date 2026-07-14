import { setRequestLocale } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { isLocale } from '@/i18n/config';
import { requireAdmin } from '@/server/auth/guards';
import { adminListTags } from '@/server/services/admin-tags';
import { TagForm } from './TagForm';
import { TagDeleteButton } from './TagDeleteButton';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function TagsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  await requireAdmin();

  const tags = await adminListTags();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Customer tags</h1>
        <p className="text-sm text-muted-foreground">
          A shared label library. Assign tags on a customer&apos;s profile, then filter the customer list by a tag to view that segment.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-foreground">New tag</h2>
        </CardHeader>
        <CardBody>
          <TagForm />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-foreground">All tags</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">Tag</th>
                  <th className="px-4 py-3 text-start">Customers</th>
                  <th className="px-4 py-3 text-end">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {tags.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                      No tags yet. Create one above.
                    </td>
                  </tr>
                ) : (
                  tags.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Badge tone={t.color as BadgeTone}>{t.name}</Badge>
                      </td>
                      <td className="px-4 py-3 text-foreground">{t._count.assignments}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <TagDeleteButton tagId={t.id} assignmentCount={t._count.assignments} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
