import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const pricingPillTool = createTool({
  id: 'pricing-pills',
  description: 'Returns pill options for the market pricing workflow. Call this when the user has selected "marketpricing" in step 1.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    type: z.literal('pill-type'),
    message: z.string(),
    options: z.array(z.string())
  }),
  execute: async () => ({
    type: 'pill-type' as const,
    message: 'What are we pricing today?',
    options: ['family', 'sub-family', 'spec', 'job']
  })
});

export const benchmarkPillTool = createTool({
  id: 'benchmark-pills',
  description: 'Returns pill options for the benchmarking workflow. Call this when the user has selected "benchmarking" in step 1.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    type: z.literal('pill-type'),
    message: z.string(),
    options: z.array(z.string())
  }),
  execute: async () => ({
    type: 'pill-type' as const,
    message: 'What level of benchmarking?',
    options: ['broad', 'targeted', 'custom']
  })
});