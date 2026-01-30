import { GoogleGenAI, Type } from "@google/genai";
import { LayerType, Task, Result, LogEntry } from "./types";
import { v4 as uuidv4 } from 'uuid';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper for logging
const createLog = (source: string, message: string): LogEntry => ({
  id: uuidv4(),
  timestamp: new Date().toLocaleTimeString(),
  source,
  message,
});

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wrapper for Gemini API calls to handle Rate Limits (429)
 * Uses exponential backoff.
 */
async function generateWithRetry(params: any, retries = 5): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (e: any) {
      // Check for rate limit errors (429 or 'RESOURCE_EXHAUSTED')
      const msg = e.message || '';
      const isRateLimit = 
        msg.includes('429') || 
        msg.includes('quota') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        e.status === 429 || 
        e.code === 429;

      if (isRateLimit) {
        if (i < retries - 1) {
            // More aggressive backoff: 2s, 4s, 8s, 16s, 32s
            const waitTime = Math.pow(2, i + 1) * 1000; 
            console.warn(`[Gemini] Rate limit hit (Attempt ${i+1}/${retries}). Retrying in ${waitTime}ms...`);
            await delay(waitTime);
            continue;
        }
      }
      throw e;
    }
  }
}

/**
 * Worker Logic - Adapted from app/agents/worker.py
 */
export class WorkerAgent {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  async executeTask(task: Task): Promise<Result> {
    try {
      if (task.layer === LayerType.PROCESSING) {
        // PROCESSING: Break down request into subtasks
        const content = task.payload.content || "";
        
        const response = await generateWithRetry({
          model: 'gemini-3-flash-preview',
          contents: `Analyze this request and break it down into 2-3 distinct, actionable subtasks.
          Request: "${content}"`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                subtasks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      index: { type: Type.INTEGER },
                      content: { type: Type.STRING },
                    }
                  }
                }
              }
            }
          }
        });
        
        const json = JSON.parse(response.text || "{}");
        const subtasks = json.subtasks || [];
        
        return {
          task_id: task.id,
          layer: task.layer,
          success: true,
          data: { processed: true, subtasks: subtasks },
          score: null,
          error: null
        };
      }

      if (task.layer === LayerType.EXECUTION) {
        // EXECUTION: Perform the subtask
        const inputData = task.payload.input;
        
        const response = await generateWithRetry({
          model: 'gemini-3-flash-preview',
          contents: `Execute the following task concisely: "${inputData}"`
        });

        return {
            task_id: task.id,
            layer: task.layer,
            success: true,
            data: { executed: true, output: response.text },
            score: null,
            error: null
        };
      }

      if (task.layer === LayerType.VALIDATION) {
        // VALIDATION: Grade the result
        const originalInput = task.payload.original_input;
        const execOutput = task.payload.exec_result?.output;

        const response = await generateWithRetry({
          model: 'gemini-3-flash-preview',
          contents: `Rate the quality of this output based on the task on a scale of 0.0 to 1.0.
          Task: "${originalInput}"
          Output: "${execOutput}"`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                score: { type: Type.NUMBER },
                feedback: { type: Type.STRING },
                is_acceptable: { type: Type.BOOLEAN }
              }
            }
          }
        });

        const json = JSON.parse(response.text || "{}");
        
        return {
            task_id: task.id,
            layer: task.layer,
            success: true,
            data: { 
                validated: true, 
                feedback: json.feedback, 
                corrected_output: execOutput 
            },
            score: json.score || 0.8,
            error: null
        };
      }

      throw new Error(`Unknown layer: ${task.layer}`);

    } catch (e: any) {
      console.error(e);
      return {
        task_id: task.id,
        layer: task.layer,
        success: false,
        data: {},
        error: e.message || "Unknown error",
        score: 0
      };
    }
  }
}

/**
 * Orchestrator - Adapted from app/orchestrator.py
 * Manages the flow processing -> execution -> validation
 */
export class SuperManagerOrchestrator {
  private dispatch: React.Dispatch<any>; // Hook into React state
  
  constructor(dispatch: React.Dispatch<any>) {
    this.dispatch = dispatch;
  }

  private log(msg: string) {
    this.dispatch({ type: 'ADD_LOG', payload: createLog("Orchestrator", msg) });
  }

