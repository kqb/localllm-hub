1. The Master Routing Table (Anthropic-Heavy)TierModelRoleBest Use CaseRouter KeywordsS1Gemini 3 ProThe Visionary"Blue Sky" & Deep Reasoning: The only model for 1M+ context or "Thinking" tasks. Use for planning, research, and massive data ingestion.PLAN, RESEARCH, DEEP_THINK, HUGE_CONTEXTS2Claude 4.5 OpusThe AuditorCritical Execution: High-stakes refactoring, security audits, and final production code. Strict instruction following.AUDIT, CRITICAL, FINAL_DRAFT, SECURITYAClaude 3.5 SonnetThe EngineerThe Loop: The daily driver for coding features, debugging, and tool use. SOTA at coding speed/quality balance.CODE, DEV, FEATURE, DEBUGBClaude 3.5 HaikuThe AnalystSpeed & Triage: Replacing Flash. Use for summarizing emails, extracting data from text, simple Q&A, and fast re-writing.SUMMARIZE, EXTRACT, FAST, EMAILCQwen 2.5 14BThe InternLocal/Privacy: Search your notes (grep), find files, or handle private data offline on your M4 Max.SEARCH, FIND, LOCAL, PRIVATE2. Haiku-Specific OptimizationsSince you are swapping Flash for Haiku, you need to adjust your provider settings slightly to avoid errors, as Haiku is less forgiving than Flash.Context Limit: Set Haiku to 100k (Keep it safe; it supports 200k, but performance degrades slightly at the limit compared to Flash).Prompt Structure: Haiku loves XML tags.Optimization: In your system prompt for this tier, wrap instructions in <instructions> and data in <data>. Haiku's adherence skyrockets with this format.Routing Logic: Haiku is very literal. If you ask it to "Check this code," it might just say "Looks good."Fix: Ensure your Router sends explicit commands: "Analyze this code and list 3 potential bugs."3. Updated Router Prompt (For Qwen 7B)Update your Triage Module prompt to reflect this Haiku swap.MarkdownROLE: System Router. Classify the User Request.

DECISION TREE:

1. REQUIRES "DEEP THINKING" OR >200K CONTEXT?
   - If "Plan", "Research", "Read entire repo" -> ROUTE: GEMINI_3_PRO
   - Reason: Only Gemini handles massive context/deep thinking.

2. CRITICAL PRODUCTION / SECURITY TASK?
   - If "Audit", "Finalize", "Refactor Security" -> ROUTE: CLAUDE_OPUS
   - Reason: Opus is the strictest architect.

3. STANDARD CODING / DEV LOOP?
   - If "Write function", "Fix bug", "Add feature" -> ROUTE: CLAUDE_SONNET
   - Reason: Best balance of speed/quality for code.

4. FAST TASKS / SUMMARIZATION / DATA?
   - If "Summarize", "Extract", "Rewrite", "Simple Q&A" -> ROUTE: CLAUDE_HAIKU
   - Reason: Fastest API model.

5. LOCAL SEARCH / PRIVATE?
   - If "Search notes", "Find file" -> ROUTE: LOCAL_QWEN
   - Reason: Free & Instant.

OUTPUT FORMAT:
{"route": "claude_haiku", "reason": "Simple summarization task", "priority": "low"}


3. "Sonnet-Specific" Optimizations
Since Sonnet will likely handle 80% of your workload, tune it for speed.

Context Limit: Set Sonnet to 180k (Keep it safe).

Prefill: Sonnet 3.5 is very sensitive to prefill.

Optimization: Do not dump your entire MEMORY.md into Sonnet for every request. It’s wasteful.

Strategy: Use your Local RAG (M4 Max) to find the top 2 relevant snippets and inject only those. Sonnet doesn't need the whole history to write a Python script.

Tool Use: Sonnet 3.5 is currently the State of the Art (SOTA) at tool calling—often better than Opus.

Agent Config: If you have an "Agent Loop" (where the bot runs terminal commands), hard-lock it to Sonnet. Opus is too slow for a write -> run -> error -> fix loop. Sonnet rips through that loop in seconds.


4. Implementation Check (Hardware)
Adding Sonnet is purely an API change, so it won't hurt your M4 Max RAM. However, to make the routing seamless:

The "Switching Cost": Ensure your dashboard doesn't re-load the local model every time you switch routes.

Verification:

Prompt: "Write a simple Python script to parse a CSV." -> Should route to Sonnet.

