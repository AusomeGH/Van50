import os

agents_md_path = 'AGENTS.md'
skill_md_path = r'C:\Users\Micro\.gemini\config\skills\vancouver-scout\SKILL.md'

rule_9_text = """
9. **Admission Price Floor vs. Optional Add-On Protocol (Zero Deceptive Price Floors)**:
   - **Core Principle**: Optional equipment rentals, tasting tent tokens, caddies, shoe rentals, skate rentals, and coat check fees must NEVER define the minimum entry floor or headline price of an event.
   - **Deceptive Price Floor Prohibition**: If general admission is $18.27 and club rentals are $2.86, displaying `$2.86 – $18.27` is strictly forbidden because it misleads consumers into believing entry is $2.86.
   - **Mandatory Pricing Formula**:
     - **Minimum Floor**: Minimum Base Admission Price (`ev.price` or cheapest active base admission tier).
     - **Upper Ceiling**: Base Admission Price + Max Optional Add-On (`baseMax + maxAddon`).
     - **Example**: Queen Elizabeth Pitch & Putt with $18.27 Adult Green Fee + $2.86 Club Rental MUST display as `$18.27 – $21.13 all-in` (never `$2.86 – $18.27`).
     - **Example**: UBC Apple Festival with $15.00 General Admission + $12.00 Apple Tasting Tent Add-On MUST display as `$15.00 – $27.00 all-in`.
   - **Data Tagging**:
     - Any optional rental or add-on tier in `tiers` or `ticket_tiers` MUST be flagged with `"isAddon": true` and `"is_addon": true`.
     - In synthetic custom tiers: `tier_custom_is_addon_X: true`.
   - **AI Agent Execution Roles**:
     - **Scout AI**: When discovering events with optional add-ons, tag the add-on tiers with `is_addon: true`, ensure `price` represents the true base admission, and verify that `Base + Add-On` respects the ≤ $50 CAD ceiling.
     - **QC AI**: During single-event audits, verify that no add-on tier defines the event's minimum price floor or causes `effectiveMin` to fall below actual admission.
     - **Quarantine AI**: If a quarantined card has inverted add-on pricing, re-calculate the range using `Floor = Base Admission` and `Ceiling = Base Admission + Add-On` before graduating cards to `data/events.json`.
"""

if os.path.exists(agents_md_path):
    with open(agents_md_path, 'r', encoding='utf-8') as f:
        agents_content = f.read()
    if 'Admission Price Floor vs. Optional Add-On Protocol' not in agents_content:
        with open(agents_md_path, 'w', encoding='utf-8') as f:
            f.write(agents_content.rstrip() + '\n' + rule_9_text + '\n')
        print('[OK] Updated AGENTS.md with Rule 9')
    else:
        print('[INFO] AGENTS.md already contains Rule 9')

skill_d11_d12_note = """
    - **Add-On Pricing Protocol**: Equipment rentals, tasting tokens, passes, caddies, shoe rentals, skate rentals, and coat check fees must NEVER set the minimum entry floor. Minimum floor MUST be base admission price (e.g. $18.27), and upper ceiling MUST be base admission plus optional add-on (e.g. $18.27 + $2.86 = $21.13). Tag all add-ons with `"is_addon": true`."""

if os.path.exists(skill_md_path):
    with open(skill_md_path, 'r', encoding='utf-8') as f:
        skill_content = f.read()
    if 'Add-On Pricing Protocol' not in skill_content:
        # Insert after D11 Price in Scout AI
        target_d11 = "11. **D11 Price**: Simulates checkout cart to confirm total all-in price $\\le \\$50.00$ CAD (including all fees & taxes)."
        if target_d11 in skill_content:
            skill_content = skill_content.replace(target_d11, target_d11 + "\n" + skill_d11_d12_note)
        with open(skill_md_path, 'w', encoding='utf-8') as f:
            f.write(skill_content)
        print('[OK] Updated SKILL.md with Add-On Pricing Protocol')
    else:
        print('[INFO] SKILL.md already contains Add-On Pricing Protocol')
