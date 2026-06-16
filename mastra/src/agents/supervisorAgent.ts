import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { pricingPillTool, benchmarkPillTool } from '../tools/pillTools';

export const supervisorAgent = new Agent({
  id: 'supervisor-agent',
  name: 'Supervisor Agent',
  instructions: `You are the orchestration agent for a Compensation AI Assistant.

Your ONLY job is to select the right pill tool based on what the user selected.

RULES:
- If the user selected "marketpricing" → call the pricing-pills tool
- If the user selected "benchmarking" → call the benchmark-pills tool
- ALWAYS call a tool. NEVER respond with text.
- NEVER make up pill options. Only return what the tool gives you.
- Do NOT add any commentary or explanation. Just call the tool.`,
  model: openai('gpt-4o-mini'),
  tools: { pricingPillTool, benchmarkPillTool },
});