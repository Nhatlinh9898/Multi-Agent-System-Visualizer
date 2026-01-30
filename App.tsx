import React, { useReducer, useState, useRef, useEffect } from 'react';
import { LayerType, Task, Result, LogEntry, AgentSystemState } from './types';
import { SuperManagerOrchestrator } from './agentSystem';
import { Activity, CheckCircle, Clock, Server, Play, Terminal, Layers } from 'lucide-react';

// --- Reducer for State Management ---
const initialState: AgentSystemState = {
  isRunning: false,
  tasks: [],
  results: [],
  logs: []
};

type Action = 
  | { type: 'SET_RUNNING'; payload: boolean }
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK_STATUS'; payload: { id: string; status: Task['status'] } }
  | { type: 'ADD_RESULT'; payload: Result }
  | { type: 'ADD_LOG'; payload: LogEntry }
  | { type: 'RESET' };

function systemReducer(state: AgentSystemState, action: Action): AgentSystemState {
  switch (action.type) {
    case 'SET_RUNNING': return { ...state, isRunning: action.payload };
    case 'ADD_TASK': return { ...state, tasks: [...state.tasks, action.payload] };
    case 'UPDATE_TASK_STATUS': 
      return {
        ...state,
        tasks: state.tasks.map(t => t.id === action.payload.id ? { ...t, status: action.payload.status } : t)
      };
    case 'ADD_RESULT': return { ...state, results: [...state.results, action.payload] };
    case 'ADD_LOG': return { ...state, logs: [...state.logs, action.payload] };
    case 'RESET': return initialState;
    default: return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(systemReducer, initialState);
  const [prompt, setPrompt] = useState("Analyze the market trends for electric vehicles in 2025 and propose a marketing strategy.");
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.logs]);

  const handleStart = async () => {
    if (!prompt.trim()) return;
    dispatch({ type: 'RESET' });
    dispatch({ type: 'SET_RUNNING', payload: true });

    const orchestrator = new SuperManagerOrchestrator(dispatch);
    await orchestrator.run({ content: prompt });
  };

  // --- Components for Visualization ---

  const TaskCard = ({ task }: { task: Task }) => {
    const result = state.results.find(r => r.task_id === task.id);
    const isValidation = task.layer === LayerType.VALIDATION;
    const isExecution = task.layer === LayerType.EXECUTION;
    
    let contentPreview = "";
    if (task.layer === LayerType.PROCESSING) contentPreview = "Analyzing Request...";
    else if (task.layer === LayerType.EXECUTION) contentPreview = task.payload.input;
    else if (task.layer === LayerType.VALIDATION) contentPreview = `Validating result of task...`;

    return (
      <div className={`p-3 mb-3 rounded border text-sm transition-all duration-300 ${
        task.status === 'running' ? 'border-blue-400 bg-blue-900/20 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 
        task.status === 'completed' ? 'border-green-800 bg-slate-800' : 
        'border-slate-700 bg-slate-800/50'
      }`}>
        <div className="flex justify-between items-start mb-1">
          <span className="text-xs font-mono text-slate-400">{task.id.slice(0, 6)}</span>
          {task.status === 'running' && <Activity size={14} className="text-blue-400 animate-pulse" />}
          {task.status === 'completed' && <CheckCircle size={14} className="text-green-500" />}
          {task.status === 'pending' && <Clock size={14} className="text-slate-500" />}
        </div>
        
        <div className="text-slate-200 line-clamp-2 mb-2">{contentPreview}</div>

        {result && (
          <div className="mt-2 pt-2 border-t border-slate-700/50 text-xs">
            {isExecution && (
               <div className="text-emerald-300 bg-emerald-900/20 p-1.5 rounded">
                 Output: {result.data.output?.slice(0, 60)}...
               </div>
            )}
            {isValidation && (
                <div className="flex justify-between items-center">
                    <span className={result.score && result.score > 0.7 ? "text-green-400" : "text-yellow-400"}>
                        Score: {result.score?.toFixed(2)}
                    </span>
                    <span className="text-slate-400 italic">{result.data.feedback?.slice(0, 30)}...</span>
                </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const LayerColumn = ({ title, layer, icon: Icon }: { title: string, layer: LayerType, icon: any }) => {
    const layerTasks = state.tasks.filter(t => t.layer === layer);
    
    return (
      <div className="flex-1 bg-slate-800/40 rounded-xl border border-slate-700 flex flex-col h-[600px]">
        <div className="p-4 border-b border-slate-700 flex items-center gap-2 bg-slate-800/60 rounded-t-xl backdrop-blur-sm">
          <Icon size={18} className="text-indigo-400" />
          <h2 className="font-semibold text-slate-100">{title}</h2>
          <span className="ml-auto text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">
            {layerTasks.length}
          </span>
        </div>
        <div className="p-4 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {layerTasks.length === 0 ? (
            <div className="text-center text-slate-600 mt-10 text-sm">Waiting for tasks...</div>
          ) : (
            layerTasks.map(t => <TaskCard key={t.id} task={t} />)
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500 rounded-lg shadow-lg shadow-indigo-500/20">
              <Layers size={20} className="text-white" />
            </div>
            <div>
                <h1 className="font-bold text-lg leading-tight">Multi-Agent Orchestrator</h1>
                <p className="text-xs text-slate-400">Processing • Execution • Validation</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border ${state.isRunning ? 'bg-emerald-900/20 text-emerald-400 border-emerald-900' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                <div className={`w-2 h-2 rounded-full ${state.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                {state.isRunning ? 'System Active' : 'System Idle'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        
        {/* Input Section */}
        <section className="mb-8">
            <div className="bg-slate-800/60 rounded-xl p-1 border border-slate-700 shadow-xl">
                <div className="relative">
                    <textarea 
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        disabled={state.isRunning}
                        className="w-full bg-slate-900 text-slate-200 p-4 pr-32 rounded-lg border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none h-24 transition-all disabled:opacity-50"
                        placeholder="Enter a complex task for the agent swarm..."
                    />
                    <button 
                        onClick={handleStart}
                        disabled={state.isRunning || !prompt}
                        className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all shadow-lg shadow-indigo-900/20"
                    >
                        {state.isRunning ? <Activity size={16} className="animate-spin" /> : <Play size={16} />}
                        Start Run
                    </button>
                </div>
            </div>
        </section>

        {/* Visualizer Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <LayerColumn 
            title="Processing Layer" 
            layer={LayerType.PROCESSING} 
            icon={Server} 
          />
          <LayerColumn 
            title="Execution Layer" 
            layer={LayerType.EXECUTION} 
            icon={Terminal} 
          />
          <LayerColumn 
            title="Validation Layer" 
            layer={LayerType.VALIDATION} 
            icon={CheckCircle} 
          />
        </div>

        {/* System Logs */}
        <section className="bg-black/40 rounded-xl border border-slate-800 overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/80 flex items-center gap-2">
                <Terminal size={14} className="text-slate-500" />
                <span className="text-xs font-mono text-slate-400">System Logs</span>
            </div>
            <div className="h-48 overflow-y-auto p-4 font-mono text-xs text-slate-300 space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
                {state.logs.length === 0 && <span className="text-slate-600">System initialized. Ready for input.</span>}
                {state.logs.map((log) => (
                    <div key={log.id} className="flex gap-3 hover:bg-slate-800/30 p-0.5 rounded">
                        <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
                        <span className="text-indigo-400 font-bold shrink-0 w-24">[{log.source}]</span>
                        <span className="text-slate-300">{log.message}</span>
                    </div>
                ))}
                <div ref={logEndRef} />
            </div>
        </section>

      </main>
    </div>
  );
}