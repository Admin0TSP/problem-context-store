'use client';

import { useTransition, useState } from 'react';
import { attachEventToProblem } from '@/app/actions/ingest';
import { Select } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';

export function AttachToProblemForm({
  eventId,
  candidateProblems,
}: {
  eventId: string;
  candidateProblems: Array<{ id: string; title: string; client: { name: string } }>;
}) {
  const [pending, startTransition] = useTransition();
  const [problemId, setProblemId] = useState('');

  return (
    <form
      action={(formData: FormData) => {
        startTransition(() => attachEventToProblem(formData));
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <Select
        name="problemId"
        value={problemId}
        onChange={(e) => setProblemId(e.target.value)}
        required
      >
        <option value="" disabled>
          {candidateProblems.length === 0 ? 'No matching problems' : 'Attach to…'}
        </option>
        {candidateProblems.map((p) => (
          <option key={p.id} value={p.id}>
            [{p.client.name}] {p.title}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending || !problemId}>
        {pending ? 'Attaching…' : 'Attach'}
      </Button>
    </form>
  );
}