Prompt: "Design a microservices architecture for a banking app handling 1M users." -> Should route to Opus.

2. Verdict: When to use Opus vs. Gemini 3 Pro?Use this "Tie-Breaker" logic in your router. 
They are not interchangeable; they are complementary.
FeatureGemini 3 ProClaude 4.5 OpusWinner?Reasoning Style
Explorative: It considers multiple angles ("Thinking" mode). Great for "I don't know where to start."Linear & Rigid: It follows instructions to the letter. Great for "Do exactly this, but better."Gemini for Start, Opus for Finish.Context WindowUnlimited (Theoretical): Can read your entire repo (1M+ tokens) effortlessly.Constrained (200k): If your repo is big, it crashes.Gemini (Hands down).Code SafetyCreative: Might suggest novel (but risky) libraries.Conservative: Writes boring, safe, enterprise-standard code.Opus for Production.CostLower: Especially for input tokens.Higher: Unless you use Caching heavily.Gemini for volume.


    Here is the system_haiku.xml template.

Since Claude 3.5 Haiku is optimized for XML parsing, wrapping your instructions in tags drastically increases its adherence to complex formatting rules (like JSON output).

Copy this block into your AgentOS configuration where you define the System Prompt for the claude_haiku route.

XML
<system_instruction>
    <role>
        You are THE ANALYST, a high-speed data processing module within the AgentOS architecture.
        Your goal is to process input rapidly, extract key insights, and output PURE JSON for the dashboard to render.
    </role>

    <constraints>
        <constraint>You must NEVER output conversational filler (e.g., "Here is the JSON"). Output ONLY the JSON object.</constraint>
        <constraint>You must strictly adhere to the defined schema.</constraint>
        <constraint>If the input is unclear, return a JSON error object, do not ask clarifying questions.</constraint>
        <constraint>For summarization tasks, maintain a neutral, objective tone.</constraint>
    </constraints>

    <output_schema>
        You must output a single JSON object with the following structure:
        {
            "status": "success" | "error",
            "type": "summary" | "extraction" | "answer",
            "data": {
                "content": "The main text response or summary here...",
                "metadata": {
                    "source_count": Number,
                    "confidence": "high" | "medium" | "low"
                },
                "key_points": [
                    "Point 1",
                    "Point 2"
                ]
            }
        }
    </output_schema>

    <formatting_rules>
        <rule>Escape all double quotes within the content string.</rule>
        <rule>Do not use markdown code blocks (```json) around the output. Just the raw JSON string.</rule>
        <rule>If the user asks for a specific format (e.g., "List 5 items"), put that formatted text inside the "content" field.</rule>
    </formatting_rules>

    <example_interaction>
        <user_input>
            Summarize this email: "Hi, meeting is moved to 5pm on Tuesday. Best, John."
        </user_input>
        <analyst_response>
            {
                "status": "success",
                "type": "summary",
                "data": {
                    "content": "Meeting rescheduled to Tuesday at 5:00 PM.",
                    "metadata": { "source_count": 1, "confidence": "high" },
                    "key_points": ["New time: 5pm", "Day: Tuesday", "Sender: John"]
                }
            }
        </analyst_response>
    </example_interaction>
</system_instruction>
Next Steps for Implementation
Paste this entire block into your Haiku provider config.

Test with a simple query: "Summarize this text: The quick brown fox jumps over the lazy dog."

Verify that your dashboard parses the JSON correctly (no Markdown backticks).

To implement the router on your M4 Max using Qwen 2.5 14B, you need two things: the System Prompt that forces the logic, and the Configuration Mapping that tells your system what to do with the result.

Here is the complete implementation package.

1. The Qwen Router System Prompt
Paste this into the System Prompt field for your local Qwen 2.5 14B model (often labeled as router_prompt.txt or inside your Triage config).

Markdown
### SYSTEM INSTRUCTION ###
You are the ROOT ROUTER for the AgentOS. Your specific job is to classify user requests into the correct execution tier.
You must output ONLY a valid JSON object. No markdown, no conversation.

### TIER DEFINITIONS ###

[S1] GEMINI_3_PRO ("The Visionary")
- TRIGGERS: "Plan", "Research", "Analyze entire repo", "Deep thought", >200k context.
- USE CASE: Massive data ingestion, complex architectural planning, ambiguous problem solving.

[S2] CLAUDE_OPUS ("The Auditor")
- TRIGGERS: "Audit", "Finalize", "Refactor Security", "Production Readiness".
- USE CASE: High-stakes execution where safety and strict adherence are critical.

[A] CLAUDE_SONNET ("The Engineer")
- TRIGGERS: "Write code", "Fix bug", "Add feature", "Refactor function".
- USE CASE: The standard coding loop. Best balance of speed and tool use.

[B] CLAUDE_HAIKU ("The Analyst")
- TRIGGERS: "Summarize", "Extract data", "Rewrite", "Email", "Simple Q&A".
- USE CASE: High-speed text processing and low-stakes generation.

[C] LOCAL_QWEN ("The Intern")
- TRIGGERS: "Search notes", "Find file", "List directory", "Private data".
- USE CASE: Zero-cost, local-only queries using simple tools.

### OUTPUT FORMAT ###
You must reply with this exact JSON structure:
{
  "route": "gemini_3_pro" | "claude_opus" | "claude_sonnet" | "claude_haiku" | "local_qwen",
  "reason": "Brief explanation of why this route was chosen",
  "priority": "high" | "medium" | "low"
}

### EXAMPLES ###
User: "Design a microservices architecture for our payment gateway."
Output: {"route": "gemini_3_pro", "reason": "Requires high-level architectural planning", "priority": "high"}

User: "Fix the regex bug in auth.ts"
Output: {"route": "claude_sonnet", "reason": "Standard code fixing task", "priority": "medium"}

User: "Summarize this PDF for me."
Output: {"route": "claude_haiku", "reason": "Text summarization task", "priority": "low"}
2. The Model Configuration (JSON)
Update your models.json (or config.js depending on your specific AgentOS fork) to map the router's output strings to your actual API endpoints.

JSON
{
  "router": {
    "model": "qwen2.5-14b-instruct",
    "provider": "ollama_local",
    "temperature": 0.1
  },
  "routes": {
    "gemini_3_pro": {
      "model_id": "gemini-experimental",
      "provider": "google",
      "context_limit": 1000000,
      "thinking_level": "high"
    },
    "claude_opus": {
      "model_id": "claude-3-opus-20240229",
      "provider": "anthropic",
      "context_limit": 190000,
      "cache_control": true
    },
    "claude_sonnet": {
      "model_id": "claude-3-5-sonnet-20240620",
      "provider": "anthropic",
      "context_limit": 180000
    },
    "claude_haiku": {
      "model_id": "claude-3-5-haiku-20241022",
      "provider": "anthropic",
      "context_limit": 100000,
      "system_prompt_override": "system_haiku.xml"
    },
    "local_qwen": {
      "model_id": "qwen2.5:14b",
      "provider": "ollama_local",
      "context_limit": 32000
    }
  }
}
3. Verification Test
To confirm your M4 Max is routing correctly, run these 3 prompts in your dashboard and check the Debug Log (or the "Agent Monitor" panel in your screenshot):

Test S1: "Read all 50 documentation files in the /docs folder and plan a migration strategy."

Goal: Should hit gemini_3_pro.

Test B: "Summarize the last email I received from John."

Goal: Should hit claude_haiku.

Test A: "Write a Python script to scrape a website."

Goal: Should hit claude_sonnet.

This is the "All-Star" Architecture. You are keeping the best-in-class models from every category:Gemini 3 Pro: The Visionary (Deep Reasoning + Infinite Context).Claude Opus: The Auditor (Precision + Safety).Claude Sonnet: The Engineer (Speed + Tooling).Claude Haiku: The Analyst (Speed + Data).Qwen 2.5 14B: The Local Operator (Privacy + Router).This gives you the most robust AgentOS possible. Here is the final, cemented configuration to make them work in harmony on your M4 Max.1. The Master Routing Table (The "All-Star" Team)TierModelRoleBest Use CaseRouter KeywordsS1Gemini 3 ProThe Visionary"Blue Sky" & Massive Context: Planning architectures, reading entire repos (>200k tokens), or tasks requiring "Thinking" mode.PLAN, RESEARCH, DEEP_THINK, HUGE_CONTEXTS2Claude 4.5 OpusThe AuditorCritical Execution: Final production code, security refactors, and high-stakes instruction following.AUDIT, CRITICAL, FINAL_DRAFT, SECURITYAClaude 3.5 SonnetThe EngineerThe Dev Loop: Writing features, fixing bugs, running tests. The workhorse for 80% of coding tasks.CODE, DEV, FEATURE, DEBUGBClaude 3.5 HaikuThe AnalystTriage & Data: Summarizing emails, extracting JSON, simple Q&A. Replaces Gemini Flash/Nano.SUMMARIZE, EXTRACT, FAST, EMAILCQwen 2.5 14B (Local)The InternLocal/Privacy: Searching notes (grep), finding files, listing directories. Zero cost/latency.SEARCH, FIND, LOCAL, PRIVATE2. The Router System Prompt (For Local Qwen)Update your Triage Module prompt (running on your M4 Max) to this exact logic. It splits traffic between the two giants (Gemini/Opus) based on intent.MarkdownROLE: System Router. Classify the User Request into the optimal execution route.

DECISION TREE:

1. REQUIRES "DEEP THINKING" OR >200K CONTEXT?
   - Triggers: "Plan", "Research", "Analyze entire repo", "Read all files", "Think deeply".
   - Route: GEMINI_3_PRO
   - Reason: Only Gemini handles >200k context and has "Thinking" mode.

2. CRITICAL PRODUCTION / SECURITY TASK?
   - Triggers: "Audit", "Finalize", "Refactor Security", "Production Ready".
   - Route: CLAUDE_OPUS
   - Reason: Opus has the highest safety and instruction adherence.

3. STANDARD CODING / DEV LOOP?
   - Triggers: "Write function", "Fix bug", "Add feature", "Create script".
   - Route: CLAUDE_SONNET
   - Reason: Best balance of speed/quality for iterative coding.

4. FAST PROCESSING / DATA / TRIAGE?
   - Triggers: "Summarize", "Extract", "Rewrite", "Email", "Simple Q&A".
   - Route: CLAUDE_HAIKU
   - Reason: Fastest API model for simple tasks.

5. LOCAL SEARCH / PRIVATE?
   - Triggers: "Search notes", "Find file", "List directory", "Private data".
   - Route: LOCAL_QWEN
   - Reason: Zero latency, local privacy.

OUTPUT FORMAT:
{"route": "gemini_3_pro", "reason": "Requires high context planning", "priority": "high"}
3. The Fallback Strategy (Cross-Provider Resilience)Since you are using both stacks, you can use them to back each other up. If Anthropic goes down, Gemini saves the day (and vice-versa).The Logic:Haiku Fails? -> Escalates to Sonnet.Sonnet Fails? -> Escalates to Gemini 3 Pro (The "Big Gun" backup).Opus Fails? -> Sidesteps to Gemini 3 Pro.Gemini 3 Pro Fails? -> Sidesteps to Opus (but warns about context limit).The Code (TypeScript):TypeScriptconst FALLBACK_MAP = {
  // Haiku fails -> Upgrade to Sonnet
  "claude_haiku": ["claude_sonnet"],
  
  // Sonnet fails -> Switch provider to Gemini 3 Pro
  "claude_sonnet": ["gemini_3_pro"],
  
  // Opus fails -> Switch provider to Gemini 3 Pro
  "claude_opus": ["gemini_3_pro"],
  
  // Gemini fails -> Switch provider to Opus (Context warning applies)
  "gemini_3_pro": ["claude_opus"] 
};
4. M4 Max Hardware Check (Final Configuration)To run this "All-Star" setup smoothly on your 36GB machine:Router Model: qwen2.5:14b-instruct-q4_k_mRAM Usage: ~9GB.Role: Runs the Router Prompt + "The Intern" tasks.Status: Always loaded (Keep in RAM).Context Cache (KV):Allocation: ~10-12GB reserved.Setting: num_ctx: 32768 (32k) for the local Qwen model.Why: This allows "The Intern" to read fairly large local files (like logs) without crashing.Embeddings: nomic-embed-text (or mxbai-embed-large)RAM Usage: ~1GB.Role: Powers your "Memory Bank" search.Total VRAM Usage: ~22GB (leaving ~14GB for MacOS + overhead). This is the perfect safe zone for performance.



    Here is the breakdown of how to route "Planning" effectively in your AgentOS.1. The Two Types of "Planning"You need to split your S-Tier into two distinct planning phases.Phase 1: Macro-Planning (The Strategist) -> Gemini 3 ProGemini 3 Pro's advantage is Context Liquidity. It can hold your entire repo, documentation, and messy user notes in RAM.The Job: "Ingest this mess and find a path forward."Why Gemini? Planning often requires connecting dot A (in file 1) to dot B (in file 500). Claude Opus (200k limit) physically cannot see both dots at once in a large system. Gemini 3 Pro (2M+) can.The "Deep Think" Edge: Its reasoning is exploratory. It is willing to say, "We could try approach X, Y, or Z," which is vital for early-stage roadmap planning.Phase 2: Micro-Planning (The Architect) -> Claude 4.5 OpusClaude Opus's advantage is Constraint Rigidity. It treats instructions as law.The Job: "Take this loose roadmap and turn it into a strict specification."Why Opus? Once Gemini finds the path, you need a model that won't "get creative" with your security protocols or variable naming conventions. Opus generates "Execution Plans" (Step-by-step Implementation Docs) that are boring, safe, and compile on the first try.2. The Updated "Planning" Routing TableDo not just route "Planning" to one model. Route based on the ambiguity of the plan.Planning PhaseModelTrigger KeywordsThe "Prompt" StrategyStrategic PlanningGemini 3 ProROADMAP, BRAINSTORM, REFACTOR_STRATEGY, IMPACT_ANALYSIS"Read the entire /src folder and user_request.md. Propose 3 architectural strategies to solve this. List pros/cons."Execution PlanningClaude OpusSPECIFICATION, INTERFACE_DEF, MIGRATION_STEP, SECURITY_AUDIT"Here is the Strategy from Gemini. Convert this into a strict 10-step implementation plan. Define exact file paths and function signatures."3. The "Handoff" Workflow (AgentOS)In your Triage Module, you can implement a "Two-Pass Planning" route for complex tasks.User Request: "Refactor the entire auth system to use OAuth2."Route: S1_STRATEGY (Gemini 3 Pro).Input: All auth files + documentation.Output: A high-level strategy document (Markdown).Agent Action: The system automatically feeds Gemini's output into Opus.Route: S2_ARCHITECT (Claude Opus).Input: Gemini's Strategy + Specific target files.Output: The TODO.md checklist for your Sonnet (Engineer) agents to execute.4. Revised Router Prompt (for Planning Nuance)Update your Qwen router to distinguish between "Strategy" and "Spec".MarkdownDECISION TREE (PLANNING SUB-SECTION):

1. IS THE PLAN "EXPLORATORY" OR "CONTEXT-HEAVY"?
   - Triggers: "How should we...", "Propose a strategy...", "Analyze impact on repo...", "Roadmap".
   - Route: GEMINI_3_PRO
   - Reason: Needs 1M+ context to see the whole picture and "Deep Think" to find options.

2. IS THE PLAN "DEFINITIVE" OR "SPECIFICATION"?
   - Triggers: "Create implementation plan", "Define interface", "Write technical spec", "Break down tasks".
   - Route: CLAUDE_OPUS
   - Reason: Needs strict logic to convert a strategy into actionable, safe steps.
5. Why this matters (The "Vending Machine" Benchmark)Benchmarks from late 2025 (like Vending-Bench 2) showed that Gemini 3 Pro excels at "Long-Horizon" decision making (keeping a business alive for a year) because it remembers history. However, Claude Opus typically wins on SWE-Bench Verified because it doesn't make syntax errors in the immediate code.Use Gemini to steer the ship (Long Horizon). Use Opus to steer the pen (Code Accuracy).Here is a video detailing a workflow that specifically combines Gemini's frontend/speed capabilities with Claude's architectural planning, which mirrors the setup you are building.


    Here is the pre_process_planning.js script.

This script acts as a "Compression Layer" for your AgentOS. It runs locally on your Node.js backend (dashboard), utilizing Claude 3.5 Haiku to turn raw code into high-density "Architectural Briefs."

This allows Claude Opus to "see" 50+ files without blowing its 200k context limit.

1. The Script (pre_process_planning.js)
You will need to install the dependencies: npm install @anthropic-ai/sdk fast-glob dotenv

JavaScript
// pre_process_planning.js
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fg = require('fast-glob');
const fs = require('fs').promises;

// Initialize Anthropic with your specific setup
// If you use a local proxy (like Clawdbot), change the baseURL here.
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, 
});

/**
 * THE "DISTILLER" PROMPT
 * Forces Haiku to strip implementation details and keep only the architecture.
 */
const HAIKU_SYSTEM_PROMPT = `
You are a code compressor. Your goal is to create an "Architectural Summary" of the provided file.
1. List all EXPORTED interfaces, types, functions, and classes (signatures only).
2. List all IMPORTS (dependencies).
3. Summarize the core responsibility of the file in 1 sentence.
4. OMIT function bodies and implementation details.
5. Output strict Markdown.
`;

/**
 * 1. The "Scanner": Finds files based on your router's intent
 */
async function scanFiles(patterns = ['src/**/*.ts', 'src/**/*.js']) {
  // Exclude node_modules, tests, and dist to save tokens
  const entries = await fg(patterns, { ignore: ['**/node_modules/**', '**/*.test.ts', '**/dist/**'] });
  console.log(`[Scanner] Found ${entries.length} files to analyze.`);
  return entries.slice(0, 50); // Hard cap for safety, adjust as needed
}

/**
 * 2. The "Distiller": Sends raw code to Haiku
 */
async function distillFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    
    // Quick skip for tiny files
    if (content.length < 500) return `## ${filePath}\n(Small file)\n\`\`\`\n${content}\n\`\`\``;

    console.log(`[Haiku] Distilling: ${filePath}...`);

    const msg = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1000,
      temperature: 0,
      system: HAIKU_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `FILE PATH: ${filePath}\n\nCONTENT:\n${content}` }
      ]
    });

    return `## ${filePath}\n${msg.content[0].text}`;
  } catch (err) {
    console.error(`[Error] Failed to distill ${filePath}:`, err.message);
    return `## ${filePath}\n(Analysis Failed)`;
  }
}

