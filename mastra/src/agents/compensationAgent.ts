import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

export const compensationAgent = new Agent({
  id: 'compensation-agent',
  name: 'Compensation Agent',
  instructions: `You are a Compensation AI Assistant for an HR consulting firm.
You help users understand pay equity, benchmarking, and compensation analysis.
Answer questions clearly and concisely.
Respond in plain text only, no markdown formatting.`,
  model: openai('gpt-4o-mini'),
});