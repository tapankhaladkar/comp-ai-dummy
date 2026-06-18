import { Mastra } from '@mastra/core';
import { compensationAgent } from '../agents/compensationAgent';
import { supervisorAgent } from '../agents/supervisorAgent';
import { buildError} from '../utils/errors';

export const mastra = new Mastra({
  agents: { compensationAgent, supervisorAgent },
  server: {
    cors: {
      origin: ['http://localhost:4200'],
      allowHeaders: ['Content-Type', 'Authorization', 'x-conversation-id'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      credentials: false,
    },
    middleware: [
      {
        path: '*',
        handler: async (c: any, next: any) => {
          try {
            await next();
          } catch (error: any) {
            console.error('Global error caught:', error);
            const conversationId = c.get('conversationId') || null;
            const err = buildError('INTERNAL_ERROR', conversationId, error?.message);
            return c.json(err, 500);
          }
        }
      },
      {
        path: '*',
        handler: async (c: any, next: any) => {
          const existingId = c.req.header('x-conversation-id');
          c.set('conversationId', existingId || `sess-${Date.now()}`);
          await next();
        }
      }
    ],
    apiRoutes: [

      // ─── INIT — page load, returns step1 chips ───────────────────────
      {
        path: '/custom/init',
        method: 'GET',
        createHandler: async () => {
          return async (c: any) => {
            const conversationId = c.get('conversationId') || `sess-${Date.now()}`;
            const stream = new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                // metadata event
                controller.enqueue(encoder.encode(
                  `event: metadata\ndata: ${JSON.stringify({ conversationId, threadId: null })}\n\n`
                ));
                // chips component
                controller.enqueue(encoder.encode(
                  `event: component\ndata: ${JSON.stringify({
                    componentType: 'chips',
                    data: {
                      message: 'What are we doing today?',
                      options: ['marketpricing', 'benchmarking']
                    }
                  })}\n\n`
                ));
                // finish
                controller.enqueue(encoder.encode(
                  `event: finish\ndata: ${JSON.stringify({ status: 'success', reason: 'stop' })}\n\n`
                ));
                controller.close();
              }
            });
            return new Response(stream, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              }
            });
          };
        }
      },

      // ─── STREAM — single endpoint for all interactions ────────────────
      {
        path: '/custom/stream',
        method: 'POST',
        createHandler: async ({ mastra }) => {
          return async (c: any) => {
            const body = await c.req.json();
            const {
              message,
              role,
              conversationId,
              context = {},
              memory = {}
            } = body;

            const { currentStep, threadId } = { ...context, ...memory };
            const sessionId = conversationId || c.get('conversationId') || `sess-${Date.now()}`;

            // Validate
            if (!message) {
              return c.json(
                buildError('INVALID_FRAME', sessionId, 'message is required.'),
                400
              );
            }

            if (conversationId === 'invalid-session') {
              return c.json(
                buildError('SESSION_NOT_FOUND', sessionId),
                403
              );
            }

            const encoder = new TextEncoder();

            // Helper — emit a named SSE event
            const emit = (controller: ReadableStreamDefaultController, event: string, data: object) => {
              controller.enqueue(encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
              ));
            };

            const stream = new ReadableStream({
              async start(controller) {
                try {
                  // Always emit metadata first
                  emit(controller, 'metadata', {
                    conversationId: sessionId,
                    threadId: threadId || null
                  });

                  // ── Routing based on currentStep ──────────────────────

                  // STEP 1 — user selected marketpricing or benchmarking
                  if (currentStep === 'step1') {
                    emit(controller, 'component', {
                      componentType: 'chips',
                      data: {
                        message: 'What are we pricing today?',
                        options: ['family', 'sub-family', 'spec', 'job']
                      }
                    });
                    emit(controller, 'finish', { status: 'success', reason: 'stop' });
                    controller.close();
                    return;
                  }

                  // STEP 2 — user selected family/sub-family/spec/job
                  if (currentStep === 'step2') {
                    emit(controller, 'component', {
                      componentType: 'search',
                      data: {
                        message: 'Select a job specialization',
                        datasource: 'mongodb:survey-metadata-jobarchitecture',
                        filters: ['spec_title']
                      }
                    });
                    emit(controller, 'finish', { status: 'success', reason: 'stop' });
                    controller.close();
                    return;
                  }

                  // JOB SEARCH — user selected a job title
                  if (currentStep === 'job-search') {
                    emit(controller, 'component', {
                      componentType: 'search',
                      data: {
                        message: 'Select a city',
                        datasource: 'mongodb:survey-metadata-location',
                        filters: ['city']
                      }
                    });
                    emit(controller, 'finish', { status: 'success', reason: 'stop' });
                    controller.close();
                    return;
                  }

                  // CITY SEARCH — user selected a city → AI generates checkbox message
                  if (currentStep === 'city-search') {
                    const agent = mastra.getAgent('compensationAgent');
                    const result = await agent.generate([
                      {
                        role: 'user',
                        content: `The user is doing a compensation analysis for a ${context.jobSelection || 'job'} role in ${message}.
                        Return ONLY this exact format: "Select industry : [SectorType]"
                        where [SectorType] is a single broad sector label relevant to their job.
                        Return the message string only. No explanation.`
                      }
                    ]);
                    emit(controller, 'component', {
                      componentType: 'checkbox',
                      data: {
                        message: result.text.trim(),
                        datasource: 'mongodb:survey-metadata-supersector',
                        filters: ['industry']
                      }
                    });
                    emit(controller, 'finish', { status: 'success', reason: 'stop' });
                    controller.close();
                    return;
                  }

                  // INDUSTRY CHECKBOX — user applied industries → AI generates range values
                  if (currentStep === 'industry-checkbox') {
                    const agent = mastra.getAgent('compensationAgent');
                    const result = await agent.generate([
                      {
                        role: 'user',
                        content: `You are a compensation data expert.
                        The user is analyzing compensation for:
                        - Job title: ${context.jobSelection || 'Unknown'}
                        - City: ${context.citySelection || 'Unknown'}
                        - Industries: ${message}
                        
                        Respond with ONLY a raw JSON object, no markdown, no backticks:
                        {"message":"...","min":0,"max":0,"defaultMin":0,"defaultMax":0}
                        
                        Where message is a short label like "Select Position Class Range for [job]",
                        min/max are position class bounds (1-100),
                        defaultMin/defaultMax are P25/P75 of the range.`
                      }
                    ]);

                    let rangeData;
                    try {
                      const cleaned = result.text.replace(/```json|```/g, '').trim();
                      rangeData = JSON.parse(cleaned);
                    } catch (e) {
                      rangeData = {
                        message: `Select Position Class Range for ${context.jobSelection || 'job'}`,
                        min: 50, max: 100, defaultMin: 62, defaultMax: 87
                      };
                    }

                    emit(controller, 'component', {
                      componentType: 'range-selector',
                      data: rangeData
                    });
                    emit(controller, 'finish', { status: 'success', reason: 'stop' });
                    controller.close();
                    return;
                  }

                  // RANGE SELECTOR — user selected range → AI greeting → free text begins
                  if (currentStep === 'range-selector') {
                    const agent = mastra.getAgent('compensationAgent');
                    const memoryOptions = threadId ? {
  memory: {
    resource: sessionId,
    thread: threadId
  }
} : {};

const result = await agent.stream(
  [
    {
      role: 'user',
      content: `The user has completed all parameter selection:
      - Job title: ${context.jobSelection || 'Unknown'}
      - City: ${context.citySelection || 'Unknown'}
      - Industries: ${context.selectedIndustries || 'Not specified'}
      - Position class range: ${message}
      
      Greet them warmly, confirm all their selections briefly in one sentence,
      and ask what they would like to know about compensation analysis.`
    }
  ],
  memoryOptions
);

                    for await (const chunk of result.textStream) {
                      emit(controller, 'text-delta', { text: chunk });
                    }
                    emit(controller, 'finish', { status: 'success', reason: 'stop' });
                    controller.close();
                    return;
                  }

                  // ANALYSIS — trigger async analysis job
                  if (currentStep === 'analysis') {
                    const jobId = `job-${Date.now()}`;
                    emit(controller, 'component', {
                      componentType: 'analysis-status',
                      data: {
                        status: 'pending',
                        jobId
                      }
                    });
                    emit(controller, 'finish', { status: 'success', reason: 'stop' });
                    controller.close();
                    return;
                  }

                  // CHAT — free text conversation with memory
                  if (currentStep === 'chat' || !currentStep) {
                    const agent = mastra.getAgent('compensationAgent');
                    const memoryOptions = threadId ? {
  memory: {
    resource: sessionId,
    thread: threadId
  }
} : {};

const result = await agent.stream(
  [{ role: 'user', content: message }],
  memoryOptions
);

                    for await (const chunk of result.textStream) {
                      emit(controller, 'text-delta', { text: chunk });
                    }
                    emit(controller, 'finish', { status: 'success', reason: 'stop' });
                    controller.close();
                    return;
                  }

                  // Unknown step
                  emit(controller, 'error', {
                    errorCode: 'INVALID_FRAME',
                    message: `Unknown currentStep: ${currentStep}`,
                    retryable: false
                  });
                  emit(controller, 'finish', { status: 'error', reason: 'stop' });
                  controller.close();

                } catch (error: any) {
                  console.error('Stream error:', error);
                  emit(controller, 'error', {
                    errorCode: 'INTERNAL_ERROR',
                    message: error?.message || 'Internal server error',
                    retryable: false
                  });
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
          };
        }
      },

      // ─── ANALYSIS COMPLETION — polling endpoint ───────────────────────
      {
        path: '/custom/analysis/:jobId',
        method: 'GET',
        createHandler: async () => {
          return async (c: any) => {
            const jobId = c.req.param('jobId');
            const conversationId = c.get('conversationId') || null;

            // Simulate completion — in production polls Databricks
            const stream = new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                const emit = (event: string, data: object) => {
                  controller.enqueue(encoder.encode(
                    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
                  ));
                };

                emit('metadata', { conversationId, threadId: null });
                emit('component', {
                  componentType: 'analysis-status',
                  data: {
                    status: 'completed',
                    jobId,
                    analysis_data_id: `data-${Date.now()}`
                  }
                });
                emit('finish', { status: 'success', reason: 'stop' });
                controller.close();
              }
            });

            return new Response(stream, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              }
            });
          };
        }
      }

    ]
  }
});