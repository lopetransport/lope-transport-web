import { z } from 'npm:zod@3.25.76';

const contact = {
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  consent: z.literal('on'),
  website: z.string().max(0).optional(),
  submissionId: z.string().uuid(),
};
export const quoteSchema = z.object({
  ...contact,
  pickup: z.string().trim().min(2).max(160),
  delivery: z.string().trim().min(2).max(160),
  capacity: z.enum(['1—4', '5—12', '14—28', '34']),
  cargo: z.string().trim().min(2).max(3000),
  date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  })]).optional(),
  company: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(7).max(30),
});
export const dispatchSchema = z.object({
  ...contact,
  message: z.string().trim().min(2).max(2500),
});
export function validateEnquiry(kind: 'quote' | 'dispatch', value: unknown) {
  return kind === 'quote' ? quoteSchema.safeParse(value) : dispatchSchema.safeParse(value);
}

