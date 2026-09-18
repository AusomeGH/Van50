import json

with open('data/manual_review_queue.json', 'r', encoding='utf-8') as f:
    q_data = json.load(f)

with open('data/curator_instructions.json', 'r', encoding='utf-8') as f:
    i_data = json.load(f)

q_events = q_data.get('quarantinedEvents', [])
instructions = i_data.get('instructions', [])

print(f"Total currently in quarantine: {len(q_events)}")
print("=" * 70)

held_with_feedback = []

for idx, ev in enumerate(q_events, 1):
    ev_id = ev.get('id')
    title = ev.get('title')
    venue = ev.get('venue')
    notes = ev.get('notes')
    
    # Match by eventId or title or venue
    matches = [i for i in instructions if i.get('eventId') == ev_id or (i.get('eventTitle') and i.get('eventTitle') == title)]
    
    print(f"{idx}. [{ev_id}] \"{title}\" @ {venue}")
    if matches:
        held_with_feedback.append((ev, matches))
        print(f"   -> FOUND {len(matches)} INSTRUCTION(S):")
        for m in matches:
            print(f"      - ID: {m.get('id')} | Status: {m.get('status')} | Action: {m.get('actionTaken')}")
            print(f"        Feedback: \"{m.get('instructionText')}\"")
            shots = m.get('screenshotPaths') or ([m.get('screenshotPath')] if m.get('screenshotPath') else [])
            if shots:
                print(f"        Screenshots ({len(shots)}): {shots}")
    else:
        print("   -> No feedback found.")
    if notes:
        print(f"   Card notes: {notes}")
    print("-" * 70)

print(f"\nSUMMARY: {len(held_with_feedback)} of {len(q_events)} quarantined events have received feedback.")