/**
 * 3. The "Aggregator": Parallel processing
 */
async function generatePlanningContext(targetPatterns) {
  console.time("Planning Context Generation");
  
  const files = await scanFiles(targetPatterns);
  
  // Run Haiku in parallel (batches of 5 to avoid rate limits)
  const batchSize = 5;
  const summaries = [];
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(distillFile));
    summaries.push(...results);
  }

  const finalReport = `# ARCHITECTURAL CONTEXT (Generated by Haiku)\n\n${summaries.join('\n\n')}`;
  
  console.timeEnd("Planning Context Generation");
  return finalReport;
}

// --- EXECUTION EXAMPLE ---
// Only run if called directly
if (require.main === module) {
  (async () => {
    // Example: User wants to refactor the Auth system
    const context = await generatePlanningContext(['src/auth/**/*.ts', 'src/controllers/*.ts']);
    
    // Save this to a file that Opus will read
    await fs.writeFile('PLANNING_CONTEXT.md', context);
    console.log("[Success] Written to PLANNING_CONTEXT.md");
  })();
}

module.exports = { generatePlanningContext };
2. How to hook this into your AgentOS Router
You need to modify your main "Agent Loop" to check for the PLAN keyword. If detected, run this script before calling Opus.

In your agent_main.ts (or similar):

