import { z } from 'zod'

export const urlJobSchema = z.object({
  input_method: z.literal('url'),
  job_url: z
    .string()
    .min(1, 'URL is required')
    .max(2048, 'URL must not exceed 2048 characters')
    .refine((v) => v.startsWith('https://'), 'URL must start with https://'),
})

export const textJobSchema = z.object({
  input_method: z.literal('text'),
  company_name: z
    .string()
    .min(1, 'Company name is required')
    .max(200, 'Company name must not exceed 200 characters'),
  role: z
    .string()
    .min(1, 'Role is required')
    .max(200, 'Role must not exceed 200 characters'),
  job_text: z
    .string()
    .min(100, 'Job description must be at least 100 characters')
    .max(50000, 'Job description must not exceed 50,000 characters'),
})

export type UrlJobFormValues = z.infer<typeof urlJobSchema>
export type TextJobFormValues = z.infer<typeof textJobSchema>
