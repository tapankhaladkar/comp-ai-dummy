import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const pillTool = createTool({
  id: 'pill-tool',
  description: 'Returns pill selection options to the UI',
  inputSchema: z.object({
    step: z.enum(['step1', 'step2']),
  }),
  outputSchema: z.object({
    type: z.literal('pill-type'),
    message: z.string(),
    options: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    if (context.step === 'step1') {
      return {
        type: 'pill-type' as const,
        message: 'What are we doing today?',
        options: ['marketpricing', 'benchmarking'],
      };
    }

    return {
      type: 'pill-type' as const,
      message: 'What are we pricing today?',
      options: ['family', 'sub-family', 'spec', 'job'],
    };
  },
});