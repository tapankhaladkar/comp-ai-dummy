import { Mastra } from '@mastra/core';
import { compensationAgent } from '../agents/compensationAgent';
import { supervisorAgent } from '../agents/supervisorAgent';
import { z } from 'zod';

export const mastra = new Mastra({
  agents: { compensationAgent, supervisorAgent },
  server: {
    cors: {
      origin: ['http://localhost:4200'],
      allowHeaders: ['Content-Type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      credentials: false,
    },
    apiRoutes: [
      // Init endpoint — fires on page load, returns Step 1 pills
      {
        path: '/custom/init',
        method: 'GET',
        createHandler: async () => {
          return async (c: any) => {
            try {
              const sessionId = `sess-${Date.now()}`;
              return c.json({
                type: 'pill-type',
                session_id: sessionId,
                message: 'What are we doing today?',
                options: ['marketpricing', 'benchmarking']
              });
            } catch (error) {
              console.error('Init error:', error);
              return c.json({
                type: 'error',
                session_id: null,
                payload: { message: 'Failed to initialize' }
              }, 500);
            }
          };
        }
      },

      // Action endpoint — handles all scenario routing
      {
        path: '/custom/action',
        method: 'POST',
        createHandler: async ({ mastra }) => {
          return async (c: any) => {
            try {
              const body = await c.req.json();
              const { message, selection, session_id, step, type, selectedIndustries, jobSelection, citySelection, selectedMin, selectedMax } = body;
              const sessionId = session_id || `sess-${Date.now()}`;

              // Step 1 pill → return Step 2 pills
              if (selection && step === 'step1') {
                return c.json({
                  type: 'pill-type',
                  session_id: sessionId,
                  message: 'What are we pricing today?',
                  options: ['family', 'sub-family', 'spec', 'job']
                });
              }

              // Step 2 pill → return job search
              if (selection && step === 'step2') {
                return c.json({
                  type: 'search',
                  session_id: sessionId,
                  message: 'Select a job specialization',
                  options: {
                    datasource: 'mongodb:survey-metadata-jobarchitecture',
                    filters: ['spec_title']
                  }
                });
              }

              // Search selection — job → city search
              if (type === 'search-selection' && step === 'job') {
                return c.json({
                  type: 'search',
                  session_id: sessionId,
                  message: 'Select a city',
                  options: {
                    datasource: 'mongodb:survey-metadata-location',
                    filters: ['city']
                  }
                });
              }

              // Search selection — city → industry checkbox
              if (type === 'search-selection' && step === 'city') {
                const agent = mastra.getAgent('compensationAgent');
                const result = await agent.generate([
                  {
                    role: 'user',
                    content: `The user is doing a compensation analysis for 
                    a ${body.jobSelection} role in ${selection}.
                    Return ONLY this exact format: "Select industry : [SectorType]"
                    where [SectorType] is a single broad sector label relevant to their job.
                    Examples: "Select industry : Super Sector", "Select industry : Tech Sector"
                    Return the message string only. No explanation. No punctuation after it.`
                  }
                ]);
                return c.json({
                  type: 'checkbox',
                  session_id: sessionId,
                  message: result.text.trim(),
                  options: {
                    datasource: 'mongodb:survey-metadata-supersector',
                    filters: ['industry']
                  }
                });
              }

              // Checkbox selection → range selector using AI structured output
              // Checkbox selection → range selector using AI JSON response
if (type === 'checkbox-selection') {
  if (!selectedIndustries || selectedIndustries.length === 0) {
    return c.json({
      type: 'error',
      session_id: sessionId,
      payload: { message: 'Please select at least one industry.' }
    }, 400);
  }

  const agent = mastra.getAgent('compensationAgent');
  const result = await agent.generate([
    {
      role: 'user',
      content: `You are a compensation data expert.
      The user is analyzing compensation for:
      - Job title: ${jobSelection}
      - City: ${citySelection}
      - Industries: ${selectedIndustries.join(', ')}
      
      Determine a realistic position class range for this profile.
      Position classes are numeric grades (typically 1-100).
      
      Respond with ONLY a raw JSON object, no markdown, no backticks, no explanation:
      {"message":"...","min":0,"max":0,"defaultMin":0,"defaultMax":0}
      
      Where:
      - message: short context-aware label e.g. "Select Position Class Range for Software Engineer"
      - min: minimum position class for this profile
      - max: maximum position class for this profile
      - defaultMin: P25 of the range
      - defaultMax: P75 of the range`
    }
  ]);

  let rangeData;
  try {
    const cleaned = result.text.replace(/```json|```/g, '').trim();
    rangeData = JSON.parse(cleaned);
  } catch (e) {
    // Fallback if parsing fails
    rangeData = {
      message: `Select Position Class Range for ${jobSelection}`,
      min: 50,
      max: 100,
      defaultMin: 62,
      defaultMax: 87
    };
  }

  return c.json({
    type: 'range-selector',
    session_id: sessionId,
    message: rangeData.message,
    options: {
      min: rangeData.min,
      max: rangeData.max,
      defaultMin: rangeData.defaultMin,
      defaultMax: rangeData.defaultMax
    }
  });
}

              // Range selection → AI greeting → free text
              if (type === 'range-selection') {
                const agent = mastra.getAgent('compensationAgent');
                const result = await agent.generate([
                  {
                    role: 'user',
                    content: `The user has completed all parameter selection:
                    - Job title: ${jobSelection}
                    - City: ${citySelection}
                    - Industries: ${selectedIndustries || 'Not specified'}
                    - Position class range: ${selectedMin} to ${selectedMax}
                    
                    Greet them warmly, confirm all their selections briefly in one sentence,
                    and ask what they would like to know about compensation analysis.`
                  }
                ]);

                return c.json({
                  type: 'text',
                  session_id: sessionId,
                  payload: { text: result.text }
                });
              }

              // Free text message → compensation agent
              if (message) {
                const agent = mastra.getAgent('compensationAgent');
                const result = await agent.generate([
                  { role: 'user', content: message }
                ]);
                return c.json({
                  type: 'text',
                  session_id: sessionId,
                  payload: { text: result.text }
                });
              }

              return c.json({
                type: 'error',
                session_id: sessionId,
                payload: { message: 'No message or selection provided' }
              }, 400);

            } catch (error) {
              console.error('Action error:', error);
              return c.json({
                type: 'error',
                session_id: null,
                payload: { message: error instanceof Error ? error.message : 'Internal server error' }
              }, 500);
            }
          };
        }
      },

      // SSE streaming endpoint — Scenario D free text
      {
        path: '/custom/chat',
        method: 'POST',
        createHandler: async ({ mastra }) => {
          return async (c: any) => {
            try {
              const body = await c.req.json();
              const { message, session_id } = body;

              if (!message) {
                return c.json({
                  type: 'error',
                  session_id: session_id || null,
                  payload: { message: 'No message provided' }
                }, 400);
              }

              const agent = mastra.getAgent('compensationAgent');
              const sessionId = session_id || `sess-${Date.now()}`;

              const stream = new ReadableStream({
                async start(controller) {
                  const encoder = new TextEncoder();
                  try {
                    const result = await agent.stream([
                      { role: 'user', content: message }
                    ]);

                    for await (const chunk of result.textStream) {
                      const data = JSON.stringify({
                        type: 'text-delta',
                        session_id: sessionId,
                        payload: { textDelta: chunk }
                      });
                      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    }

                    const finish = JSON.stringify({
                      type: 'finish',
                      session_id: sessionId
                    });
                    controller.enqueue(encoder.encode(`data: ${finish}\n\n`));

                  } catch (error) {
                    console.error('Stream error:', error);
                    const errData = JSON.stringify({
                      type: 'error',
                      session_id: sessionId,
                      payload: { message: 'Stream failed' }
                    });
                    controller.enqueue(encoder.encode(`data: ${errData}\n\n`));
                  } finally {
                    controller.close();
                  }
                }
              });

              return new Response(stream, {
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive',
                }
              });

            } catch (error) {
              console.error('Chat error:', error);
              return c.json({
                type: 'error',
                session_id: null,
                payload: { message: 'Internal server error' }
              }, 500);
            }
          };
        }
      }
    ]
  }
});