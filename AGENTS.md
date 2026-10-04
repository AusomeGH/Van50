# Van50 Agent Operating Rules

## Direct Antigravity AI Execution (Zero External Gemini API)
1. **No External Gemini APIs**:
   - The Van50 project does NOT use external Gemini API keys or `generativelanguage.googleapis.com` endpoints.
   - All `gemini_*.py` scripts are permanently removed and forbidden.
   - Never run or create scripts that attempt to call Gemini API endpoints or read `GEMINI_API_KEY`.

2. **Antigravity AI is the Intelligence Engine**:
   - Whenever the user requests **"Run AI Scout"**, **"Run QC AI"**, or **"Run Quarantine AI"**, Antigravity AI MUST execute the task directly using its own cognitive reasoning and built-in tools.
   - **Ambiguity & Non-Antigravity AI Prompting Mandate**: If the user ever issues an instruction that mentions an external AI, model, or third-party LLM, the agent **MUST stop and prompt the user for clarification** before taking action.
   - **Scripts vs. Antigravity AI Confirmation Mandate**: Whenever a task could be handled by running an automated script OR by having Antigravity AI perform the task directly (e.g., scouting, auditing, link checking, data cleaning, catalog updates), or whenever the user asks to "run a script" for evaluation/curation, the agent **MUST pause and provide a confirmation prompt** using `ask_question`:
     - Option 1: *(Recommended)* Have Antigravity AI perform the evaluation/action directly using reasoning and built-in tools.
     - Option 2: Run the automated script programmatically via shell.
   - The agent must never silently choose a script when direct AI execution was intended.

3. **Holiday Taxonomy & Discovery Mandate**:
   - Tag events with approved holidays from `data/approved_holidays.json`.
   - If an unapproved holiday is discovered, route it to `pendingHolidays` in `data/approved_holidays.json` and stage the card in `data/manual_review_queue.json` for Curator approval.
   - Include robust keywords/tags for user searching.

4. **AI Workflow Runtime Tracking & Estimation Protocol**:
   - Whenever asked to run **Scout AI**, **QC AI**, or **Quarantine AI**:
     1. **Pre-Run Estimate**: Read `data/ai_runtime_benchmarks.json` and provide an upfront runtime estimate to the user before commencing work (e.g., *"Starting Scout AI. Based on previous runs, this typically takes ~3–5 minutes."*).
     2. **Measure Duration**: Record start timestamp and completion timestamp to calculate exact elapsed duration.
     3. **Persist Benchmark**: Update `data/ai_runtime_benchmarks.json` with the measured duration, timestamp, items processed, and updated rolling average.
     4. **Post-Run Reporting**: Report the elapsed duration in the final summary (e.g., *"Completed in 4m 10s. Recorded duration to benchmark registry for future estimates."*).
