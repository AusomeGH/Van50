# Van50 Agent Operating Rules

## Direct Antigravity AI Execution (Zero External Gemini API)
1. **No External Gemini APIs**:
   - The Van50 project does NOT use external Gemini API keys or `generativelanguage.googleapis.com` endpoints.
   - All `gemini_*.py` scripts are permanently removed and forbidden.
   - Never run or create scripts that attempt to call Gemini API endpoints or read `GEMINI_API_KEY`.

2. **Antigravity AI is the Intelligence Engine**:
   - Whenever the user requests **"Run AI Scout"**, **"Run QC AI"**, or **"Run Quarantine AI"**, Antigravity AI MUST execute the task directly using its own cognitive reasoning and built-in tools.
   - **Ambiguity & Non-Antigravity AI Prompting Mandate**: If the user ever issues an instruction that mentions an external AI, script, model, or third-party LLM (or if there is any ambiguity about whether an external tool vs. Antigravity AI is intended), the agent **MUST stop and prompt the user for clarification** before taking action. Never assume or execute an external AI surrogate without explicit confirmation.
   - Never attempt to delegate AI scouting, auditing, or healing to a standalone Python script.

3. **Holiday Taxonomy & Discovery Mandate**:
   - Tag events with approved holidays from `data/approved_holidays.json`.
   - If an unapproved holiday is discovered, route it to `pendingHolidays` in `data/approved_holidays.json` and stage the card in `data/manual_review_queue.json` for Curator approval.
   - Include robust keywords/tags for user searching.