  private updateTaskStatus(id: string, status: Task['status']) {
    this.dispatch({ type: 'UPDATE_TASK_STATUS', payload: { id, status } });
  }

  async run(userRequest: Record<string, any>) {
    try {
        this.log("===== New Orchestration Run =====");

        // 1. Processing Layer
        this.log("Starting Processing Layer...");
        const processingTask: Task = {
        id: uuidv4(),
        layer: LayerType.PROCESSING,
        payload: userRequest,
        status: 'pending'
        };
        
        this.dispatch({ type: 'ADD_TASK', payload: processingTask });
        
        // Run Processing Worker
        this.updateTaskStatus(processingTask.id, 'running');
        const pWorker = new WorkerAgent("ProcessingWorker-1");
        const pResult = await pWorker.executeTask(processingTask);
        
        if (!pResult.success) {
             this.log(`Processing failed: ${pResult.error}`);
             this.updateTaskStatus(processingTask.id, 'failed');
             return;
        }

        this.dispatch({ type: 'ADD_RESULT', payload: pResult });
        this.updateTaskStatus(processingTask.id, 'completed');
        this.log(`Processing complete. Generated ${pResult.data.subtasks?.length || 0} subtasks.`);

        // 2. Execution Layer
        // NOTE: Executing sequentially to avoid hitting Gemini API Rate Limits (429)
        this.log("Starting Execution Layer...");
        const subtasks = pResult.data.subtasks || [];
        const execTasks: Task[] = subtasks.map((st: any) => ({
        id: uuidv4(),
        layer: LayerType.EXECUTION,
        payload: { input: st.content, index: st.index },
        parent_id: processingTask.id,
        status: 'pending'
        }));

        execTasks.forEach(t => this.dispatch({ type: 'ADD_TASK', payload: t }));

        const execResults: Result[] = [];
        for (const task of execTasks) {
            this.updateTaskStatus(task.id, 'running');
            const worker = new WorkerAgent(`ExecutionWorker-${task.payload.index}`);
            
            // Add substantial delay between calls to avoid rate limits
            await delay(2000);
            
            const res = await worker.executeTask(task);
            this.dispatch({ type: 'ADD_RESULT', payload: res });
            this.updateTaskStatus(task.id, res.success ? 'completed' : 'failed');
            execResults.push(res);
        }

        this.log(`Execution complete. ${execResults.length} results collected.`);

        // 3. Validation Layer
        // NOTE: Executing sequentially to avoid Rate Limits
        this.log("Starting Validation Layer...");
        const validationTasks: Task[] = execResults.map((r, idx) => ({
        id: uuidv4(),
        layer: LayerType.VALIDATION,
        payload: { 
            exec_result: r.data, 
            original_input: subtasks[idx]?.content || "Unknown" 
        },
        parent_id: r.task_id,
        status: 'pending'
        }));

        validationTasks.forEach(t => this.dispatch({ type: 'ADD_TASK', payload: t }));

        const valResults: Result[] = [];
        for (const task of validationTasks) {
            this.updateTaskStatus(task.id, 'running');
            const worker = new WorkerAgent(`ValidationWorker`);
            
            // Add substantial delay between calls
            await delay(2000);

            const res = await worker.executeTask(task);
            this.dispatch({ type: 'ADD_RESULT', payload: res });
            this.updateTaskStatus(task.id, res.success ? 'completed' : 'failed');
            valResults.push(res);
        }
        
        // 4. Final Decision
        const validScores = valResults.filter(r => r.score !== null).map(r => r.score || 0);
        const avgScore = validScores.length > 0 
            ? validScores.reduce((a, b) => a + b, 0) / validScores.length 
            : 0;
        
        this.log(`Validation complete. Average Score: ${avgScore.toFixed(2)}`);
        
        if (avgScore < 0.7) {
            this.log("⚠️ Quality below threshold (0.7). Iteration recommended.");
        } else {
            this.log("✅ Quality checks passed. Aggregating outputs.");
        }
    } catch (err: any) {
        console.error("Orchestrator Error:", err);
        this.log(`System Error: ${err.message}`);
    } finally {
        this.dispatch({ type: 'SET_RUNNING', payload: false });
    }
  }
}