TypeScript
import { generatePlanningContext } from './pre_process_planning';
import { callOpus } from './llm_client';

async function handleUserRequest(userPrompt, route) {

  // DETECT PLANNING ROUTE
  if (route.model === "claude_opus" && route.reason.includes("plan")) {
    
    notifyUser("Status: Analyzing codebase structure with Haiku...");
    
    // 1. Identify likely target files (using simple regex or Qwen Router)
    // For now, let's assume we scan the 'src' folder
    const patterns = ['src/**/*.ts']; 
    
    // 2. Run the Pre-Processor
    const architecturalSummary = await generatePlanningContext(patterns);
    
    // 3. Inject into Opus Prompt
    const enhancedPrompt = `
      ${userPrompt}
      
      ---
      CONTEXT:
      I have attached an architectural summary of the codebase below. 
      Use this to create the roadmap. DO NOT guess implementation details.
      
      ${architecturalSummary}
    `;
    
    // 4. Call Opus with the "Compressed" Context
    return await callOpus(enhancedPrompt);
  }

  // ... standard logic for other routes
}
3. Why this optimization wins
Token Savings: A 500-line TypeScript file consumes ~2,000 tokens. Haiku compresses it to ~200 tokens (Interface definitions only). You save 90% context space.

Focus: Opus isn't distracted by "spaghetti code" inside functions. It sees only the "Lego blocks" (Classes/Functions), which is exactly what an Architect needs to see to build a plan.

Speed: Haiku runs in parallel. 50 files take about 5 seconds to process. Opus then answers instantly because the input context is small.