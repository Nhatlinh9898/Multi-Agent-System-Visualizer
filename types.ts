// Matching app/models.py
export enum LayerType {
  PROCESSING = "processing",
  EXECUTION = "execution",
  VALIDATION = "validation",
}

export interface Task {
  id: string;
  layer: LayerType;
  payload: Record<string, any>;
  parent_id?: string;
  metadata?: Record<string, any>;
  // Frontend specific status for visualization
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

export interface Result {
  task_id: string;
  layer: LayerType;
  success: boolean;
  data: Record<string, any>;
  error?: string | null;
  score?: number | null; // Used for validation
}

export interface LogEntry {
  id: string;
  timestamp: string;
  source: string;
  message: string;
}

export interface AgentSystemState {
  isRunning: boolean;
  tasks: Task[];
  results: Result[];
  logs: LogEntry[];
}