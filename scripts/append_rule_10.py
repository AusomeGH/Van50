import os

agents_md_path = 'AGENTS.md'
skill_md_path = r'C:\Users\Micro\.gemini\config\skills\vancouver-scout\SKILL.md'

rule_10_text = """
10. **Dimension-by-Dimension Audit & Timestamp Protocol (Zero Rubber-Stamping)**:
    - **Granular Scoping Mandate**: When QC AI audits an event, it MUST NOT issue a blanket or superficial pass. It must systematically inspect each of the 20 discrete dimensions (D1 Title through D20 Showings/Waypoints) sequentially.
    - **Dimension Audit Metadata Schema (`dimension_audit`)**:
      - Each event in `data/events.json` maintains a structured `dimension_audit` object with `last_full_qc_at`, `auditor`, `dimensions_score`, and a `dimensions` map.
      - For each dimension (D1..D20), QC AI records `confirmed_at` (ISO timestamp), `status` (`verified`, `calibrated`, `standardized`), and a descriptive validation `note` or value.
    - **Audit Notes & Anomaly Logging**: Any adjustments made during QC (e.g. link upgrades, price adjustments, tier cleaning) must be documented in `actions_taken` and written to `audit_notes`.
    - **Differential Decay & Freshness**:
      - *High Velocity (Daily/Weekly)*: D2 (Date), D11 (Price), D12 (Tiers), D14 (Link), D19 (Sold-Out) must be audited frequently.
      - *Medium Velocity (Monthly)*: D3 (Time), D4 (Weekly Hours), D13 (Benchmarks), D18 (Restrictions).
      - *Low Velocity (Semi-Annual)*: D1 (Title), D7 (Category), D8 (Location), D9 (Access), D10 (Pricing Model), D16 (Description).
"""

if os.path.exists(agents_md_path):
    with open(agents_md_path, 'r', encoding='utf-8') as f:
        content = f.read()
    if 'Dimension-by-Dimension Audit & Timestamp Protocol' not in content:
        with open(agents_md_path, 'w', encoding='utf-8') as f:
            f.write(content.rstrip() + '\n' + rule_10_text + '\n')
        print('[OK] Appended Rule 10 to AGENTS.md')
    else:
        print('[INFO] AGENTS.md already contains Rule 10')

skill_note = """
### QC AI Dimension Audit Stamping Protocol
Whenever QC AI audits an event card, it must update `dimension_audit` in `data/events.json`:
1. Systematically step through dimensions D1 to D20.
2. Update `confirmed_at` timestamps for each dimension.
3. Log specific validation notes (e.g., cart fee verified, non-blocking URL confirmed, add-on flagged).
4. Persist progress atomically after each event to prevent loss of audit records.
"""

if os.path.exists(skill_md_path):
    with open(skill_md_path, 'r', encoding='utf-8') as f:
        skill_content = f.read()
    if 'QC AI Dimension Audit Stamping Protocol' not in skill_content:
        target = "### QC AI (Integrity Auditor & Anomaly Hunter)"
        if target in skill_content:
            skill_content = skill_content.replace(target, target + "\n" + skill_note)
            with open(skill_md_path, 'w', encoding='utf-8') as f:
                f.write(skill_content)
            print('[OK] Appended Dimension Audit Protocol to SKILL.md')
    else:
        print('[INFO] SKILL.md already contains Dimension Audit Protocol')
