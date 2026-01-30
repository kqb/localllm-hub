To integrate the **Claude Code Wingman** (tmux-based agent) into your **LocalLLM Hub** (Node.js/AgentOS), we will wrap the shell scripts into a dedicated **Node.js Service Package** (`packages/wingman`).

This integrates the "File-System Bus" pattern directly into your AgentOS architecture, allowing your dashboard to monitor autonomous coding agents without blocking the main event loop.

### 1. Architecture Overview

We will add a new package `packages/wingman` that acts as the **Bridge**.

* **Triage (Qwen)**: Routes "Code" tasks to the Wingman Service.
* **Wingman Service (Node)**: Spawns the `claude-wingman.sh` script and watches `/tmp/agent-bus` for status updates.
* **Dashboard**: Polls the Wingman Service to render the live "tmux capture" and "approval" buttons.

---

### 2. Step-by-Step Integration

#### Step 1: Create the Wingman Package

Move your shell scripts into the monorepo structure.

```bash
mkdir -p packages/wingman/scripts
cp ~/code/claude-code-wingman/*.sh packages/wingman/scripts/
chmod +x packages/wingman/scripts/*.sh

```

#### Step 2: The Service Wrapper (`packages/wingman/index.js`)

This Node.js module bridges the gap between your AgentOS (JavaScript) and the Wingman (Shell/Tmux). It implements the **Agent Bus** pattern we discussed.

```javascript
// packages/wingman/index.js
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

const BUS_DIR = '/tmp/agent-bus';
const SCRIPT_DIR = path.join(__dirname, 'scripts');

export class WingmanService extends EventEmitter {
  constructor() {
    super();
    this.ensureBus();
  }

  async ensureBus() {
    try { await fs.mkdir(BUS_DIR, { recursive: true }); } catch (e) {}
  }

  /**
   * Spawns a new autonomous coding agent
   */
  startSession(sessionId, taskPrompt) {
    // 1. Write the Context/Prompt to a file (The "Dead Drop")
    const taskFile = path.join(BUS_DIR, `${sessionId}.task`);
    await fs.writeFile(taskFile, taskPrompt);

    // 2. Spawn the Bridge Script (detached)
    const subprocess = spawn(path.join(SCRIPT_DIR, 'agent-bridge.sh'), [sessionId, taskFile], {
      detached: true,
      stdio: 'ignore'
    });
    subprocess.unref();

    return { status: 'spawned', sessionId };
  }

  /**
   * Reads the "Heartbeat" JSON from the Bus
   */
  async getSessionState(sessionId) {
    try {
      const stateFile = path.join(BUS_DIR, `${sessionId}.state`);
      const data = await fs.readFile(stateFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return { status: 'unknown', active: false };
    }
  }

  /**
   * Sends a signal to the agent (e.g., Approve)
   */
  async sendSignal(sessionId, signal) {
    // Writes to the approval file used by interactive-approver.sh
    const approvalFile = `/tmp/claude-approvals/${sessionId}.response`;
    await fs.writeFile(approvalFile, signal); // "yes", "no", "always"
  }
}

```

#### Step 3: Integrate with Triage (`packages/triage`)

Update your Triage logic to route coding tasks to this new service.

**Modify `packages/triage/index.js`:**

```javascript
// ... existing imports
import { WingmanService } from '@localllm/wingman';
const wingman = new WingmanService();

export async function routeTask(userPrompt) {
  const classification = await classify(userPrompt); // Your existing Qwen classifier

  if (classification.route === 'claude_code') {
    const sessionId = `task-${Date.now()}`;
    console.log(`[Router] Dispatching to Wingman: ${sessionId}`);
    
    // Spawn the agent asynchronously
    wingman.startSession(sessionId, userPrompt);
    
    return {
      type: 'agent_started',
      message: `I've assigned Agent ${sessionId} to handle this code task.`,
      metadata: { sessionId, service: 'wingman' }
    };
  }
  
  // ... handle other routes
}

```

#### Step 4: Update Dashboard (`packages/dashboard`)

The dashboard needs an API endpoint to read the state from the bus.

**Modify `packages/dashboard/server.js`:**

```javascript
// ... inside your Express/Server setup
import { WingmanService } from '@localllm/wingman';
const wingman = new WingmanService();

// API: Get Agent Status
app.get('/api/agent/:id/state', async (req, res) => {
  const state = await wingman.getSessionState(req.params.id);
  res.json(state);
});

// API: Approve/Intervene
app.post('/api/agent/:id/approve', async (req, res) => {
  const { decision } = req.body; // "yes" or "no"
  await wingman.sendSignal(req.params.id, decision);
  res.json({ success: true });
});

```

---

### 3. The Resulting Flow

1. **User:** "Fix the bug in `api.js`"
2. **Localllm-Hub (Triage):** Qwen sees "Coding" -> calls `wingman.startSession()`.
3. **Wingman:** Spawns `tmux` session `task-123` via `claude-wingman.sh`.
4. **Agent Bus:** `agent-bridge.sh` wakes up and starts writing `task-123.state` to `/tmp/agent-bus/`.
5. **Dashboard:** Frontend polls `/api/agent/task-123/state` and renders:
* **Status:** "Waiting for Approval"
* **Live Log:** "Claude Code wants to edit api.js..."


6. **User:** Clicks "Approve" on the dashboard.
7. **Wingman:** Writes to `/tmp/claude-approvals/task-123.response`.
8. **Tmux:** The `auto-approver.sh` inside tmux sees the file, hits `Enter`, and Claude Code continues.

This keeps your Node.js event loop completely free (non-blocking) while maintaining robust control over the heavy coding process.